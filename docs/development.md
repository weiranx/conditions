# Development Guide

## Prerequisites

- Node.js `>=20.19.0`
- npm `>=10`

---

## Local Setup

### Backend

```bash
cd backend
cp .env.example .env   # copy defaults; edit as needed
npm install
npm run dev            # starts API server at http://localhost:3001
```

### Frontend

```bash
# In a new terminal
cd frontend
cp .env.example .env
npm install
npm run dev            # starts Vite at http://localhost:5173
```

By default, Vite proxies `/api` to `VITE_DEV_BACKEND_URL` (default `http://localhost:3001`).

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development` or `production` |
| `PORT` | `3001` | API listen port |
| `CORS_ORIGIN` | — | Comma-separated origin allowlist for browser requests |
| `REQUEST_TIMEOUT_MS` | — | Upstream fetch timeout baseline (ms) |
| `AVALANCHE_MAP_LAYER_TTL_MS` | — | Avalanche map-layer cache TTL |
| `SNOTEL_STATION_CACHE_TTL_MS` | — | SNOTEL station metadata cache TTL |
| `RATE_LIMIT_WINDOW_MS` | — | API rate-limit window (ms) |
| `RATE_LIMIT_MAX_REQUESTS` | — | Max requests per rate-limit window |
| `DEBUG_AVY` | `false` | Set to `true` to enable avalanche pipeline debug logs |

### Frontend (`frontend/.env`)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | — | Explicit backend origin; leave empty to use same-origin `/api` |
| `VITE_DEV_BACKEND_URL` | `http://localhost:3001` | Vite dev proxy target for `/api` requests |

---

## Scripts

### Backend (`cd backend`)

| Script | Description |
|---|---|
| `npm run dev` | Start API server with hot reload |
| `npm run start` | Production-style start (no hot reload) |
| `npm run test` | Run all backend Jest tests |
| `npm run test:unit` | Unit tests (wind parsing, scoring, relevance rules) |
| `npm run test:integration` | Integration tests (route and validation behavior) |

**Running a single test file:**
```bash
npx jest test/unit.helpers.test.js
npx jest test/integration.api.test.js
```

### Frontend (`cd frontend`)

| Script | Description |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run typecheck` | TypeScript compilation check (no emit) |
| `npm run lint` | ESLint validation |
| `npm run build` | Production build → `frontend/dist/` |
| `npm run preview` | Preview production build locally |

---

## Code Conventions

### Module System

- **Backend**: CommonJS (`require` / `module.exports`)
- **Frontend**: ES modules (`import` / `export`)

Do not mix module systems within each tier.

### File Placement

- New backend domain logic goes in `backend/index.js` or a new utility in `backend/src/utils/`.
- New backend routes go in `backend/src/routes/`.
- New frontend utilities go in `frontend/src/app/` or `frontend/src/lib/`.
- New frontend UI components go in `frontend/src/components/`.
- Prefer extracting helpers from orchestration files (`App.tsx`, `backend/index.js`) rather than splitting the core flow.

### Avalanche-Specific Logic

Center-specific avalanche handling exists as explicit hotfix logic in `backend/index.js`. Review existing patterns before modifying avalanche parsing or zone-matching behavior.

---

## Testing Strategy

### Backend

- **Unit tests** (`test/unit.helpers.test.js`): cover utility-level logic — wind parsing, avalanche relevance rules, safety score calculation, and similar helpers.
- **Integration tests** (`test/integration.api.test.js`): cover route registration, input validation behavior, and response shape contracts.

The unit test file is large. During development, run targeted tests to keep feedback loops fast:

```bash
# Run only tests matching a pattern
npx jest --testNamePattern="wind parsing"
npx jest --testNamePattern="safety score"
```

### Frontend

The frontend does not have an automated test suite. Validation relies on:

- **TypeScript** — `npm run typecheck` catches type errors at compile time
- **ESLint** — `npm run lint` enforces code style and catches common mistakes
- **Manual QA** — use the verification checklist below

---

## Manual Verification Checklist

Use this after significant changes to confirm core flows still work:

1. Load the planner and search for a named objective.
2. Confirm `/api/safety` renders a complete report without errors.
3. Change the date and start time — verify all cards update correctly.
4. Adjust the travel window — confirm the trend timeline and scores react.
5. Toggle unit settings (temperature, elevation, wind speed, time style) in Settings.
6. Generate a share link and verify it reproduces the planner/trip state.
7. Test the print report, SAT one-liner copy, and team brief copy actions.
8. Open the Status view and run built-in health checks.
9. Open the Trip view and run a multi-day forecast.

---

## Common Development Workflows

### Adding a new backend data field

1. Add fetch/parsing logic to `backend/index.js` or the relevant utility in `backend/src/utils/`.
2. Include the field in the unified response payload returned by `/api/safety`.
3. Update `docs/api.md` to document the new field.
4. Add a unit test in `test/unit.helpers.test.js` if the parsing logic is non-trivial.

### Adding a new frontend UI section

1. Create the component in `frontend/src/components/planner/` or inline in `App.tsx` for small additions.
2. Wire up any new data fields using the types defined in `frontend/src/app/types.ts`.
3. Run `npm run typecheck` to catch type mismatches.
4. Add any new shared formatting logic to `frontend/src/app/core.ts`.

### Debugging upstream provider failures

1. Set `DEBUG_AVY=true` in `backend/.env` for avalanche-specific debug logs.
2. Check the `X-Request-Id` response header and search backend logs by that ID.
3. Inspect the `/api/safety` response for `partialData`, `apiWarning`, and per-section `status` fields.
4. Re-run the failing request with the same query parameters to confirm reproducibility.
