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

  const danger = data.avalanche.dangerLevel || 0;
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
  const avalancheRelevant = !ignoreAvalancheForDecision && data.avalanche.relevant !== false;
  const avalancheExpired = avalancheRelevant && data.avalanche.coverageStatus === 'expired_for_selected_start';
  const avalancheUnknown = avalancheRelevant && !avalancheExpired &&
    Boolean(data.avalanche.dangerUnknown || data.avalanche.coverageStatus !== 'reported');
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
  const hasAqi = Number.isFinite(aqi) && airQualityStatus !== 'unavailable' && !airQualityFutureNotApplicable;

  const fireRiskStatus = String(data.fireRisk?.status || '').toLowerCase();
  const fireRiskLevel = Number(data.fireRisk?.level);
  const hasFireRisk = Number.isFinite(fireRiskLevel) && fireRiskStatus !== 'unavailable';

  const heatRiskStatus = String(data.heatRisk?.status || '').toLowerCase();
  const heatRiskLevel = Number(data.heatRisk?.level);
  const hasHeatRisk = Number.isFinite(heatRiskLevel) && heatRiskStatus !== 'unavailable';

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
    ? freshnessClass(pickOldestIsoTimestamp([data.avalanche.publishedTime || null]), 24)
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
  const snowpackAvailable = snowpackStatus === 'ok' || snowpackStatus === 'partial';
  const snowpackFreshness = classifySnowpackFreshness(data.snowpack?.snotel?.observedDate || null, data.snowpack?.nohrsc?.sampledTime || null);
  const snowpackFreshnessState = snowpackAvailable
    ? snowpackFreshness.state
    : null;
  const freshnessIssues = [
    weatherFreshnessState === 'stale' || weatherFreshnessState === 'missing' ? 'weather' : null,
    !ignoreAvalancheForDecision && (avalancheFreshnessState === 'stale' || avalancheFreshnessState === 'missing') ? 'avalanche' : null,
    alertsFreshnessState === 'stale' || alertsFreshnessState === 'missing' ? 'alerts' : null,
    airQualityFreshnessState === 'stale' || airQualityFreshnessState === 'missing' ? 'air quality' : null,
    precipitationFreshnessState === 'stale' || precipitationFreshnessState === 'missing' ? 'precipitation' : null,
    snowpackFreshnessState === 'stale' || snowpackFreshnessState === 'missing' ? 'snowpack' : null,
  ].filter(Boolean) as string[];

  if (unknownSnowpackMode) {
    addCaution(
      'Avalanche forecast coverage is unavailable for this location. Do not treat this as low risk; keep terrain conservative and avoid avalanche features.',
    );
    addCaution('Limited avalanche coverage: use low-angle terrain, avoid terrain traps, and increase spacing/communication.');
  }
  if (avalancheExpired) {
    addCaution('Avalanche bulletin has expired for the selected start time. Danger rating shown is the last-known value; treat conditions as potentially worse.');
  }

  if (avalancheGateRequired && !avalancheUnknown && danger >= 4) {
    addBlocker('Avalanche danger is High/Extreme. Avoid avalanche terrain.');
  } else if (avalancheGateRequired && !avalancheUnknown && danger === 3) {
    addBlocker('Avalanche danger is Considerable. Avoid avalanche terrain unless trained in terrain selection and risk management.');
  }
  if (hasStormSignal) {
    addCaution('Storm or thunder signal in forecast. Avoid exposed terrain and keep fallback options ready.');
  }
  if (precip >= Math.max(85, maxPrecipThreshold + 25)) {
    addBlocker(`Precipitation chance at ${precip}% is too high for stable travel conditions.`);
  } else if (precip >= Math.max(55, maxPrecipThreshold)) {
    addCaution(`Precipitation chance at ${precip}% can create slick surfaces and slower travel.`);
  }
  if (gust >= Math.max(35, maxGustThreshold + 10)) {
    addBlocker(`Wind gusts around ${formatWind(gust)} exceed conservative backcountry thresholds.`);
  } else if (gust >= maxGustThreshold) {
    addCaution(`Wind gusts near ${formatWind(gust)} can affect exposed movement and stability.`);
  }

  if (feelsLike !== null && feelsLike >= 95) {
    addBlocker(`Apparent temperature near ${formatTemp(feelsLike)} has high heat-stress risk.`);
  } else if (feelsLike !== null && feelsLike <= minFeelsLikeThreshold) {
    addCaution(`Apparent temperature near ${formatTemp(feelsLike)} increases cold-exposure risk.`);
  }

  if (alertsRelevantForSelectedStart && hasActiveAlertCount && activeAlertCount > 0) {
    if (highestAlertSeverityRank >= 4) {
      addBlocker(`${activeAlertCount} active NWS alert(s) include high-severity products (${highestAlertSeverity}).`);
    } else {
      addCaution(`${activeAlertCount} active NWS alert(s) are in effect at selected start time.`);
    }
  }

  if (hasAqi) {
    if (aqi >= 151) {
      addBlocker(`Air quality is unhealthy/hazardous (AQI ${Math.round(aqi)}).`);
    } else if (aqi >= 101) {
      addCaution(`Air quality is unhealthy for sensitive groups (AQI ${Math.round(aqi)}).`);
    } else if (aqi >= 51) {
      addCaution(`Air quality is moderate (AQI ${Math.round(aqi)}).`);
    }
  }

  if (hasFireRisk) {
    if (fireRiskLevel >= 4) {
      addBlocker(`Fire danger is extreme (${data.fireRisk?.label || `L${Math.round(fireRiskLevel)}`}).`);
    } else if (fireRiskLevel >= 3) {
      addCaution(`Fire danger is high (${data.fireRisk?.label || `L${Math.round(fireRiskLevel)}`}).`);
    } else if (fireRiskLevel >= 2) {
      addCaution(`Fire danger is elevated (${data.fireRisk?.label || `L${Math.round(fireRiskLevel)}`}).`);
    }
  }

  if (hasHeatRisk) {
    if (heatRiskLevel >= 4) {
      addBlocker(`Heat risk is extreme (${data.heatRisk?.label || `L${Math.round(heatRiskLevel)}`}).`);
    } else if (heatRiskLevel >= 3) {
      addCaution(`Heat risk is high (${data.heatRisk?.label || `L${Math.round(heatRiskLevel)}`}).`);
    } else if (heatRiskLevel >= 2) {
      addCaution(`Heat risk is elevated (${data.heatRisk?.label || `L${Math.round(heatRiskLevel)}`}).`);
    }
  }

  if (terrainNeedsAttention) {
    addCaution(`Terrain/trail condition needs attention (${terrainLabel}).`);
  }

  if (freshnessIssues.length > 0) {
    addCaution(`Some feeds are stale or missing timestamps (${freshnessIssues.join(', ')}). Re-verify before committing.`);
  }

  const cutoffMinutes = parseTimeInputMinutes(cutoffTime);
  const sunsetMinutes = data.solar?.sunset ? parseSolarClockMinutes(data.solar.sunset) : null;
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
  if (!hasDaylightInputs) {
    addCaution('Daylight timing data is unavailable. Confirm sunset timing from official sources before committing.');
  } else if (!daylightOkay) {
    addCaution(`Daylight margin is too thin for this plan. Keep at least a ${daylightBuffer}-minute buffer before sunset.`);
  }
  if (turnaroundMinutes !== null && sunsetMinutes !== null) {
    const margin = sunsetMinutes - turnaroundMinutes;
    if (margin < 0) {
      addCaution(`Turnaround time is ${Math.abs(margin)} min after sunset (${data.solar.sunset}). Adjust plan or expect darkness.`);
    } else if (margin < 30) {
      addCaution(`Turnaround margin is only ${margin} min before sunset — very thin buffer.`);
    }
  }

  const checks: SummitDecision['checks'] = [
    {
      key: 'avalanche',
      label: avalancheGateRequired ? 'Avalanche danger is Moderate or lower' : avalancheCheckLabel('Moderate or lower'),
      ok: avalancheGateRequired ? (!avalancheUnknown && danger <= 2) : true,
      detail: !avalancheRelevant
        ? 'Not required by current seasonal and snowpack profile.'
        : avalancheUnknown
          ? 'Coverage unavailable for this objective/time.'
          : `Current danger level ${normalizeDangerLevel(danger)}.`,
      action:
        avalancheGateRequired && avalancheUnknown
          ? 'Use conservative, low-consequence terrain until a current bulletin is available.'
          : avalancheGateRequired && danger > 2
            ? 'Choose lower-angle terrain or delay until hazard rating drops.'
            : undefined,
    },
    {
      key: 'convective-signal',
      label: 'No convective storm signal (thunder/lightning/hail)',
      ok: !hasStormSignal,
      detail: hasStormSignal
        ? (startHasStormSignal
          ? `Convective risk keywords in start-time forecast: ${normalizedConditionText}.`
          : `Convective risk keywords detected at ${stormSignalHour} within travel window.`)
        : `Forecast text: ${normalizedConditionText}. No convective keywords detected.`,
      action: hasStormSignal ? 'Avoid exposed ridgelines and move to lower-consequence terrain windows.' : undefined,
    },
    {
      key: 'precipitation',
      label: `Precipitation chance is at or below ${maxPrecipThreshold}%`,
      ok: precip <= maxPrecipThreshold,
      detail: peakPrecipHour ? `Peak ${precip}% at ${peakPrecipHour} in window (limit ${maxPrecipThreshold}%).` : `Now ${precip}% (limit ${maxPrecipThreshold}%).`,
      action: precip > maxPrecipThreshold ? 'Expect slower travel and reduced traction; tighten route and timing.' : undefined,
    },
    {
      key: 'wind-gust',
      label: `Wind gusts are at or below ${displayMaxGustThreshold}`,
      ok: gust <= maxGustThreshold,
      detail: peakGustHour ? `Peak ${formatWind(gust)} at ${peakGustHour} in window (limit ${displayMaxGustThreshold}).` : `Now ${formatWind(gust)} (limit ${displayMaxGustThreshold}).`,
      action: gust > maxGustThreshold ? 'Reduce ridge exposure and shorten high-wind segments.' : undefined,
    },
    {
      key: 'daylight',
      label: 'Plan finishes at least 30 min before sunset',
      ok: daylightOkay,
      detail: hasDaylightInputs
        ? `${cutoffTime} start${turnaroundMinutes !== null && options.turnaroundTime ? ` \u2022 back by ${options.turnaroundTime}` : ''} \u2022 ${data.solar.sunset} sunset \u2022 ${
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
    },
    {
      key: 'feels-like',
      label: `Apparent temperature is at or above ${displayMinFeelsLikeThreshold}`,
      ok: feelsLike !== null && feelsLike >= minFeelsLikeThreshold,
      detail: feelsLike === null ? 'Feels-like data unavailable.' : coldestFeelsLikeHour ? `Coldest ${formatTemp(feelsLike)} at ${coldestFeelsLikeHour} in window (limit ${displayMinFeelsLikeThreshold}).` : `Now ${formatTemp(feelsLike)} (limit ${displayMinFeelsLikeThreshold}).`,
      action: feelsLike !== null && feelsLike < minFeelsLikeThreshold ? 'Increase insulation/warmth margin or reduce exposure duration.' : undefined,
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
      action: aqi > 100 ? 'Reduce exertion, carry respiratory protection, or pick a cleaner-air objective.' : undefined,
    });
  }

  if (hasFireRisk) {
    checks.push({
      key: 'fire-risk',
      label: 'Fire risk is below High (L3+)',
      ok: fireRiskLevel < 3,
      detail: `${data.fireRisk?.label || 'Unknown'} (${Number.isFinite(fireRiskLevel) ? `L${Math.round(fireRiskLevel)}` : 'L?'})`,
      action: fireRiskLevel >= 3 ? 'Avoid fire-restricted areas and plan low-spark/no-flame operations.' : undefined,
    });
  }

  if (hasHeatRisk) {
    checks.push({
      key: 'heat-risk',
      label: 'Heat risk is below High (L3+)',
      ok: heatRiskLevel < 3,
      detail: `${data.heatRisk?.label || 'Unknown'} (${Number.isFinite(heatRiskLevel) ? `L${Math.round(heatRiskLevel)}` : 'L?'})`,
      action: heatRiskLevel >= 3 ? 'Shift to cooler hours/elevations and increase hydration/cooling controls.' : undefined,
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
      action: terrainCriticalGateFail ? 'Use field observations for traction/surface risk since model signal is unavailable.' : undefined,
    });
  }

  checks.push({
    key: 'source-freshness',
    label: 'Core source freshness has no stale/missing feeds',
    ok: freshnessIssues.length === 0,
    detail: freshnessIssues.length === 0 ? 'Timestamps are current enough for active feeds.' : `Issue: ${freshnessIssues.join(', ')}.`,
    action: freshnessIssues.length > 0 ? 'Refresh and verify upstream official products before committing.' : undefined,
  });

  let level: DecisionLevel = 'GO';
  let headline = 'Proceed with conservative backcountry travel controls.';

  if (blockers.length > 0) {
    level = 'NO-GO';
    headline = 'High-likelihood failure modes detected. Delay or change objective.';
  } else if (unknownSnowpackMode && !ignoreAvalancheForDecision) {
    level = 'CAUTION';
    headline = 'Limited avalanche coverage. Favor conservative terrain and explicit abort triggers.';
  } else if (cautions.length > 0) {
    level = 'CAUTION';
    headline = 'Conditions are workable with conservative timing and route choices.';
  }

  return { level, headline, blockers, cautions, checks };
}

export function isAvalancheSummaryText(text: string): boolean {
  return /\bavalanche\b|\bbulletin\b/i.test(String(text || ''));
}

export function summarizeBetterDayWithoutAvalancheText(decision: SummitDecision): string {
  const nonAvalancheBlockers = decision.blockers.filter((line) => !isAvalancheSummaryText(line));
  if (nonAvalancheBlockers.length > 0) {
    return nonAvalancheBlockers[0];
  }

  const nonAvalancheCautions = decision.cautions.filter((line) => !isAvalancheSummaryText(line));
  if (nonAvalancheCautions.length > 0) {
    return nonAvalancheCautions[0];
  }

  if (!isAvalancheSummaryText(decision.headline || '')) {
    return decision.headline;
  }

  return 'Conditions remain mixed; review weather, wind, and timing details for this day.';
}
