# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Backcountry Conditions — a backcountry planning app that synthesizes weather, avalanche, alerts, air quality, snowpack, and terrain signals into a single planning interface with date/time-aware risk checks.

## Commands

### Backend (`cd backend`)

```bash
npm run dev              # Start API server (port 3001)
npm run test             # Run every Jest suite (unit, integration, scenario)
npm run test:unit        # All test/unit.*.test.js files
npm run test:integration # All test/integration.*.test.js files
npm run db:migrate       # Apply SQL migrations in backend/migrations/ (needs DATABASE_URL)
```

### Frontend (`cd frontend`)

```bash
npm run dev              # Start Vite dev server (port 5173, proxies /api to backend)
npm run dev:mock         # Vite with the in-browser mock API (no backend needed)
npm run typecheck        # TypeScript compilation check
npm run lint             # ESLint validation
npm run test:ui          # Every tests/*.test.jsx (node:test + jsdom, bundled by esbuild)
npm run test:mock        # Mock API / persistence tests
npm run build            # Production build → frontend/dist/
```

`test:ui` discovers test files automatically — no list to update. Pass a name fragment to run a subset (`npm run test:ui -- admin`). A test file whose first line is `// @env production` is built with `import.meta.env.DEV=false`.

### MCP server (`cd mcp`)

```bash
npm test                 # MCP tool tests
```

### Run a single test file or pattern

```bash
cd backend && npx jest test/unit.helpers.test.js
cd backend && npx jest test/integration.api.test.js
cd backend && npx jest --testNamePattern="wind parsing"
cd frontend && npm run test:ui -- report-history
```

## Architecture

Three parts: React + Vite SPA (`frontend/`), Express API (`backend/`, PostgreSQL for accounts/saved reports/watches), and a read-only MCP server (`mcp/`) that proxies each user's OAuth token to the backend. Node 24 in CI and Docker; `>=22` locally.

### Backend

- **`backend/index.js`** — composition root (~1k lines): wires services, defines the `/api/safety` handler (`safetyHandler`), and registers every route module.
- **`backend/src/routes/`** — route modules, each exporting a `register*Route(s)` function: `safety`, `evaluate`, `plan-comparisons` (start-time scenarios, day-over-day), `search`, `trip-forecasts`, `itineraries`, `saved-itineraries`, `route-analysis`, `ai-brief`, `report-chat`, `report-logs`, `saved-reports`, `objective-watches`, `objective-watch-checks`, `account`, `mcp-oauth`, `feature-flags`, `health`, `satellite-tile`, `snow-vision`.
- **`backend/src/utils/`** — domain logic. Plan evaluation (everything the app shows about a plan): `plan-evaluation.js` (entry point), `plan-context.js` (plan params → limits, units, approach), `decision.js`, `travel-window.js`, `critical-window.js`, `wind-loading.js`, `verdict.js`, `report-interpretation.js` (precipitation, snowpack, fire/heat, surface, source freshness, visibility, chart rows), `terrain-window.js`, `start-time-scenarios.js`, `day-over-day.js`, `trip-days.js`, `itinerary-assessment.js` (a multi-day trip's days, camp nights, weak link and verdict), `camp-night.js` (the planned night at camp after an itinerary day; `/api/safety?camp_night=1`), `display-format.js` (unit/clock formatting). Upstream data: `weather-pipeline.js` / `weather-data.js` (NOAA + Open-Meteo), `avalanche-pipeline.js` / `avalanche-orchestration.js` / `avalanche-detail.js` (zone resolution, bulletin parsing, center-specific fixes), `safety-score.js`, `activity-profiles.js` (per-activity limits and route timing, hazard weights, snow-travel avalanche relevance, AI framing; the frontend's `app/activity-profiles.ts` keeps labels and chapter/check order), `snowpack.js`, `alerts.js`, `precipitation.js`, `fire-risk.js`, `heat-risk.js`, `supplemental-evidence.js`, `ai-client.js`, `http-client.js` (fetch with timeout + circuit breaker).
- **`backend/src/auth/`** — accounts, passwords, Google identity, tiers, usage limits, MCP OAuth.
- **`backend/src/db/`** — PostgreSQL access (`database.js`, `app-data-store.js`); schema in `backend/migrations/*.sql`. Without `DATABASE_URL`, persistent features are disabled.
- **`backend/src/services/`** — background jobs: objective-watch checker/scheduler, health monitor.
- **`backend/src/email/`** — Resend email service and templates.
- **`backend/src/server/`** — `runtime.js` (env parsing), `create-app.js` (middleware/CORS/rate limiting/request IDs), `start-server.js` (listen + graceful shutdown).
- **`backend/src/data/cdec-snow-stations.json`** — static CDEC snow station reference data for California.

### Frontend

