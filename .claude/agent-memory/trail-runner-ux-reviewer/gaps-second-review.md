---
name: gaps-second-review
description: Gaps and findings from second trail runner UX review (2026-03-13), tracking what was fixed from first review and what remains
type: project
---

# Gaps — Second Review (2026-03-13)

## Fixed Since First Review (2026-02-25)
- Lightning/thunderstorm now correctly fails travel window hours (travel-window.ts line 47)
- Jump nav now includes Avalanche (conditional) and Gear buttons (PlannerView.tsx line 1129)
- Mobile plan controls expanded state persists via localStorage (PlannerView.tsx line 981)
- Creek crossing risk warning appears in DecisionGateCard (line 61-64) — but only at "nogo" severity
- Score card now shows top 2 factors inline (PlannerView.tsx lines 1149-1158)

## Still Open from First Review
- No back-by/turnaround time input in planner controls (turnaroundTime state exists but no input rendered)
- Snow depth not translated into postholing risk in travel window hourly rows
- Avalanche path crossing timing not surfaced (solar + temp trend combination)
- No terrain/surface badge in sticky header or mission brief (CSS exists but component not rendered)
- Better Day suggestions may not always show bestWindowStart hour

## New Findings (Second Review)
- AQI thresholds too permissive for runner exercise ventilation (caution at 51, block at 151 — should be lower for sustained aerobic effort)
- No max-feels-like (heat) threshold in travel window pass/fail — only min-feels-like (cold) checked
- "Runner / Summer" preset name implies seasonal restriction; should be "Trail Runner"
- Travel window preset sub-labels hardcode mph (TravelWindowPlannerCard.tsx line 175) regardless of user wind unit
- No wind direction in TravelWindowRow type (WeatherTrendPoint has it, but it's not passed through)
- No hydration demand signal despite heat risk metrics being available

## Runner Preset Values (usePreferenceHandlers.ts line 33)
- Runner: gust 30mph, precip 50%, minFeelsLike 25F
- Conservative: gust 20mph, precip 40%, minFeelsLike 15F
- Standard: gust 25mph, precip 60%, minFeelsLike 5F
- Aggressive: gust 35mph, precip 75%, minFeelsLike -5F
