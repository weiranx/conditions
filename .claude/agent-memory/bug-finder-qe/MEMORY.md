# QE Agent Memory — Backcountry Conditions

## Key Architecture Facts
- Backend: CommonJS, 4000+ line `backend/index.js` monolith
- Frontend: ES modules, `frontend/src/App.tsx` monolith
- `/api/safety` returns HTTP 200 even on partial failure (`partialData: true`, `apiWarning`)
- Confidence score floor: 20 (clamped at ~L2583)
- Safety score: 100 - sum of capped group impacts (see `calculateSafetyScore`)

## Known Fragility Points

### Rainfall Pipeline (`backend/index.js` ~L1870-L2069)
- `fetchRecentRainfallData` has a 4-tier fallback: live forecast → fresh cache → archive API → stale cache → zeroed fallback
- Archive data IS written to cache (L1944). Previous note was wrong — corrected.
- Zero-fallback scoring: all totals are null so no Surface Conditions factors fire — **underestimates hazard silently** (only a 4-point penalty applied, not surface factor chain)

### Confidence Chain Ordering (~L2522-2583)
- `zeroed_totals` check is `else if` after `status` checks — `buildRainfallZeroFallback` sets `status: 'partial'` so zeroed_totals branch IS reached correctly. Do not flag as bug.

### `alertsRelevantForSelectedTime` (L2157)
- Hardcoded `true` — never computed. The else-branch at L2545-2546 is dead code. The `+2` uncertainty bump at L2421-2423 can never fire. All confidence/scoring guards that check `!alertsRelevantForSelectedTime` are dead.

### NOAA Hourly Response Not `.ok`-Checked (L3032-3033)
- `hourlyRes` is used without checking `hourlyRes.ok`. Non-200 response falls through to JSON parsing, which may throw or silently return an empty periods array.

### Avalanche Scraper `pageRes.ok` Not Checked (L3564-3565)
- HTML scrape goes directly to `pageRes.text()` without checking `pageRes.ok`. Error pages get scraped.

### `parseInt` on Undefined Fields — NaN label risk (L3493-3495)
- `parseInt(currentDay.lower/middle/upper)` → NaN if field missing → `levelMap[NaN]` → `undefined` label.

### `peakFeelsLike12hF` Compares Against Raw Temp, Not Feels-Like (heat-risk.js L42-44)
- `peakFeelsLike12hF = Math.max(feelsLikeF, peakTemp12hF)` — should compare against peak feels-like across trend, not peak raw temperature. Underestimates heat risk when wind chill is significant, overestimates it when feels-like < raw temp is not possible (low wind).

### URL Share State Missing `turnaroundTime` (frontend/src/App.tsx ~L1407-1449)
- `buildShareQuery` never sets the `turn` parameter even though `parseLinkState` reads it. Turnaround time is lost on every URL share.

## Recurrent Patterns to Watch
- HTTP `.ok` check applied inconsistently — NOAA hourly and HTML scraper both lack it
- `parseInt()` without `|| 0` fallback produces NaN when upstream fields are absent
- Caches are process-local Maps — no TTL eviction, unbounded growth on long-running servers
- Dead code branches from hardcoded booleans (`alertsRelevantForSelectedTime`)
- `buildRainfallZeroFallback` suppresses Surface Condition factors silently

## Key File Locations for High-Risk Bugs
- L2157 `backend/index.js`: `alertsRelevantForSelectedTime = true` hardcoded
- L3032 `backend/index.js`: NOAA hourly used without `.ok` check
- L3564 `backend/index.js`: HTML scrape page used without `.ok` check
- L3493 `backend/index.js`: `parseInt(currentDay.lower/middle/upper)` NaN risk
- L42 `backend/src/utils/heat-risk.js`: `peakFeelsLike12hF` wrong max comparison
- L1407 `frontend/src/App.tsx`: `buildShareQuery` missing `turn` param
