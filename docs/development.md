# Development Guide

## Prerequisites

- Node.js `>=20.19.0`
- npm `>=10`

## Local Setup

### Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Backend default port is `3001`.

### Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

By default, Vite proxies `/api` to `VITE_DEV_BACKEND_URL` (default `http://localhost:3001`).

## Environment Variables

### Backend (`backend/.env`)

- `NODE_ENV`: `development` or `production`
- `PORT`: API port (default `3001`)
- `CORS_ORIGIN`: comma-separated allowlist for browser origins
- `REQUEST_TIMEOUT_MS`: upstream fetch timeout baseline
- `AVALANCHE_MAP_LAYER_TTL_MS`: avalanche map-layer cache TTL
- `SNOTEL_STATION_CACHE_TTL_MS`: SNOTEL station metadata cache TTL
- `RATE_LIMIT_WINDOW_MS`: API rate-limit window
- `RATE_LIMIT_MAX_REQUESTS`: max requests in rate-limit window
- `DEBUG_AVY`: avalanche debug logging (`true`/`false`)

### Frontend (`frontend/.env`)

- `VITE_API_BASE_URL`: explicit backend origin (leave empty for same-origin)
- `VITE_DEV_BACKEND_URL`: dev proxy target for `/api`

## Scripts

### Backend

- `npm run dev`: start API server
- `npm run start`: production-style start
- `npm run test`: run all backend Jest tests
- `npm run test:unit`
- `npm run test:integration`

### Frontend

- `npm run dev`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run preview`

## Manual Verification Checklist

1. Load planner and search for an objective.
2. Confirm `/api/safety` renders without errors.
3. Change date/start time and verify cards update.
4. Adjust travel window and confirm trend/timeline reacts.
5. Toggle units (temp/elevation/wind/time) in Settings.
6. Verify share link reproduces planner/trip state.
7. Verify print report, SAT copy, and team brief copy actions work.
8. Open Status view and run health checks.
9. Open Trip view and run a multi-day forecast.

## Testing Strategy

- Unit tests focus on backend utility logic (wind parsing, relevance rules, scoring helpers).
- Integration tests validate route registration and request validation behavior.
- Frontend currently relies on type checks + manual QA for UI behavior.

## Current Maintainability Notes

- `frontend/src/App.tsx` and `backend/index.js` remain the largest orchestration files.
- Shared frontend logic has been extracted into `frontend/src/app/*` and `frontend/src/lib/*`.
- Backend route/server setup has been extracted into `backend/src/routes/*` and `backend/src/server/*`.

When refactoring, prefer extracting:

- Backend pipeline stages and provider clients
- Frontend subview containers and report card composition logic
- Shared serialization/formatting helpers used by print, SAT, and trip features
