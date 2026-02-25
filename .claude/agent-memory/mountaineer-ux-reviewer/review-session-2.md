# Review Session 2 - Deep Safety Code Audit

## Files Reviewed
- backend/index.js (full pipeline, read in chunks)
- backend/src/utils/avalanche-detail.js
- backend/src/utils/fire-risk.js
- backend/src/utils/terrain-condition.js
- frontend/src/App.tsx (decision gate sections)

## Critical Safety Issues Found

### ISSUE 1: Avalanche Danger Level Silently Downgraded (HIGHEST PRIORITY)
File: backend/index.js ~line 2728
Function: deriveOverallDangerLevelFromElevations()

The "almost worst-case" logic reduces the overall danger level by 1 when only one elevation band
has the maximum rating and there's a spread of 2+ levels across bands.

Example: above=High(4), at=Low(1), below=Low(1) -> maxLevel=4, minLevel=1, maxCount=1 (only 1 band at max)
Result: overall = max(1, 4-1) = 3 (Considerable) -- NOT High.

This is dangerous. A climber passing through HIGH elevation avalanche terrain gets a Considerable (3) rating
displayed. The IFAG standard does not support synthesizing a "combined" overall rating by downgrading the worst band.
The correct approach is to display the max band level, or display per-band ratings directly.

This affects the safety score (which uses dangerLevel), the decision gate (which triggers NO-GO at >=4),
and all UI displays of "L3 Considerable" vs "L4 High".

### ISSUE 2: createUnavailableWeatherData Returns 0 for Critical Fields
File: backend/index.js lines 461-496

When weather is completely unavailable, the struct sets:
  temp: 0, feelsLike: 0, windSpeed: 0, windGust: 0, humidity: 0, precipChance: 0, cloudCover: 0

Zero values look like "good conditions" to the scoring engine. The safety score engine
reads precipChance=0 (no storm penalty), windGust=0 (no wind penalty), feelsLike=0 (triggers Cold penalty,
but NOT correctly - 0F would be caught but only as trendMinFeelsLike if there's a trend).

The decision gate in App.tsx at line 1612 reads: const gust = data.weather.windGust || 0;
So a 0 gust bypasses the wind check entirely. A climber could get a near-perfect safety score
and a GO recommendation when no weather data exists.

### ISSUE 3: Avalanche "Considerable" Does Not Trigger NO-GO
File: frontend/src/App.tsx line 1729-1733

Danger level 3 (Considerable) only adds a CAUTION, not a NO-GO blocker.
In standard avalanche education (AIARE, AST), Considerable danger (Level 3) is the
danger level at which the majority of avalanche fatalities occur. Many avalanche centers
and training curricula treat it as a presumptive NO-GO for recreational travel unless
the party has specific skills and terrain selection.

The current logic:
  if danger >= 4 -> addBlocker (NO-GO)
  if danger === 3 -> addCaution

This is an educational/policy choice but needs a prominent disclosure to users.
At minimum, Considerable should add a hard-gate NO-GO for users who have NOT
explicitly selected "experienced" skill level.

### ISSUE 4: alertsRelevantForSelectedTime is Always True
File: frontend/src/App.tsx line 1653

  const alertsRelevantForSelectedStart = true;

This variable is hardcoded to true, meaning the alert check always treats NWS alerts
as relevant regardless of timing. This is also true in calculateSafetyScore() at line 2146:
  const alertsRelevantForSelectedTime = true;

The backend already has proper time-window filtering (see fetchWeatherAlertsData()).
The frontend ignoring future-time irrelevance doesn't create a safety failure (it errs on the
side of more alerts = safer), but it can produce false CAUTION states for future-date planning
if a current alert will not apply to the planned start time. Not a safety-critical bug but
worth noting - the backend correctly returns status:'none_for_selected_start'.

### ISSUE 5: Expired Avalanche Bulletins Show Stale dangerUnknown: false
File: backend/index.js lines 3681-3695

