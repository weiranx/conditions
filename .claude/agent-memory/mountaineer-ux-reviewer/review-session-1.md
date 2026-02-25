# Review Session 1 - Full Detailed Notes

## Session Date: 2026-02-24
## App Version: commit ad99e5f (main branch)

## Files Read
- README.md, CLAUDE.md, docs/api.md, docs/architecture.md
- frontend/src/app/types.ts, constants.ts, App.tsx (full read in sections)
- frontend/src/lib/search.ts
- backend/src/utils/gear-suggestions.js, terrain-condition.js, snowpack.js,
  wind.js, avalanche-detail.js, sat-oneliner.js
- backend/index.js (first 150 lines - confirms pipeline architecture)

## Offline Capability Assessment
- Zero offline capability confirmed. No service worker, no PWA manifest.
- localStorage used only for user preferences (not safety data caching).
- Backend is a remote API - if connectivity drops, app is dead.
- Mountain environment implication: any cell dead-zone = zero app function.

## Gear Suggestions Assessment
- buildLayeringGearSuggestions() in gear-suggestions.js is clothing/layering only.
- Triggers: beacon check only for avy danger >= 2 (correct threshold, correct gear).
- No hardware: ice axe, crampons, rope, harness, helmet, crevasse rescue kit,
  prussiks, avalanche airbag, ski/split gear, GPS device, PLB.
- "Final system check: Confirm shell + insulation work together" is reasonable.
- Max 9 items returned - good discipline, avoids list fatigue.

## Avalanche System Assessment
- Avalanche.org polygon matching + nearest fallback (good engineering).
- Utah UAC specific hotfix logic (real-world pragmatism noted).
- Danger levels 0-5 mapped to IFAG labels (correct).
- Elevation bands (below/at/above treeline) displayed - correct IFAG structure.
- Aspect rose computed from wind direction for wind loading - useful.
- CRITICAL GAP: No aspect/elevation input for the climber's planned route.
  The app shows "leeward aspects" from wind direction but has no way to know
  if the climber is on a N face vs SW face. This is the most important
  contextual piece for avalanche hazard assessment.
- coverageStatus field handles: reported, no_center_coverage,
  temporarily_unavailable, no_active_forecast, expired_for_selected_start.
  Good coverage of edge cases.

## Decision Gate Assessment
- GO/CAUTION/NO-GO with blockers and cautions - appropriate framework.
- Threshold-based: max gust mph, max precip %, min feels-like F.
- User-configurable thresholds in settings (good - different parties have
  different tolerance profiles).
- Daylight check: 30-min buffer before sunset (conservative but appropriate).
- Avalanche gate: requires <= 2 (Moderate) for GO without "ignore" flag.
- "ignoreAvalancheForDecision" flag exists - appropriate for non-avalanche terrain.
- Score < 42 triggers NO-GO blocker, 42-68 triggers CAUTION.
- CRITICAL GAP: No team size factor. A solo climber has much higher risk
  tolerance requirements than a guided group of 10.
- CRITICAL GAP: Decision framework doesn't account for objective difficulty
  or technical grade. A Class 2 hike vs a Grade V alpine route should have
  different baseline risk tolerances.

## Weather System Assessment
- NOAA/NWS primary with Open-Meteo fallback - solid architecture.
- Hourly trend chart with metric selector (temp/wind/gust/precip/humidity/
  pressure/dew point/cloud cover/wind direction) - comprehensive.
- Hour preview selector (step through hours) - excellent field utility.
- Lapse rate estimates: 3.3F/1000ft, 2 mph wind/1000ft - standard and correct.
- Elevation forecast bands from API data when available.
- Target elevation input (manual) with +/- step buttons.
- Wind chill formula (NWS standard) used for feels-like below 50F at 3+ mph.
- Pressure trend tracked but trend direction context unclear in UI.
- Whiteout/visibility risk score (0-100) derived from condition text + weather.
- IMPORTANT GAP: No mountain-summit-specific weather model. NWS gridpoint
  forecasts at valley/station elevation are commonly 2000-5000ft below summit.
  The lapse rate estimate helps, but it's a rough calculation, not a summit forecast.
- IMPORTANT GAP: No 500mb / upper-level wind data. Above 18,000ft conditions
  diverge dramatically from surface forecasts. On Denali or Rainier, this matters.

## Snowpack Assessment
- SNOTEL nearest station + NOHRSC grid raster sample.
- Historical comparison (10-year lookback, % of average).
- Representativeness scoring based on distance/elevation delta.
- Station can be up to 140km away (findNearestSnotelStation maxDistanceKm=140).
  140km is FAR - this will frequently misrepresent actual conditions.
