# Trail Runner UX Reviewer — Agent Memory

## Project Summary
SummitSafe is a backcountry planning app (React + Vite frontend, Express backend). It synthesizes weather, avalanche, air quality, snowpack, and terrain signals. The intended audience is backcountry travelers; the app has no trail-runner-specific persona, but the UX impacts runners directly.

## Key File Paths
- `frontend/src/App.tsx` — 8500+ line monolith, all planner UI, decision logic, rendering
- `frontend/src/components/planner/cards/TravelWindowPlannerCard.tsx` — hourly pass/fail timeline
- `frontend/src/components/planner/cards/AvalancheForecastCard.tsx` — avalanche display
- `frontend/src/components/planner/cards/FieldBriefCard.tsx` — command-intent style brief
- `frontend/src/app/types.ts` — all SafetyData interfaces
- `frontend/src/app/core.ts` — formatting and calculation utilities
- `backend/index.js` — 4000+ line orchestration monolith
- `backend/src/utils/terrain-condition.js` — deriveTerrainCondition, deriveSnowProfile

## Architecture Patterns
- Activity type is always `'backcountry'` — `normalizeActivity()` in `core.ts` collapses trail-runner, hiker, mountaineer → all to 'backcountry'. No runner-specific signal customization.
- `evaluateBackcountryDecision()` in App.tsx (line 1478) drives the GO/CAUTION/NO-GO gate using: avalanche danger, gust, precip, safety score, feels-like, alerts, AQI, fire risk, heat risk, terrain, freshness
- `TravelWindowRow` type has: time, pass, condition, reasonSummary, failedRules (gust/precip/feelsLike only), temp, feelsLike, wind, gust, precipChance — NO snow depth, NO lightning flag, NO creek level
- `TravelWindowInsights` has: passHours, failHours, bestWindow, nextCleanWindow, topFailureLabels, trendDirection/strength, conditionTrendLabel/Summary, summary
- Travel window threshold presets: Conservative (gust 20, precip 40%, feels 15F), Standard (25, 60%, 5F), Aggressive (35, 75%, -5F)
- Weather trend chart supports 10 metrics: temp, feelsLike, wind, gust, pressure, precipChance, humidity, dewPoint, cloudCover, windDirection

## Hazard Data Available But Not Exposed to Runners
- `terrainCondition.signals.maxSnowDepthIn` — snow depth present but no postholing/suncup risk translation
- `weather.trend[].condition` — "thunderstorm" string exists but no dedicated lightning window detection in travel timeline
- `solar.sunrise / solar.sunset` — available; daylight buffer check exists (30 min) but no per-hour sun exposure in travel window
- `rainfall.totals.rainPast12/24/48hIn` — creek flood proxy exists but never labeled as "creek crossing risk"
- `terrainCondition.snowProfile.code` — freeze-thaw corn cycle IS computed (codes: fresh_powder, corn_snow, frozen_crust, etc.) but not surfaced in runner-relevant language

## Safety Score Display
- Score shown as `safetyData.safety.score` (percentage 0–100)
- Color bands: ≥80 green (Optimal), ≥50 yellow (Caution), <50 red (Critical)
- `safety.confidence` also shown but rarely visible in the score card
- Score explanations live in `safetyData.safety.explanations[]` and `safety.factors[]`

## Decision Gate Structure
- `decision.level` = GO / CAUTION / NO-GO displayed as pill
- `decision.blockers[]` = hard blockers
- `decision.cautions[]` = soft cautions
- `decision.checks[]` = individual check objects with {key, label, ok, detail, action}
- Better-days scan fires on CAUTION/NO-GO — loads 7 future days automatically

## UX Layout
- Mission brief bar appears above report cards: shows decision pill, best window, objective name, start time, top blockers
- Jump nav has 4 sections: Decision, Travel, Weather, Alerts
- Cards are dynamically sorted by risk level (base score + riskLevel * 12 penalty)
- Essential vs Full view toggle — Essential shows rank ≤ 8 or riskLevel ≥ 3
- Map controls have a collapsible "Show plan controls" toggle for mobile
- No dedicated "end time" / "back by time" field in the planner header controls (turnaroundTime exists in state but is NOT rendered as an input in the map controls section)

## Confirmed Gaps (First Review, 2026-02-25)
See `gaps-first-review.md` for detailed findings.

## Conventions
- `localizeUnitText()` does regex substitution to convert unit strings in explanations
- `formatClockForStyle()` respects user's ampm/24h preference
- All upstream provider failures return partialData:true with apiWarning — no crash
