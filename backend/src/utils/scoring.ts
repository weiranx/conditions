import { 
  parseIsoTimeToMs, 
  parseIsoTimeToMsWithReference,
  parseClockToMinutes,
  parseIsoClockMinutes
} from './time';
import { 
  computeFeelsLikeF, 
  clampTravelWindowHours,
  normalizeAlertSeverity,
  formatAlertSeverity,
  getHigherSeverity,
  classifyUsAqi,
  createUnavailableAirQualityData,
  createUnavailableRainfallData,
  createUnavailableAlertsData,
  ALERT_SEVERITY_RANK,
  normalizeNwsAlertText,
  normalizeNwsAreaList,
} from './weather';
import { 
  AVALANCHE_UNKNOWN_MESSAGE,
  AVALANCHE_WINTER_MONTHS,
  AVALANCHE_SHOULDER_MONTHS,
  AVALANCHE_MATERIAL_SNOW_DEPTH_IN,
  AVALANCHE_MATERIAL_SWE_IN,
  AVALANCHE_MEASURABLE_SNOW_DEPTH_IN,
  AVALANCHE_MEASURABLE_SWE_IN
} from './avalanche';

export const parseForecastMonth = (dateValue: string | null | undefined): number | null => {
  if (typeof dateValue !== 'string' || !dateValue.trim()) {
    return null;
  }

  const match = dateValue.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const month = parseInt(match[2], 10) - 1;
  return Number.isFinite(month) && month >= 0 && month <= 11 ? month : null;
};

export const parseFiniteNumber = (value: any): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export interface SnowpackSignal {
  hasSignal: boolean;
  hasMaterialSignal?: boolean;
  hasMeasurablePresence?: boolean;
  hasNoSignal: boolean;
  hasObservedPresence: boolean;
  reason: string | null;
}

export const evaluateSnowpackSignal = (snowpackData: any): SnowpackSignal => {
  if (!snowpackData || typeof snowpackData !== 'object') {
    return { hasSignal: false, hasNoSignal: false, hasObservedPresence: false, reason: null };
  }

  const snotel = snowpackData?.snotel || null;
  const nohrsc = snowpackData?.nohrsc || null;
  const snotelDistanceKm = parseFiniteNumber(snotel?.distanceKm);
  const snotelNearObjective = snotelDistanceKm === null || snotelDistanceKm <= 80;

  const depthSamples: number[] = [];
  const sweSamples: number[] = [];

  const snotelDepthIn = parseFiniteNumber(snotel?.snowDepthIn);
  const snotelSweIn = parseFiniteNumber(snotel?.sweIn);
  if (snotelNearObjective && snotelDepthIn !== null) depthSamples.push(snotelDepthIn);
  if (snotelNearObjective && snotelSweIn !== null) sweSamples.push(snotelSweIn);

  const nohrscDepthIn = parseFiniteNumber(nohrsc?.snowDepthIn);
  const nohrscSweIn = parseFiniteNumber(nohrsc?.sweIn);
  if (nohrscDepthIn !== null) depthSamples.push(nohrscDepthIn);
  if (nohrscSweIn !== null) sweSamples.push(nohrscSweIn);

  const hasObservations = depthSamples.length > 0 || sweSamples.length > 0;
  if (!hasObservations) {
    return { hasSignal: false, hasNoSignal: false, hasObservedPresence: false, reason: null };
  }

  const maxDepthIn = depthSamples.length ? Math.max(...depthSamples) : null;
  const maxSweIn = sweSamples.length ? Math.max(...sweSamples) : null;

  const hasMaterialSnowpackSignal =
    (maxDepthIn !== null && maxDepthIn >= AVALANCHE_MATERIAL_SNOW_DEPTH_IN) ||
    (maxSweIn !== null && maxSweIn >= AVALANCHE_MATERIAL_SWE_IN);
  const hasModerateSnowpackPresence =
    (maxDepthIn !== null && maxDepthIn >= AVALANCHE_MEASURABLE_SNOW_DEPTH_IN) ||
    (maxSweIn !== null && maxSweIn >= AVALANCHE_MEASURABLE_SWE_IN);

  const hasLowSnowpackSignal =
    (maxDepthIn !== null && maxDepthIn <= 1) &&
    (maxSweIn === null || maxSweIn <= 0.25);

  if (hasMaterialSnowpackSignal) {
    const parts: string[] = [];
    if (maxDepthIn !== null) parts.push(`depth ~${maxDepthIn.toFixed(1)} in`);
    if (maxSweIn !== null) parts.push(`SWE ~${maxSweIn.toFixed(1)} in`);
    return {
      hasSignal: true,
      hasMaterialSignal: true,
      hasMeasurablePresence: true,
      hasNoSignal: false,
      hasObservedPresence: true,
      reason: `Snowpack Snapshot shows material snowpack (${parts.join(', ')}).`,
    };
  }

  if (hasModerateSnowpackPresence) {
    const parts: string[] = [];
    if (maxDepthIn !== null) parts.push(`depth ~${maxDepthIn.toFixed(1)} in`);
    if (maxSweIn !== null) parts.push(`SWE ~${maxSweIn.toFixed(1)} in`);
    return {
      hasSignal: false,
      hasMaterialSignal: false,
      hasMeasurablePresence: true,
      hasNoSignal: false,
      hasObservedPresence: true,
      reason: `Snowpack Snapshot shows measurable snowpack (${parts.join(', ')}), below material avalanche relevance threshold.`,
    };
  }

  if (hasLowSnowpackSignal) {
    const parts: string[] = [];
    if (maxDepthIn !== null) parts.push(`depth ~${maxDepthIn.toFixed(1)} in`);
    if (maxSweIn !== null) parts.push(`SWE ~${maxSweIn.toFixed(2)} in`);
    return {
      hasSignal: false,
      hasMaterialSignal: false,
      hasMeasurablePresence: false,
      hasNoSignal: true,
      hasObservedPresence: false,
      reason: `Snowpack Snapshot shows very low snow signal (${parts.join(', ')}).`,
    };
  }

  return {
    hasSignal: false,
    hasMaterialSignal: false,
    hasMeasurablePresence: false,
    hasNoSignal: false,
    hasObservedPresence: true,
    reason: 'Snowpack Snapshot is mixed/patchy and below material avalanche threshold; use weather and season context.',
  };
};

