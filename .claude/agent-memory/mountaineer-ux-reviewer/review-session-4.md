# Review Session 4 - Safety Score, Avalanche Card, Terrain, Weather, Route Planning Review

## Task Scope
Full review of UX gaps, missing features, and improvements from experienced mountaineer perspective.
Focus areas: safety score breakdown, avalanche information, terrain assessment, weather data, route planning tools.
Source files examined: App.tsx (full), AvalancheForecastCard.tsx, TravelWindowPlannerCard.tsx, FieldBriefCard.tsx.

---

## Status Check: Previously Identified Gaps (Sessions 1-3)

### Gaps STILL OPEN (confirmed not yet fixed):
- GAP-3.1: Wind direction NOT cross-referenced against bulletin problem aspects in score or UI
  - leewardAspectHints[] exists in WindLoadingHints card, but NO logic compares these to problem.aspects in AvalancheForecastCard
  - No "wind is loading the same aspects as Problem #1" callout anywhere
- GAP-3.2: Turnaround time NOT checked against sunset
  - turnaroundTime is in state, passed to raw payload and SAT one-liner, but evaluateBackcountryDecision() only checks alpineStartTime vs sunset
  - Plan Snapshot card shows sunrise/sunset/daylight-from-start but NOT turnaround time vs sunset
  - No check: "if start=6am, window=12h, turnaround=6pm, does 6pm <= sunset-30min?"
- GAP-3.3: Forecast lead time NOT surfaced as UI badge
  - forecastLeadHours mentioned in backend scoring but zero UI callout on weather card or decision gate
- GAP-3.4: Snow loading rate (24h snowfall) NOT shown adjacent to avalanche problem cards
  - snowfall24hIn is computed in App.tsx (line 4335) and shown in Rainfall card
  - But AvalancheForecastCard.tsx does NOT receive or display snowfall24hIn alongside problem descriptions
- GAP-3.6: Ground blizzard scenario (dry high-wind + snowpack) NOT in visibility risk
  - Whiteout Risk chip exists in weather card but logic does not check wind>=30 + snowpack + below-freezing without precipitation
- GAP-3.7: Gear list missing ice axe, crampons, helmet, rope
  - Confirmed: gear-suggestions.js has zero instances of ice axe/crampon/helmet/rope
  - Category 'snow_ice' terrain code does NOT trigger hardware gear suggestions
- GAP-3.8: Lapse rate inversion warning absent (confirmed, fixed-rate lapse still used)
- GAP-2.1: Avalanche danger silently downgraded by 1 in backend (known bug)
- GAP-2.3: Considerable danger (L3) triggers CAUTION not NO-GO (line 1621-1622 - by design or bug?)
- GAP-1.1: No offline/PWA capability (unchanged)
- GAP-1.3: No emergency/SOS feature (unchanged)

---

## NEW Gaps Found in This Session

### GAP-4.1: Avalanche Card Hidden in Essential View - Creates Safety Information Blind Spot
The AvalancheForecastCard is wrapped in `{!isEssentialView && ...}` (line 8436).
In Essential View, the full avalanche problem breakdown (aspects, elevation bands, likelihood,
size scales, bottom line, problem discussion) is completely hidden.
The Decision Gate card shows the avalanche DANGER LEVEL as a pass/fail check, but:
- No avalanche problem details (Wind Slab, Persistent Slab, etc.) are visible
- No "bottom line" text is accessible
- The aspect rose for each problem is invisible
A climber in Essential View making a go/no-go decision has ONLY a danger number - not the
contextual information needed to choose a safe route.
RISK: User optimizes for readability (essential view) at exactly the moment they most need
the full avalanche context - when conditions are marginal and they are in the field.
FIX: In Essential View, keep a condensed avalanche summary visible: danger level per band,
bottom line text (2 sentences), and the top problem name + aspects. Full problem expansion
can remain behind a "show full forecast" toggle.

### GAP-4.2: Score Trace Card Shows Only Top 5 Factors, Sorted by Absolute Impact - Misleading Omissions
The Score Trace card (lines 7294-7308) shows `factors.slice(0,5)` sorted by `Math.abs(impact)`.
Two issues:
1. If the #6 factor is "Avalanche data unavailable, penalty = -8" but factor #5 is "Gust within limits +3",
   the avalanche gap disappears from the trace view. The user sees the positive factor but not the
   data-gap penalty.
