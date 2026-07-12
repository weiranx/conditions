# SummitSafe

SummitSafe is a backcountry planning app that synthesizes weather, avalanche, alerts, air quality, snowpack, and terrain signals into a single planning interface with date/time-aware risk checks.

Built for ski mountaineers, alpinists, trail runners, and backcountry travelers who need consolidated condition data before committing to terrain.

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
- **Safety Score** — weighted risk score with confidence factors, temporal weighting, combined hazard detection, and plain-language explanations
- **Pleasantness Score** — a separate 0–100 weather-comfort outlook based on temperature/dew point, wind, precipitation, views/daylight, and air quality
- **Route Analysis** — import a GPX track or choose a named route for per-checkpoint conditions and a route-wide go/no-go briefing
- **AI Field Brief** — on-demand narrative summary of current conditions
- **Wind Loading** — aspect/elevation rose showing wind exposure patterns

## Key Capabilities

- Interactive objective search + map pin workflow
- GPX route import with distance-based safety checkpoints, recorded distance/elevation metadata, and route profiles
- Time-aware condition reports (`date` + `start time`)
- Configurable travel-window analysis (`travel_window_hours`, 1-24h)
- Avalanche forecast ingestion with center/zone matching and fallback handling
- Snowpack snapshot from NRCS SNOTEL + NOAA NOHRSC
- Rainfall/snowfall rolling totals (12h / 24h / 48h)
- NWS alerts, air quality, fire-risk synthesis, and source freshness indicators
- Configurable OpenAI- or Claude-powered route suggestions and multi-waypoint route analysis
- On-demand AI field brief narrative
- Shareable planner URLs, printable report, and SAT one-liner output
- Multi-day trip risk view and built-in app status checks
- Unit settings for temperature, elevation, wind speed, and time style
- Collapsible card UI with preview summaries
- Report logging with access-controlled retrieval
- Tiered in-memory caching across all upstream API calls

## Repository Layout

