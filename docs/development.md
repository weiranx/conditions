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
- `REQUEST_TIMEOUT_MS`: upstream fetch timeout
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
4. Toggle units (temp/elevation/wind/time) in Settings.
5. Verify map scale and report values follow settings.
6. Verify share link reproduces planner state.
7. Verify print report opens and renders key sections.

## Testing Strategy

- Unit tests focus on backend utility logic (wind parsing, relevance rules, scoring helpers).
- Integration tests validate core routes and validation behavior.
- Frontend currently relies on type checks + manual QA for UI behavior.

## Current Maintainability Notes

- `frontend/src/App.tsx` contains most client logic.
- `backend/index.js` contains core orchestration logic.

When refactoring, prefer extracting:

- Shared formatting and unit logic
- Endpoint client wrappers
- Card-level UI components
- Backend provider clients and synthesis stages