2. The factors are scored by absolute magnitude, not by safety criticality. A +3 score for "AQI good"
   can appear before a -3 for "stale avalanche bulletin" which is far more safety-critical.
FIX: Reserve one "sticky" slot in the trace for any data-gap or coverage-unavailable factor,
regardless of its score impact. Also consider a separate "data confidence" row that highlights
missing/stale source penalties separately from weather/avy signal penalties.

### GAP-4.3: Plan Snapshot Does Not Show Turnaround Time vs Sunset Delta
The Plan Snapshot card (lines 8370-8401) shows:
  - Start time
  - Sunrise
  - Sunset
  - Daylight left from start
  - Forecast date
BUT does NOT show:
  - Turnaround time
  - Whether turnaround time is before/after sunset
  - How much daylight margin exists at turnaround
The turnaroundTime state variable is present and populated (from preferences.defaultBackByTime
or URL param). It is passed to the raw payload and SAT one-liner. But it is nowhere rendered
in the Plan Snapshot card that shows solar/timing data.
A user who sets a 4pm turnaround on a November day with 4:45pm sunset will have no visual
prompt that this leaves only 45 minutes of daylight margin on their scheduled return.
FIX: Add "Turnaround" and "Daylight at turnaround" rows to Plan Snapshot. Wire turnaround
time vs (sunset - 30 min) into the daylight check in evaluateBackcountryDecision().

### GAP-4.4: Travel Window Threshold Editor Uses Number Inputs - Glove-Hostile UX
The threshold editor (TravelWindowPlannerCard.tsx lines 202-243) uses raw `type="number"` inputs
with step/min/max for wind, precip, and feels-like thresholds.
On mobile (which is where this app lives during actual trips), number inputs are keyboard-heavy.
On a touchscreen with gloves, typing "25" in a small number input requires removing a glove.
There ARE preset buttons (Conservative/Standard/Aggressive) which is good - but there is no
slider control as an alternative to text entry.
The presets cover three common cases; custom edits require precise numeric input.
FIX: Replace or augment the `type="number"` inputs with range sliders as the primary control.
The text input can remain as a secondary/precision override. Sliders work with thumb-swipe
even with gloves on a touchscreen. This is directly analogous to how Suunto and inReach apps
handle threshold adjustment in cold-weather modes.

### GAP-4.5: Wind Loading Card Gated Behind avalancheRelevant AND avalancheUnknown == false
The Wind Loading Hints card (line 7903) only renders if:
  `windLoadingHintsRelevant` is true, which is defined as:
  `avalancheRelevant && !avalancheUnknown` (line 5482)
This means: if you are outside formal avalanche center coverage (dangerUnknown=true), the
wind loading analysis is hidden entirely. But this is precisely the scenario where a climber
needs wind loading information most - when there is no official forecast, field-derived
clues like leeward aspects and transport-speed classification are the primary safety signal.
A couloir objective outside CAIC coverage in early season: no center data, but 30 mph NW
winds with 8 inches of fresh snow = textbook slab loading scenario. App shows nothing.
FIX: Show wind loading hints even when avalanche coverage is unknown. In unknown coverage mode,
lead with: "No official avy forecast - use wind loading as a primary terrain-selection guide."
Remove the hard dependency on !avalancheUnknown.

### GAP-4.6: No Aspect-Overlap Alert Between Wind Loading Leeward Aspects and Bulletin Problem Aspects
This is a carry-forward from GAP-3.1 but now confirmed in both new card-level code and App.tsx:
The leewardAspectHints[] array (leeward aspects from current wind direction) is rendered as
chips in the Wind Loading Hints card. The AvalancheForecastCard receives `avalanche.problems[]`
which each contain `problem.location` that gets parsed by `parseTerrainFromLocation()` into
a `terrain.aspects` Set.
These two data structures are NEVER compared. The UI never says:
"Wind from NW is loading S/SE/E aspects. Problem #1 (Wind Slab) is on S/SE/E aspects.
Current winds are actively loading the exact aspects cited in this bulletin."
This is a tier-1 safety-critical gap. The data exists, the computation is trivial, and the
integration requires at most 15 lines in App.tsx. The reason to flag it again in Session 4:
both source arrays are now confirmed to be populated and correctly shaped.
FIX: In App.tsx, compute the intersection of leewardAspectHints and each problem's
parseTerrainFromLocation(problem.location).aspects. If overlap >= 1 aspect with
windLoadingLevel >= 'Localized', surface a yellow/orange callout on the AvalancheForecastCard
and in the decision gate cautions.

