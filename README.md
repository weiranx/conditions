# Backcountry Conditions

Backcountry Conditions is a backcountry planning and condition-synthesis app for mountain and trail objectives.

It combines weather, avalanche, alerts, air quality, snowpack, and terrain-surface signals into a single planning view with date/time-aware risk checks.

## Credits

Built by Weiran Xiong with AI support.

## Key Capabilities

- Interactive objective search + map pin workflow
- Time-aware condition reports (`date` + `start time`)
- Avalanche forecast ingestion with center/zone matching and fallback handling
- Snowpack snapshot from NRCS SNOTEL + NOAA NOHRSC
- Rainfall/snowfall rolling totals (12h/24h/48h)
- NWS alerts, air quality, fire-risk synthesis, and source freshness
- Shareable planner URLs, printable report, and SAT one-liner output
- Unit settings for temperature, elevation, wind speed, and time style

## Repository Layout

- `frontend/` React + Vite client
- `backend/` Express API and risk-synthesis logic
- `docs/` project documentation

## Requirements

- Node.js `>=20.19.0`
- npm `>=10`

## Quick Start

1. Start backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

2. Start frontend (in a new terminal)

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

3. Open the URL printed by Vite (typically `http://localhost:5173`).

Notes:
- Frontend dev server proxies `/api` to `VITE_DEV_BACKEND_URL` (default `http://localhost:3001`).
- Planner defaults to objective-local time where available.

## API Endpoints

- `GET /api/safety?lat={lat}&lon={lon}&date=YYYY-MM-DD&start=HH:mm`
- `GET /api/search?q={query}`
- `GET /healthz` and `GET /api/healthz`

See full contract details in `docs/api.md`.

## Testing

Backend:

```bash
cd backend
npm run test:unit
npm run test:integration
```

Frontend:

```bash
cd frontend
npm run typecheck
npm run lint
```

## Production

1. Build frontend

```bash
cd frontend
npm ci
npm run build
```

2. Start backend

```bash
cd backend
npm ci
NODE_ENV=production npm start
```

Recommended topology:
- Serve `frontend/dist` from static hosting/CDN.
- Reverse-proxy `/api`, `/healthz`, `/api/healthz` to backend.
- Set backend `CORS_ORIGIN` when frontend is on a different origin.

See `docs/operations.md` for production details.

## Documentation Index

- `docs/README.md` overview
- `docs/architecture.md` system design and data flow
- `docs/api.md` endpoint contracts and response model
- `docs/development.md` local workflow and conventions
- `docs/operations.md` deployment, health checks, and troubleshooting

## Disclaimer

Backcountry Conditions is a planning aid, not a safety guarantee. Data can be delayed, incomplete, or incorrect. Verify official products and field observations before committing to terrain.
