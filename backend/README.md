# SummitSafe Backend

Express API for the SummitSafe backcountry planning app.

## Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/safety` | Synthesized planning report with separate safety and pleasantness scores |
| GET | `/api/search` | Objective search (local peak catalog + Nominatim) |
| GET | `/api/sat-oneliner` | Satellite-friendly one-line condition summary |
| GET | `/api/route-suggestions` | AI-generated routes for a named peak |
| POST | `/api/route-analysis` | Multi-waypoint route analysis with go/no-go briefing |
| POST | `/api/ai-brief` | On-demand AI narrative field brief |
| POST | `/api/report-chat` | Streaming, report-aware Q&A conversation |
| GET | `/api/auth/session` | Current optional-account session |
| POST | `/api/auth/register` | Create an email/password account and session |
| POST | `/api/auth/login` | Sign in and create a session |
| GET | `/api/auth/google/config` | Google sign-in client configuration and browser nonce |
| POST | `/api/auth/google` | Verify Google identity and create a session |
| PATCH | `/api/account/preferences` | Save planning preferences for the signed-in account |
| GET | `/api/account/reports` | List report history for the signed-in account |
| GET | `/api/account/reports/:reportId` | Retrieve one account-owned report snapshot |
| POST | `/api/account/reports` | Save a newly generated report snapshot |
| PUT | `/api/account/reports/:reportId` | Update a report snapshot with later AI sections |
| POST | `/api/auth/logout` | End the current session |
| GET | `/api/report-logs` | Retrieve logged reports (administrator account only) |
| POST | `/api/report-logs` | Log a report entry |
| GET | `/healthz` | Health check (also `/health`, `/api/healthz`, `/api/health`) |

AI features require an account and are limited per user by provider-reported token usage. The monthly allowance defaults to 250,000 tokens and can be changed with `AI_USER_MONTHLY_TOKEN_LIMIT`; the current meter and reset date are included in authenticated account responses.

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