- **`frontend/src/main.tsx`** → **`frontend/src/field/FieldApp.tsx`** — the live app. `field/` holds the screens (`Report`, `Compare`, `Library`, `Settings`, `Administration`, `Chat`, …), lazily loaded from `FieldApp`.
- **`frontend/src/field/model/`** — state hooks: `useWorkspace.ts` (planner state, the `Workspace` object passed to most screens), `useAdministration.ts`, `useReportGeneration.ts`, `useReportComparisons.ts`, `useSavedReportSync.ts`, `useObjectiveShortlist.ts`.
- **`frontend/src/app/`** — helpers shared by screens: `types.ts` (domain interfaces, including `PlanEvaluation`), `constants.ts`, `core.ts` (formatting), `preferences.ts`, `plan-evaluation.ts` (plan params, reading evaluations), `report-storage.ts`, etc. The frontend presents: decisions, hourly checks, comparisons and report interpretation come from the backend's evaluation; do not add domain logic here.
- **Multi-day trips** — a plan type, not a screen: the plan form's Day trip / Multi-day switch (`field/ItineraryPlan.tsx`), state in `field/model/useItinerary.ts`, the draft and request in `app/itinerary.ts`, the trip brief in `field/Itinerary.tsx`. The backend (`/api/itineraries/check`, `utils/itinerary-assessment.js`) decides each day and night and the trip verdict: the trip is its weakest day or night, and unchecked is never good. Compare (`field/Compare.tsx`) is the separate pick-a-day tool.
- **`frontend/src/hooks/`**, **`frontend/src/contexts/`** — data-fetching hooks (`useSafetyData`, `usePlanEvaluation`, `useTripForecast`, `useStartTimeScenarios`, …) and account/feature-flag/AI-access providers.
- **`frontend/src/lib/`** — `api-client.ts` (API calls + retry), `search.ts` (local peak catalog + Nominatim), `gpx.ts`, `saved-reports.ts`, `objective-watches.ts`.
- **`frontend/dev/`** — mock API used by `dev:mock` and `test:mock`.
- Styling is plain CSS colocated with the screens (`field/*.css`); there is no Tailwind or component library.

### `/api/safety` pipeline

1. Validate `lat`, `lon`, `date`, `start`
2. Load NOAA weather (primary) → fill gaps from Open-Meteo fallback
3. Load solar data
4. Resolve avalanche zone (polygon match or nearest fallback, Utah-specific fallback)
5. Parse avalanche bulletin (problems, danger ratings, bottom line)
6. Load alerts, air quality, precipitation, snowpack in parallel
7. Evaluate avalanche relevance for objective/time context
8. Classify terrain/trail surface
9. Build fire risk + safety score with confidence factors
10. Attach `evaluation` (`attachPlanEvaluation`): the decision, hourly checks, verdict, wind loading, report interpretation, terrain window and elevation estimates for the plan params in the query
11. Return unified payload; on partial upstream failures returns `200` with `partialData: true` + `apiWarning`

When the plan changes after a report loads (limits, units, approach, target elevation) or a stored evaluation is stale, the frontend re-evaluates the report with `POST /api/evaluate { report, plan }` instead of computing anything itself. Plan params are the flat keys in `PLAN_PARAM_KEYS` (`src/utils/plan-context.js`); the evaluation echoes them in `evaluation.params`.

### Upstream providers

- **Weather**: NOAA/NWS (`api.weather.gov`) primary, Open-Meteo fallback
- **Avalanche**: Avalanche.org map/product feeds, center-link scraping fallback
- **Solar**: `api.sunrisesunset.io`
- **Snowpack**: NRCS AWDB/SNOTEL, NOAA NOHRSC
- **Search/Elevation**: OpenStreetMap Nominatim, USGS/Open-Meteo

### User preferences

Persisted in browser local storage under `USER_PREFERENCES_KEY` (`frontend/src/app/constants.ts`, `…user-preferences:v1`). Report numbers stay imperial (°F, mph, ft, in) and the frontend formats them for display; the evaluation's text (reasons, captions, labels) is written in the units sent as plan params (`temp_unit`, `wind_unit`, `elevation_unit`, `time_style`).

## Design Constraints

- Keep `backend/index.js` as the composition root: put new logic in `src/utils/` (or `src/services/`) and new endpoints in `src/routes/` with a `register*` function.
- Center-specific avalanche handling (e.g. the Utah fallback) exists as explicit hotfix logic in `backend/index.js`, `src/utils/avalanche-pipeline.js` and `src/utils/avalanche-detail.js` — check these before modifying avalanche parsing.
- Backend module system is **CommonJS** (`require`/`module.exports`). Frontend is **ES modules** (`import`/`export`).
- Backend test suite (`test/unit.helpers.test.js`) is extremely large; run targeted tests during development.
- `AI_PROVIDER` selects the preferred `openai` (default), `anthropic`, or `gemini` provider. Failed or timed-out requests retry through the other configured providers. Gemini uses Google's OpenAI-compatible API and defaults to `gemini-3.7-flash`/`gemini-3.5-flash-lite`. The `/api/healthz` response exposes preferred/fallback providers and model IDs without exposing credentials.
- Set `DEBUG_AVY=true` in `backend/.env` to enable verbose avalanche pipeline debug logs.
