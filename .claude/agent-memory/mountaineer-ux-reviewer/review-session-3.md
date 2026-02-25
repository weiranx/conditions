# Review Session 3 - Feature Gap and Decision-Support Analysis

## Task Scope
Identify 5-8 specific, actionable improvements that have NOT already been implemented.
Prior implementations excluded (per prompt): objective elevation in avy card, wind thresholds,
snowfall >=6in relevance trigger, stale bulletin age cap, corn cycle time-of-day, winter season
through May, SAT one-liner char label, five critical safety fixes.

## New Gaps Found in This Session

### GAP-3.1: Wind Direction / Leeward Aspect Awareness Not Integrated Into Avalanche Score
The frontend has a working leeward aspect rose (utils/avalanche.ts, leewardAspectsFromWind()).
The AvalancheForecastCard highlights which aspects are in the bulletin.
BUT: No logic cross-references the active wind direction against the bulletin's problem aspects
to flag "current winds are loading the same aspects cited in Problem #1."
The scoring engine in calculateSafetyScore() (index.js) does not use wind direction at all.
A NW wind at 30 mph while slab problems are listed for NE/N/NW aspects = significant signal
that is completely ignored in the safety score and decision gate.

### GAP-3.2: Turnaround Time Not Wired Into Any Decision Gate
The planner accepts `alpineStartTime` and `turnaroundTime` (from LinkState). The turnaround
time is stored in preferences (`defaultBackByTime`), passed around, and shown in the SAT one-liner.
But: evaluateBackcountryDecision() only uses `cutoffTime` (alpineStartTime) for the
daylight check. The turnaroundTime is NEVER checked against sunset or the travel window.
A team that sets a 6pm turnaround 2 hours after sunset will NOT get a daylight warning.
The "daylight" check only verifies start time <= sunset - 30 min, not whether turnaround
allows for the full planned travel window.

### GAP-3.3: Forecast Model Age vs. Planned Trip Date Mismatch Not Visualized
The safety score applies a confidence penalty for lead time (24h = -4, 48h = -6, 72h = -8, 96h = -10).
But the UI only shows the numeric confidence score with a single reason string - there is no
explicit "this forecast is 72 hours old relative to your planned trip date" callout in the
report card header or decision gate. The penalty is silent. A planner checking conditions
for a trip 3 days out has no clear visual cue that NOAA has very low precision at that range.
The `forecastLeadHours` value is computed and used in scoring but never surfaced as a label
in any card.

### GAP-3.4: New Snow Loading Rate Not Surfaced in Avalanche Context
The safety scoring engine penalizes for snowPast24hIn >= 6 in (winter weather factor) and
triggers avalanche relevance for >= 6 in. But neither the avalanche card nor the field brief
surfaces an explicit "X inches in last 24h = loading rate context" alongside the avalanche
problem descriptions. Loading rate is a primary trigger factor for slab initiations.
The data is available (rainfall.totals.snowPast24hIn) but only appears in the terrain card's
signal list, not near the avalanche problem descriptions where a climber needs it.

### GAP-3.5: Pressure Trend (Rising/Falling) Not Interpreted
The weather card shows "Pressure (station)" as a raw hPa number with no trend context.
The WeatherTrendPoint struct includes pressure for every hour in the trend array.
But no logic computes whether pressure is rising or falling over the window.
A 5-6 hPa drop over 3 hours is a classic alpine storm-approach signal; 3 hPa/hour is
near-gale territory. This is one of the most useful in-field meteorological signals and
the data exists to derive it but is not used at all.

### GAP-3.6: Visibility Risk Score Logic Ignores Blowing Snow With Cold Dry Conditions
buildVisibilityRisk() (index.js ~line 230) correctly flags blowing snow/blizzard from forecast
description text. But the visibility score does NOT consider the combination of:
  - Wind >= 30 mph sustained + existing snowpack (SNOTEL depth >= 4 in) + below-freezing temps
  - This combination is the classic ground blizzard / blowing snow scenario for dry powder days
The whiteout risk can be "Low" on a blue-sky day with 35 mph winds at 8000ft on fresh snow.
No explicit handling for this "clear above / ground blizzard below" scenario exists.

### GAP-3.7: Gear Suggestions Missing Core Alpine Hardware
gear-suggestions.js produces layering-only recommendations (shells, insulation, gaiters).
Zero mention of:
  - Ice axe / crampons even when terrain = snow_ice or icy_hardpack
  - Rope and anchor hardware even when dangerLevel = 3+ or elevation >= 10000ft
  - Crevasse rescue kit for glacier objectives (no glacier detection logic exists)
  - Helmet (relevant for couloir travel, rock fall zones, high-danger avy terrain)
  - Beacon/shovel/probe already conditionally added - this is good.
The gear list will tell a user to "carry traction devices" without ever mentioning crampons
or an ice axe. On an alpine route at 14000ft with icy terrain conditions this is a gap.

### GAP-3.8: Temperature Inversion Not Detected
The elevation lapse bands (buildElevationForecastBands) use a fixed 3.3F/1000ft lapse rate
applied as a constant (colder at altitude = lower band warmer than objective).
Inversions are common in winter (cold air pooling in valleys, warm layer aloft) and in post-frontal
situations. When an inversion is present, the "Approach Terrain" band shown as warmer than objective
may actually be colder. The lapse-rate bands have no inversion detection from dew point spread or
from comparing the lapse-implied temp against the Open-Meteo elevation-specific bands.
Users can see "Approach: 28F, Objective: 24F, Summit: 18F" and assume cooling with altitude
when on an inversion day it might actually be 5F warmer at treeline.

## Improvements Recommended (in priority order)
1. Turnaround time into daylight/darkness decision gate (Safety - HIGH)
2. Wind direction vs. avalanche problem aspect cross-reference alert (Safety - HIGH)
3. Explicit forecast lead-time callout badge on weather card (Decision support - MEDIUM)
4. Snow loading rate surfaced adjacent to avalanche problem cards (Decision support - MEDIUM)
5. Pressure trend direction (rising/falling hPa/hr) computed and displayed (Decision support - MEDIUM)
6. Ice axe / crampons / helmet in gear suggestions triggered by terrain = snow_ice + elevation (Gear - MEDIUM)
7. Ground blizzard / blowing snow visibility scenario for dry high-wind + snowpack conditions (Safety - MEDIUM)
8. Note on lapse bands that inversions can reverse the gradient (Data integrity - LOW)
