---
name: Testing conventions and known patterns
description: Test framework, file locations, run commands, and key JS gotchas discovered in this project
type: project
---

## Test framework
Jest 29 with `--runInBand` (no parallelism). CommonJS (`require`).

## Test file locations
- `backend/test/unit.helpers.test.js` — existing unit tests (imports from `backend/index.js` and `backend/src/utils/wind.js`, `time.js`)
- `backend/test/unit.utils.test.js` — utility unit tests (157 tests for url-utils, time, weather-normalizers, alerts, precipitation, visibility-risk, heat-risk, fire-risk)
- `backend/test/unit.utils2.test.js` — additional utility unit tests (126 tests for wind.js, avalanche-detail.js, terrain-condition.js, gear-suggestions.js)
- `backend/test/integration.api.test.js` — integration tests (supertest, starts Express server)

## Run commands
```bash
cd backend && npm run test              # all tests
cd backend && npm run test:unit         # unit.helpers.test.js only
cd backend && npm run test:integration  # integration.api.test.js only
cd backend && npx jest --runInBand test/unit.utils.test.js  # new utils tests
```

## Pre-existing failures (as of 2026-03-11)
Two tests in `unit.helpers.test.js` fail due to in-flight changes to `index.js` and `src/utils/wind.js` in the working tree. These are pre-existing and unrelated to the new test file.

## Key JS null-coercion gotcha
Many util functions use `Number(value)` which coerces `null` → `0` (finite!), so they do NOT return `null` for `null` inputs — they return `0`. Only `undefined` and non-numeric strings produce `NaN` (non-finite) and trigger null returns. Tests must reflect this actual behavior:
- `mmToInches(null)` → `0`, not `null`
- `cmToInches(null)` → `0`, not `null`
- `clampPercent(null)` → `0`, not `null`
- `normalizePressureHpa(null)` → `0`, not `null`
- `toFiniteNumberOrNull(null)` → `0`, not `null`
- `clampTravelWindowHours(null)` → `1` (0 clamped to min), not fallback
- `celsiusToF(null)` → `32` (0°C = 32°F), not `null`
- `openMeteoCodeToText(null)` → `'Clear'` (code 0), not `'Unknown'`
- `new Date(null)` = epoch (valid), `new Date(undefined)` = Invalid Date — affects `hourLabelFromIso`
- JS `toFixed(4)` uses banker's rounding for `.5` half-way cases — do not use `x.xxxxx5` boundary values in `toFixed` assertions

## Utility modules coverage
`unit.helpers.test.js` now also directly imports and tests (as of 2026-03-16, 274 tests total):
- `wind.js`: `parseWindMph`, `windDegreesToCardinal`, `findNearestWindDirection`
- `time.js`: `clampTravelWindowHours`, `parseClockToMinutes`, `formatMinutesToClock`, `withExplicitTimezone`, `normalizeUtcIsoTimestamp`, `findClosestTimeIndex`, `parseIsoTimeToMs`
- `alerts.js`: `classifyUsAqi`, `normalizeAlertSeverity`, `formatAlertSeverity`, `getHigherSeverity`, `normalizeNwsAlertText`, `normalizeNwsAreaList`, `isGenericNwsLink`, `isIndividualNwsAlertLink`, `buildNwsAlertUrlFromId`
- `weather-normalizers.js`: `computeFeelsLikeF`, `celsiusToF`, `inferNoaaCloudCoverFromIcon`, `inferNoaaCloudCoverFromForecastText`, `resolveNoaaCloudCover`, `normalizeNoaaDewPointF`, `normalizeNoaaPressureHpa`, `clampPercent`
- `precipitation.js`: `mmToInches`, `cmToInches`, `buildPrecipitationSummaryForAi`
- `visibility-risk.js`: `buildVisibilityRisk`, `buildElevationForecastBands`
- `fire-risk.js`: `buildFireRiskData` (direct unit tests, not just via calculateSafetyScore)
- `heat-risk.js`: `buildHeatRiskData` (direct unit tests)
- `safety-score.js`: `computeTier`
- `cache.js`: `createCache` (TTL, stale-while-revalidate, LRU eviction, in-flight dedup, prune, stats, del), `normalizeCoordKey`, `normalizeCoordDateKey`, `normalizeTextKey`
- `url-utils.js`: `normalizeHttpUrl`
- `weather-data.js`: `openMeteoCodeToText`, `hourLabelFromIso`, `localHourFromIso`, `isWeatherFieldMissing`, `buildTemperatureContext24h`, `blendNoaaWeatherWithFallback`
- `avalanche-detail.js` (additional): `firstNonEmptyString`, `inferAvalancheExpiresTime`, `normalizeAvalancheProblemCollection` additional edge cases (non-array input, non-object entries, sequential id assignment, alternative key resolution, array likelihood)
- `sat-oneliner.js` (via `createSatOneLinerBuilder`): GO/CAUTION/UNKNOWN decision labels, Avy n/a / unknown / level snippets, Worst12h n/a / worst-hour selection, start clock 12h format, objective name truncation at comma
- `safety-score.js` calculateSafetyScore additional: avalanche wind-loading penalty, avalanche storm-loading penalty, fire-heat compound penalty, avalanche-visibility penalty, alerts-unavailable confidence penalty, weather-unavailable confidence penalty, visibility from fog description, thunderstorm/convective penalty
- `snowpack.js`: `createUnavailableSnowpackData` (default + custom status)

