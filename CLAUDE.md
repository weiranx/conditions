# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Backcountry Conditions — a backcountry planning app that synthesizes weather, avalanche, alerts, air quality, snowpack, and terrain signals into a single planning interface with date/time-aware risk checks.

## Commands

### Backend (`cd backend`)

```bash
npm run dev              # Start API server (port 3001)
npm run test             # Run all tests
npm run test:unit        # Unit tests (wind parsing, scoring, relevance rules)
npm run test:integration # Integration tests (route + validation behavior)
```

### Frontend (`cd frontend`)

```bash
npm run dev              # Start Vite dev server (port 5173, proxies /api to backend)
npm run typecheck        # TypeScript compilation check
npm run lint             # ESLint validation
npm run build            # Production build → frontend/dist/
```

### Run a single test file

```bash
cd backend && npx jest test/unit.helpers.test.js
cd backend && npx jest test/integration.api.test.js
```

## Architecture

Two-tier: React + Vite SPA (`frontend/`) + Express API (`backend/`).

### Key files

- **`backend/index.js`** — 4000+ line monolith: orchestrates the full `/api/safety` pipeline, all upstream provider calls, safety score synthesis, and explanation generation. All new backend logic typically goes here.
- **`backend/src/utils/`** — Extracted helpers: `http-client.js`, `avalanche-detail.js`, `snowpack.js`, `wind.js`, `terrain-condition.js`, `fire-risk.js`, `heat-risk.js`, `gear-suggestions.js`, `time.js`.
- **`backend/src/routes/`** — Thin route handlers: `safety.js`, `search.js`, `sat-oneliner.js`, `health.js`.
- **`frontend/src/App.tsx`** — 8500+ line monolith: all planner UI state, report card rendering, settings, URL sharing, print views.
- **`frontend/src/app/`** — Extracted modules: `types.ts` (domain interfaces), `constants.ts`, `core.ts` (formatting + calculations), `map-components.tsx`.
- **`frontend/src/components/planner/`** — Extracted UI components: `SearchBox.tsx`, card components.
- **`frontend/src/lib/`** — `api-client.ts` (API calls + retry), `search.ts` (local peak catalog + Nominatim).

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

Persisted in browser local storage under `summitsafe:user-preferences:v1`. Unit conversions (temp, elevation, wind, time) are display-side only — backend always returns SI-adjacent values.

## Design Constraints

- `backend/index.js` and `frontend/src/App.tsx` are intentionally large. Refactoring should extract helpers/utilities rather than splitting the orchestration flow.
- Some center-specific avalanche handling exists as explicit hotfix logic in `backend/index.js` — check before modifying avalanche parsing.
- Backend module system is **CommonJS** (`require`/`module.exports`). Frontend is **ES modules** (`import`/`export`).
- Backend test suite (`test/unit.helpers.test.js`) is extremely large; run targeted tests during development.
