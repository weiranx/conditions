# Backcountry Conditions Backend

Express API for:

- `GET /api/safety`
- `GET /api/sat-oneliner`
- `GET /api/search`
- `GET /healthz`, `GET /health`, `GET /api/healthz`, `GET /api/health`

## Run Locally

```bash
cp .env.example .env
npm install
npm run dev
```

## Test

```bash
npm run test:unit
npm run test:integration
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
