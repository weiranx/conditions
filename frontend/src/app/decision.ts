import type {
  DecisionLevel,
  SafetyData,
  SummitDecision,
  UserPreferences,
} from './types';
import { alertSeverityRank } from './alert-utils';
import {
  classifySnowpackFreshness,
  formatTemperatureForUnit,
  formatWindForUnit,
  freshnessClass,
  isTravelWindowCoveredByAlertWindow,
  parseSolarClockMinutes,
  parseTimeInputMinutes,
  pickNewestIsoTimestamp,
  pickOldestIsoTimestamp,
  resolveSelectedTravelWindowMs,
} from './core';
import { computeFeelsLikeF, normalizeDangerLevel } from './planner-helpers';

export type DecisionEvaluationOptions = {
  ignoreAvalancheForDecision?: boolean;
  turnaroundTime?: string;
};

export function decisionLevelRank(level: DecisionLevel | null | undefined): number {
  if (level === 'GO') return 3;
  if (level === 'CAUTION') return 2;
  if (level === 'NO-GO') return 1;
  return 0;
}

export function normalizedDecisionScore(data: SafetyData, options: DecisionEvaluationOptions = {}): number {
  const rawScore = Number(data?.safety?.score);
  const safeRawScore = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : 0;
  if (!options.ignoreAvalancheForDecision) {
    return safeRawScore;
  }

  const avalanchePenalty = (Array.isArray(data?.safety?.factors) ? data.safety.factors : []).reduce((sum, factor) => {
    const hazard = String(factor?.hazard || '').toLowerCase();
    const impact = Number(factor?.impact);
    if (!hazard.includes('avalanche') || !Number.isFinite(impact) || impact <= 0) {
      return sum;
    }
    return sum + impact;
  }, 0);

  return Math.max(0, Math.min(100, safeRawScore + avalanchePenalty));
}