---

## Confirmed Working Well (New Observations)

### Pressure Trend (GAP-3.5 partially addressed):
weatherPressureTrendSummary (lines 4195-4208) computes a direction label (Rising/Falling/Steady)
from the trend window pressure array and displays it as a text line on the weather card (line 7356).
This covers the basic case. What is still missing: rate interpretation
(e.g., "Falling 3 hPa/hr - storm-strength drop") and integration into decision scoring.
The raw delta number is shown; the clinical meaning is not. Better than nothing.

### Travel Window Preset Buttons:
Conservative/Standard/Aggressive preset buttons work and are well-labeled. These provide
one-tap threshold reconfiguration which partially compensates for the glove-hostile custom inputs.
A climber can reach one of three preset modes without typing.

### Avalanche Stale Warning Banners:
The 48h and 72h stale banners are correctly placed and distinctly styled on the AvalancheForecastCard.
"Treat danger ratings as unknown" at 72h is exactly the right language.

### Field Brief Abort Triggers:
fieldBriefAbortTriggers is populated from decision.blockers (if any) or defaultAbortTriggers.
The abort trigger list in the FieldBriefCard's collapsible section is a genuinely useful
pre-departure checklist item that experienced mountaineers will recognize and use correctly.

### Weather Hour Picker:
The +/- stepper buttons with time input and datalist for hour selection is a good pattern.
Allows stepping through hourly forecast without reloading the full report. Referenced on a
summit push to check an afternoon weather window, this is a meaningful field tool.

---

## UX Friction Points Observed in Code Review

### Score Card Placement:
Score card is fixed at order:0 in the reportCardOrder.scoreCard (line 5848: `scoreCard: 0`).
This means the raw percentage number is always the first thing a user sees, before the
Decision Gate card which has the GO/CAUTION/NO-GO verdict.
From a mountaineer's perspective this is backwards: the decision is what matters, not the
abstract score. The score is a confidence measure; the decision gate is the output.
Most competent decision frameworks (AIARE, FACETS) put the verdict before the supporting score.

### Decision Checks Deep in `<details>` Collapse:
The full list of pass/fail checks (including daylight, avalanche, wind, precip, etc.) is
hidden behind a `<details>` element labeled "Show detailed blockers, cautions, and check outcomes"
(line 7137). The visible portion of the Decision Gate card shows only the key drivers and the
GO/CAUTION/NO-GO badge.
In the field, a climber may want to rapidly scan all checks, not just the top 3 drivers.
The collapse makes the card compact, but it also hides the information needed to evaluate
whether a CAUTION is "one step from GO" or "one step from NO-GO."
FIX: Consider showing a compact icon-row of check pass/fail indicators (checkmark or X per
named check) even when collapsed, so the user can quickly see pass/fail distribution
without opening the details element.

---

## Priority Ranking of All Open Gaps (This Session)

Safety-Critical (must fix):
1. GAP-4.1: Avalanche card hidden in essential view
2. GAP-4.6 / GAP-3.1: No aspect overlap alert (wind loading vs avy problem aspects)
3. GAP-3.2 / GAP-4.3: Turnaround time not validated against sunset
4. GAP-4.5: Wind loading hidden when avalanche coverage is unknown

Decision-Support (should fix):
5. GAP-4.4: Glove-hostile threshold inputs (no sliders)
6. GAP-4.2: Score trace omits data-gap factors + lacks safety-criticality sorting
7. GAP-3.3: Forecast lead time not surfaced as UI badge
8. GAP-3.4: Snow loading rate not adjacent to avalanche problem cards

Enhancement (nice to have):
9. Score card ordering: Decision Gate before score number
10. Pass/fail icon row visible without expanding `<details>` in Decision Gate
11. GAP-3.8: Lapse rate inversion warning
12. GAP-3.6: Ground blizzard visibility scenario
13. GAP-3.7: Hardware gear (ice axe, crampons, helmet) in gear suggestions