- SNOTEL data is daily, not hourly - appropriate for planning.
- NOHRSC is an analysis product (not modeled), which is honest.
- GOOD: Warning displayed when station is >25km away.
- GOOD: Confidence downgraded when observation is >3 days old.

## Travel Window Planner Assessment
- Hourly pass/fail against user thresholds (gust/precip/feels-like).
- Trend direction (improving/worsening/steady) computed.
- "Best window" and "next clean window" identified - excellent field utility.
- GOOD: Risk-sorted cards float travel window up when conditions are poor.
- GOOD: Threshold editor inline in the card.
- GAP: Threshold editor uses text inputs not sliders. With gloves this is painful.
- GAP: No "cushion" logic - if you need 2hr summit window, it should find
  consecutive 2hr+ blocks, not just any passing hour.
- GAP: No integration between turnaround time and travel window display.
  Turnaround time is captured but the travel window just shows hourly pass/fail
  for the whole travel window without surfacing "you need X hours of green to
  summit and return."

## SAT One-Liner Assessment
- Format: "Name Date StartTime | temp feelslike wind gust precip | Avy | Worst12h | GO"
- 170-char limit (appropriate for Garmin inReach standard message limit).
- Worst12h snippet selects hour with highest composite risk score.
- Copyable from score card area.
- EXCELLENT: This is genuinely useful. Mountain rescue coordinators could use this.
- MINOR: SAT line uses F and mph even when user has C and kph set in preferences.
  International teams using SI units will see unfamiliar units in the SAT message.

## Multi-Day Trip Forecast Assessment
- 2-7 day range, parallel API calls per day.
- Shows decision level, score, weather, temp, gust, precip, avy summary per day.
- "Better day" suggestions scan next 7 days when current day is CAUTION/NO-GO.
- GOOD: Automatically opens when navigating to Trip view with objective loaded.
- GAP: No acclimatization staging. For high-altitude objectives, days 1-3 would
  be approach/acclimatization, summit day would be day 4-7. App treats all days
  equally with the same travel parameters.
- GAP: No camp elevation planning. Camp 1 vs Camp 2 conditions can differ
  dramatically and matter for multi-day alpine objectives.

## Printable Report Assessment
- HTML print view opened in new window.
- Includes: objective, date, start, coordinates, score, decision, weather snapshot,
  avalanche, alerts, snowpack, fire risk, decision checks, gear, blockers,
  cautions, avy bottom line, SAT line, field brief.
- GOOD: Designed for pre-trip filing with SAR contacts.
- GAP: No signature field or "filed with" contact info for trip filing.
- GAP: Print CSS could be more compact - wastes paper on spacing.
- GOOD: Explicit disclaimer on print output (liability-appropriate).

## Team Brief / Field Brief Assessment
- Structured 4-step execution guide generated from current conditions.
- Includes: departure gate verification, movement timing, hazard timing, route discipline.
- Abort triggers generated from decision blockers.
- Copyable to clipboard.
- GOOD: "Send SAT one-liner and team brief to your support contact before departure" reminder.
- GAP: No field for "responsible contact name/phone" in the brief.
- GAP: No standard SARtopo/GaiaGPS track URL field.

## Search / Objective Selection Assessment
- 10 popular US peaks hardcoded.
- Nominatim geocoding for broader search (US-focused).
- Coordinate paste supported.
- Map click to pin - intuitive.
- CRITICAL GAP: Search is US-biased. Nominatim returns US results well but
  for objectives like Aconcagua, Denali (partial - it's in US), Mont Blanc,
  or Kilimanjaro, the app would return incomplete/no data from NOAA/SNOTEL.
  No warning is shown that data quality drops dramatically outside the US.
- GAP: Peak elevation not shown in search results. For a climber looking for
  "Mount Adams" there are multiple. The state name helps but elevation would
  confirm the right peak.

## External Link Integration
- CalTopo, Gaia GPS, Windy linked from planner (excellent choices).
- Mountain Project NOT linked (commonly used for route beta).
- Avalanche center homepage linked from avalanche card (good).
- NOAA forecast link available in weather source details.

## Usability in Extreme Conditions
- Web app (not native mobile): no offline, no background refresh.
- Touch targets: standard web buttons - likely too small for thick glove use.
  Smallest identified: weather-hour-step-btn (Plus/Minus), target-elev-step-btn.
- Text inputs for thresholds require precise typing.
- Dark mode available (critical for night reading without destroying night vision).
- High-contrast color: score card uses dynamic border color (green/yellow/red) - readable.
- Dynamic card ordering by risk level is smart but may confuse in the field
  if cards jump around between refreshes.
- No font size override or "field mode" with larger text.
- No battery/power-saver mode consideration (no lazy load beyond what React provides).
