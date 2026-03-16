# QE Agent Memory — Backcountry Conditions

## Key Architecture Facts (Updated 2026-03-13)
- Backend: CommonJS. `backend/index.js` is now a thin 593-line bootstrap. All logic in `backend/src/utils/` and `backend/src/routes/`.
- Frontend: ES modules, `frontend/src/App.tsx` (~2410 lines). Modules in `frontend/src/app/`, hooks in `frontend/src/hooks/`.
- `/api/safety` returns HTTP 200 even on partial failure (`partialData: true`, `apiWarning`)
- Safety score: 100 - sum of capped group impacts (`backend/src/utils/safety-score.js`)
- Confidence score floor: 20 (`calculateSafetyScore` bottom of function)

## Architecture Change (2026-03-13)
- `backend/index.js` refactored from 4000+ lines to 593-line bootstrap.
- All pipeline logic moved to:
  - `backend/src/utils/safety-score.js` — full safety score calculation
  - `backend/src/utils/weather-pipeline.js` — NOAA + Open-Meteo weather pipeline
  - `backend/src/utils/avalanche-pipeline.js` — avalanche map + detail + scraper
  - `backend/src/utils/avalanche-orchestration.js` — relevance, danger derivation
  - `backend/src/utils/geo.js` — haversine, zone matching, elevation service
- **All prior notes about old `backend/index.js` line numbers are OBSOLETE.**

## Known Fragility Points

### Solar Cache Permanently Caches Failure (`weather-pipeline.js` L328-342)
- When `solarRes.ok` is false OR `solarJson.status !== 'OK'`, fetch fn returns `null`
- `solarCache.getOrFetch` stores that `null` for 7 days — next request serves cached null
- Fix: throw instead of returning null in the fetch callback

### `alertsRelevantForSelectedTime` — Correctly computed in backend (`safety-score.js` L177)
- Backend: `alertsRelevantForSelectedTime = forecastLeadHours === null || forecastLeadHours <= 48` — correct
- Frontend `decision.ts` L130: `const alertsRelevantForSelectedStart = true` — still hardcoded, causing frontend to always show alerts gate regardless of lead time

### `feelsLike` Null Guard Missing in Decision Check (`decision.ts` L368)
- `feelsLike` is typed `number | null` — but `feelsLike >= minFeelsLikeThreshold` fires without null check
- When both `data.weather.feelsLike` and `data.weather.temp` are null: `null >= threshold` = false in JS
- Check fires as "failed" even though data is unavailable, misleading the user

### Precipitation Retry Loop No Backoff (`precipitation.js` L258-276)
- Inner loop retries 3x on same URL with no delay on rate-limit or 503 errors
- Hammers the upstream immediately; can worsen rate-limit situation
- Fix: exponential backoff between retry attempts

### AI Brief Stale Cache Never Revalidates (`ai-brief.js` L28-30)
- Uses `aiBriefCache.get()` directly — stale entries are returned but never background-refreshed
- Should use `getOrFetch()` to trigger stale-while-revalidate

### `invokeSafetyHandler` Route Analysis Uses Timeout-Wrapped Handler
- L543 of `backend/index.js`: `createSafetyInvoker({ safetyHandler: safetyHandlerWithTimeout })`
- The 30s per-request timeout IS applied to route analysis waypoint checks. Previously noted as missing — now fixed.

## Recurrent Patterns to Watch
- `getOrFetch` caches `null` values returned by fetch callbacks — don't return null on failure
- Retry loops without backoff hammer rate-limited upstreams
- `null >= threshold` / `null <= threshold` evaluates to false in JS — silently wrong checks
- Frontend `decision.ts` dead/hardcoded booleans (`alertsRelevantForSelectedStart`)
- `buildRainfallZeroFallback` only applies 4pt penalty — surface condition factors suppressed silently

## Key File Locations for High-Risk Bugs
- `backend/src/utils/weather-pipeline.js` L333: solar failure cached as `null` for 7 days
- `backend/src/utils/precipitation.js` L258-276: no-delay retry on same URL
- `frontend/src/app/decision.ts` L130: `alertsRelevantForSelectedStart = true` hardcoded
- `frontend/src/app/decision.ts` L368: `feelsLike >= minFeelsLikeThreshold` unguarded null
- `backend/src/routes/ai-brief.js` L28-30: stale cache never revalidates

## iOS App (BackcountryConditions/)
- Full audit completed 2026-03-11. See [ios_app_patterns.md](ios_app_patterns.md) for patterns.
- Key bugs: RouteAnalysisCard task lifecycle; TravelWindowEngine deriveSpans single-pass-row edge; SettingsView lazy init; formatAmPm unclamped; AQI scale indicator clipping; DecisionEngine precipitation never blocks; staleWarning display says "Forecast is X+ old" (confusing "+ old" wording).
- `AvalancheProblem.problem_description` decoded but never rendered — dead field.
- 2026-03-12 history persistence PR: `currentReportId` is set before `Task.detached { save }` completes — `updateRouteAnalysis`/`updateAiBrief` may fire before initial save, silently dropping the update since `load(id:)` returns nil. `recentReports` in PlannerView loaded once in `.task` — never refreshed after new report saved.

## Previously Reported Bugs — Now Fixed
- NOAA hourly `.ok` check: now throws correctly in weather-pipeline.js L86
- Scraper `pageRes.ok`: now checked in avalanche-pipeline.js L470
- `alertsRelevantForSelectedTime` hardcoded `true` in old backend/index.js: now computed in safety-score.js
- `peakFeelsLike12hF` wrong max in heat-risk.js: now correctly uses `feelsLikeF` not `peakTemp12hF`

## Extracted Frontend Modules
- `frontend/src/app/card-ordering.ts`: `windLoadingLevel` passed in but never used in risk scoring (only `windLoadingConfidence` used)
- `frontend/src/app/rainfall-display.ts`: `rainfallDataAvailable` returned but not used in App.tsx
- `frontend/src/app/wind-loading-display.ts`: `windSpeedMph` returned but not destructured in App.tsx
