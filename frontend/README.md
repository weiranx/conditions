# Backcountry Conditions Frontend

React + Vite client for Backcountry Conditions planner UI.

Primary views:

- `home`: objective setup + feature overview
- `planner`: full safety report, travel-window analysis, and report actions
- `settings`: defaults/thresholds/units/theme
- `status`: built-in frontend/backend health checks
- `trip`: multi-day forecast sweep for one objective

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
