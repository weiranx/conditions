'use strict';

// The GO / CAUTION / NO-GO decision for one plan: a report checked against the
// traveler's limits for their start time, travel window and approach.
//
// Blockers make a plan NO-GO; cautions make it CAUTION. Each check says what
// was compared, whether it passed, and what to do about it. Messages quote
// values in the units the request asked for.

const { computeFeelsLikeF } = require('./weather-normalizers');
const {
  formatClockForStyle,
  formatTemperature,
  formatWind,
  isFiniteNumber,
  localizeUnitText,
  parseSolarClockMinutes,
  parseTimeInputMinutes,
} = require('./display-format');
const {
  classifySnowpackFreshness,
  freshnessClass,
  isTravelWindowCoveredByAlertWindow,
  pickNewestIsoTimestamp,
  pickOldestIsoTimestamp,
  resolveSelectedTravelWindowMs,
} = require('./source-freshness');
const { adjustReadingForApproach } = require('./approach-elevation');

const DECISION_LEVEL_RANK = { GO: 3, CAUTION: 2, 'NO-GO': 1 };
const decisionLevelRank = (level) => DECISION_LEVEL_RANK[level] || 0;

const DANGER_LABELS = ['No Rating', 'Low', 'Moderate', 'Considerable', 'High', 'Extreme'];
const STORM_SIGNAL = /thunder|storm|lightning|hail|blizzard/i;

// NWS wind chill chart: exposed skin freezes in about 30 minutes near -20 °F
// feels-like and in about 10 minutes near -35 °F. A traveler's own limit can
// push the cold no-go point lower, as with gusts, but only by a clear margin.
const FROSTBITE_30_MIN_F = -20;
const FROSTBITE_10_MIN_F = -35;
const COLD_BLOCKER_MARGIN_F = 15;
// Feels-like heat that blocks a plan unless the traveler's limit is higher.
const HEAT_BLOCKER_F = 95;

const normalizeDangerLevel = (level) => (Number.isFinite(level) ? Math.max(0, Math.min(5, Math.round(level || 0))) : 0);

const alertSeverityRank = (severity) => {
  const normalized = String(severity || '').trim().toLowerCase();
  if (!normalized) return 1;
  if (['extreme', 'severe'].includes(normalized)) return 5;
  if (normalized === 'warning') return 4;
  if (['advisory', 'watch'].includes(normalized)) return 3;
  if (normalized === 'moderate') return 2;
  return 1;
};

/** Report insights whose domains are all enabled for this report. */
const enabledReportInsights = (report) =>
  (report?.reportInsights?.items || []).filter((item) =>
    Array.isArray(item?.features) && item.features.every((key) => report?.featureFlags?.[key] !== false));

/** The safety score, with avalanche penalties added back when avalanche terrain is out of scope. */
const normalizedDecisionScore = (report, { ignoreAvalancheForDecision = false } = {}) => {
  const rawScore = Number(report?.safety?.score);
  const safeRawScore = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : 0;
  if (!ignoreAvalancheForDecision) return safeRawScore;
  const avalanchePenalty = (Array.isArray(report?.safety?.factors) ? report.safety.factors : []).reduce((sum, factor) => {
    const hazard = String(factor?.hazard || '').toLowerCase();
    const impact = Number(factor?.impact);
    return hazard.includes('avalanche') && Number.isFinite(impact) && impact > 0 ? sum + impact : sum;
  }, 0);
  return Math.max(0, Math.min(100, safeRawScore + avalanchePenalty));
};

/**
 * How many trend readings the travel window spans. The forecast opens with the
 * hour that contains the start, so a start off the hour ends inside one more
 * reading: a 5:30 start for 10 hours runs through the 3:00 PM reading.
 */
const trendRowsCoveringWindow = (startTime, travelWindowHours) => {
  const startMinute = parseTimeInputMinutes(startTime);
  return travelWindowHours + (startMinute !== null && startMinute % 60 !== 0 ? 1 : 0);
};

/**
 * @param {object} report  a /api/safety payload
 * @param {object} context plan context from plan-context.js
 * @returns {{ level: 'GO'|'CAUTION'|'NO-GO', headline: string, blockers: string[], cautions: string[], advisories: string[], checks: object[] }}
 */