`unit.utils.test.js` covers: `url-utils.js`, `time.js`, `weather-normalizers.js`, `alerts.js` (pure fns), `precipitation.js` (pure fns), `visibility-risk.js`, `heat-risk.js`, `fire-risk.js`.

`unit.utils2.test.js` covers:
- `wind.js`: `parseWindMph`, `windDegreesToCardinal`, `findNearestWindDirection` (deeper than unit.helpers.test.js)
- `avalanche-detail.js`: `firstNonEmptyString`, `parseAvalancheDetailPayloads`, `normalizeAvalancheProblemCollection` (all branches), `inferAvalancheExpiresTime`, `buildUtahForecastJsonUrl`, `pickBestAvalancheDetailCandidate`
  - NOTE: `normalizeAvalancheLikelihood` and `normalizeAvalancheLocation` are NOT exported — tested indirectly via `normalizeAvalancheProblemCollection`
- `terrain-condition.js`: all terrain codes (dry_firm, snow_fresh_powder, spring_snow, wet_snow, snow_ice, cold_slick, dry_loose, mixed_variable, weather_unavailable), SNOTEL proximity gate, signals shape
- `gear-suggestions.js`: all suggestion branches (extremities-cold, alpine-hardware, emergency-shelter, navigation-low-vis, fire-risk, sun-protection, hydration-heat, electrolytes-heat, avalanche-kit, traction-snow, shell selection)

Network-dependent service factories (`createSnowpackService`, `createPrecipitationService`, `createAlertsService`) are NOT unit-tested (require HTTP mocking).

## Integration test coverage (as of 2026-03-16, 75 tests total)
Routes covered in `integration.api.test.js`:
- Health: all four aliases; fields: ok, service, version, uptime, memory, nodeVersion, caches, X-Request-Id
- `/api/safety`: all missing-param combos, NaN coords, range violations, boundary coords, invalid date format
- `/api/sat-oneliner`: all missing-param combos, NaN coords, invalid date, full maxLength boundary suite
- `/api/search`: no q, whitespace-only q, 2-char short query (local path), local match, Mt normalization, trimming, unmatched, case-insensitive, field shape (name/lat/lon), long q (120-char cap), popular peaks field shape
- `/api/ai-brief` POST: empty body, each required field missing, score=0 (valid), score=null (invalid), empty-string primaryHazard/decisionLevel, optional factors/context omitted, JSON content-type on error
- `/api/route-suggestions` GET: missing peak/lat/lon, empty-string peak, non-numeric lat/lon, lat=0 lon=0 valid (query string "0" is truthy)
- `/api/route-analysis` POST: empty body, missing peak, missing route, missing date, invalid date format, invalid start format, non-numeric lat/lon, start=00:00 valid, start=23:59 valid, start omitted (optional), lat=0 body (documents falsy-zero bug)
- `/api/report-logs` GET: 403 when LOGS_SECRET not set
- Response headers: Content-Type: application/json on error responses, X-Request-Id present on every response, X-Request-Id unique per request
- HTTP method mismatches: POST /api/safety → 404, GET /api/ai-brief → 404, GET /api/route-analysis → 404

## Known bugs documented in tests
- `POST /api/route-analysis` rejects `lat=0`/`lon=0` because the presence check is `!lat` (falsy), not `lat == null`. JSON body numeric 0 is falsy. Query string `"0"` is truthy, so GET routes are unaffected.

Key pattern: Tests that pass validation but trigger live upstream calls use `expect(res.status).not.toBe(400)` with a 30s explicit timeout (third arg to `test()`).

## Key design patterns discovered
- `deriveTerrainCondition` checks terrain codes in strict priority order: weather_unavailable → dry_firm → snow paths → wet_muddy → cold_slick → dry_loose → mixed_variable. Tests that trigger later codes must ensure earlier conditions are not satisfied.
- `hasWetSignal` in gear-suggestions.js matches `/rain|shower|drizzle|wet|thunder|storm/` — "Snow Showers" matches "shower" and triggers the wet shell, not the snow shell. Use descriptions like "Heavy Snow" or "Blizzard" to test snow shell path.
- `dry_firm` takes priority over `dry_loose` even with very low humidity; `dry_loose` requires `dry_firm` to fail first (needs temp < 35 OR precip > 25 OR humidity > 75).