interface EvaluateAvalancheRelevanceOptions {
  lat: number | string;
  selectedDate: string | null | undefined;
  weatherData: any;
  avalancheData: any;
  snowpackData: any;
  rainfallData: any;
}

export const evaluateAvalancheRelevance = ({ lat, selectedDate, weatherData, avalancheData, snowpackData, rainfallData }: EvaluateAvalancheRelevanceOptions): { relevant: boolean; reason: string } => {
  if (avalancheData?.coverageStatus === 'expired_for_selected_start') {
    return {
      relevant: true,
      reason: 'Avalanche product expired before the selected start time; shown as stale guidance only.',
    };
  }

  const hasOfficialCoverage = avalancheData?.coverageStatus === 'reported' && avalancheData?.dangerUnknown !== true;
  if (hasOfficialCoverage) {
    return {
      relevant: true,
      reason: 'Official avalanche center forecast covers this objective.',
    };
  }

  const expectedSnowWindowIn = Number(rainfallData?.expected?.snowWindowIn);
  if (Number.isFinite(expectedSnowWindowIn) && expectedSnowWindowIn >= 6) {
    return { relevant: true, reason: 'Significant snow accumulation (≥6 in) expected during the travel window — active loading increases avalanche cycle risk.' };
  }

  const objectiveElevationFt = parseFloat(weatherData?.elevation);
  const tempF = parseFloat(weatherData?.temp);
  const feelsLikeF = parseFloat(weatherData?.feelsLike);
  const precipChance = parseFloat(weatherData?.precipChance);
  const description = String(weatherData?.description || '').toLowerCase();
  const month = parseForecastMonth(selectedDate || weatherData?.forecastDate || '');
  const highLatitude = Math.abs(Number(lat)) >= 42;
  const highElevation = Number.isFinite(objectiveElevationFt) && objectiveElevationFt >= 8500;
  const midElevation = Number.isFinite(objectiveElevationFt) && objectiveElevationFt >= 6500;
  const isWinterWindow = month !== null && (AVALANCHE_WINTER_MONTHS.has(month) || (highElevation && month === 4));
  const isShoulderWindow = month !== null && !isWinterWindow && AVALANCHE_SHOULDER_MONTHS.has(month);
  const seasonUnknown = month === null;
  const snowpackSignal = evaluateSnowpackSignal(snowpackData);

  const hasWintrySignal =
    /snow|sleet|blizzard|ice|freezing|wintry|graupel|flurr|rime/.test(description) ||
    (Number.isFinite(tempF) && tempF <= 34) ||
    (Number.isFinite(feelsLikeF) && feelsLikeF <= 30) ||
    (Number.isFinite(precipChance) && precipChance >= 50 && Number.isFinite(tempF) && tempF <= 38);

  if (hasWintrySignal) {
    return {
      relevant: true,
      reason: 'Forecast includes wintry signals (snow/ice/freezing conditions).',
    };
  }

  if (snowpackSignal.hasMaterialSignal || snowpackSignal.hasSignal) {
    return {
      relevant: true,
      reason: snowpackSignal.reason || 'Snowpack Snapshot indicates meaningful snowpack.',
    };
  }

  if (snowpackSignal.hasMeasurablePresence) {
    if (highElevation && (isWinterWindow || isShoulderWindow || seasonUnknown)) {
      return {
        relevant: true,
        reason: `${snowpackSignal.reason || 'Snowpack Snapshot shows measurable snowpack.'} Elevation/season context keeps avalanche relevance on.`,
      };
    }
    if (midElevation && highLatitude && (isWinterWindow || seasonUnknown)) {
      return {
        relevant: true,
        reason: `${snowpackSignal.reason || 'Snowpack Snapshot shows measurable snowpack.'} Winter latitude/elevation context keeps avalanche relevance on.`,
      };
    }
    return {
      relevant: false,
      reason: `${snowpackSignal.reason || 'Snowpack Snapshot shows measurable snowpack.'} Keep monitoring, but avalanche forecasting is de-emphasized until snowpack reaches material levels or wintry signals increase.`,
    };
  }

  if (snowpackSignal.hasNoSignal && (
    avalancheData?.coverageStatus === 'no_active_forecast' ||
    avalancheData?.coverageStatus === 'no_center_coverage'
  )) {
    return {
      relevant: false,
      reason:
        avalancheData?.coverageStatus === 'no_active_forecast'
          ? `${snowpackSignal.reason || 'Snowpack Snapshot shows low snow signal.'} Local avalanche center is out of forecast season.`
          : `${snowpackSignal.reason || 'Snowpack Snapshot shows low snow signal.'} No local avalanche center coverage for this objective.`,
    };
  }

  if (avalancheData?.coverageStatus === 'no_active_forecast' && !isWinterWindow && !isShoulderWindow) {
    return {
      relevant: false,
      reason: 'Local avalanche center is out of forecast season for this objective/date.',
    };
  }

  if (highElevation && (isWinterWindow || isShoulderWindow || seasonUnknown)) {
    return {
      relevant: true,
      reason: 'High-elevation objective has meaningful seasonal snow potential.',
    };
  }

  if (midElevation && highLatitude && (isWinterWindow || seasonUnknown)) {
    return {
      relevant: true,
      reason: 'Mid-elevation objective in winter window at snow-prone latitude.',
    };
  }

  if (snowpackSignal.hasNoSignal && !isWinterWindow && !isShoulderWindow) {
    return {
      relevant: false,
      reason: snowpackSignal.reason || 'Snowpack Snapshot shows low snow signal for this objective window.',
    };
  }

  return {
    relevant: false,
    reason: 'Objective appears typically low-snow for the selected season and forecast.',
  };
};