export function evaluateBackcountryDecision(
  data: SafetyData,
  cutoffTime: string,
  preferences: UserPreferences,
  options: DecisionEvaluationOptions = {},
): SummitDecision {
  const blockers: string[] = [];
  const cautions: string[] = [];
  const featureEnabled = (key: string): boolean => data.featureFlags?.[key] !== false;
  const avalancheEnabled = featureEnabled('avalancheDetails');
  const airQualityEnabled = featureEnabled('airQualityDetails');
  const fireRiskEnabled = featureEnabled('fireRiskDetails');
  const heatRiskEnabled = featureEnabled('heatRiskDetails');
  const snowpackEnabled = featureEnabled('snowpackDetails');
  const daylightEnabled = featureEnabled('daylightTimeline');
  const addBlocker = (message: string) => {
    if (!blockers.includes(message)) {
      blockers.push(message);
    }
  };
  const addCaution = (message: string) => {
    if (!cautions.includes(message)) {
      cautions.push(message);
    }
  };

  const avalanche = data.avalanche;
  const danger = avalanche?.dangerLevel || 0;
  let gust = data.weather.windGust ?? 0;
  let precip = data.weather.precipChance ?? 0;
  let feelsLike: number | null = data.weather.feelsLike ?? data.weather.temp ?? null;
  const description = data.weather.description || '';
  const normalizedConditionText = String(description || '').trim() || 'No forecast condition text available.';
  const weatherUnavailable = /weather data unavailable/i.test(description);
  if (weatherUnavailable) {
    addBlocker('Weather data is unavailable — wind, precipitation, and temperature are unknown. Do not make go/no-go decisions from this report.');
  }
  const startHasStormSignal = /thunder|storm|lightning|hail|blizzard/i.test(description);
  let hasStormSignal = startHasStormSignal;

  // Scan the full travel window for worst-case conditions
  let peakGustHour = '';
  let peakPrecipHour = '';
  let coldestFeelsLikeHour = '';
  let stormSignalHour = '';
  const windowTrend = (data.weather.trend || []).slice(0, preferences.travelWindowHours);
  for (const wpt of windowTrend) {
    const wg = Number.isFinite(Number(wpt.gust)) ? Number(wpt.gust) : 0;
    if (wg > gust) { gust = wg; peakGustHour = wpt.time || ''; }
    const wp = Number.isFinite(Number(wpt.precipChance)) ? Number(wpt.precipChance) : 0;
    if (wp > precip) { precip = wp; peakPrecipHour = wpt.time || ''; }
    const wt = Number.isFinite(Number(wpt.temp)) ? Number(wpt.temp) : 0;
    const ww = Number.isFinite(Number(wpt.wind)) ? Number(wpt.wind) : 0;
    const wfl = computeFeelsLikeF(wt, ww);
    if (feelsLike === null || wfl < feelsLike) { feelsLike = wfl; coldestFeelsLikeHour = wpt.time || ''; }
    if (!hasStormSignal && /thunder|storm|lightning|hail|blizzard/i.test(String(wpt.condition || ''))) {
      hasStormSignal = true;
      stormSignalHour = wpt.time || '';
    }
  }
  const ignoreAvalancheForDecision = Boolean(options.ignoreAvalancheForDecision);
  const avalancheRelevant = Boolean(avalancheEnabled && avalanche && !ignoreAvalancheForDecision && avalanche.relevant !== false);
  const avalancheExpired = avalancheRelevant && avalanche?.coverageStatus === 'expired_for_selected_start';
  const avalancheUnknown = avalancheRelevant && !avalancheExpired &&
    Boolean(avalanche?.dangerUnknown || avalanche?.coverageStatus !== 'reported');
  const avalancheGateRequired = avalancheRelevant;
  const unknownSnowpackMode = avalancheGateRequired && avalancheUnknown;
  const avalancheCheckLabel = (safeDangerLabel: string): string => {
    if (!avalancheRelevant) {
      return 'Avalanche check not required for this location profile';
    }
    if (avalancheUnknown) {
      return 'Avalanche forecast coverage is unavailable for this location';
    }
    return `Avalanche danger is ${safeDangerLabel}`;
  };
  const maxGustThreshold = Math.max(10, preferences.maxWindGustMph);
  const maxPrecipThreshold = Math.max(0, preferences.maxPrecipChance);
  const minFeelsLikeThreshold = preferences.minFeelsLikeF;
  const windUnit = preferences.windSpeedUnit;
  const tempUnit = preferences.temperatureUnit;
  const formatWind = (valueMph: number) => formatWindForUnit(valueMph, windUnit);
  const formatTemp = (valueF: number) => formatTemperatureForUnit(valueF, tempUnit);
  const displayMaxGustThreshold = formatWind(maxGustThreshold);
  const displayMinFeelsLikeThreshold = formatTemp(minFeelsLikeThreshold);

  const alertsStatus = String(data.alerts?.status || '').toLowerCase();
  const forecastLeadHoursRaw = data.forecast?.selectedStartTime
    ? (new Date(data.forecast.selectedStartTime).getTime() - Date.now()) / 3_600_000
    : null;
  const alertsRelevantForSelectedStart = forecastLeadHoursRaw === null || forecastLeadHoursRaw <= 48;
  const alertsNoActiveForSelectedStart = alertsStatus === 'none' || alertsStatus === 'none_for_selected_start';
  const selectedTravelWindowMs = resolveSelectedTravelWindowMs(data, preferences.travelWindowHours);
  const alertsWindowCovered = isTravelWindowCoveredByAlertWindow(selectedTravelWindowMs, data.alerts?.alerts || []);
  const activeAlertCount = Number(data.alerts?.activeCount);
  const hasActiveAlertCount = Number.isFinite(activeAlertCount);
  const highestAlertSeverity = String(data.alerts?.highestSeverity || 'Unknown');
  const highestAlertSeverityRank = alertSeverityRank(highestAlertSeverity);

  const airQualityStatus = String(data.airQuality?.status || '').toLowerCase();
  const airQualityFutureNotApplicable = airQualityStatus === 'not_applicable_future_date';
  const aqi = Number(data.airQuality?.usAqi);
  const hasAqi = airQualityEnabled && Number.isFinite(aqi) && airQualityStatus !== 'unavailable' && !airQualityFutureNotApplicable;

  const fireRiskStatus = String(data.fireRisk?.status || '').toLowerCase();
  const fireRiskLevel = Number(data.fireRisk?.level);
  const hasFireRisk = fireRiskEnabled && Number.isFinite(fireRiskLevel) && fireRiskStatus !== 'unavailable';

  const heatRiskStatus = String(data.heatRisk?.status || '').toLowerCase();
  const heatRiskLevel = Number(data.heatRisk?.level);
  const hasHeatRisk = heatRiskEnabled && Number.isFinite(heatRiskLevel) && heatRiskStatus !== 'unavailable';

  const terrainCode = String(data.terrainCondition?.code || '').toLowerCase();
  const terrainLabel = data.terrainCondition?.label || data.trail || 'Unknown';
  const terrainConfidence = String(data.terrainCondition?.confidence || '').toLowerCase();
  const terrainNeedsAttention = ['snow_ice', 'wet_muddy', 'cold_slick', 'dry_loose'].includes(terrainCode);
  const terrainCriticalGateFail = terrainCode === 'weather_unavailable';

  const weatherFreshnessState = freshnessClass(
    pickOldestIsoTimestamp([
      data.weather.issuedTime || null,
      data.weather.forecastStartTime || null,
    ]),
    12,
  );
  const avalancheFreshnessState = avalancheRelevant
    ? freshnessClass(pickOldestIsoTimestamp([avalanche?.publishedTime || null]), 24)
    : null;
  const alertsFreshnessState = alertsRelevantForSelectedStart
    ? alertsNoActiveForSelectedStart || alertsWindowCovered
      ? 'fresh'
      : freshnessClass(
          pickNewestIsoTimestamp(
            (data.alerts?.alerts || []).flatMap((alert) => [alert.sent || null, alert.effective || null, alert.onset || null]),
          ),
          6,
        )
    : null;
  const airQualityFreshnessState = airQualityFutureNotApplicable
    ? 'fresh'
    : hasAqi
      ? freshnessClass(pickOldestIsoTimestamp([data.airQuality?.measuredTime || null]), 8)
      : null;
  const precipitationFreshnessState = freshnessClass(pickOldestIsoTimestamp([data.rainfall?.anchorTime || null]), 8);
  const snowpackStatus = String(data.snowpack?.status || '').toLowerCase();
  const snowpackAvailable = snowpackEnabled && (snowpackStatus === 'ok' || snowpackStatus === 'partial');
  const snowpackFreshness = classifySnowpackFreshness(data.snowpack?.snotel?.observedDate || null, data.snowpack?.nohrsc?.sampledTime || null);
  const snowpackFreshnessState = snowpackAvailable
    ? snowpackFreshness.state
    : null;
  const freshnessIssues = [
    weatherFreshnessState === 'stale' || weatherFreshnessState === 'missing' ? 'weather' : null,
    // When the bulletin is unavailable, that is already surfaced by its own dedicated
    // check, so don't double-count it as a stale/missing source-freshness feed.
    !ignoreAvalancheForDecision && !avalancheUnknown && (avalancheFreshnessState === 'stale' || avalancheFreshnessState === 'missing') ? 'avalanche' : null,
    alertsFreshnessState === 'stale' || alertsFreshnessState === 'missing' ? 'alerts' : null,
    airQualityEnabled && (airQualityFreshnessState === 'stale' || airQualityFreshnessState === 'missing') ? 'air quality' : null,
    precipitationFreshnessState === 'stale' || precipitationFreshnessState === 'missing' ? 'precipitation' : null,
    snowpackEnabled && (snowpackFreshnessState === 'stale' || snowpackFreshnessState === 'missing') ? 'snowpack' : null,
  ].filter(Boolean) as string[];

  if (unknownSnowpackMode) {
    addCaution(
      'No current avalanche bulletin covers this zone. Use low-angle, low-consequence terrain, avoid terrain traps, increase spacing, and open the Avalanche card before committing.',
    );
  }
  if (avalancheExpired) {
    addCaution('The avalanche bulletin expires before this start time. Open the latest center product before leaving; if no update is available, treat the terrain as unrated and conditions as potentially worse.');
  }

  if (avalancheGateRequired && !avalancheUnknown && danger >= 4) {
    addBlocker('Avalanche danger is High or Extreme. Choose non-avalanche terrain or another day; do not enter avalanche terrain.');
  } else if (avalancheGateRequired && !avalancheUnknown && danger === 3) {
    addBlocker('Avalanche danger is Considerable. Choose non-avalanche terrain or another day unless your team can reliably identify and avoid the day’s avalanche problems.');
  }
  if (hasStormSignal) {
    addCaution('A storm or thunder signal appears in the travel window. Stay off exposed ridges, identify a fast descent route, and turn around at the first thunder, lightning, or rapid cloud growth.');
  }
  if (precip >= Math.max(85, maxPrecipThreshold + 25)) {
    addBlocker(`Precipitation chance reaches ${precip}%. Delay or choose a lower-consequence route where slick surfaces, poor visibility, and slower travel do not create a trap.`);
  } else if (precip >= Math.max(55, maxPrecipThreshold)) {
    addCaution(`Precipitation chance reaches ${precip}%. Allow extra travel time, carry traction and weather protection, and turn around if footing or visibility deteriorates.`);
  }
  if (gust >= Math.max(35, maxGustThreshold + 10)) {
    addBlocker(`Wind gusts reach about ${formatWind(gust)}. Choose a sheltered, lower objective or delay; avoid exposed ridges and terrain where a stumble would be consequential.`);
  } else if (gust >= maxGustThreshold) {
    addCaution(`Wind gusts reach about ${formatWind(gust)}. Shorten ridge exposure, secure loose gear, and use a firm turnaround if balance or communication becomes difficult.`);
  }

  if (feelsLike !== null && feelsLike >= 95) {
    addBlocker(`Apparent temperature reaches about ${formatTemp(feelsLike)}. Move to cooler hours or a cooler objective; do not commit without reliable water, shade, and an early exit.`);
  } else if (feelsLike !== null && feelsLike <= minFeelsLikeThreshold) {
    addCaution(`Apparent temperature falls near ${formatTemp(feelsLike)}. Add insulation and hand protection, reduce exposed time, and set a warming or turnaround checkpoint.`);
  }

  if (alertsRelevantForSelectedStart && hasActiveAlertCount && activeAlertCount > 0) {
    const alertNoun = activeAlertCount === 1 ? 'alert' : 'alerts';
    const alertVerb = activeAlertCount === 1 ? 'includes' : 'include';
    const overlapVerb = activeAlertCount === 1 ? 'overlaps' : 'overlap';
    if (highestAlertSeverityRank >= 4) {
      addBlocker(`${activeAlertCount} active NWS ${alertNoun} ${alertVerb} ${highestAlertSeverity.toLowerCase()}-severity products. Open the alert details and move the plan outside the affected area and time.`);
    } else {
      addCaution(`${activeAlertCount} active NWS ${alertNoun} ${overlapVerb} the selected start. Read each alert’s area, timing, and instructions before choosing the route.`);
    }
  }

  if (hasAqi) {
    if (aqi >= 151) {
      addBlocker(`Air quality is unhealthy or worse (AQI ${Math.round(aqi)}). Choose a cleaner-air objective or postpone strenuous travel.`);
    } else if (aqi >= 101) {
      addCaution(`Air quality is unhealthy for sensitive groups (AQI ${Math.round(aqi)}). Reduce exertion, shorten the plan, and use a cleaner-air alternative if anyone develops symptoms.`);
    } else if (aqi >= 51) {
      addCaution(`Air quality is moderate (AQI ${Math.round(aqi)}). Sensitive group members should reduce sustained exertion and monitor symptoms.`);
    }
  }

  if (hasFireRisk) {
    if (fireRiskLevel >= 4) {
      addBlocker(`Fire danger is extreme (${data.fireRisk?.label || `L${Math.round(fireRiskLevel)}`}). Choose another area or time, verify closures, and do not enter fire-affected terrain.`);
    } else if (fireRiskLevel >= 3) {
      addCaution(`Fire danger is high (${data.fireRisk?.label || `L${Math.round(fireRiskLevel)}`}). Use a short objective with multiple exits, avoid ignition sources, and turn around for increasing smoke or wind.`);
    } else if (fireRiskLevel >= 2) {
      addCaution(`Fire danger is elevated (${data.fireRisk?.label || `L${Math.round(fireRiskLevel)}`}). Check closures and incident updates, avoid ignition sources, and keep a clear exit route.`);
    }
  }

  if (hasHeatRisk) {
    if (heatRiskLevel >= 4) {
      addBlocker(`Heat risk is extreme (${data.heatRisk?.label || `L${Math.round(heatRiskLevel)}`}). Choose a cooler time or objective and avoid long exposed travel.`);
    } else if (heatRiskLevel >= 3) {
      addCaution(`Heat risk is high (${data.heatRisk?.label || `L${Math.round(heatRiskLevel)}`}). Move in cooler hours, shorten exposed segments, and set a firm turnaround if water or cooling becomes limited.`);
    } else if (heatRiskLevel >= 2) {
      addCaution(`Heat risk is elevated (${data.heatRisk?.label || `L${Math.round(heatRiskLevel)}`}). Schedule shade and hydration breaks, ease the pace, and watch the group for early symptoms.`);
    }
  }

  if (terrainNeedsAttention) {
    const terrainAction = String(data.terrainCondition?.recommendedTravel || '').trim();
    addCaution(`Terrain and trail surfaces need attention (${terrainLabel}).${terrainAction ? ` ${terrainAction}` : ' Test footing at low-consequence transitions before exposed travel.'}`);
  }

  if (freshnessIssues.length > 0) {
    addCaution(`Some feeds are stale or missing timestamps (${freshnessIssues.join(', ')}). Refresh the report and open the affected official sources before committing.`);
  }

  const cutoffMinutes = parseTimeInputMinutes(cutoffTime);
  const sunsetMinutes = daylightEnabled && data.solar?.sunset ? parseSolarClockMinutes(data.solar.sunset) : null;
  const daylightBuffer = 30;
  const turnaroundMinutes = options.turnaroundTime
    ? parseTimeInputMinutes(options.turnaroundTime)
    : null;
  const hasDaylightInputs = cutoffMinutes !== null && sunsetMinutes !== null;
  const effectiveReturnMinutes = turnaroundMinutes ?? cutoffMinutes;
  const daylightOkay = hasDaylightInputs && effectiveReturnMinutes !== null
    ? effectiveReturnMinutes <= sunsetMinutes - daylightBuffer
    : false;
  const daylightMarginMinutes = hasDaylightInputs && effectiveReturnMinutes !== null
    ? sunsetMinutes - effectiveReturnMinutes
    : null;
  if (daylightEnabled && !hasDaylightInputs) {
    addCaution('Daylight timing is unavailable. Confirm sunset from an official source, set a return time with at least 30 minutes of margin, and carry a headlamp.');
  } else if (daylightEnabled && !daylightOkay && turnaroundMinutes === null) {
    // When a turnaround time is known, the block below reports the same thin-margin
    // condition with exact minutes — keep only the more specific message.
    addCaution(`Daylight margin is too thin. Start earlier or shorten the route to finish at least ${daylightBuffer} minutes before sunset, and carry a headlamp.`);
  }
  if (daylightEnabled && turnaroundMinutes !== null && sunsetMinutes !== null) {
    const margin = sunsetMinutes - turnaroundMinutes;
    if (margin < 0) {
      addCaution(`Turnaround time is ${Math.abs(margin)} minutes after sunset (${data.solar?.sunset || 'time unavailable'}). Move the start earlier or shorten the route; do not make darkness the default plan.`);
    } else if (margin < 30) {
      addCaution(`Turnaround margin is only ${margin} minutes before sunset. Move the turnaround earlier and preserve at least 30 minutes for delays.`);
    }
  }

  const checks: SummitDecision['checks'] = [
    ...(avalancheEnabled && avalanche ? [{
      key: 'avalanche',
      label: avalancheGateRequired ? 'Avalanche danger is Moderate or lower' : avalancheCheckLabel('Moderate or lower'),
      ok: avalancheGateRequired ? (!avalancheUnknown && danger <= 2) : true,
      detail: !avalancheRelevant
        ? 'Not required by current seasonal and snowpack profile.'
        : avalancheUnknown
          ? 'Coverage unavailable for this objective/time.'
          : `Current danger: ${['No Rating', 'Low', 'Moderate', 'Considerable', 'High', 'Extreme'][normalizeDangerLevel(danger)] || 'Unknown'}.`,
      action:
        avalancheGateRequired && avalancheUnknown
          ? 'Use low-angle, low-consequence terrain, avoid terrain traps, and increase spacing until a current bulletin is available.'
          : avalancheGateRequired && danger > 2
            ? 'Choose non-avalanche terrain or delay until the hazard and avalanche problems can be managed.'
            : undefined,
    }] : []),
    {
      key: 'convective-signal',
      label: 'No convective storm signal (thunder/lightning/hail)',
      ok: !hasStormSignal,
      detail: hasStormSignal
        ? (startHasStormSignal
          ? `Convective risk keywords in start-time forecast: ${normalizedConditionText}.`
          : `Convective risk keywords detected at ${stormSignalHour} within travel window.`)
        : `Forecast text: ${normalizedConditionText}. No convective keywords detected.`,
      action: hasStormSignal ? 'Leave exposed terrain before the storm arrives; descend at the first thunder, lightning, or rapid cloud growth.' : undefined,
    },
    {
      key: 'precipitation',
      label: `Precipitation chance is at or below ${maxPrecipThreshold}%`,
      ok: precip <= maxPrecipThreshold,
      detail: peakPrecipHour ? `Peak ${precip}% at ${peakPrecipHour} in window (limit ${maxPrecipThreshold}%).` : `Now ${precip}% (limit ${maxPrecipThreshold}%).`,
      action: precip > maxPrecipThreshold ? 'Allow extra time, carry traction and weather protection, and turn around if footing or visibility deteriorates.' : undefined,
    },
    {
      key: 'wind-gust',
      label: `Wind gusts are at or below ${displayMaxGustThreshold}`,
      ok: gust <= maxGustThreshold,
      detail: peakGustHour ? `Peak ${formatWind(gust)} at ${peakGustHour} in window (limit ${displayMaxGustThreshold}).` : `Now ${formatWind(gust)} (limit ${displayMaxGustThreshold}).`,
      action: gust > maxGustThreshold ? 'Use sheltered terrain, secure loose gear, and turn around if balance or communication becomes difficult.' : undefined,
    },
    ...(daylightEnabled ? [{
      key: 'daylight',
      label: 'Plan finishes at least 30 min before sunset',
      ok: daylightOkay,
      detail: hasDaylightInputs
        ? `${cutoffTime} start${turnaroundMinutes !== null && options.turnaroundTime ? ` \u2022 back by ${options.turnaroundTime}` : ''} \u2022 ${data.solar?.sunset || 'unknown'} sunset \u2022 ${
            daylightMarginMinutes === null
              ? 'margin unavailable'
              : daylightMarginMinutes < 0
                ? `${Math.abs(daylightMarginMinutes)} min after sunset`
                : `${daylightMarginMinutes} min margin`
          }`
        : 'Start or sunset time unavailable.',
      action:
        hasDaylightInputs && !daylightOkay
          ? 'Move start earlier or shorten the plan to preserve at least 30 minutes of daylight margin.'
          : undefined,
    }] : []),
    {
      key: 'feels-like',
      label: `Apparent temperature is at or above ${displayMinFeelsLikeThreshold}`,
      ok: feelsLike !== null && feelsLike >= minFeelsLikeThreshold,
      detail: feelsLike === null ? 'Feels-like data unavailable.' : coldestFeelsLikeHour ? `Coldest ${formatTemp(feelsLike)} at ${coldestFeelsLikeHour} in window (limit ${displayMinFeelsLikeThreshold}).` : `Now ${formatTemp(feelsLike)} (limit ${displayMinFeelsLikeThreshold}).`,
      action: feelsLike !== null && feelsLike < minFeelsLikeThreshold ? 'Add insulation and hand protection, reduce exposed time, and set a warming checkpoint.' : undefined,
    },
  ];

  if (alertsRelevantForSelectedStart && hasActiveAlertCount) {
    checks.push({
      key: 'nws-alerts',
      label: 'No active NWS alerts at selected start time',
      ok: activeAlertCount === 0,
      detail:
        activeAlertCount === 0
          ? 'No active alerts.'
          : `${activeAlertCount} active \u2022 highest severity ${highestAlertSeverity}.`,
      action: activeAlertCount > 0 ? 'Open alert details and verify your route is outside affected zones/time windows.' : undefined,
    });
  }

  if (hasAqi) {
    checks.push({
      key: 'air-quality',
      label: 'Air quality is <= 100 AQI',
      ok: aqi <= 100,
      detail: `Current AQI ${Math.round(aqi)} (${data.airQuality?.category || 'Unknown'}).`,
      action: aqi > 100 ? 'Reduce exertion and shorten the plan; choose a cleaner-air objective if anyone develops symptoms.' : undefined,
    });
  }

  if (hasFireRisk) {
    checks.push({
      key: 'fire-risk',
      label: 'Fire risk is below High (L3+)',
      ok: fireRiskLevel < 3,
      detail: `${data.fireRisk?.label || 'Unknown'} (${Number.isFinite(fireRiskLevel) ? `L${Math.round(fireRiskLevel)}` : 'L?'})`,
      action: fireRiskLevel >= 3 ? 'Verify closures, use no flame or sparks, keep multiple exits, and leave for increasing smoke or wind.' : undefined,
    });
  }

  if (hasHeatRisk) {
    checks.push({
      key: 'heat-risk',
      label: 'Heat risk is below High (L3+)',
      ok: heatRiskLevel < 3,
      detail: `${data.heatRisk?.label || 'Unknown'} (${Number.isFinite(heatRiskLevel) ? `L${Math.round(heatRiskLevel)}` : 'L?'})`,
      action: heatRiskLevel >= 3 ? 'Shift to cooler hours or elevations, shorten exposed segments, and set water and cooling checkpoints.' : undefined,
    });
  }

  if (terrainCode) {
    checks.push({
      key: 'terrain-signal',
      label: 'Terrain / trail surface signal is available',
      ok: !terrainCriticalGateFail,
      detail: terrainCriticalGateFail
        ? 'Surface/trail classification unavailable from current weather inputs.'
        : terrainConfidence
          ? `${terrainLabel} \u2022 confidence ${terrainConfidence} \u2022 use as advisory context, not a hard gate.`
          : `${terrainLabel} \u2022 use as advisory context, not a hard gate.`,
      action: terrainCriticalGateFail ? 'Test traction and supportability in low-consequence terrain before committing to exposed travel.' : undefined,
    });
  }

  checks.push({
    key: 'source-freshness',
    label: 'Core source freshness has no stale/missing feeds',
    ok: freshnessIssues.length === 0,
    detail: freshnessIssues.length === 0 ? 'Timestamps are current enough for active feeds.' : `Issue: ${freshnessIssues.join(', ')}.`,
    action: freshnessIssues.length > 0 ? 'Refresh the report and open each affected official source before committing.' : undefined,
  });

  let level: DecisionLevel = 'GO';
  let headline = 'No current threshold is tripped — keep normal precautions.';

  if (blockers.length > 0) {
    level = 'NO-GO';
    headline = 'Do not commit to this plan — change the objective, timing, or day.';
  } else if (unknownSnowpackMode && !ignoreAvalancheForDecision) {
    level = 'CAUTION';
    headline = 'No current avalanche bulletin — use unrated-terrain travel practices.';
  } else if (cautions.length > 0) {
    level = 'CAUTION';
    headline = 'Adjust terrain, timing, or pace before committing.';
  }

  return { level, headline, blockers, cautions, checks };
}
