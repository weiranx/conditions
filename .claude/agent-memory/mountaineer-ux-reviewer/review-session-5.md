---
name: review-session-5
description: Session 5 comprehensive mountaineer UX review — full-stack audit of all views, decision logic, gear engine, wind loading, terrain classification, and card ordering
type: project
---

## Session 5 Review (2026-03-13)

### Scope
Full mountaineer-persona review of the entire application across frontend (App.tsx, PlannerView, all card components, HomeView, SettingsView, decision.ts, wind-loading-display.ts, card-ordering.ts) and backend (gear-suggestions.js, terrain-condition.js, sat-oneliner.js, visibility-risk.js, fire-risk.js, weather-data.js, avalanche-orchestration.js).

### Key Findings

**Previously Identified Bugs — Status Update:**
- `createUnavailableWeatherData()` now returns `null` for all fields (NOT 0) — BUG FIXED since session 2
- `deriveOverallDangerLevelFromElevations()` now uses `Math.max()` of elevation bands — BUG FIXED (uses max, not average)
- `fire-risk.js` `createUnavailableFireRiskData` now returns `level: null` (not 0) — BUG FIXED
- Considerable (L3) still triggers `addBlocker()` in decision.ts line 217 — previous note said CAUTION only, but it IS now a blocker (with qualification text)

**New Observations:**
1. `deriveOverallDangerLevelFromElevations` at line 415: if ALL elevation bands return level 0 (e.g., "No Rating" parsed as 0), the max is 0, and fallback is ignored. This could silently produce danger 0 when data is present but unparseable.
2. Wind loading `aspectOverlapProblems` computed in `wind-loading-display.ts` line 72-78 — data exists but caller must explicitly use it; need to verify PlannerView actually displays the overlap warning.
3. Gear engine (gear-suggestions.js) now includes `alpine-hardware` suggestion for ice axe + crampons when `maxObservedSnowDepthIn >= 12` or `icy && cold` — this was flagged as missing in session 3 but appears to have been added.
4. SAT one-liner `maxLength = 170` aligns with Garmin inReach 160-character limit (close but not exact); should be 160 for strict compatibility.
5. Travel threshold presets: `aggressive` preset has minFeelsLikeF: -5. For mountaineering, this is barely below zero F — genuinely aggressive alpine would tolerate -20F or lower.
6. HomeView has no mention of US-only coverage — the landing page gives no geographic scope indication.
7. No PWA/service-worker files exist anywhere in the frontend.

### Decision Logic Deep-Dive
- L3 Considerable: now correctly `addBlocker()` with text "Avoid avalanche terrain unless trained in terrain selection and risk management" — this is appropriate
- L4/L5 High/Extreme: hard blocker, correct
- Storm signal scanning covers full travel window trend — good improvement
- Daylight check now considers turnaround time when provided — good
- BUT: turnaround time is not validated against sunset in the travel window engine itself (only in decision gate)

### Card Ordering Observations
- Decision Gate has hardcoded `order: 0` (always first) — correct
- Score card has hardcoded `order: 1` — displays raw percentage before verdict context, which is suboptimal from a mountaineer's perspective (verdict first, score second)
- Avalanche forecast card is `order: 2` when relevant, `order: 130` when not — correct gating
- Wind loading hints gated on `windLoadingHintsRelevant` which is `avalancheRelevant || Boolean(resolvedWindDirection)` — BETTER than before (was gated only on `!avalancheUnknown`), now shows even without avalanche coverage if wind direction is known