interface CalculateSafetyScoreOptions {
  weatherData: any;
  avalancheData: any;
  alertsData: any;
  airQualityData: any;
  fireRiskData: any;
  heatRiskData: any;
  rainfallData: any;
  selectedDate: string | null | undefined;
  solarData: any;
  selectedStartClock: string | null | undefined;
  selectedTravelWindowHours?: number | string | null;
}

export interface SafetyScoreFactor {
  hazard: string;
  impact: number;
  source: string;
  message: string;
  group: string;
}

export interface SafetyScoreResult {
  score: number;
  confidence: number;
  primaryHazard: string;
  explanations: string[];
  factors: SafetyScoreFactor[];
  groupImpacts: Record<string, { raw: number; capped: number; cap: number }>;
  confidenceReasons: string[];
  sourcesUsed: string[];
  airQualityCategory: string;
}

export const calculateSafetyScore = ({
  weatherData,
  avalancheData,
  alertsData,
  airQualityData,
  fireRiskData,
  heatRiskData,
  rainfallData,
  selectedDate,
  solarData,
  selectedStartClock,
  selectedTravelWindowHours = null,
}: CalculateSafetyScoreOptions): SafetyScoreResult => {
  const explanations: string[] = [];
  const factors: SafetyScoreFactor[] = [];
  const groupCaps: Record<string, number> = {
    avalanche: 55,
    weather: 42,
    alerts: 24,
    airQuality: 20,
    fire: 18,
  };

  const mapHazardToGroup = (hazard: string): string => {
    const normalized = String(hazard || '').toLowerCase();
    if (normalized.includes('avalanche')) return 'avalanche';
    if (normalized.includes('alert')) return 'alerts';
    if (normalized.includes('air quality')) return 'airQuality';
    if (normalized.includes('fire')) return 'fire';
    return 'weather';
  };

  const applyFactor = (hazard: string, impact: number, message: string, source: string) => {
    if (!Number.isFinite(impact) || impact <= 0) {
      return;
    }
    factors.push({ hazard, impact, source, message, group: mapHazardToGroup(hazard) });
    explanations.push(message);
  };

  const weatherDescription = String(weatherData?.description || '').toLowerCase();
  const wind = parseFloat(weatherData?.windSpeed);
  const gust = parseFloat(weatherData?.windGust);
  const precipChance = parseFloat(weatherData?.precipChance);
  const humidity = parseFloat(weatherData?.humidity);
  const tempF = parseFloat(weatherData?.temp);
  const feelsLikeF = Number.isFinite(parseFloat(weatherData?.feelsLike)) ? (parseFloat(weatherData?.feelsLike) as number) : tempF;
  const isDaytime = weatherData?.isDaytime;
  const visibilityRiskScoreRaw = Number(weatherData?.visibilityRisk?.score);
  const visibilityRiskScore = Number.isFinite(visibilityRiskScoreRaw) ? visibilityRiskScoreRaw : null;
  const visibilityRiskLevel = String(weatherData?.visibilityRisk?.level || '').trim();
  const visibilityActiveHoursRaw = Number(weatherData?.visibilityRisk?.activeHours);
  const visibilityActiveHours = Number.isFinite(visibilityActiveHoursRaw) ? visibilityActiveHoursRaw : null;

  const normalizedRisk = String(avalancheData?.risk || '').toLowerCase();
  const avalancheRelevant = avalancheData?.relevant !== false;
  const avalancheUnknown = avalancheRelevant
    && Boolean(avalancheData?.dangerUnknown || normalizedRisk.includes('unknown') || normalizedRisk.includes('no forecast'));
  const avalancheDangerLevel = Number(avalancheData?.dangerLevel);
  const avalancheProblemCount = Array.isArray(avalancheData?.problems) ? avalancheData.problems.length : 0;

  const usAqi = Number(airQualityData?.usAqi);
  const airQualityStatus = String(airQualityData?.status || '').toLowerCase();
  const airQualityRelevantForScoring = airQualityStatus !== 'not_applicable_future_date';
  const aqiCategory = String(airQualityData?.category || 'Unknown');

  const trend = Array.isArray(weatherData?.trend) ? weatherData.trend : [];
  const requestedWindowHours = clampTravelWindowHours(selectedTravelWindowHours, 12);
  const effectiveTrendWindowHours = Math.max(1, trend.length || requestedWindowHours);
  const trendTemps = trend.map((item: any) => Number(item?.temp)).filter(Number.isFinite);
  const trendGusts = trend.map((item: any) => Number.isFinite(Number(item?.gust)) ? Number(item.gust) : Number(item?.wind)).filter(Number.isFinite);
  const trendPrecips = trend.map((item: any) => Number(item?.precipChance)).filter(Number.isFinite);
  const trendFeelsLike = trend
    .map((item: any) => {
      const rowTemp = Number(item?.temp);
      const rowWind = Number.isFinite(Number(item?.wind)) ? Number(item.wind) : Number.isFinite(Number(item?.gust)) ? Number(item.gust) : 0;
      if (!Number.isFinite(rowTemp)) return Number.NaN;
      return computeFeelsLikeF(rowTemp, Number.isFinite(rowWind) ? rowWind : 0);
    })
    .filter(Number.isFinite);
  const tempRange = trendTemps.length ? Math.max(...trendTemps) - Math.min(...trendTemps) : 0;
  const trendMinFeelsLike = trendFeelsLike.length ? Math.min(...trendFeelsLike) : (feelsLikeF as number);
  const trendMaxFeelsLike = trendFeelsLike.length ? Math.max(...trendFeelsLike) : (feelsLikeF as number);
  const trendPeakPrecip = trendPrecips.length ? Math.max(...trendPrecips) : precipChance;
  const trendPeakGust = trendGusts.length ? Math.max(...trendGusts) : (Number.isFinite(gust) ? (gust as number) : 0);
  const severeWindHours = trend.filter((item: any) => {
    const rowWind = Number(item?.wind);
    const rowGust = Number.isFinite(Number(item?.gust)) ? Number(item.gust) : rowWind;
    return (Number.isFinite(rowWind) && rowWind >= 30) || (Number.isFinite(rowGust) && rowGust >= 45);
  }).length;
  const strongWindHours = trend.filter((item: any) => {
    const rowWind = Number(item?.wind);
    const rowGust = Number.isFinite(Number(item?.gust)) ? Number(item.gust) : rowWind;
    return (Number.isFinite(rowWind) && rowWind >= 20) || (Number.isFinite(rowGust) && rowGust >= 30);
  }).length;
  const highPrecipHours = trendPrecips.filter((value: number) => value >= 60).length;
  const moderatePrecipHours = trendPrecips.filter((value: number) => value >= 40).length;
  const coldExposureHours = trendFeelsLike.filter((value: number) => value <= 15).length;
  const extremeColdHours = trendFeelsLike.filter((value: number) => value <= 0).length;
  const heatExposureHours = trendFeelsLike.filter((value: number) => value >= 85).length;
  const rainfallTotals = rainfallData?.totals || {};
  const rainfallExpected = rainfallData?.expected || {};
  const rainPast24hIn = Number(rainfallTotals?.rainPast24hIn ?? rainfallTotals?.past24hIn);
  const snowPast24hIn = Number(rainfallTotals?.snowPast24hIn);
  const expectedRainWindowIn = Number(rainfallExpected?.rainWindowIn);
  const expectedSnowWindowIn = Number(rainfallExpected?.snowWindowIn);
  
  const sunriseMinutes = parseClockToMinutes(solarData?.sunrise);
  const selectedStartMinutes = parseClockToMinutes(selectedStartClock) ?? parseIsoClockMinutes(weatherData?.forecastStartTime);
  const isNightBeforeSunrise =
    isDaytime === false
    && Number.isFinite(selectedStartMinutes)
    && Number.isFinite(sunriseMinutes)
    && (selectedStartMinutes as number) < (sunriseMinutes as number);
  const forecastStartMs = parseIsoTimeToMs(weatherData?.forecastStartTime);
  const selectedDateMs =
    typeof selectedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)
      ? Date.parse(`${selectedDate}T00:00:00Z`)
      : null;
  const forecastLeadHoursRaw =
    forecastStartMs !== null
      ? (forecastStartMs - Date.now()) / (1000 * 60 * 60)
      : Number.isFinite(selectedDateMs)
        ? (selectedDateMs as number - Date.now()) / (1000 * 60 * 60)
        : null;
  const forecastLeadHours = Number.isFinite(forecastLeadHoursRaw) ? Number(forecastLeadHoursRaw) : null;
  const alertsRelevantForSelectedTime = forecastLeadHours === null || forecastLeadHours <= 48;

  if (avalancheRelevant) {
    if (avalancheUnknown) {
      applyFactor('Avalanche Uncertainty', 16, AVALANCHE_UNKNOWN_MESSAGE, 'Avalanche center coverage');
    } else if (Number.isFinite(avalancheDangerLevel)) {
      if (avalancheDangerLevel >= 4 || normalizedRisk.includes('high') || normalizedRisk.includes('extreme')) {
        applyFactor('Avalanche', 52, 'High avalanche danger reported. Avoid avalanche terrain and steep loaded slopes.', 'Avalanche center forecast');
      } else if (avalancheDangerLevel === 3 || normalizedRisk.includes('considerable')) {
        applyFactor('Avalanche', 34, 'Considerable avalanche danger. Conservative terrain selection and strict spacing are required.', 'Avalanche center forecast');
      } else if (avalancheDangerLevel === 2 || normalizedRisk.includes('moderate')) {
        applyFactor('Avalanche', 15, 'Moderate avalanche danger. Evaluate snowpack and avoid connected terrain traps.', 'Avalanche center forecast');
      } else if (avalancheDangerLevel === 1) {
        applyFactor('Avalanche', 4, 'Low avalanche danger still requires basic avalanche precautions in suspect terrain.', 'Avalanche center forecast');
      }
    }

    if (avalancheProblemCount >= 3) {
      applyFactor(
        'Avalanche',
        6,
        `${avalancheProblemCount} avalanche problems are listed by the center, increasing snowpack complexity.`,
        'Avalanche problem list',
      );
    }
  }

  const effectiveWind = Math.max(
    Number.isFinite(wind) ? (wind as number) : 0,
    Number.isFinite(gust) ? (gust as number) : 0,
    Number.isFinite(trendPeakGust) ? trendPeakGust : 0,
  );
  if (effectiveWind >= 50 || (Number.isFinite(wind) && (wind as number) >= 35)) {
    applyFactor(
      'Wind',
      20,
      `Severe wind exposure expected (start wind ${Math.round(Number.isFinite(wind) ? (wind as number) : 0)} mph, gust ${Math.round(Number.isFinite(gust) ? (gust as number) : effectiveWind)} mph, trend peak ${Math.round(effectiveWind)} mph).`,
      'NOAA hourly forecast',
    );
  } else if (effectiveWind >= 40 || (Number.isFinite(wind) && (wind as number) >= 25)) {
    applyFactor(
      'Wind',
      12,
      `Strong winds expected (start wind ${Math.round(Number.isFinite(wind) ? (wind as number) : 0)} mph, gust ${Math.round(Number.isFinite(gust) ? (gust as number) : effectiveWind)} mph, trend peak ${Math.round(effectiveWind)} mph).`,
      'NOAA hourly forecast',
    );
  } else if (effectiveWind >= 30 || (Number.isFinite(wind) && (wind as number) >= 18)) {
    applyFactor('Wind', 6, `Moderate wind signal (trend peak ${Math.round(effectiveWind)} mph) may affect exposed movement.`, 'NOAA hourly forecast');
  }

  if (severeWindHours >= 4) {
    applyFactor('Wind', 8, `${severeWindHours}/${trend.length} trend hours are severe wind windows (>=30 mph sustained or >=45 mph gust).`, 'NOAA hourly trend');
  } else if (severeWindHours >= 2) {
    applyFactor('Wind', 5, `${severeWindHours}/${trend.length} trend hours show severe wind windows.`, 'NOAA hourly trend');
  } else if (strongWindHours >= 6) {
    applyFactor('Wind', 4, `${strongWindHours}/${trend.length} trend hours are windy (>=20 mph sustained or >=30 mph gust).`, 'NOAA hourly trend');
  } else if (strongWindHours >= 3) {
    applyFactor('Wind', 2, `${strongWindHours}/${trend.length} trend hours are windy and may reduce margin on exposed terrain.`, 'NOAA hourly trend');
  }

  if (Number.isFinite(trendPeakPrecip) && (trendPeakPrecip as number) >= 80) {
    applyFactor('Storm', 12, `Peak precipitation chance in the window reaches ${Math.round(trendPeakPrecip as number)}%.`, 'NOAA hourly forecast');
  } else if (Number.isFinite(trendPeakPrecip) && (trendPeakPrecip as number) >= 60) {
    applyFactor('Storm', 8, `Peak precipitation chance in the window reaches ${Math.round(trendPeakPrecip as number)}%.`, 'NOAA hourly forecast');
  } else if (Number.isFinite(trendPeakPrecip) && (trendPeakPrecip as number) >= 40) {
    applyFactor('Storm', 4, `Peak precipitation chance in the window reaches ${Math.round(trendPeakPrecip as number)}%.`, 'NOAA hourly forecast');
  }

  if (highPrecipHours >= 4) {
    applyFactor('Storm', 7, `${highPrecipHours}/${trend.length} trend hours are high precip windows (>=60%).`, 'NOAA hourly trend');
  } else if (highPrecipHours >= 2) {
    applyFactor('Storm', 4, `${highPrecipHours}/${trend.length} trend hours are high precip windows.`, 'NOAA hourly trend');
  } else if (moderatePrecipHours >= 6) {
    applyFactor('Storm', 3, `${moderatePrecipHours}/${trend.length} trend hours are moderate precip windows (>=40%).`, 'NOAA hourly trend');
  }

  if (/thunderstorm|lightning|blizzard/.test(weatherDescription)) {
    applyFactor('Storm', 18, `Convective or severe weather signal in forecast: "${weatherData.description}".`, 'NOAA short forecast');
  } else if (/snow|sleet|freezing rain|ice/.test(weatherDescription)) {
    applyFactor('Winter Weather', 10, `Frozen precipitation in forecast ("${weatherData.description}") increases travel hazard.`, 'NOAA short forecast');
  }

  if (visibilityRiskScore !== null) {
    let visibilityImpact = 0;
    if (visibilityRiskScore >= 80) visibilityImpact = 12;
    else if (visibilityRiskScore >= 60) visibilityImpact = 9;
    else if (visibilityRiskScore >= 40) visibilityImpact = 6;
    else if (visibilityRiskScore >= 20) visibilityImpact = 3;
    if (visibilityImpact > 0) {
      const activeHoursNote = visibilityActiveHours !== null && trend.length > 0 ? ` ${Math.round(visibilityActiveHours)}/${trend.length} trend hours show reduced-visibility signal.` : '';
      applyFactor('Visibility', visibilityImpact, `Whiteout/visibility risk is ${visibilityRiskLevel || 'elevated'} (${Math.round(visibilityRiskScore)}/100).${activeHoursNote}`, weatherData?.visibilityRisk?.source || 'Derived weather visibility model');
    }
  } else if (/fog|smoke|haze/.test(weatherDescription)) {
    applyFactor('Visibility', 6, `Reduced-visibility weather in forecast ("${weatherData.description}").`, 'NOAA short forecast');
  }

  if (Number.isFinite(trendMinFeelsLike) && trendMinFeelsLike <= -10) applyFactor('Cold', 15, `Minimum apparent temperature in the window is ${Math.round(trendMinFeelsLike)}F.`, 'NOAA temp + windchill');
  else if (Number.isFinite(trendMinFeelsLike) && trendMinFeelsLike <= 0) applyFactor('Cold', 10, `Very cold apparent temperature in the window (${Math.round(trendMinFeelsLike)}F).`, 'NOAA temp + windchill');
  else if (Number.isFinite(trendMinFeelsLike) && trendMinFeelsLike <= 15) applyFactor('Cold', 6, `Cold apparent temperature in the window (${Math.round(trendMinFeelsLike)}F).`, 'NOAA temp + windchill');
  else if (Number.isFinite(trendMinFeelsLike) && trendMinFeelsLike <= 25) applyFactor('Cold', 3, `Cool apparent temperatures (${Math.round(trendMinFeelsLike)}F) reduce comfort and dexterity margin.`, 'NOAA temp + windchill');

  if (extremeColdHours >= 3) applyFactor('Cold', 6, `${extremeColdHours}/${trend.length} trend hours are at or below 0F apparent temperature.`, 'NOAA hourly trend');
  else if (coldExposureHours >= 5) applyFactor('Cold', 4, `${coldExposureHours}/${trend.length} trend hours are at or below 15F apparent temperature.`, 'NOAA hourly trend');

  const heatRiskLevel = Number(heatRiskData?.level);
  if (Number.isFinite(heatRiskLevel) && heatRiskLevel >= 4) applyFactor('Heat', 14, `Heat risk is ${heatRiskData?.label || 'Extreme'} with significant heat-stress potential in the selected window.`, heatRiskData?.source || 'Heat risk synthesis');
  else if (Number.isFinite(heatRiskLevel) && heatRiskLevel >= 3) applyFactor('Heat', 10, `Heat risk is ${heatRiskData?.label || 'High'} in the selected window.`, heatRiskData?.source || 'Heat risk synthesis');
  else if (Number.isFinite(heatRiskLevel) && heatRiskLevel >= 2) applyFactor('Heat', 6, `Heat risk is ${heatRiskData?.label || 'Elevated'} in the selected window.`, heatRiskData?.source || 'Heat risk synthesis');
  else if (Number.isFinite(heatRiskLevel) && heatRiskLevel >= 1) applyFactor('Heat', 2, `Heat risk is ${heatRiskData?.label || 'Guarded'}; monitor pace and hydration.`, heatRiskData?.source || 'Heat risk synthesis');
  else if (Number.isFinite(trendMaxFeelsLike) && trendMaxFeelsLike >= 90) applyFactor('Heat', 6, `Peak apparent temperature in the window reaches ${Math.round(trendMaxFeelsLike)}F.`, 'NOAA temp + humidity');
  else if (Number.isFinite(trendMaxFeelsLike) && trendMaxFeelsLike >= 82 && heatExposureHours >= 4) applyFactor('Heat', 3, `${heatExposureHours}/${trend.length} trend hours are warm (>=85F apparent).`, 'NOAA hourly trend');

  if (rainfallData?.fallbackMode === 'zeroed_totals') applyFactor('Surface Conditions', 4, 'Precipitation data unavailable (upstream outage) — surface conditions are unknown; treat as potentially hazardous.', rainfallData?.source || 'Open-Meteo precipitation history');
  else if (Number.isFinite(rainPast24hIn) && rainPast24hIn >= 0.75) applyFactor('Surface Conditions', 7, `Recent rainfall is heavy (${rainPast24hIn.toFixed(2)} in in 24h), increasing slick/trail-softening risk.`, rainfallData?.source || 'Open-Meteo precipitation history');
  else if (Number.isFinite(rainPast24hIn) && rainPast24hIn >= 0.3) applyFactor('Surface Conditions', 4, `Recent rainfall (${rainPast24hIn.toFixed(2)} in in 24h) can create slippery or muddy travel.`, rainfallData?.source || 'Open-Meteo precipitation history');

  if (Number.isFinite(snowPast24hIn) && snowPast24hIn >= 6) applyFactor('Surface Conditions', 8, `Recent snowfall is substantial (${snowPast24hIn.toFixed(1)} in in 24h), increasing trail and route uncertainty.`, rainfallData?.source || 'Open-Meteo precipitation history');
  else if (Number.isFinite(snowPast24hIn) && snowPast24hIn >= 2) applyFactor('Surface Conditions', 4, `Recent snowfall (${snowPast24hIn.toFixed(1)} in in 24h) can hide surface hazards and slow travel.`, rainfallData?.source || 'Open-Meteo precipitation history');

  if (Number.isFinite(expectedRainWindowIn) && expectedRainWindowIn >= 0.5) applyFactor('Storm', 6, `Expected rain in selected travel window is ${expectedRainWindowIn.toFixed(2)} in.`, rainfallData?.source || 'Open-Meteo precipitation forecast');
  else if (Number.isFinite(expectedRainWindowIn) && expectedRainWindowIn >= 0.2) applyFactor('Storm', 3, `Expected rain in selected travel window is ${expectedRainWindowIn.toFixed(2)} in.`, rainfallData?.source || 'Open-Meteo precipitation forecast');

  if (Number.isFinite(expectedSnowWindowIn) && expectedSnowWindowIn >= 4) applyFactor('Winter Weather', 7, `Expected snowfall in selected travel window is ${expectedSnowWindowIn.toFixed(1)} in.`, rainfallData?.source || 'Open-Meteo precipitation forecast');
  else if (Number.isFinite(expectedSnowWindowIn) && expectedSnowWindowIn >= 1.5) applyFactor('Winter Weather', 3, `Expected snowfall in selected travel window is ${expectedSnowWindowIn.toFixed(1)} in.`, rainfallData?.source || 'Open-Meteo precipitation forecast');

  if (isDaytime === false && !isNightBeforeSunrise) applyFactor('Darkness', 5, 'Selected forecast period is nighttime, reducing navigation margin and terrain visibility.', 'NOAA isDaytime flag');

  if (Number.isFinite(tempRange) && tempRange >= 18) applyFactor('Weather Volatility', 6, `Large ${effectiveTrendWindowHours}-hour temperature swing (${Math.round(tempRange)}F) suggests unstable conditions.`, 'NOAA hourly trend');
  if (Number.isFinite(trendPeakGust) && trendPeakGust >= 45 && (!Number.isFinite(gust) || (gust as number) < 45)) applyFactor('Wind', 6, `Peak gusts in the next ${effectiveTrendWindowHours} hours reach ${Math.round(trendPeakGust)} mph.`, 'NOAA hourly trend');

  if (forecastLeadHours !== null && forecastLeadHours > 6) {
    let uncertaintyImpact = 2;
    if (forecastLeadHours >= 96) uncertaintyImpact = 10;
    else if (forecastLeadHours >= 72) uncertaintyImpact = 8;
    else if (forecastLeadHours >= 48) uncertaintyImpact = 6;
    else if (forecastLeadHours >= 24) uncertaintyImpact = 4;
    if (!alertsRelevantForSelectedTime) uncertaintyImpact += 2;
    applyFactor('Forecast Uncertainty', Math.min(14, uncertaintyImpact), `Selected start is ${Math.round(forecastLeadHours)}h ahead; confidence is lower because fewer real-time feeds can be projected.`, 'Forecast lead time');
  }

  const alertsCount = Number(alertsData?.activeCount);
  const highestAlertSeverity = normalizeAlertSeverity(alertsData?.highestSeverity);
  const alertEvents = Array.isArray(alertsData?.alerts) && alertsData.alerts.length ? [...new Set(alertsData.alerts.map((alert: any) => alert.event).filter(Boolean))].slice(0, 3) : [];

  if (alertsRelevantForSelectedTime && Number.isFinite(alertsCount) && alertsCount > 0) {
    const listedEvents = alertEvents.length ? ` (${alertEvents.join(', ')})` : '';
    if (highestAlertSeverity === 'extreme') applyFactor('Official Alert', 24, `${alertsCount} active NWS alert(s)${listedEvents} with EXTREME severity.`, 'NOAA/NWS Active Alerts');
    else if (highestAlertSeverity === 'severe') applyFactor('Official Alert', 16, `${alertsCount} active NWS alert(s)${listedEvents} with severe impacts possible.`, 'NOAA/NWS Active Alerts');
    else if (highestAlertSeverity === 'moderate') applyFactor('Official Alert', 10, `${alertsCount} active NWS alert(s)${listedEvents} indicate moderate hazard.`, 'NOAA/NWS Active Alerts');
    else applyFactor('Official Alert', 5, `${alertsCount} active NWS alert(s)${listedEvents} are in effect.`, 'NOAA/NWS Active Alerts');
  }

  if (airQualityRelevantForScoring && Number.isFinite(usAqi)) {
    if (usAqi >= 201) applyFactor('Air Quality', 20, `Air quality is hazardous (US AQI ${Math.round(usAqi)}).`, 'Open-Meteo Air Quality');
    else if (usAqi >= 151) applyFactor('Air Quality', 14, `Air quality is unhealthy (US AQI ${Math.round(usAqi)}).`, 'Open-Meteo Air Quality');
    else if (usAqi >= 101) applyFactor('Air Quality', 8, `Air quality is unhealthy for sensitive groups (US AQI ${Math.round(usAqi)}).`, 'Open-Meteo Air Quality');
    else if (usAqi >= 51) applyFactor('Air Quality', 3, `Air quality is moderate (US AQI ${Math.round(usAqi)}).`, 'Open-Meteo Air Quality');
  }

  const fireLevel = fireRiskData?.level != null ? Number(fireRiskData.level) : null;
  if (fireLevel !== null && Number.isFinite(fireLevel) && fireLevel >= 4) applyFactor('Fire Danger', 16, 'Extreme fire-weather/alert signal for this objective window.', fireRiskData?.source || 'Fire risk synthesis');
  else if (fireLevel !== null && Number.isFinite(fireLevel) && fireLevel >= 3) applyFactor('Fire Danger', 10, 'High fire-weather signal: elevated spread potential or fire-weather alerts.', fireRiskData?.source || 'Fire risk synthesis');
  else if (fireLevel !== null && Number.isFinite(fireLevel) && fireLevel >= 2) applyFactor('Fire Danger', 5, 'Elevated fire risk signal from weather, smoke, or alert context.', fireRiskData?.source || 'Fire risk synthesis');

  const rawGroupImpacts = factors.reduce((acc: Record<string, number>, factor) => {
    const group = factor.group || 'weather';
    acc[group] = (acc[group] || 0) + Number(factor.impact || 0);
    return acc;
  }, {});
  const groupImpacts: Record<string, { raw: number; capped: number; cap: number }> = Object.entries(rawGroupImpacts).reduce((acc: Record<string, any>, [group, rawImpact]) => {
    const cap = Number(groupCaps[group] || 100);
    const raw = Number.isFinite(rawImpact) ? Math.round(rawImpact) : 0;
    const capped = Math.min(raw, cap);
    acc[group] = { raw, capped, cap };
    return acc;
  }, {});
  const totalCappedImpact = Object.values(groupImpacts).reduce((sum, entry) => sum + Number(entry.capped || 0), 0);
  const score = Math.max(0, Math.round(100 - totalCappedImpact));

  let confidence = 100;
  const confidenceReasons: string[] = [];
  const applyConfidencePenalty = (points: number, reason: string) => {
    if (!Number.isFinite(points) || points <= 0) return;
    confidence -= points;
    if (reason) confidenceReasons.push(reason);
  };

  const weatherDataUnavailable = weatherDescription.includes('weather data unavailable');
  if (weatherDataUnavailable) {
    applyFactor('Weather Unavailable', 20, 'All weather data is unavailable — wind, precipitation, and temperature conditions are unknown.', 'System');
    applyConfidencePenalty(30, 'Complete weather data unavailable — do not rely on this report for go/no-go decisions.');
  }

  const nowMs = Date.now();
  const weatherIssuedMs = parseIsoTimeToMs(weatherData?.issuedTime);
  if (!weatherDataUnavailable && weatherIssuedMs === null) applyConfidencePenalty(8, 'Weather issue time unavailable.');
  else if (!weatherDataUnavailable && weatherIssuedMs !== null) {
    const weatherAgeHours = (nowMs - (weatherIssuedMs as number)) / (1000 * 60 * 60);
    if (weatherAgeHours > 18) applyConfidencePenalty(12, `Weather issuance is ${Math.round(weatherAgeHours)}h old.`);
    else if (weatherAgeHours > 10) applyConfidencePenalty(7, `Weather issuance is ${Math.round(weatherAgeHours)}h old.`);
    else if (weatherAgeHours > 6) applyConfidencePenalty(4, `Weather issuance is ${Math.round(weatherAgeHours)}h old.`);
  }

  if (trend.length < 6) applyConfidencePenalty(6, 'Limited hourly trend depth (<6 points).');

  if (avalancheRelevant) {
    if (avalancheUnknown) applyConfidencePenalty(20, 'Avalanche danger is unknown for this objective.');
    else {
      const avalanchePublishedMs = parseIsoTimeToMs(avalancheData?.publishedTime);
      if (avalanchePublishedMs === null) applyConfidencePenalty(8, 'Avalanche bulletin publish time unavailable.');
      else {
        const avalancheAgeHours = (nowMs - (avalanchePublishedMs as number)) / (1000 * 60 * 60);
        if (avalancheAgeHours > 72) applyConfidencePenalty(12, `Avalanche bulletin is ${Math.round(avalancheAgeHours)}h old.`);
        else if (avalancheAgeHours > 48) applyConfidencePenalty(8, `Avalanche bulletin is ${Math.round(avalancheAgeHours)}h old.`);
        else if (avalancheAgeHours > 24) applyConfidencePenalty(4, `Avalanche bulletin is ${Math.round(avalancheAgeHours)}h old.`);
      }
    }
  }

  if (alertsRelevantForSelectedTime && alertsData?.status === 'unavailable') applyConfidencePenalty(8, 'NWS alerts feed unavailable.');
  else if (!alertsRelevantForSelectedTime) applyConfidencePenalty(4, 'NWS alerts are current-state only and not forecast-valid for the selected start time.');
  
  if (airQualityRelevantForScoring && airQualityData?.status === 'unavailable') applyConfidencePenalty(6, 'Air quality feed unavailable.');
  else if (airQualityRelevantForScoring && airQualityData?.status === 'no_data') applyConfidencePenalty(3, 'Air quality point data unavailable.');
  
  const rainfallAnchorMs = parseIsoTimeToMs(rainfallData?.anchorTime);
  if (rainfallData?.status === 'unavailable') applyConfidencePenalty(5, 'Precipitation history feed unavailable.');
  else if (rainfallData?.status === 'no_data') applyConfidencePenalty(3, 'Precipitation history has no usable anchor/sample data.');
  else if (rainfallData?.fallbackMode === 'zeroed_totals') applyConfidencePenalty(8, 'Precipitation totals are fallback estimates due upstream feed outage.');
  else if (rainfallAnchorMs === null) applyConfidencePenalty(3, 'Precipitation anchor time unavailable.');
  else {
    const rainfallAgeHours = (nowMs - (rainfallAnchorMs as number)) / (1000 * 60 * 60);
    if (rainfallAgeHours > 36) applyConfidencePenalty(7, `Precipitation anchor is ${Math.round(rainfallAgeHours)}h old.`);
    else if (rainfallAgeHours > 18) applyConfidencePenalty(4, `Precipitation anchor is ${Math.round(rainfallAgeHours)}h old.`);
    else if (rainfallAgeHours > 10) applyConfidencePenalty(2, `Precipitation anchor is ${Math.round(rainfallAgeHours)}h old.`);
  }
  
  if (forecastLeadHours !== null && forecastLeadHours >= 72) applyConfidencePenalty(8, `Selected start is ${Math.round(forecastLeadHours)}h ahead (lower forecast certainty).`);
  else if (forecastLeadHours !== null && forecastLeadHours >= 48) applyConfidencePenalty(6, `Selected start is ${Math.round(forecastLeadHours)}h ahead (lower forecast certainty).`);
  else if (forecastLeadHours !== null && forecastLeadHours >= 24) applyConfidencePenalty(4, `Selected start is ${Math.round(forecastLeadHours)}h ahead (lower forecast certainty).`);
  
  if (!fireRiskData || fireRiskData.status === 'unavailable') applyConfidencePenalty(3, 'Fire risk synthesis unavailable.');

  confidence = Math.max(20, Math.min(100, Math.round(confidence)));

  const factorsSorted = [...factors].sort((a, b) => b.impact - a.impact);
  const primaryHazard = factorsSorted[0]?.hazard || 'None';
  const sourcesUsed = [
    'NOAA/NWS hourly forecast',
    avalancheRelevant ? 'Avalanche center forecast' : null,
    alertsRelevantForSelectedTime && (alertsData?.status === 'ok' || alertsData?.status === 'none' || alertsData?.status === 'none_for_selected_start') ? 'NOAA/NWS active alerts' : null,
    airQualityRelevantForScoring && (airQualityData?.status === 'ok' || airQualityData?.status === 'no_data') ? 'Open-Meteo air quality' : null,
    (rainfallData?.status === 'ok' || rainfallData?.status === 'partial' || rainfallData?.status === 'no_data') && rainfallData?.fallbackMode !== 'zeroed_totals' ? 'Open-Meteo precipitation history/forecast' : null,
    heatRiskData?.status === 'ok' ? 'Heat risk synthesis (forecast + lower-terrain adjustment)' : null,
    fireRiskData?.status === 'ok' ? 'Fire risk synthesis (NOAA + NWS + AQI)' : null,
  ].filter((s): s is string => s !== null);

  return {
    score,
    confidence,
    primaryHazard,
    explanations: explanations.length > 0 ? explanations : ['Conditions appear stable for the selected plan window.'],
    factors: factorsSorted,
    groupImpacts,
    confidenceReasons,
    sourcesUsed,
    airQualityCategory: aqiCategory,
  };
};