When avalancheTargetMs > avalancheExpiresMs, the code sets coverageStatus: 'expired_for_selected_start'
but explicitly sets dangerUnknown: false. This means the safety score and decision gate will
still apply the full danger level penalty from an expired bulletin rather than treating it as unknown.

The bottomLine gets a NOTE appended, which is good, but the danger level used in scoring and
the decision gate blocker threshold are based on expired data without any degradation in confidence
or escalation to CAUTION.

### ISSUE 6: Snow Trend Hours Use Current-Hour tempF (Not Row tempF) for Threshold
File: backend/src/utils/terrain-condition.js line 170

  const snowTrendHours = nearTermTrend.filter((point) => {
    const pointPrecip = toFinite(point?.precipChance);
    const pointCondition = String(point?.condition || '').toLowerCase();
    return (pointPrecip !== null && pointPrecip >= 35 && tempF !== null && tempF <= 34) || /snow|sleet|freezing|flurr|wintry|ice/.test(pointCondition);
  }).length;

The temperature check `tempF <= 34` uses the CURRENT hour's temp (outer scope),
not each trend point's temperature. A rising temperature scenario (currently 28F, warming to 40F)
would incorrectly classify future trend hours as snow hours even when the actual forecast shows rain.
This could understate wet/slushy hazard (misclassifying wet snow accumulation as fresh powder).

### ISSUE 7: Corn-Snow Window Requires Strict Zero wetTrendHours
File: backend/src/utils/terrain-condition.js line 86

  wetTrendHours === 0

The corn-snow classification requires exactly zero wet trend hours. Any approaching rain,
even one hour in 6 hours, suppresses the corn classification and drops to a lower branch.
This is actually conservative (errs toward wet/slushy over corn), so it's safety-appropriate,
but it means a climber on a classic corn cycle with an afternoon shower at the tail of their window
gets "wet/slushy" which is not quite right for morning travel. Lower severity than other issues.

### ISSUE 8: Fire Risk unavailable Status Initializes as Level 0 / Label "Low"
File: backend/src/utils/fire-risk.js lines 1-10

createUnavailableFireRiskData() returns level: 0 and label: 'Low'.
When fire risk is unavailable (network failure), the safety score reads fireLevel=0
and applies NO fire danger penalty. A wildfire-adjacent backcountry traveler during
a network outage gets no warning. The confidence penalty for unavailable fire risk
is only 3 points (line 2563 in index.js) which is minimal.

### ISSUE 9: Avalanche "Off-Season" Flag Resets After Scraper Runs
File: backend/index.js lines 3633-3648

The centerNoActiveForecast check at the end of the avalanche block re-applies the off-season
overwrite AFTER the scraper may have populated detailDet with real danger data.
But the reassignment at line 3635 uses createUnknownAvalancheData("no_active_forecast"),
which clobbers any valid danger level data the scraper found. This is safe (conservative)
but means that if a center mis-reports off_season=true in the map layer but actually has
an active forecast accessible via the detail API, the real danger level is silently discarded.

### ISSUE 10: Danger Level Parsing Uses levelMap With Potential Out-of-Bounds
File: backend/index.js lines 3481-3490

  levelMap[parseInt(currentDay.lower)]

If currentDay.lower is undefined, parseInt(undefined) = NaN. levelMap[NaN] = undefined.
This would set label: undefined on the elevation band. The normalizeAvalancheLevel() function
correctly clamps 0-5, but parseInt(undefined) bypasses that path here in the raw object literal.
This doesn't corrupt dangerLevel (that's set separately) but elevations.below.label could
be displayed as "undefined" in the frontend.

## Confirmed Safe Patterns
- The IFAG 1-5 scale is correctly mapped (AVALANCHE_LEVEL_LABELS array index 0-5)
- Expired bulletin detection is present and operational
- Confidence penalty system correctly penalizes stale data feeds
- Group caps on safety score prevent any single hazard from dominating to zero
- Off-season detection logic is multi-signal (off_season flag + text matching + date range)
