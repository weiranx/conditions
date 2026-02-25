# Gaps — First Review (2026-02-25)

## P0 Safety Gaps

### Lightning window not surfaced in travel timeline
`TravelWindowRow` (types.ts:452) has no lightning/convective flag. `assessCriticalWindowPoint()` (App.tsx:686) does add `convective storm signal` to CriticalWindowRow.reasons but this never becomes a hard FAIL in the `buildTravelWindowRows()` pass/fail logic (App.tsx:967). A runner crossing an exposed ridge at 1PM with a "CAUTION: convective storm signal" hour in the timeline but a PASS verdict is misled.

### Creek crossing flood risk has no translation
`rainfall.totals.rainPast24hIn` and `rainPast48hIn` are computed (types.ts:204) and displayed in the Recent Rainfall card with severity classes (rainfall24hSeverityClass, App.tsx:4340), but are NEVER labeled as creek/ford crossing risk. A runner planning a technical route with creek crossings gets raw precipitation numbers with no statement like "Creek crossing risk: Elevated — 0.6 in in 24h may mean high water on stream crossings."

### Avalanche path crossing timing never translated for runners
The `AvalancheForecastCard` (AvalancheForecastCard.tsx) shows danger by elevation band and aspect/elevation chip grid, but nowhere does the app say "crossing this avalanche path is highest-risk between 10AM–2PM when solar warming peaks." The solar data (`safetyData.solar`) and temperature trend are both available but never combined to produce a runner-relevant timing window for crossing exposed slopes.

### No turnaround/back-by time shown or used in travel window
`turnaroundTime` exists in state (App.tsx ~line 1366 in LinkState) but it is NOT rendered as an input field in the map controls section. The travel window is driven purely by `alpineStartTime + travelWindowHours`, meaning a runner's actual "I must be back by 2PM" constraint is never enforced. A runner setting a 12h window from 5AM would see all hours to 5PM evaluated, missing the turn-around discipline entirely.

## P1 High-Friction UX Problems

### "Show plan controls" is collapsed by default on mobile
`mobileMapControlsExpanded` defaults to false (App.tsx renders `map-actions is-collapsed`). A runner loading the app on a phone sees no date/time/window controls without first expanding them. The start time — the most critical planning input — is hidden behind a tap. This adds friction exactly when a runner is in a hurry.

### Activity type is hardcoded — no runner-specific framing
`normalizeActivity()` in core.ts (line 31) collapses every activity type including 'trail_runner' and 'runner' into 'backcountry'. There is no runner-specific hazard vocabulary anywhere (postholing, suncups, icy singletrack, etc.). A runner sees the same "backcountry traveler" framing as a ski mountaineer. This means the terrain/trail condition system (`terrainCondition.code` values like `snow_ice`, `wet_muddy`, `cold_slick`) are shown but NOT translated into runner actions.

### Travel window only fails on 3 signals — missing lightning, snow depth, sun exposure
`buildTravelWindowRows()` (App.tsx:967) evaluates ONLY: gust > maxGust, precipChance > maxPrecip, feelsLike < minFeelsLike. There is no per-hour postholing risk signal (snow depth available via `terrainCondition.signals.maxSnowDepthIn`), no lightning flag (condition text IS available as `WeatherTrendPoint.condition`), and no icy-surface detection (freeze/thaw profile exists in `terrainCondition.snowProfile`). A runner can get an all-PASS timeline through a 12h window with "Thunderstorm Possible" conditions at hour 6 as long as precip/gust/temp pass.

### No end-time / back-by-time input in main planner
The plan controls section (App.tsx ~6755) has: Forecast date, Start time, Window (hours), Now button. There is no "Back by" time input despite `turnaroundTime` existing in state and `LinkState`. A runner must mentally convert "back by 2PM, started 5AM = 9h window" — error-prone especially while tired.

### Score card explains nothing about what the number means
The score card (App.tsx:6974) shows `safetyData.safety.score`% and a label (Optimal/Caution/Critical), plus `primaryHazard`. A runner seeing "63% — Caution" has no immediate sense of what moved the needle. `safety.factors[]` exists and drives the Score Trace card, but it is buried deep in card order and requires scrolling. The score card itself should surface the top 1-2 factors inline.

### Jump nav has only 4 destinations, misses "Avalanche"
The `planner-jump-nav` (App.tsx:6956) has Decision, Travel, Weather, Alerts. The Avalanche card has a dedicated section (`planner-section-weather` is used for weather, but the avalanche card has no jump nav entry). A runner who primarily wants to check the avalanche path crossing danger must scroll through the full card list.

### "Plan controls" collapsed state is not preserved across sessions
`mobileMapControlsExpanded` is local component state. When a user returns to the app, it re-collapses. Every session requires an extra tap before any planning can happen.

## P2 Trail Runner Enhancements

### Freeze-thaw / corn snow profile not surfaced as runner-relevant signal
`terrainCondition.snowProfile.code` includes `corn_snow`, `frozen_crust`, `fresh_powder` (terrain-condition.js). These are computed but rendered without runner vocabulary. "Frozen crust" means different things to a skier vs a runner — for a runner it means hard, breakable surface with post-holing risk mid-day. A simple translation: "Morning: firm crust (good running). Afternoon: soft/breakable crust (postholing risk)."

### No sun exposure / solar aspect indicator in the travel window
`solar.sunrise` and `solar.sunset` are available. The freeze-thaw snow profile already references "solar aspects." A per-hour isDaytime flag exists in `WeatherTrendPoint.isDaytime`. But there is no sun-angle indicator showing when a given aspect will be in full solar radiation — critical for predicting afternoon snowfield softening, suncup formation, and icy morning crossings.

### No creek/waterway crossing indicator on the map
The map has CalTopo / Gaia GPS links, but no overlay showing creek level indicators or flood-risk context near the pinned objective. Given `rainfall.totals` data is already fetched, a simple "Stream crossings: ELEVATED" badge near the map coordinates label would help.

### Better Day picker does not show daily start window quality
The "Potential better days" list (Decision Gate card, App.tsx:7091) shows date, decision level, score, weather description, precip%, gust. It does NOT show whether the better day has a clean early-morning window vs only afternoon conditions. A runner starting at 4AM needs to know if that day's clean window starts at 4AM or 10AM.

### Wind direction relative to route not linked to avalanche aspects
The wind loading card computes `leewardAspectHints` (App.tsx:5286) but it is surfaced separately from the avalanche card's aspect/elevation grid. A runner glancing at the AvalancheForecastCard cannot immediately see "wind from NW = leeward loading on SE aspects" without cross-referencing cards.

### No "quick-look" header badge for current snow surface runnability
The map bottom bar has weather temp + condition, but nothing about trail/snow surface runnability. A badge like "Terrain: Icy/Suncups/Postholing" visible without any scrolling would serve a runner's go/no-go scan better.

### Satellite one-liner is powerful but buried
The SAT message copy button (App.tsx:7029) is in the score card area, below the map. On mobile this is below the fold. A runner who uses a satellite messenger should be able to copy this line from a persistent top bar, not from a buried button.
