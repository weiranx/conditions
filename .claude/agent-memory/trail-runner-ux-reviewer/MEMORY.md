# Trail Runner UX Reviewer — Agent Memory

## Project Summary
SummitSafe is a backcountry planning app (React + Vite frontend, Express backend). It synthesizes weather, avalanche, air quality, snowpack, and terrain signals. The intended audience is backcountry travelers; the app has no trail-runner-specific persona, but the UX impacts runners directly.

## Key File Paths
- `frontend/src/App.tsx` — 8500+ line monolith, all planner UI, decision logic, rendering
- `frontend/src/components/planner/PlannerView.tsx` — extracted planner view with map controls, jump nav, card rendering
- `frontend/src/components/planner/cards/TravelWindowPlannerCard.tsx` — hourly pass/fail timeline
- `frontend/src/components/planner/cards/DecisionGateCard.tsx` — decision gate with blockers/cautions/better days
- `frontend/src/app/types.ts` — all SafetyData interfaces
- `frontend/src/app/core.ts` — formatting and calculation utilities
- `frontend/src/app/decision.ts` — evaluateBackcountryDecision() with all check logic
- `frontend/src/app/travel-window.ts` — buildTravelWindowRows() pass/fail logic
- `frontend/src/app/critical-window.ts` — assessCriticalWindowPoint() risk scoring
- `frontend/src/hooks/usePreferenceHandlers.ts` — TRAVEL_THRESHOLD_PRESETS including runner preset
- `backend/src/utils/terrain-condition.js` — deriveTerrainCondition, deriveSnowProfile
- `backend/src/utils/safety-score.js` — safety score with AQI/fire/heat/weather factors

## Architecture Patterns
- Activity type always collapses to `'backcountry'` via `normalizeActivity()` in `core.ts`
- Travel window pass/fail: gust, precip, feelsLike (cold only), condition text (thunder/lightning/hail/blizzard)
- NO max-feels-like (heat) check in travel window
- NO snow depth check in travel window
- Decision gate scans worst-case across full travel window trend
- Presets: Conservative, Standard, Aggressive, Runner/Summer (line 33 usePreferenceHandlers.ts)
- Mobile controls persist via localStorage `summitsafe:mobile-controls-expanded`
- Jump nav: Decision, Travel, Weather, Avalanche (conditional), Alerts, Gear

## Review History
- [gaps-first-review.md](gaps-first-review.md) — First review findings (2026-02-25)
- [gaps-second-review.md](gaps-second-review.md) — Second review findings (2026-03-13), tracks fixes and new gaps