const evaluateDecision = (report, context) => {
  const {
    start: cutoffTime,
    travelWindowHours,
    turnaroundTime = null,
    limits,
    units,
    approach = null,
    ignoreAvalancheForDecision = false,
    nowMs = Date.now(),
  } = context;
  const blockers = [];
  const cautions = [];
  // Signals worth acting on that stay inside the limits and barely move the
  // score: they are listed with the cautions but do not lower the level.
  const advisories = [];
  const featureEnabled = (key) => report?.featureFlags?.[key] !== false;
  const avalancheEnabled = featureEnabled('avalancheDetails');
  const airQualityEnabled = featureEnabled('airQualityDetails');
  const fireRiskEnabled = featureEnabled('fireRiskDetails');
  const heatRiskEnabled = featureEnabled('heatRiskDetails');
  const snowpackEnabled = featureEnabled('snowpackDetails');
  const daylightEnabled = featureEnabled('daylightTimeline');
  const addBlocker = (message) => { if (!blockers.includes(message)) blockers.push(message); };
  const addCaution = (message) => { if (!cautions.includes(message)) cautions.push(message); };
  const addAdvisory = (message) => { if (!advisories.includes(message)) advisories.push(message); };

  const safety = report?.safety || {};
  const weather = report?.weather || {};
  const insufficientEvidence = safety.assessmentStatus === 'insufficient_evidence';
  if (insufficientEvidence) addCaution(`Not enough data to assess this trip. ${(safety.evidenceReasons || []).join(' ')}`);

  const avalanche = report?.avalanche;
  const danger = avalanche?.dangerLevel || 0;
  const description = weather.description || '';
  // Each reading is placed by its own clock time: a 05:30 start's trend opens
  // with the 05:00 reading, which covers only the trip's first 30 minutes.
  const approachStartMinute = parseTimeInputMinutes(cutoffTime);
  const approachSolar = {
    sunriseMinutes: parseSolarClockMinutes(report?.solar?.sunrise),
    sunsetMinutes: parseSolarClockMinutes(report?.solar?.sunset),
  };
  const atPartyElevation = (point, index) => {
    if (!approach || approachStartMinute === null) return point;
    return adjustReadingForApproach(point, index, approach, { start: cutoffTime, ...approachSolar });
  };
  const startPoint = atPartyElevation({
    time: cutoffTime,
    temp: weather.temp,
    wind: weather.windSpeed,
    gust: weather.windGust,
    precipChance: weather.precipChance,
    cloudCover: weather.cloudCover ?? null,
    isDaytime: weather.isDaytime ?? null,
    condition: description,
  }, 0);
  // A missing reading stays null: reading it as 0 would pass the gust and
  // precipitation limits and invent a 0 °F feels-like.
  const startGust = approach ? startPoint.gust : weather.windGust;
  let gust = isFiniteNumber(startGust) ? startGust : null;
  let precip = isFiniteNumber(weather.precipChance) ? weather.precipChance : null;
  let feelsLike = approach && isFiniteNumber(startPoint.temp)
    ? computeFeelsLikeF(startPoint.temp, isFiniteNumber(startPoint.wind) ? startPoint.wind : 0)
    : weather.feelsLike ?? weather.temp ?? null;
  // Coldest feels-like drives the cold check; the hottest drives the heat check.
  let peakFeelsLike = feelsLike;
  const normalizedConditionText = String(description || '').trim() || 'No forecast condition text available.';
  if (/weather data unavailable/i.test(description)) {
    addBlocker('Weather data is unavailable, so wind, rain or snow, and temperature are unknown. Do not use this report to decide whether to go.');
  }
  const startHasStormSignal = STORM_SIGNAL.test(description);
  let hasStormSignal = startHasStormSignal;

  // Scan the full travel window for worst-case conditions.
  let peakGustHour = '';
  let peakPrecipHour = '';
  let coldestFeelsLikeHour = '';
  let hottestFeelsLikeHour = '';
  // True when the coldest hour is cold because a valley inversion is likely on the approach.
  const hasInversion = (point) => Boolean(point?.inversionRisk);
  let coldestIsInversion = Boolean(approach) && hasInversion(startPoint);
  let stormSignalHour = '';
  const windowTrend = (weather.trend || [])
    .slice(0, trendRowsCoveringWindow(cutoffTime, travelWindowHours))
    .map((point, index) => atPartyElevation(point, index));
  for (const point of windowTrend) {
    if (isFiniteNumber(point.gust) && (gust === null || point.gust > gust)) { gust = point.gust; peakGustHour = point.time || ''; }
    if (isFiniteNumber(point.precipChance) && (precip === null || point.precipChance > precip)) { precip = point.precipChance; peakPrecipHour = point.time || ''; }
    if (isFiniteNumber(point.temp)) {
      const pointFeelsLike = computeFeelsLikeF(point.temp, isFiniteNumber(point.wind) ? point.wind : 0);
      if (feelsLike === null || pointFeelsLike < feelsLike) {
        feelsLike = pointFeelsLike;
        coldestFeelsLikeHour = point.time || '';
        coldestIsInversion = hasInversion(point);
      }
      if (peakFeelsLike === null || pointFeelsLike > peakFeelsLike) {
        peakFeelsLike = pointFeelsLike;
        hottestFeelsLikeHour = point.time || '';
      }
    }
    if (!hasStormSignal && STORM_SIGNAL.test(String(point.condition || ''))) {
      hasStormSignal = true;
      stormSignalHour = point.time || '';
    }
  }
  const avalancheRelevant = Boolean(avalancheEnabled && avalanche && !ignoreAvalancheForDecision && avalanche.relevant !== false);
  const avalancheExpired = avalancheRelevant && avalanche?.coverageStatus === 'expired_for_selected_start';
  const avalancheUnknown = avalancheRelevant && !avalancheExpired
    && Boolean(avalanche?.dangerUnknown || avalanche?.coverageStatus !== 'reported');
  const avalancheGateRequired = avalancheRelevant;
  const unknownSnowpackMode = avalancheGateRequired && avalancheUnknown;
  const avalancheCheckLabel = (safeDangerLabel) => {
    if (!avalancheRelevant) return 'Avalanche check not required for this location profile';
    if (avalancheUnknown) return 'Avalanche forecast coverage is unavailable for this location';
    return `Avalanche danger is ${safeDangerLabel}`;
  };
  const maxGustThreshold = Math.max(10, limits.maxWindGustMph);
  const maxPrecipThreshold = Math.max(0, limits.maxPrecipChance);
  const minFeelsLikeThreshold = limits.minFeelsLikeF;
  // Older callers send no heat limit; they keep the fixed heat no-go point.
  const maxFeelsLikeThreshold = isFiniteNumber(limits.maxFeelsLikeF) ? limits.maxFeelsLikeF : HEAT_BLOCKER_F;
  const heatBlockerThreshold = Math.max(HEAT_BLOCKER_F, maxFeelsLikeThreshold);
  const coldBlockerThreshold = Math.min(FROSTBITE_30_MIN_F, minFeelsLikeThreshold - COLD_BLOCKER_MARGIN_F);
  const formatWindValue = (valueMph) => formatWind(valueMph, units.wind);
  const formatTempValue = (valueF) => formatTemperature(valueF, units.temperature);
  // Start, return and sunset read on the traveler's clock; sunset arrives as the provider wrote it ("7:30 PM").
  const formatClockValue = (value) => formatClockForStyle(value, units.timeStyle);
  // " around 2:00 PM" for a reading inside the window; nothing for the start-time reading.
  const around = (hour) => (hour ? ` around ${formatClockValue(hour)}` : '');
  const displayMaxGustThreshold = formatWindValue(maxGustThreshold);
  const displayMinFeelsLikeThreshold = formatTempValue(minFeelsLikeThreshold);
  const displayMaxFeelsLikeThreshold = formatTempValue(maxFeelsLikeThreshold);

  const alerts = report?.alerts || {};
  const alertsStatus = String(alerts.status || '').toLowerCase();
  const forecastLeadHours = report?.forecast?.selectedStartTime
    ? (new Date(report.forecast.selectedStartTime).getTime() - nowMs) / 3_600_000
    : null;
  const alertsRelevantForSelectedStart = forecastLeadHours === null || forecastLeadHours <= 48;
  const alertsNoActiveForSelectedStart = alertsStatus === 'none' || alertsStatus === 'none_for_selected_start';
  const selectedTravelWindowMs = resolveSelectedTravelWindowMs(report, travelWindowHours);
  const alertsWindowCovered = isTravelWindowCoveredByAlertWindow(selectedTravelWindowMs, alerts.alerts || []);
  const activeAlertCount = Number(alerts.activeCount);
  const hasActiveAlertCount = Number.isFinite(activeAlertCount);
  const highestAlertSeverity = String(alerts.highestSeverity || 'Unknown');
  const highestAlertSeverityRank = alertSeverityRank(highestAlertSeverity);

  const airQuality = report?.airQuality || {};
  const airQualityStatus = String(airQuality.status || '').toLowerCase();
  const airQualityFutureNotApplicable = airQualityStatus === 'not_applicable_future_date';
  const aqi = Number(airQuality.usAqi);
  const hasAqi = airQualityEnabled && Number.isFinite(aqi) && airQualityStatus !== 'unavailable' && !airQualityFutureNotApplicable;

  const fireRisk = report?.fireRisk || {};
  const fireRiskStatus = String(fireRisk.status || '').toLowerCase();
  const fireRiskLevel = Number(fireRisk.level);
  const hasFireRisk = fireRiskEnabled && Number.isFinite(fireRiskLevel) && fireRiskStatus !== 'unavailable';
  // Say what sets the fire level (a nearby fire, fire weather, or smoke); the
  // level's own label alone ("Extreme") does not tell the party what to check.
  const fireRiskCause = localizeUnitText(String(fireRisk.reasons?.[0] || '').trim().replace(/\.$/, ''), units);
  const fireRiskStatement = (level) => `Fire risk is ${level}${fireRiskCause ? `: ${fireRiskCause}` : ''}.`;

  const heatRisk = report?.heatRisk || {};
  const heatRiskStatus = String(heatRisk.status || '').toLowerCase();
  const heatRiskLevel = Number(heatRisk.level);
  const hasHeatRisk = heatRiskEnabled && Number.isFinite(heatRiskLevel) && heatRiskStatus !== 'unavailable';
  const heatRiskLabel = heatRisk.label || `L${Math.round(heatRiskLevel)}`;

  const terrainCondition = report?.terrainCondition || {};
  const terrainCode = String(terrainCondition.code || '').toLowerCase();
  const terrainLabel = terrainCondition.label || report?.trail || 'Unknown';
  const terrainConfidence = String(terrainCondition.confidence || '').toLowerCase();
  const terrainImpact = String(terrainCondition.impact || '').toLowerCase();
  // Only a high-impact surface (icy, wet or fresh snow) sets a caution; drying,
  // muddy or patchy-ice footing is advice, as in the score.
  const terrainHazardous = terrainImpact === 'high' || (!terrainImpact && terrainCode === 'snow_ice');
  const terrainNeedsAttention = terrainHazardous || ['wet_muddy', 'cold_slick', 'dry_loose'].includes(terrainCode);
  const terrainCriticalGateFail = terrainCode === 'weather_unavailable';

  const weatherFreshnessState = freshnessClass(
    pickOldestIsoTimestamp([weather.issuedTime || null, weather.forecastStartTime || null]),
    12,
    nowMs,
  );
  const avalancheFreshnessState = avalancheRelevant
    ? freshnessClass(pickOldestIsoTimestamp([avalanche?.publishedTime || null]), 24, nowMs)
    : null;
  const alertsFreshnessState = alertsRelevantForSelectedStart
    ? alertsNoActiveForSelectedStart || alertsWindowCovered
      ? 'fresh'
      : freshnessClass(
        pickNewestIsoTimestamp((alerts.alerts || []).flatMap((alert) => [alert?.sent || null, alert?.effective || null, alert?.onset || null])),
        6,
        nowMs,
      )
    : null;
  const airQualityFreshnessState = airQualityFutureNotApplicable
    ? 'fresh'
    : hasAqi
      ? freshnessClass(pickOldestIsoTimestamp([airQuality.measuredTime || null]), 8, nowMs)
      : null;
  const precipitationFreshnessState = freshnessClass(pickOldestIsoTimestamp([report?.rainfall?.anchorTime || null]), 8, nowMs);
  const snowpackStatus = String(report?.snowpack?.status || '').toLowerCase();
  const snowpackAvailable = snowpackEnabled && (snowpackStatus === 'ok' || snowpackStatus === 'partial');
  const snowpackFreshnessState = snowpackAvailable
    ? classifySnowpackFreshness(report?.snowpack?.snotel?.observedDate || null, report?.snowpack?.nohrsc?.sampledTime || null, nowMs).state
    : null;
  const outdated = (state) => state === 'stale' || state === 'missing';
  const freshnessIssues = [
    outdated(weatherFreshnessState) ? 'weather' : null,
    // An unavailable bulletin is surfaced by its own check, so don't
    // double-count it as a stale or missing source.
    !ignoreAvalancheForDecision && !avalancheUnknown && outdated(avalancheFreshnessState) ? 'avalanche' : null,
    outdated(alertsFreshnessState) ? 'alerts' : null,
    airQualityEnabled && outdated(airQualityFreshnessState) ? 'air quality' : null,
    outdated(precipitationFreshnessState) ? 'precipitation' : null,
    snowpackEnabled && outdated(snowpackFreshnessState) ? 'snowpack' : null,
  ].filter(Boolean);

  if (unknownSnowpackMode) {
    addCaution('No current avalanche forecast covers this area. Stick to low-angle slopes with nothing steep above you, avoid gullies and other terrain traps, cross slopes one at a time, and read the Avalanche card before you commit.');
  }
  if (avalancheExpired) {
    addCaution('The avalanche forecast expires before your start. Check the avalanche center for a newer one before you leave; if there is none, treat the terrain as unrated and assume conditions could be worse.');
  }
  if (avalancheGateRequired && !avalancheUnknown && danger >= 4) {
    addBlocker('Avalanche danger is High or Extreme: very dangerous conditions. Stay off and out from under slopes steeper than about 30°, or pick another day.');
  } else if (avalancheGateRequired && !avalancheUnknown && danger === 3) {
    addBlocker('Avalanche danger is Considerable: human-triggered avalanches are likely. Stay off and out from under slopes steeper than about 30°, or pick another day, unless your team can recognize and avoid today’s avalanche problems.');
  }
  if (hasStormSignal) {
    const stormWhen = stormSignalHour ? ` from about ${formatClockValue(stormSignalHour)}` : ' during your trip';
    addCaution(`Storms or thunder are forecast${stormWhen}. Plan to be off ridges and summits before then, know your fastest way down, and turn back at the first thunder, lightning, or fast-growing clouds.`);
  }
  // Each limit check that fails sets at least a caution, so a plan never
  // reads GO with a limit it does not meet. Well past a limit, it blocks.
  if (precip !== null && precip >= Math.max(85, maxPrecipThreshold + 25)) {
    addBlocker(`Rain or snow is very likely (${precip}% chance${around(peakPrecipHour)}). Expect slick footing, poor visibility, and slow travel: pick another day, or a route that is easy to turn back from.`);
  } else if (precip !== null && precip > maxPrecipThreshold) {
    addCaution(`Rain or snow chance reaches ${precip}%${around(peakPrecipHour)}, above your ${maxPrecipThreshold}% limit. Allow extra time, bring rain gear and traction, and turn back if footing or visibility gets bad.`);
  }
  if (gust !== null && gust >= Math.max(35, maxGustThreshold + 10)) {
    addBlocker(`Gusts reach about ${formatWindValue(gust)}${around(peakGustHour)}, well above your ${displayMaxGustThreshold} limit. Pick a sheltered, lower route or another day, and stay off exposed ridges where a stumble would be serious.`);
  } else if (gust !== null && gust > maxGustThreshold) {
    addCaution(`Gusts reach about ${formatWindValue(gust)}${around(peakGustHour)}, above your ${displayMaxGustThreshold} limit. Keep ridge time short, secure loose gear, and turn back if it gets hard to keep your balance or hear each other.`);
  }
  if (peakFeelsLike !== null && peakFeelsLike >= heatBlockerThreshold) {
    addBlocker(`It feels like about ${formatTempValue(peakFeelsLike)}${around(hottestFeelsLikeHour)}, hot enough for heat illness. Go in the cool early hours or pick a shadier, higher objective, and do not commit without plenty of water and an early way out.`);
  } else if (peakFeelsLike !== null && peakFeelsLike > maxFeelsLikeThreshold) {
    addCaution(`It feels like about ${formatTempValue(peakFeelsLike)}${around(hottestFeelsLikeHour)}, above your ${displayMaxFeelsLikeThreshold} limit. Start earlier, rest in the shade, drink often, and turn back if anyone feels dizzy, sick, or stops sweating.`);
  }
  if (feelsLike !== null && feelsLike <= coldBlockerThreshold) {
    const freezeMinutes = feelsLike <= FROSTBITE_10_MIN_F ? 10 : 30;
    addBlocker(`It feels like about ${formatTempValue(feelsLike)}${around(coldestFeelsLikeHour)}: exposed skin can get frostbite in about ${freezeMinutes} minutes. Pick a warmer day or a lower, sheltered route.`);
  } else if (feelsLike !== null && feelsLike < minFeelsLikeThreshold) {
    const inversionNote = coldestIsInversion
      ? ' The coldest spot is low on the approach, where clear, calm nights pool cold air in the valley.'
      : '';
    addCaution(`It feels like about ${formatTempValue(feelsLike)}${around(coldestFeelsLikeHour)}, below your ${displayMinFeelsLikeThreshold} limit.${inversionNote} Bring extra layers and warm gloves, limit time in the open, and pick a point to warm up or turn back.`);
  }

  if (alertsRelevantForSelectedStart && hasActiveAlertCount && activeAlertCount > 0) {
    const alertNoun = activeAlertCount === 1 ? 'alert' : 'alerts';
    if (highestAlertSeverityRank >= 4) {
      addBlocker(`${activeAlertCount} active NWS ${alertNoun} ${activeAlertCount === 1 ? 'is' : 'are'} ${highestAlertSeverity.toLowerCase()} severity. Read the alert and move your plan out of its area and time.`);
    } else {
      addCaution(`${activeAlertCount} active NWS ${alertNoun} ${activeAlertCount === 1 ? 'overlaps' : 'overlap'} your start. Read each one’s area, timing, and advice before you pick a route.`);
    }
  }

  if (hasAqi) {
    if (aqi >= 151) {
      addBlocker(`Air quality is unhealthy (AQI ${Math.round(aqi)}): everyone can feel it, especially during hard effort. Pick a cleaner-air area or postpone.`);
    } else if (aqi >= 101) {
      addCaution(`Air quality is unhealthy for sensitive groups (AQI ${Math.round(aqi)}). Ease the pace, shorten the plan, and switch to a cleaner-air option if anyone has symptoms.`);
    } else if (aqi >= 51) {
      addAdvisory(`Air quality is moderate (AQI ${Math.round(aqi)}). Anyone sensitive to smoke or pollution should ease off on long, hard efforts.`);
    }
  }

  if (hasFireRisk) {
    if (fireRiskLevel >= 4) {
      addBlocker(`${fireRiskStatement('extreme')} Pick another area or time, check for closures, and stay out of fire-affected terrain.`);
    } else if (fireRiskLevel >= 3) {
      addCaution(`${fireRiskStatement('high')} Pick a short route with more than one way out, avoid anything that could spark a fire, and leave if smoke or wind picks up.`);
    } else if (fireRiskLevel >= 2) {
      addAdvisory(`${fireRiskStatement('elevated')} Check closures and fire updates, avoid sparks and open flames, and know your way out.`);
    }
  }

  if (hasHeatRisk) {
    if (heatRiskLevel >= 4) {
      addBlocker(`Heat risk is extreme (${heatRiskLabel}). Pick a cooler time or place and avoid long stretches in the sun.`);
    } else if (heatRiskLevel >= 3) {
      addCaution(`Heat risk is high (${heatRiskLabel}). Travel in the cooler hours, keep sunny stretches short, and turn back if water runs low or anyone overheats.`);
    } else if (heatRiskLevel >= 2) {
      addAdvisory(`Heat risk is elevated (${heatRiskLabel}). Plan shade and water breaks, ease the pace, and watch each other for early signs of heat illness.`);
    }
  }

  if (terrainNeedsAttention) {
    const terrainAction = String(terrainCondition.recommendedTravel || '').trim();
    (terrainHazardous ? addCaution : addAdvisory)(`The trail surface needs care (${terrainLabel}).${terrainAction ? ` ${terrainAction}` : ' Test your footing somewhere safe before exposed sections.'}`);
  }

  if (freshnessIssues.length > 0) {
    addCaution(`Some data is out of date or undated (${freshnessIssues.join(', ')}). Refresh the report and check those sources before you commit.`);
  }

  const cutoffMinutes = parseTimeInputMinutes(cutoffTime);
  const sunsetMinutes = daylightEnabled && report?.solar?.sunset ? parseSolarClockMinutes(report.solar.sunset) : null;
  const daylightBuffer = 30;
  const turnaroundMinutes = turnaroundTime ? parseTimeInputMinutes(turnaroundTime) : null;
  const hasDaylightInputs = cutoffMinutes !== null && sunsetMinutes !== null;
  const effectiveReturnMinutes = turnaroundMinutes ?? cutoffMinutes;
  const daylightOkay = hasDaylightInputs && effectiveReturnMinutes !== null
    ? effectiveReturnMinutes <= sunsetMinutes - daylightBuffer
    : false;
  const daylightMarginMinutes = hasDaylightInputs && effectiveReturnMinutes !== null
    ? sunsetMinutes - effectiveReturnMinutes
    : null;
  const sunsetLabel = report?.solar?.sunset ? formatClockValue(report.solar.sunset) : 'an unknown time';
  if (daylightEnabled && !hasDaylightInputs) {
    addCaution('Sunset time is unavailable. Look it up, plan to be back at least 30 minutes before it, and carry a headlamp.');
  } else if (daylightEnabled && !daylightOkay && turnaroundMinutes === null) {
    // With a turnaround time, the block below reports the same thin margin
    // with exact minutes — keep only the more specific message.
    addCaution(`Your ${formatClockValue(cutoffTime)} start leaves less than ${daylightBuffer} minutes of daylight before sunset at ${sunsetLabel}. Start earlier, or plan to travel in the dark with headlamps.`);
  }
  if (daylightEnabled && turnaroundMinutes !== null && sunsetMinutes !== null) {
    const margin = sunsetMinutes - turnaroundMinutes;
    if (margin < 0) {
      addCaution(`You would turn around ${Math.abs(margin)} minutes after sunset (${sunsetLabel}). Start earlier or shorten the route so the plan does not depend on travel in the dark.`);
    } else if (margin < 30) {
      addCaution(`You would turn around only ${margin} minutes before sunset (${sunsetLabel}). Turn around earlier to keep at least 30 minutes spare for delays.`);
    }
  }

  const checks = [
    ...(avalancheEnabled && avalanche ? [{
      key: 'avalanche',
      label: avalancheGateRequired ? 'Avalanche danger is Moderate or lower' : avalancheCheckLabel('Moderate or lower'),
      ok: avalancheGateRequired ? (!avalancheUnknown && danger <= 2) : true,
      detail: !avalancheRelevant
        ? 'Not needed for this location given the season and snowpack.'
        : avalancheUnknown
          ? 'No avalanche forecast covers this objective and time.'
          : `Current danger: ${DANGER_LABELS[normalizeDangerLevel(danger)] || 'Unknown'}.`,
      action: avalancheGateRequired && avalancheUnknown
        ? 'Use low-angle, low-consequence terrain, avoid terrain traps, and increase spacing until a current bulletin is available.'
        : avalancheGateRequired && danger > 2
          ? 'Choose non-avalanche terrain or delay until the hazard and avalanche problems can be managed.'
          : undefined,
    }] : []),
    {
      key: 'convective-signal',
      label: 'No thunderstorm signal (thunder, lightning, or hail)',
      ok: !hasStormSignal,
      detail: hasStormSignal
        ? (startHasStormSignal
          ? `The start-time forecast mentions storms: ${normalizedConditionText}.`
          : `The forecast mentions storms at ${formatClockValue(stormSignalHour)}, inside your travel window.`)
        : `Forecast: ${normalizedConditionText}. No thunder, lightning, or hail mentioned.`,
      action: hasStormSignal ? 'Leave exposed terrain before the storm arrives; descend at the first thunder, lightning, or rapid cloud growth.' : undefined,
    },
    {
      key: 'precipitation',
      label: `Precipitation chance is at or below ${maxPrecipThreshold}%`,
      ok: precip !== null && precip <= maxPrecipThreshold,
      detail: precip === null
        ? 'Precipitation chance unavailable.'
        : peakPrecipHour
          ? `Peak ${precip}% at ${formatClockValue(peakPrecipHour)} in window (limit ${maxPrecipThreshold}%).`
          : `Now ${precip}% (limit ${maxPrecipThreshold}%).`,
      action: precip !== null && precip > maxPrecipThreshold ? 'Allow extra time, carry traction and weather protection, and turn around if footing or visibility deteriorates.' : undefined,
    },
    {
      key: 'wind-gust',
      label: `Wind gusts are at or below ${displayMaxGustThreshold}`,
      ok: gust !== null && gust <= maxGustThreshold,
      detail: gust === null
        ? 'Wind gust data unavailable.'
        : peakGustHour
          ? `Peak ${formatWindValue(gust)} at ${formatClockValue(peakGustHour)} in window (limit ${displayMaxGustThreshold}).`
          : `Now ${formatWindValue(gust)} (limit ${displayMaxGustThreshold}).`,
      action: gust !== null && gust > maxGustThreshold ? 'Use sheltered terrain, secure loose gear, and turn around if balance or communication becomes difficult.' : undefined,
    },
    ...(daylightEnabled ? [{
      key: 'daylight',
      label: 'Plan finishes at least 30 min before sunset',
      ok: daylightOkay,
      detail: hasDaylightInputs
        ? `${formatClockValue(cutoffTime)} start${turnaroundMinutes !== null && turnaroundTime ? ` • back by ${formatClockValue(turnaroundTime)}` : ''} • ${report?.solar?.sunset ? formatClockValue(report.solar.sunset) : 'unknown'} sunset • ${
          daylightMarginMinutes === null
            ? 'margin unavailable'
            : daylightMarginMinutes < 0
              ? `${Math.abs(daylightMarginMinutes)} min after sunset`
              : `${daylightMarginMinutes} min margin`
        }`
        : 'Start or sunset time unavailable.',
      action: hasDaylightInputs && !daylightOkay
        ? 'Move start earlier or shorten the plan to preserve at least 30 minutes of daylight margin.'
        : undefined,
    }] : []),
    {
      key: 'feels-like',
      label: `Feels-like temperature is at or above ${displayMinFeelsLikeThreshold}`,
      ok: feelsLike !== null && feelsLike >= minFeelsLikeThreshold,
      detail: feelsLike === null
        ? 'Feels-like data unavailable.'
        : coldestFeelsLikeHour
          ? `Coldest ${formatTempValue(feelsLike)} at ${formatClockValue(coldestFeelsLikeHour)} in window (limit ${displayMinFeelsLikeThreshold}).`
          : `Now ${formatTempValue(feelsLike)} (limit ${displayMinFeelsLikeThreshold}).`,
      action: feelsLike !== null && feelsLike < minFeelsLikeThreshold ? 'Bring extra layers and warm gloves, limit time in the open, and pick a point to warm up.' : undefined,
    },
    {
      key: 'heat-limit',
      label: `Feels-like temperature is at or below ${displayMaxFeelsLikeThreshold}`,
      ok: peakFeelsLike !== null && peakFeelsLike <= maxFeelsLikeThreshold,
      detail: peakFeelsLike === null
        ? 'Feels-like data unavailable.'
        : hottestFeelsLikeHour
          ? `Hottest ${formatTempValue(peakFeelsLike)} at ${formatClockValue(hottestFeelsLikeHour)} in window (limit ${displayMaxFeelsLikeThreshold}).`
          : `Now ${formatTempValue(peakFeelsLike)} (limit ${displayMaxFeelsLikeThreshold}).`,
      action: peakFeelsLike !== null && peakFeelsLike > maxFeelsLikeThreshold ? 'Start earlier, rest in the shade, and carry more water than usual.' : undefined,
    },
  ];

  if (alertsRelevantForSelectedStart && hasActiveAlertCount) {
    checks.push({
      key: 'nws-alerts',
      label: 'No active NWS alerts at your start time',
      ok: activeAlertCount === 0,
      detail: activeAlertCount === 0 ? 'No active alerts.' : `${activeAlertCount} active • highest severity ${highestAlertSeverity}.`,
      action: activeAlertCount > 0 ? 'Open the alert details and confirm your route is outside the affected areas and times.' : undefined,
    });
  }
  if (hasAqi) {
    checks.push({
      key: 'air-quality',
      label: 'Air quality is AQI 100 or better',
      ok: aqi <= 100,
      detail: `Current AQI ${Math.round(aqi)} (${airQuality.category || 'Unknown'}).`,
      action: aqi > 100 ? 'Reduce exertion and shorten the plan; choose a cleaner-air objective if anyone develops symptoms.' : undefined,
    });
  }
  if (hasFireRisk) {
    checks.push({
      key: 'fire-risk',
      label: 'Fire risk is below High',
      ok: fireRiskLevel < 3,
      detail: `${fireRisk.label || 'Unknown'} (L${Math.round(fireRiskLevel)})${fireRiskCause ? `. ${fireRiskCause}.` : ''}`,
      action: fireRiskLevel >= 3 ? 'Verify closures, use no flame or sparks, keep multiple exits, and leave for increasing smoke or wind.' : undefined,
    });
  }
  if (hasHeatRisk) {
    checks.push({
      key: 'heat-risk',
      label: 'Heat risk is below High',
      ok: heatRiskLevel < 3,
      detail: `${heatRisk.label || 'Unknown'} (L${Math.round(heatRiskLevel)})`,
      action: heatRiskLevel >= 3 ? 'Shift to cooler hours or elevations, shorten exposed segments, and set water and cooling checkpoints.' : undefined,
    });
  }
  if (terrainCode) {
    checks.push({
      key: 'terrain-signal',
      label: 'Trail surface assessment is available',
      ok: !terrainCriticalGateFail,
      detail: terrainCriticalGateFail
        ? 'The trail surface could not be classified from the current weather data.'
        : terrainConfidence
          ? `${terrainLabel} • ${terrainConfidence} confidence • advisory only, not a pass/fail limit.`
          : `${terrainLabel} • advisory only, not a pass/fail limit.`,
      action: terrainCriticalGateFail ? 'Test traction and supportability in low-consequence terrain before committing to exposed travel.' : undefined,
    });
  }
  checks.push({
    key: 'source-freshness',
    label: 'Core sources are up to date',
    ok: freshnessIssues.length === 0,
    detail: freshnessIssues.length === 0
      ? 'Every active source was updated recently enough to rely on.'
      : `Out of date or missing a timestamp: ${freshnessIssues.join(', ')}.`,
    action: freshnessIssues.length > 0 ? 'Refresh the report and check each affected official source before committing.' : undefined,
  });
  if (safety.assessmentStatus) {
    checks.push({
      key: 'evidence-coverage',
      label: 'Key data covers your whole trip window',
      ok: !insufficientEvidence,
      detail: (safety.evidenceReasons || []).join(' ') || 'Key data is available for the full requested window.',
      action: insufficientEvidence ? 'Refresh the missing sources and check the full travel window before committing.' : undefined,
    });
  }
  for (const insight of enabledReportInsights(report).filter((item) => item.decisionRelevant)) {
    // Access closures come from an area-wide search that is not matched to the
    // route, and most forests always have some closed road nearby.
    if (insight.id === 'access') {
      addAdvisory(`${insight.title}. ${insight.action}`);
      continue;
    }
    addCaution(`${insight.title}. ${insight.action}`);
    checks.push({ key: `source-${insight.id}`, label: insight.title, ok: false, detail: insight.meaning, action: insight.action });
  }

  let level = 'GO';
  let headline = 'Everything checked is within your limits. Go with normal precautions and keep checking as you travel.';
  if (blockers.length > 0) {
    level = 'NO-GO';
    headline = 'Not this plan. Change the day, the start time, or the objective.';
  } else if (insufficientEvidence) {
    level = 'CAUTION';
    headline = 'Too much data is missing to judge this trip. Fill the gaps before you commit.';
  } else if (unknownSnowpackMode && !ignoreAvalancheForDecision) {
    level = 'CAUTION';
    headline = 'No avalanche forecast covers this trip. Treat every slope as unrated.';
  } else if (cautions.length > 0) {
    level = 'CAUTION';
    headline = 'Possible with changes. Adjust your route, timing, or pace before you commit.';
  }

  // JSON drops undefined actions; drop them here too so in-process callers see the wire shape.
  for (const check of checks) {
    if (check.action === undefined) delete check.action;
  }
  return { level, headline, blockers, cautions, advisories, checks };
};

module.exports = {
  decisionLevelRank,
  normalizeDangerLevel,
  alertSeverityRank,
  enabledReportInsights,
  normalizedDecisionScore,
  trendRowsCoveringWindow,
  evaluateDecision,
};