```
summitsafe/
├── frontend/                # React + Vite SPA
│   ├── src/
│   │   ├── App.tsx                # Main orchestration layer
│   │   ├── app/                   # Types, constants, core utilities, preferences
│   │   ├── components/            # Extracted UI components (cards, search, loading)
│   │   ├── lib/                   # API client and search helpers
│   │   └── utils/                 # Domain-specific utilities (avalanche)
│   └── ...
├── backend/                 # Express API + risk-synthesis logic
│   ├── index.js                   # Core safety pipeline
│   ├── src/
│   │   ├── routes/                # Route handlers (safety, search, route-analysis, ai-brief, report-logs, etc.)
│   │   ├── server/                # Middleware, CORS, app bootstrap
│   │   ├── utils/                 # Domain helpers (weather, avalanche, cache, AI client, logger, etc.)
│   │   └── data/                  # Static reference data (CDEC snow stations)
│   └── test/                      # Jest test suites (unit, utils, integration)
├── BackcountryConditions/   # Native iOS app (SwiftUI, iOS 17+)
│   ├── BackcountryConditions/
│   │   ├── ViewModels/            # PlannerViewModel, SearchViewModel, SettingsViewModel, StatusViewModel
│   │   ├── Models/                # SafetyData, RouteAnalysis, AiBrief, SearchResult, UserPreferences
│   │   ├── App/                   # App entry point, AppState, Configuration
│   │   ├── Extensions/            # Color+Theme, View+Conditional
│   │   └── Utilities/             # Constants, TravelWindowEngine, WindLoadingEngine
│   └── BackcountryConditionsTests/
├── docs/                    # Project documentation
├── scripts/                 # Deployment scripts (deploy.sh, setup-nginx.sh)
├── docker-compose.yml
└── .github/workflows/       # CI and deploy pipelines
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

### Optional environment variables

The backend runs against free public data sources out of the box. A couple of features require optional API keys in `backend/.env` (see `backend/.env.example` for the full list):

| Variable | Enables | How to get it |
|---|---|---|
| `NPS_API_KEY` | The **Access & Closures** sub-section of the Local Conditions card — nearest national-park alerts and closures via the National Park Service API. Without it the section is hidden; the rest of the report is unaffected. | Free, instant — request at [nps.gov developer get-started](https://www.nps.gov/subjects/developer/get-started.htm). |
| `AI_PROVIDER` | Selects the preferred provider (`openai` by default); failures retry once through the other configured provider. | — |
| `AI_PRIMARY_TIMEOUT_MS` / `AI_FAST_TIMEOUT_MS` | Per-provider attempt limits before failover; defaults to 28000/8000 ms. | — |
| `OPENAI_API_KEY` | Enables OpenAI as the preferred provider or automatic fallback. | [OpenAI API keys](https://platform.openai.com/api-keys) |
| `OPENAI_MODEL` / `OPENAI_FAST_MODEL` | OpenAI primary and extraction models; defaults to Terra and Luna. | — |
| `ANTHROPIC_API_KEY` | Enables Anthropic as the preferred provider or automatic fallback. | [Anthropic Console](https://console.anthropic.com/) |
| `ANTHROPIC_MODEL` / `ANTHROPIC_FAST_MODEL` | Claude primary and extraction models; defaults to Sonnet and Haiku. | — |

Set both AI provider keys to enable automatic failover in either direction. All API keys are optional to omit — features that do not depend on a missing key continue to work.
When neither AI provider key is configured, AI-powered controls are hidden in the web and iOS planners.

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/safety` | Full synthesized planning report for a coordinate + date/time |
| GET | `/api/search` | Objective search using local peak catalog + Nominatim |
| GET | `/api/sat-oneliner` | Satellite-friendly one-line condition summary |
| GET | `/api/route-suggestions` | AI-generated routes for a named peak |
| POST | `/api/route-analysis` | Multi-waypoint route analysis with go/no-go briefing |
| POST | `/api/ai-brief` | On-demand AI narrative field brief |
| GET | `/api/report-logs` | Retrieve logged reports (requires `LOGS_SECRET`) |
| POST | `/api/report-logs` | Log a report entry |
| GET | `/healthz` | Backend health check (also `/health`, `/api/healthz`, `/api/health`) |

**Example:**
```bash
curl "http://localhost:3001/api/safety?lat=46.8523&lon=-121.7603&date=2026-02-21&start=06:30&travel_window_hours=12"
```

See full parameter and response documentation in [`docs/api.md`](docs/api.md).

## Testing

**Backend:**
```bash
cd backend
npm run test             # All tests
npm run test:unit        # Wind parsing, scoring, relevance rules
npm run test:integration # Route registration, request validation

# Run a single test file
npx jest test/unit.utils.test.js
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

See [`docs/operations.md`](docs/operations.md) for full production guidance and [`docs/vps-setup.md`](docs/vps-setup.md) for DigitalOcean droplet provisioning.

## Documentation

| Document | Contents |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | System design, components, and data flow |
| [`docs/api.md`](docs/api.md) | Endpoint contracts and response model |
| [`docs/development.md`](docs/development.md) | Local workflow, conventions, and testing |
| [`docs/operations.md`](docs/operations.md) | Deployment, health checks, and troubleshooting |
| [`docs/vps-setup.md`](docs/vps-setup.md) | DigitalOcean droplet setup guide |

## iOS App

A native iOS companion app lives in `BackcountryConditions/`. Built with SwiftUI targeting iOS 17+, it consumes the same backend API and provides:

- Objective search and planner with the same date/time/travel-window controls
- Full safety report rendering with collapsible cards
- Route analysis and AI field brief integration
- User preferences (units, thresholds, theme)
- App status and health checks

The iOS app uses XcodeGen (`project.yml`) for project configuration. Open `BackcountryConditions.xcodeproj` in Xcode to build and run.

## Disclaimer

SummitSafe is a planning aid, not a safety guarantee. Data can be delayed, incomplete, or incorrect. Always verify official avalanche forecasts and field observations before committing to terrain. Your safety is your responsibility.
