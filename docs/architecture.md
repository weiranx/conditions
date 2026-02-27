# Architecture

## Overview

Backcountry Conditions uses a two-tier web architecture:

- **Frontend**: React + Vite SPA (`frontend/src/App.tsx` plus supporting modules)
- **Backend**: Express API (`backend/index.js` + modular server/route helpers in `backend/src/`)

The frontend requests synthesized planning data from the backend. The backend fetches and merges data from multiple upstream providers, then returns a single unified response payload used to render report cards, decision checks, SAT output, and trip/status views.

---

## System Diagram

```
Browser
  │
  │  GET /api/safety?lat=...&lon=...&date=...
  ▼
┌─────────────────────────────────────────────┐
│              Frontend (Vite SPA)            │
│  App.tsx → planner UI, report cards, views  │
│  /api proxy in dev → backend:3001           │
└───────────────────┬─────────────────────────┘
                    │ HTTP
                    ▼
┌─────────────────────────────────────────────┐
│           Backend (Express API)             │
│                                             │
│  Routes: /api/safety, /api/sat-oneliner,    │
│          /api/search, /health*              │
│                                             │
│  Safety pipeline (backend/index.js):        │
│  1. Validate input                          │
│  2. Fetch weather (NOAA → Open-Meteo)       │
│  3. Fetch solar data                        │
│  4. Resolve avalanche zone + bulletin       │
│  5. Fetch alerts, AQI, precip, snowpack     │
│  6. Evaluate relevance + terrain            │
│  7. Synthesize safety score                 │
│  8. Return unified payload                  │
└──────┬──────┬──────┬──────┬─────────────────┘
       │      │      │      │   (parallel fetches)
       ▼      ▼      ▼      ▼
  NOAA/NWS  Avy.org NRCS  Open-Meteo
  weather   feeds  SNOTEL  AQI/precip
```

---

## Frontend

**Primary responsibilities:**

- Objective search and map interaction
- Planner state management (objective, date, start time, target elevation)
- Travel-window scoring and pass/fail timeline rendering
- Settings persistence (theme, units, time style, decision thresholds)
- Multi-view navigation (`home`, `planner`, `settings`, `status`, `trip`)
- Report actions (print report, SAT one-liner copy, team brief copy)
- URL state encoding for shareable planner/trip links

**Module layout:**

| Path | Purpose |
|---|---|
| `frontend/src/App.tsx` | Main orchestration layer for UI state and rendering (~8500 lines) |
| `frontend/src/app/constants.ts` | App-wide constants |
| `frontend/src/app/types.ts` | Domain TypeScript interfaces |
| `frontend/src/app/core.ts` | Formatting and calculation utilities |
| `frontend/src/app/map-components.tsx` | Map-related components |
| `frontend/src/lib/api-client.ts` | API calls + retry logic |
| `frontend/src/lib/search.ts` | Local peak catalog + Nominatim integration |
| `frontend/src/components/planner/` | Extracted UI components (SearchBox, cards) |

**User preferences** are persisted under `summitsafe:user-preferences:v1` in browser `localStorage`. Unit conversions (temperature, elevation, wind, time) are display-side only — the backend always returns SI-adjacent values.

---

## Backend

**Primary responsibilities:**

- Input validation for coordinates, date, start time, and travel window
- Weather forecast retrieval and gap-filling fallback handling
- Avalanche zone matching and bulletin ingestion
- NWS alert filtering by travel window
- Air quality, precipitation, snowpack, fire-risk, and heat-risk enrichment
- Safety score synthesis and confidence-weighted explanation generation
- Search, SAT one-liner, and health route registration

**Route modules:**

| File | Route(s) |
|---|---|
| `backend/src/routes/safety.js` | `GET /api/safety` |
| `backend/src/routes/sat-oneliner.js` | `GET /api/sat-oneliner` |
| `backend/src/routes/search.js` | `GET /api/search` |
| `backend/src/routes/health.js` | `GET /healthz`, `/health`, `/api/healthz`, `/api/health` |

