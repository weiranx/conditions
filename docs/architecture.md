# Architecture

## Overview

Backcountry Conditions uses a two-tier web architecture:

- Frontend: React + Vite SPA (`frontend/src/App.tsx` plus supporting modules)
- Backend: Express API (`backend/index.js` + modular server/route helpers in `backend/src`)

The frontend requests synthesized planning data from the backend. The backend fetches and merges upstream provider data, then returns a single response payload used to render report cards, decision checks, SAT output, and trip/status views.

## Frontend

Primary responsibilities:

- Objective search and map interaction
- Planner state (objective, date, start time, target elevation)
- Travel-window scoring and pass/fail timeline
- Settings persistence (theme, units, time style, decision thresholds)
- Multi-view navigation (`home`, `planner`, `settings`, `status`, `trip`)
- Report actions (print report, SAT one-liner copy, team brief copy)
- URL state for shareable planner/trip links

Implementation notes:

- `frontend/src/App.tsx` remains the orchestration layer for UI state and rendering.
- Shared constants/types/utilities now live in:
  - `frontend/src/app/constants.ts`
  - `frontend/src/app/types.ts`
  - `frontend/src/app/core.ts`
  - `frontend/src/lib/api-client.ts`
  - `frontend/src/lib/search.ts`
- User preferences are persisted under `summitsafe:user-preferences:v1`.

## Backend

Primary responsibilities:

- Input validation for coordinates/date/start time/travel window
- Weather forecast retrieval and fallback handling
- Avalanche zone matching and bulletin ingestion
- NWS alerts filtering by selected travel window
- Air quality, precipitation, snowpack, fire-risk, and heat-risk enrichment
- Safety score synthesis and explanation generation
- Search, SAT one-liner, and health route registration

Route wiring is split into dedicated modules:

- `backend/src/routes/safety.js`
- `backend/src/routes/sat-oneliner.js`
- `backend/src/routes/search.js`
- `backend/src/routes/health.js`

Server runtime/middleware setup is split into:

- `backend/src/server/runtime.js` (env parsing + defaults)
- `backend/src/server/create-app.js` (middleware, CORS, rate limit, request IDs)
- `backend/src/server/start-server.js` (listen + graceful shutdown)

Core domain/data-synthesis logic remains in `backend/index.js` and utilities under `backend/src/utils`.

## Core Routes

- `GET /api/safety`
- `GET /api/sat-oneliner`
- `GET /api/search`
- `GET /healthz`, `GET /health`, `GET /api/healthz`, `GET /api/health`

## Middleware and Operability

- `helmet`
- `compression`
- CORS allowlist behavior by environment
- API rate limiting on `/api/*`
- Request ID injection (`X-Request-Id`)
- Graceful process shutdown handlers

## `/api/safety` Data Pipeline

1. Validate `lat`, `lon`, optional `date`, optional `start`, optional `travel_window_hours`.
2. Load weather from NOAA (primary).
3. Fill missing/noisy weather fields from Open-Meteo fallback when needed.
4. Load solar data.
5. Resolve avalanche zone from map layer (polygon or nearest fallback, including Utah-specific fallback).
6. Load avalanche detail products and parse problem/bottom-line/elevation dangers.
7. Load alerts, air quality, precipitation (rain + snowfall), and snowpack in parallel.
8. Evaluate avalanche relevance for selected objective/time context.
9. Derive terrain/trail condition and gear suggestions.
10. Build fire/heat risk and safety score (with confidence factors).
11. Stamp generated timestamps and return unified response payload.

If partial upstream failures occur, backend returns a degraded but usable `200` response with `partialData` and `apiWarning`.

## Upstream Data Providers

- NOAA/NWS weather APIs (`api.weather.gov`)
- Open-Meteo weather fallback and precipitation/air-quality feeds
- Avalanche.org map/product feeds plus center-link scraping fallback
- Sunrise-Sunset API (`api.sunrisesunset.io`)
- NRCS AWDB / SNOTEL
- NOAA NOHRSC Snow Analysis
- OpenStreetMap Nominatim (search geocoding)
- USGS/Open-Meteo elevation fallback

## Maintainability Notes

- `frontend/src/App.tsx` and `backend/index.js` are still large orchestration files.
- Route registration and server bootstrap have been extracted, reducing coupling around middleware and endpoint setup.
- Additional extraction candidates:
  - Safety pipeline stages in backend (`weather`, `alerts`, `precip`, `scoring`)
  - Planner subviews and report-card containers in frontend
