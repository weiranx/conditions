# Local mock development

From `frontend/`, run `npm run dev:mock`. Open `http://127.0.0.1:5173` (or `http://localhost:5173`). No backend, PostgreSQL, AI keys, or email provider is required.

The development toolbar selects clear, cloudy, rain, snow, storm, fog, mixed, unusual field observations, missing-data, or API-error fixtures. Click **Apply & reload** to regenerate the selected plan. Each tab keeps its selected scenario so you can compare states side by side.

The signed-in `admin@example.test` account is Premium, email-verified, and has local admin access. Report, AI, and multi-day allowances are unlimited. Sign-out/sign-in flows are simulated; no real credentials are checked or stored.

The JSON database is `frontend/.mock/database.json` (gitignored). Saved report snapshots, share tokens, watchlists and manual check history, account preferences, local outbox entries, feature flags, and mock admin settings survive Vite restarts. Use **Test data → Reset mock database** to reset it. Browser report/preferences storage is namespaced separately from normal development.

Supported workflows include report/search responses, multi-day forecasts, saved reports and local shared links, watch mutations, canned AI brief/chat/snow responses, sample route analysis, and the admin dashboard. Admin feature flags, AI toggles, and usage settings are local simulations. Operational actions that do not make sense for this fixture server return an explicit unsupported response; there is no fallback to the live backend. Email only adds an entry to `/api/dev/mock`'s `outbox`; it never sends a message. Background watch scheduling and real billing are not simulated.

Mock mode is guarded by `import.meta.env.DEV` and the Vite plugin's `apply: 'serve'`. Production builds omit the development controls and use the configured real API. The development mock does not validate the real database, authentication, email delivery, or AI providers. Basemap tiles may still require a network connection.

Run `npm run test:mock` for mock API/persistence tests. Run `node scripts/verify-field-ui.mjs` for visual-component data tests.