**Server bootstrap modules:**

| File | Purpose |
|---|---|
| `backend/src/server/runtime.js` | Environment parsing and defaults |
| `backend/src/server/create-app.js` | Middleware, CORS, rate limiting, request IDs |
| `backend/src/server/start-server.js` | HTTP listen + graceful shutdown |

**Utility helpers** (`backend/src/utils/`):

| File | Purpose |
|---|---|
| `http-client.js` | Fetch wrapper with timeout and retry |
| `avalanche-detail.js` | Avalanche bulletin parsing and zone matching |
| `snowpack.js` | SNOTEL + NOHRSC data fetching and summarization |
| `wind.js` | Wind speed and direction parsing |
| `terrain-condition.js` | Trail/terrain surface classification |
| `fire-risk.js` | Fire-risk signal synthesis |
| `heat-risk.js` | Heat-risk signal synthesis |
| `gear-suggestions.js` | Gear focus recommendation logic |
| `time.js` | Time zone and date utilities |

Core domain and orchestration logic remains in `backend/index.js`.

---

## Middleware and Operability

| Middleware | Purpose |
|---|---|
| `helmet` | Security headers |
| `compression` | Gzip response compression |
| CORS allowlist | Origin-based access control, configured per environment |
| Rate limiter | Protects `/api/*` routes from abuse |
| Request ID injection | `X-Request-Id` header on every response for log correlation |
| Graceful shutdown | `SIGINT` / `SIGTERM` handlers + uncaught exception handling |

---

## `/api/safety` Data Pipeline

1. **Validate** `lat`, `lon`, optional `date`, optional `start`, optional `travel_window_hours`.
2. **Load weather** from NOAA/NWS (primary source).
3. **Fill gaps** using Open-Meteo fallback for missing or noisy weather fields.
4. **Load solar data** (sunrise/sunset/day length).
5. **Resolve avalanche zone** from the Avalanche.org map layer using polygon matching or nearest-zone fallback (includes Utah-specific center fallback logic).
6. **Parse avalanche bulletin** — danger ratings by elevation, problem types, and bottom-line text.
7. **Parallel fetch**: NWS alerts, air quality, precipitation (rain + snowfall rolling totals), and snowpack (SNOTEL + NOHRSC).
8. **Evaluate avalanche relevance** for the selected objective type and time context.
9. **Classify terrain/trail** surface and derive gear suggestions.
10. **Synthesize fire/heat risk** and build the overall safety score with confidence factors.
11. **Stamp timestamps** and return the unified response payload.

On partial upstream failures, the backend returns a degraded but usable `200` response with `partialData: true` and an `apiWarning` field describing which feeds failed.

---

## Upstream Data Providers

| Provider | Data |
|---|---|
| NOAA/NWS (`api.weather.gov`) | Hourly weather forecast (primary) |
| Open-Meteo | Weather fallback, precipitation, air quality |
| Avalanche.org | Map layer (zone polygon), product feeds, center links |
| Sunrise-Sunset API (`api.sunrisesunset.io`) | Solar data |
| NRCS AWDB / SNOTEL | Snowpack station observations |
| NOAA NOHRSC | Snow analysis grids |
| OpenStreetMap Nominatim | Search geocoding |
| USGS / Open-Meteo | Elevation fallback |

---

## Maintainability Notes

- `frontend/src/App.tsx` and `backend/index.js` are intentionally large orchestration files. Prefer extracting helpers rather than splitting the core flow.
- Route registration and server bootstrap are already extracted, reducing coupling around middleware and endpoint setup.
- Some center-specific avalanche handling exists as explicit hotfix logic in `backend/index.js` — review before modifying avalanche parsing.
- Backend module system is **CommonJS** (`require` / `module.exports`). Frontend is **ES modules** (`import` / `export`).

**Future extraction candidates:**
- Backend pipeline stages (`weather`, `alerts`, `precip`, `scoring`) into separate service modules
- Planner subview containers and report-card composition logic in the frontend
- Shared serialization/formatting helpers used by print, SAT, and trip features
