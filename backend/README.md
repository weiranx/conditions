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
| POST | `/api/auth/resend-verification` | Send a new verification link to the signed-in password account |
| POST | `/api/auth/verify-email` | Consume a single-use email verification token |
| POST | `/api/auth/forgot-password` | Request a password reset without revealing whether an account exists |
| POST | `/api/auth/reset-password` | Consume a reset token, update the password, and invalidate existing sessions |
| PATCH | `/api/account/preferences` | Save planning preferences for the signed-in account |
| GET | `/api/account/reports` | List report history for the signed-in account |
| GET | `/api/account/reports/:reportId` | Retrieve one account-owned report snapshot |
| POST | `/api/account/reports` | Add a newly generated report to account history |
| PUT | `/api/account/reports/:reportId` | Add later AI and route sections without changing the generated report's plan |
| GET | `/api/reports/shared/:shareToken` | Retrieve a read-only generated report by its random public token |
| POST | `/api/auth/logout` | End the current session |
| GET | `/api/report-logs` | Retrieve logged reports (administrator account only) |
| POST | `/api/report-logs` | Log a report entry |
| GET | `/healthz` | Health check (also `/health`, `/api/healthz`, `/api/health`) |

AI features require an account. Free accounts default to 250,000 AI tokens, 50 generated reports, and 10 multi-day forecast comparisons per UTC month, configurable with `AI_FREE_MONTHLY_TOKEN_LIMIT`, `FREE_MONTHLY_USAGE_LIMIT`, and `FREE_MONTHLY_MULTI_DAY_LIMIT`; Premium accounts have unlimited usage while their totals remain visible. Guest browsers receive 3 multi-day comparisons by default through `GUEST_MULTI_DAY_LIMIT`. Authenticated account responses include all three meters and their shared UTC-month reset date. The legacy `REPORT_FREE_MONTHLY_LIMIT` remains a fallback for the generated-report allowance.

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
