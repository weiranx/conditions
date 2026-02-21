# Backcountry Conditions Frontend

React + Vite client for Backcountry Conditions planner UI.

## Run Locally

```bash
cp .env.example .env
npm install
npm run dev
```

## Commands

```bash
npm run dev
npm run lint
npm run typecheck
npm run build
npm run preview
```

## Environment

- `VITE_API_BASE_URL`: backend base URL (empty for same-origin `/api`)
- `VITE_DEV_BACKEND_URL`: Vite proxy target for `/api` in dev

## Documentation

- Project overview: `../README.md`
- Development guide: `../docs/development.md`
- API contract consumed by frontend: `../docs/api.md`
