# Backcountry Conditions

Backcountry Conditions is a backcountry planning app that synthesizes weather, avalanche, alerts, air quality, snowpack, and terrain signals into a single planning interface with date/time-aware risk checks.

Built for ski mountaineers, alpinists, trail runners, and backcountry travelers who need consolidated condition data before committing to terrain.

## Credits

Built by Weiran Xiong with AI support.

## What It Does

Enter an objective, pick a date and start time, and the app returns a unified conditions report covering:

- **Weather** — NOAA/NWS hourly forecast with Open-Meteo fallback; wind, temperature, precipitation trends across your travel window
- **Avalanche** — danger ratings, problem types, and bottom-line text from the local forecast center; time/elevation relevance scoring
- **Snowpack** — SNOTEL station observations and NOHRSC snow analysis for the objective area
- **Precipitation** — rain and snowfall rolling totals (12h / 24h / 48h)
- **Alerts** — active NWS alerts filtered to your travel window
- **Air Quality** — AQI and key pollutant data
- **Fire & Heat Risk** — synthesized signals for warm-season objectives
- **Terrain & Gear** — trail surface classification and gear-focus suggestions
- **Safety Score** — weighted risk score with confidence factors and plain-language explanations

## Key Capabilities

- Interactive objective search + map pin workflow
- Time-aware condition reports (`date` + `start time`)
- Configurable travel-window analysis (`travel_window_hours`, 1–24h)
- Avalanche forecast ingestion with center/zone matching and fallback handling
- Snowpack snapshot from NRCS SNOTEL + NOAA NOHRSC
- Rainfall/snowfall rolling totals (12h / 24h / 48h)
- NWS alerts, air quality, fire-risk synthesis, and source freshness indicators
- Shareable planner URLs, printable report, and SAT one-liner output
- Multi-day trip risk view and built-in app status checks
- Unit settings for temperature, elevation, wind speed, and time style

## Repository Layout

```
conditions/
├── frontend/          # React + Vite SPA
│   ├── src/
│   │   ├── App.tsx          # Main orchestration layer (~8500 lines)
│   │   ├── app/             # Shared types, constants, core utilities
│   │   ├── components/      # Extracted UI components (SearchBox, cards)
│   │   └── lib/             # API client and search helpers
│   └── README.md
├── backend/           # Express API + risk-synthesis logic
│   ├── index.js             # Core pipeline (~4000 lines)
│   ├── src/
│   │   ├── routes/          # Thin route handlers
│   │   ├── server/          # Middleware, CORS, app bootstrap
│   │   └── utils/           # Extracted domain helpers
│   └── README.md
└── docs/              # Project documentation
    ├── architecture.md
    ├── api.md
    ├── development.md
    └── operations.md
```

## Requirements

- Node.js `>=20.19.0`
- npm `>=10`

## Quick Start

### 1. Start the backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
# API server running at http://localhost:3001
```

### 2. Start the frontend

```bash
# In a new terminal
cd frontend
cp .env.example .env
npm install
npm run dev
# UI running at http://localhost:5173
```

### 3. Open the app

Navigate to the URL printed by Vite (typically `http://localhost:5173`).

> **Notes**
> - The frontend dev server proxies `/api` to `VITE_DEV_BACKEND_URL` (default `http://localhost:3001`).
> - The planner defaults to objective-local time where timezone data is available.

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/safety` | Full synthesized planning report for a coordinate + date/time |
| `GET /api/sat-oneliner` | Satellite-friendly one-line condition summary |
| `GET /api/search` | Objective search using local peak catalog + Nominatim |
| `GET /healthz` (and aliases) | Backend health check |

**Example:**
```bash
curl "http://localhost:3001/api/safety?lat=46.8523&lon=-121.7603&date=2026-02-21&start=06:30&travel_window_hours=12"
```

See full parameter and response documentation in [`docs/api.md`](docs/api.md).

## Testing

**Backend:**
```bash
cd backend
npm run test:unit        # Wind parsing, scoring, relevance rules
npm run test:integration # Route registration, request validation
```

**Frontend:**
```bash
cd frontend
npm run typecheck        # TypeScript compilation check
npm run lint             # ESLint validation
```

## Production Build

### 1. Build the frontend

```bash
cd frontend
npm ci
npm run build
# Output: frontend/dist/
```

### 2. Start the backend

```bash
cd backend
npm ci
NODE_ENV=production npm start
```

**Recommended topology:**
- Serve `frontend/dist/` from static hosting or a CDN.
- Reverse-proxy `/api/*`, `/healthz`, and `/api/healthz` to the backend.
- Set backend `CORS_ORIGIN` when frontend is on a different origin.

See [`docs/operations.md`](docs/operations.md) for full production guidance.

## Documentation

| Document | Contents |
|---|---|
| [`docs/README.md`](docs/README.md) | Documentation index and reading order |
| [`docs/architecture.md`](docs/architecture.md) | System design, components, and data flow |
| [`docs/api.md`](docs/api.md) | Endpoint contracts and response model |
| [`docs/development.md`](docs/development.md) | Local workflow, conventions, and testing |
| [`docs/operations.md`](docs/operations.md) | Deployment, health checks, and troubleshooting |

## Disclaimer

Backcountry Conditions is a planning aid, not a safety guarantee. Data can be delayed, incomplete, or incorrect. Always verify official avalanche forecasts and field observations before committing to terrain. Your safety is your responsibility.

