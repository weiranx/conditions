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
- **`backend/src/routes/`** — route modules, each exporting a `register*Route(s)` function: `safety`, `search`, `trip-forecasts`, `route-analysis`, `ai-brief`, `report-chat`, `report-logs`, `saved-reports`, `objective-watches`, `objective-watch-checks`, `account`, `mcp-oauth`, `feature-flags`, `health`, `satellite-tile`, `snow-vision`.
- **`backend/src/utils/`** — domain logic. Notable: `weather-pipeline.js` / `weather-data.js` (NOAA + Open-Meteo), `avalanche-pipeline.js` / `avalanche-orchestration.js` / `avalanche-detail.js` (zone resolution, bulletin parsing, center-specific fixes), `safety-score.js`, `snowpack.js`, `alerts.js`, `precipitation.js`, `fire-risk.js`, `heat-risk.js`, `supplemental-evidence.js`, `ai-client.js`, `http-client.js` (fetch with timeout + circuit breaker).
- **`backend/src/auth/`** — accounts, passwords, Google identity, tiers, usage limits, MCP OAuth.
- **`backend/src/db/`** — PostgreSQL access (`database.js`, `app-data-store.js`); schema in `backend/migrations/*.sql`. Without `DATABASE_URL`, persistent features are disabled.
- **`backend/src/services/`** — background jobs: objective-watch checker/scheduler, health monitor.
- **`backend/src/email/`** — Resend email service and templates.
- **`backend/src/server/`** — `runtime.js` (env parsing), `create-app.js` (middleware/CORS/rate limiting/request IDs), `start-server.js` (listen + graceful shutdown).
- **`backend/src/data/cdec-snow-stations.json`** — static CDEC snow station reference data for California.

### Frontend

- **`frontend/src/main.tsx`** → **`frontend/src/field/FieldApp.tsx`** — the live app. `field/` holds the screens (`Report`, `Compare`, `Library`, `Settings`, `Administration`, `Chat`, …), lazily loaded from `FieldApp`.
- **`frontend/src/field/model/`** — state hooks: `useWorkspace.ts` (planner state, the `Workspace` object passed to most screens), `useAdministration.ts`, `useReportGeneration.ts`, `useReportComparisons.ts`, `useSavedReportSync.ts`, `useObjectiveShortlist.ts`.
- **`frontend/src/app/`** — pure helpers shared by screens: `types.ts` (domain interfaces), `constants.ts`, `core.ts`, `preferences.ts`, `decision.ts`, `report-storage.ts`, display helpers (`*-display.ts`), etc.
- **`frontend/src/hooks/`**, **`frontend/src/contexts/`** — data-fetching hooks (`useSafetyData`, `useTripForecast`, …) and account/feature-flag/AI-access providers.
- **`frontend/src/lib/`** — `api-client.ts` (API calls + retry), `search.ts` (local peak catalog + Nominatim), `gpx.ts`, `saved-reports.ts`, `objective-watches.ts`.
- **`frontend/dev/`** — mock API used by `dev:mock` and `test:mock`.
- **Legacy UI:** `frontend/src/App.tsx`, `components/planner/*`, `components/views/*` and most of `styles/` are the previous planner UI. `main.tsx` no longer imports them, so they are not in the production bundle — do not add features there.

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
10. Return unified payload; on partial upstream failures returns `200` with `partialData: true` + `apiWarning`

### Upstream providers

- **Weather**: NOAA/NWS (`api.weather.gov`) primary, Open-Meteo fallback
- **Avalanche**: Avalanche.org map/product feeds, center-link scraping fallback
- **Solar**: `api.sunrisesunset.io`
- **Snowpack**: NRCS AWDB/SNOTEL, NOAA NOHRSC
- **Search/Elevation**: OpenStreetMap Nominatim, USGS/Open-Meteo

### User preferences

Persisted in browser local storage under `USER_PREFERENCES_KEY` (`frontend/src/app/constants.ts`, `…user-preferences:v1`). Unit conversions (temp, elevation, wind, time) are display-side only — backend always returns SI-adjacent values.

## Design Constraints

- Keep `backend/index.js` as the composition root: put new logic in `src/utils/` (or `src/services/`) and new endpoints in `src/routes/` with a `register*` function.
- Center-specific avalanche handling (e.g. the Utah fallback) exists as explicit hotfix logic in `backend/index.js`, `src/utils/avalanche-pipeline.js` and `src/utils/avalanche-detail.js` — check these before modifying avalanche parsing.
- Backend module system is **CommonJS** (`require`/`module.exports`). Frontend is **ES modules** (`import`/`export`).
- Backend test suite (`test/unit.helpers.test.js`) is extremely large; run targeted tests during development.
- `AI_PROVIDER` selects the preferred `openai` (default), `anthropic`, or `gemini` provider. Failed or timed-out requests retry through the other configured providers. Gemini uses Google's OpenAI-compatible API and defaults to `gemini-3.7-flash`/`gemini-3.5-flash-lite`. The `/api/healthz` response exposes preferred/fallback providers and model IDs without exposing credentials.
- Set `DEBUG_AVY=true` in `backend/.env` to enable verbose avalanche pipeline debug logs.
