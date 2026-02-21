# Architecture

## Overview

Backcountry Conditions has a two-tier architecture:

- Frontend: React + Vite SPA (`frontend/src/App.tsx`)
- Backend: Express API (`backend/index.js`)

The frontend requests synthesized planning data from the backend. The backend fetches and merges upstream provider data, then returns a single response payload used to render report cards and decision logic.

## Frontend

Primary responsibilities:

- Objective search and map interaction
- Planner state (objective, date, start time, target elevation)
- Settings persistence (theme, units, time style, decision thresholds)
- Rendering report cards and decision checks
- URL state for shareable searches
- Print/export views (print report, SAT line, team brief)

Implementation notes:

- Current UI logic is centralized in `frontend/src/App.tsx`.
- User preferences are persisted in browser local storage under `summitsafe:user-preferences:v1`.
- Unit conversions are display-side and keyed off settings.

## Backend

Primary responsibilities:

- Input validation for coordinates/date/start time
- Weather forecast retrieval and fallback handling
- Avalanche zone matching and bulletin ingestion
- NWS alerts filtering by selected start time
- Air quality, precipitation, snowpack, and fire-risk enrichment
- Safety score synthesis and explanation generation
- Search endpoint and health endpoint registration

Core routes:

- `GET /api/safety`
- `GET /api/search`
- `GET /healthz`, `GET /health`, `GET /api/healthz`, `GET /api/health`

Security/operability middleware:

- `helmet`
- `compression`
- CORS allowlist behavior by environment
- API rate limiting on `/api/*`
- Request ID injection (`X-Request-Id`)

## `/api/safety` Data Pipeline

1. Validate `lat`, `lon`, optional `date`, optional `start`.
2. Load weather from NOAA (primary).
3. Fill missing/noisy weather fields from Open-Meteo fallback when needed.
4. Load solar data.
5. Resolve avalanche zone from map layer (polygon or nearest fallback, including Utah-specific fallback).
6. Load avalanche detail products and parse problem/bottom-line/elevation dangers.
7. Load alerts, air quality, precipitation (rain + snowfall), and snowpack in parallel.
8. Evaluate avalanche relevance for selected objective/time context.
9. Derive trail/terrain surface classification.
10. Build fire risk and safety score (with confidence factors).
11. Stamp generated timestamps and return unified response payload.

If partial upstream failures occur, backend returns a degraded but usable `200` response with `partialData` and `apiWarning` fields.

## Upstream Data Providers

- NOAA/NWS weather APIs (`api.weather.gov`)
- Open-Meteo weather fallback and precipitation/air-quality feeds
- Avalanche.org map/product feeds plus center-link scraping fallback
- Sunrise-Sunset API (`api.sunrisesunset.io`)
- NRCS AWDB / SNOTEL
- NOAA NOHRSC Snow Analysis
- OpenStreetMap Nominatim (search geocoding)
- USGS/Open-Meteo elevation fallback

## Important Design Constraints

- Frontend and backend both encode significant domain logic in single large files.
- Some center-specific avalanche behavior is implemented as explicit hotfix logic.
- Response model is intentionally broad to support detailed planner cards and raw-data inspection.
