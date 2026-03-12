# SummitSafe Backend

Express API for the SummitSafe backcountry planning app.

## Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/safety` | Synthesized planning report for a coordinate + date/time |
| GET | `/api/search` | Objective search (local peak catalog + Nominatim) |
| GET | `/api/sat-oneliner` | Satellite-friendly one-line condition summary |
| GET | `/api/route-suggestions` | Claude-generated routes for a named peak |
| POST | `/api/route-analysis` | Multi-waypoint route analysis with go/no-go briefing |
| POST | `/api/ai-brief` | On-demand AI narrative field brief |
| GET | `/api/report-logs` | Retrieve logged reports (requires `LOGS_SECRET`) |
| POST | `/api/report-logs` | Log a report entry |
| GET | `/healthz` | Health check (also `/health`, `/api/healthz`, `/api/health`) |

## Run Locally

```bash
cp .env.example .env
npm install
npm run dev
```

## Test

```bash
npm run test             # All tests
npm run test:unit        # Unit tests (wind parsing, scoring, relevance rules)
npm run test:integration # Integration tests (route + validation behavior)

# Run a single file
npx jest test/unit.utils.test.js
```

## Production

```bash
NODE_ENV=production npm start
```

Set `CORS_ORIGIN` when frontend is served from a different origin.

## Documentation

- API contract: `../docs/api.md`
- Architecture: `../docs/architecture.md`
- Operations: `../docs/operations.md`
