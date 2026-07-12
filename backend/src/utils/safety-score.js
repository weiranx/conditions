const { parseIsoTimeToMs } = require('./time');
const { computeFeelsLikeF } = require('./weather-normalizers');
const { parseWindMph } = require('./wind');
const { clampTravelWindowHours, parseClockToMinutes, parseIsoClockMinutes } = require('./time');
const { normalizeAlertSeverity } = require('./alerts');

// --- Scoring Config: all thresholds, group scales, tier definitions ---
// scoreVersion is stamped onto every result so logged scores stay comparable
// across threshold changes. Bump it whenever any value in `thresholds`,
// `groupScales`, `maxScore`, or `tiers` changes in a way that shifts outputs.
const SCORING_CONFIG = {
  scoreVersion: '2.5.0',
  maxScore: 100,

  // Group scales intentionally sum to well over maxScore. Avalanche and
  // weather are kept at full strength because either alone can legitimately
  // justify a "don't go" decision, matching real avalanche-forecast judgment
  // — so the pair can saturate the score to 0 without needing any other
  // hazard to pile on. Alerts/airQuality/fire are capped much lower because
  // they're compounding/secondary signals, not solo turn-back reasons on
  // their own — do not "fix" this by shrinking avalanche/weather to make the
  // sum match maxScore.
  groupScales: {
    avalanche: 55,
    weather: 42,
    alerts: 10,
    airQuality: 8,
    fire: 7,
  },

  tiers: [
    { min: 85, label: 'Low', tierClass: 'is-low-risk', color: 'green' },
    { min: 70, label: 'Caution', tierClass: 'is-caution-risk', color: 'teal' },
    { min: 55, label: 'Elevated', tierClass: 'is-elevated-risk', color: 'yellow' },
    { min: 40, label: 'High', tierClass: 'is-high-risk', color: 'orange' },
    { min: -Infinity, label: 'Extreme', tierClass: 'is-extreme-risk', color: 'red' },
  ],

  confidenceTierShift: {
    threshold: 70,
    rate: 0.3,
  },

  // --- Declarative hazard thresholds ---
  // All impact magnitudes and trigger cutoffs live here so the scoring logic
  // reads as data-driven ladders rather than inline magic numbers. Values are
  // intentionally identical to the historical inline constants.
  thresholds: {
    weather: {
      unavailableImpact: 20,
    },
    avalanche: {
      unknown: 16,
      // avalancheUnknown penalty is scaled by snowpack signal when available
      unknownSnowpackBoost: 4, // strong/anomalous snowpack under a closed/unknown center
      unknownSnowpackReduce: 4, // minimal snow present despite unknown coverage
      high: 52,
      considerable: 34,
      moderate: 15,
      low: 4,
      manyProblemsCount: 3,
      manyProblemsImpact: 6,
      // Extra weight for high-consequence, hard-to-predict problem types. Keyed
      // by normalized substring of the avalanche center problem name. The single
      // largest matching weight is applied (not summed) and capped.
      problemTypeWeights: [
        { match: 'deep persistent', impact: 8 },
        { match: 'persistent', impact: 6 },
        { match: 'wet slab', impact: 5 },
        { match: 'glide', impact: 4 },
        { match: 'cornice', impact: 3 },
      ],
      problemTypeCap: 8,
      // Danger rating that differs across elevation bands signals the user must
      // be elevation-aware; adds a small complexity factor.
      elevationBandSpread: 4,
    },
    wind: {
      severeImpact: 20,
      strongImpact: 12,
      moderateImpact: 6,
      severeEffective: 50,
      severeStart: 35,
      strongEffective: 40,
      strongStart: 25,
      moderateEffective: 30,
      moderateStart: 18,
      durSevereHigh: 2.8,
      durSevereLow: 1.5,
      durStrongHigh: 4.0,
      durStrongLow: 2.0,
      durSevereHighImpact: 8,
      durSevereLowImpact: 5,
      durStrongHighImpact: 4,
      durStrongLowImpact: 2,
      gustGuard: 45,
      gustGuardImpact: 6,
    },
    storm: {
      peakHigh: 80,
      peakMid: 60,
      peakLow: 40,
      peakHighImpact: 12,
      peakMidImpact: 8,
      peakLowImpact: 4,
      durHighHours: 2.8,
      durMidHours: 1.5,
      durModHours: 4.0,
      durHighImpact: 7,
      durMidImpact: 4,
      durModImpact: 3,
      convectiveImpact: 18,
      // Convective signal can also come from trend hours, not just description.
      convectiveTrendHours: 2,
      winterImpact: 10,
      expectedRainHigh: 0.5,
      expectedRainLow: 0.2,
      expectedRainHighImpact: 6,
      expectedRainLowImpact: 3,
      expectedSnowHigh: 4,
      expectedSnowLow: 1.5,
      expectedSnowHighImpact: 7,
      expectedSnowLowImpact: 3,
    },
    visibility: [
      { min: 80, impact: 12 },
      { min: 60, impact: 9 },
      { min: 40, impact: 6 },
      { min: 20, impact: 3 },
    ],
    visibilityDescriptionImpact: 6,
    cold: [
      { max: -10, impact: 15 },
      { max: 0, impact: 10 },
      { max: 15, impact: 6 },
      { max: 25, impact: 3 },
    ],
    coldDuration: { extremeWeight: 1.5, coldWeight: 0.8, cap: 12 },
    heat: {
      level4Impact: 14,
      level3Impact: 10,
      level2Impact: 6,
      level1Impact: 2,
      peakFeelsLike: 90,
      peakImpact: 6,
      warmFeelsLike: 82,
      warmDurHours: 4,
      warmImpact: 3,
    },
    surface: {
      rainHeavy: 0.75,
      rainModerate: 0.3,
      rainHeavyImpact: 7,
      rainModerateImpact: 4,
      snowHeavy: 6,
      snowModerate: 2,
      snowHeavyImpact: 8,
      snowModerateImpact: 4,
      dataUnavailableImpact: 4,
      // terrainCondition-driven surface factor (only when input present)
      terrainHighImpact: 5,
      terrainModerateImpact: 2,
    },
    snowpack: {
      // Anomalously deep / above-average snowpack increases route-finding,
      // postholing, lingering-snow, and creek-crossing uncertainty. Only fires
      // when snowpack data is present.
      aboveAveragePercent: 130,
      aboveAverageImpact: 4,
      deepDepthIn: 36,
      deepSweIn: 12,
      deepImpact: 3,
    },
    darknessImpact: 5,
    volatilityRange: 18,
    volatilityImpact: 6,
    alerts: { extreme: 24, severe: 16, moderate: 10, minor: 5 },
    airQuality: [
      { min: 201, impact: 20 },
      { min: 151, impact: 14 },
      { min: 101, impact: 8 },
      { min: 51, impact: 3 },
    ],
    fire: { level4: 16, level3: 10, level2: 5 },
    combinedExposure: { tripleImpact: 10, pairImpact: 5 },
    trajectory: { bothImpact: 7, singleImpact: 4 },
    crossGroup: {
      avalancheWindLoading: 8,
      avalancheStormLoading: 5,
      fireHeatCompound: 4,
      avalancheVisibility: 4,
    },
  },

  messages: {
    avalancheUnknown: "No official avalanche center forecast covers this objective. Avalanche terrain can still be dangerous. Treat conditions as unknown and use conservative terrain choices.",
    stableConditions: 'Conditions appear stable for the selected plan window.',
  },
};

const computeTier = (score, confidence) => {
  const { tiers, confidenceTierShift } = SCORING_CONFIG;
  const shift = Math.max(0, (confidenceTierShift.threshold - Math.min(confidence, confidenceTierShift.threshold)) * confidenceTierShift.rate);
  for (const tier of tiers) {
    if (score >= tier.min + shift) {
      return { tier: tier.label, tierClass: tier.tierClass };
    }
  }
  const last = tiers[tiers.length - 1];
  return { tier: last.label, tierClass: last.tierClass };
};

const diminishingReturn = (raw, scale) => {
  return scale * (1 - Math.exp(-raw / scale));
};

// Shared lookup for the declarative threshold ladders below. 'min' ladders are
// sorted descending and match the first tier where value >= tier.min (e.g.
// visibility, airQuality). 'max' ladders are sorted ascending and match the
// first tier where value <= tier.max (e.g. cold).
const findTier = (value, ladder, mode) => {
  if (mode === 'max') {
    return ladder.find((tier) => value <= tier.max) || null;
  }
  return ladder.find((tier) => value >= tier.min) || null;
};

const calculateSafetyScore = ({
  weatherData,
  avalancheData,
  alertsData,
  airQualityData,
  fireRiskData,
  heatRiskData,
  rainfallData,
  snowpackData,
  terrainConditionData,
  localConditionsData,
  selectedDate,
  solarData,
  selectedStartClock,
  selectedTravelWindowHours = null,
}) => {
  const T = SCORING_CONFIG.thresholds;
  const explanations = [];
  const factors = [];

  const mapHazardToGroup = (hazard) => {
    const normalized = String(hazard || '').toLowerCase();
    if (normalized.includes('avalanche')) return 'avalanche';
    if (normalized.includes('alert')) return 'alerts';
    if (normalized.includes('air quality')) return 'airQuality';
    if (normalized.includes('fire')) return 'fire';
    return 'weather';
  };

  const applyFactor = (hazard, impact, message, source) => {
    if (!Number.isFinite(impact) || impact <= 0) {
      return;
    }
    factors.push({ hazard, impact, source, message, group: mapHazardToGroup(hazard) });
    explanations.push(message);
  };

  const weatherDescription = String(weatherData?.description || '').toLowerCase();
  const weatherDataUnavailable = weatherDescription.includes('weather data unavailable');
  const wind = parseFloat(weatherData?.windSpeed);
  const gust = parseFloat(weatherData?.windGust);
  const precipChance = parseFloat(weatherData?.precipChance);
  const humidity = parseFloat(weatherData?.humidity);
  const tempF = parseFloat(weatherData?.temp);
  const feelsLikeF = Number.isFinite(parseFloat(weatherData?.feelsLike)) ? parseFloat(weatherData?.feelsLike) : tempF;
  const isDaytime = weatherData?.isDaytime;
  const visibilityRiskScoreRaw = Number(weatherData?.visibilityRisk?.score);
  const visibilityRiskScore = Number.isFinite(visibilityRiskScoreRaw) ? visibilityRiskScoreRaw : null;
  const visibilityRiskLevel = String(weatherData?.visibilityRisk?.level || '').trim();
  const visibilityActiveHoursRaw = Number(weatherData?.visibilityRisk?.activeHours);
  const visibilityActiveHours = Number.isFinite(visibilityActiveHoursRaw) ? visibilityActiveHoursRaw : null;
  const radarEchoDetected = localConditionsData?.radar?.echoDetected === true;
  const observedRain24hIn = Number(localConditionsData?.radar?.rain24hIn);
  const streamflowForecast = localConditionsData?.streamflow?.forecast || null;
  const streamPeakFlowCfs = Number(streamflowForecast?.peakFlowCfs);
  const currentStreamflowCfs = Number(localConditionsData?.streamflow?.dischargeCfs);
  const observedStation = localConditionsData?.weatherObservation || null;

  const normalizedRisk = String(avalancheData?.risk || '').toLowerCase();
  const avalancheRelevant = avalancheData?.relevant !== false;
  const avalancheUnknown = avalancheRelevant
    && Boolean(avalancheData?.dangerUnknown || normalizedRisk.includes('unknown') || normalizedRisk.includes('no forecast'));
  const avalancheDangerLevel = Number(avalancheData?.dangerLevel);
  const avalancheProblems = Array.isArray(avalancheData?.problems) ? avalancheData.problems : [];
  const avalancheProblemCount = avalancheProblems.length;

  // Highest-consequence problem-type weight present in the bulletin. Persistent
  // and deep-persistent slabs (and wet slabs / glide / cornices) are far less
  // predictable than loose snow, so they add weight beyond raw danger level.
  const avalancheProblemTypeImpact = avalancheProblems.reduce((max, problem) => {
    const name = String(problem?.name || problem?.problem_description || '').toLowerCase();
    if (!name) return max;
    const matched = T.avalanche.problemTypeWeights.find((w) => name.includes(w.match));
    return matched ? Math.max(max, matched.impact) : max;
  }, 0);

  // Danger that varies across elevation bands means the user must pick terrain
  // by elevation; flag it as added complexity.
  const avalancheBandLevels = avalancheData?.elevations && typeof avalancheData.elevations === 'object'
    ? [avalancheData.elevations.below, avalancheData.elevations.at, avalancheData.elevations.above]
        .map((band) => Number(band?.level))
        .filter((lvl) => Number.isFinite(lvl) && lvl > 0)
    : [];
  const avalancheBandSpread = avalancheBandLevels.length >= 2
    ? Math.max(...avalancheBandLevels) - Math.min(...avalancheBandLevels)
    : 0;

  // Snowpack signal: max observed depth/SWE across stations + seasonal anomaly.
  // Used both as a standalone route-condition factor and to scale the
  // "avalanche unknown" penalty when a center is closed/out of season.
  const snowpackMaxOf = (field) => {
    if (!snowpackData || typeof snowpackData !== 'object') return null;
    const vals = [snowpackData.snotel, snowpackData.nohrsc, snowpackData.cdec]
      .map((src) => Number(src?.[field]))
      .filter(Number.isFinite);
    return vals.length ? Math.max(...vals) : null;
  };
  const snowpackMaxDepthIn = snowpackMaxOf('snowDepthIn');
  const snowpackMaxSweIn = snowpackMaxOf('sweIn');
  const snowpackOverall = snowpackData?.historical?.overall || null;
  const snowpackPercentOfAverage = Number(snowpackOverall?.percentOfAverage);
  const snowpackAboveAverage = snowpackOverall?.status === 'above_average'
    && Number.isFinite(snowpackPercentOfAverage)
    && snowpackPercentOfAverage >= T.snowpack.aboveAveragePercent;
  const snowpackDeep = (Number.isFinite(snowpackMaxDepthIn) && snowpackMaxDepthIn >= T.snowpack.deepDepthIn)
    || (Number.isFinite(snowpackMaxSweIn) && snowpackMaxSweIn >= T.snowpack.deepSweIn);
  const snowpackHasData = snowpackData && typeof snowpackData === 'object'
    && (Number.isFinite(snowpackMaxDepthIn) || Number.isFinite(snowpackMaxSweIn) || Number.isFinite(snowpackPercentOfAverage));
  const snowpackStrongSignal = snowpackAboveAverage || snowpackDeep;
  const snowpackMinimalSignal = snowpackHasData && !snowpackStrongSignal
    && (!Number.isFinite(snowpackMaxDepthIn) || snowpackMaxDepthIn < 6);

  const alertsStatus = String(alertsData?.status || '');
  const alertsCount = Number(alertsData?.activeCount);
  const highestAlertSeverity = normalizeAlertSeverity(alertsData?.highestSeverity);
  const alertEvents =
    Array.isArray(alertsData?.alerts) && alertsData.alerts.length
      ? [...new Set(alertsData.alerts.map((alert) => alert.event).filter(Boolean))].slice(0, 3)
      : [];

  const usAqi = Number(airQualityData?.usAqi);
  const airQualityStatus = String(airQualityData?.status || '').toLowerCase();
  const airQualityRelevantForScoring = airQualityStatus !== 'not_applicable_future_date';
  const aqiCategory = String(airQualityData?.category || 'Unknown');

  const trend = Array.isArray(weatherData?.trend) ? weatherData.trend : [];
  const requestedWindowHours = clampTravelWindowHours(selectedTravelWindowHours, 12);
  const effectiveTrendWindowHours = Math.max(1, trend.length || requestedWindowHours);
  const trendTemps = trend.map((item) => Number(item?.temp)).filter(Number.isFinite);
  const trendGusts = trend.map((item) => Number(item?.gust)).filter(Number.isFinite);
  const trendPrecips = trend.map((item) => Number(item?.precipChance)).filter(Number.isFinite);
  const trendFeelsLike = trend
    .map((item) => {
      const rowTemp = Number(item?.temp);
      const rowWind = Number.isFinite(Number(item?.wind)) ? Number(item.wind) : 0;
      if (!Number.isFinite(rowTemp)) return Number.NaN;
      return computeFeelsLikeF(rowTemp, Number.isFinite(rowWind) ? rowWind : 0);
    })
    .filter(Number.isFinite);
  const tempRange = trendTemps.length ? Math.max(...trendTemps) - Math.min(...trendTemps) : 0;
  const trendMinFeelsLike = trendFeelsLike.length ? Math.min(...trendFeelsLike) : feelsLikeF;
  const trendMaxFeelsLike = trendFeelsLike.length ? Math.max(...trendFeelsLike) : feelsLikeF;
  const trendPeakPrecip = trendPrecips.length ? Math.max(...trendPrecips) : precipChance;
  const trendPeakGust = trendGusts.length ? Math.max(...trendGusts) : Number.isFinite(gust) ? gust : 0;
  const severeWindHours = trend.filter((item) => {
    const rowWind = Number(item?.wind);
    const rowGust = Number.isFinite(Number(item?.gust)) ? Number(item.gust) : rowWind;
    return (Number.isFinite(rowWind) && rowWind >= 30) || (Number.isFinite(rowGust) && rowGust >= 45);
  }).length;
  const strongWindHours = trend.filter((item) => {
    const rowWind = Number(item?.wind);
    const rowGust = Number.isFinite(Number(item?.gust)) ? Number(item.gust) : rowWind;
    return (Number.isFinite(rowWind) && rowWind >= 20) || (Number.isFinite(rowGust) && rowGust >= 30);
  }).length;
  const highPrecipHours = trendPrecips.filter((value) => value >= 60).length;
  const moderatePrecipHours = trendPrecips.filter((value) => value >= 40).length;
  const coldExposureHours = trendFeelsLike.filter((value) => value <= 15).length;
  const extremeColdHours = trendFeelsLike.filter((value) => value <= 0).length;
  const heatExposureHours = trendFeelsLike.filter((value) => value >= 85).length;
  // Convective signal from per-hour conditions, not just the summary description.
  const convectiveTrendHours = trend.filter((item) =>
    /thunder|lightning|t-storm|tstm/i.test(String(item?.condition || ''))).length;

  // Temporal weighting: early-window hazards penalize more than late-window
  const trendLen = trend.length;
  const temporalWeight = (i) => {
    if (trendLen <= 1) return 1.0;
    return 1.0 - 0.7 * (i / (trendLen - 1));
  };
  let weightedSevereWindHours = 0;
  let weightedStrongWindHours = 0;
  let weightedHighPrecipHours = 0;
  let weightedModeratePrecipHours = 0;
  let weightedTrendPeakGust = 0;
  let weightedColdExposureHours = 0;
  let weightedExtremeColdHours = 0;
  let weightedHeatExposureHours = 0;
  trend.forEach((item, i) => {
    const w = temporalWeight(i);
    const rowWind = Number(item?.wind);
    const rowGust = Number.isFinite(Number(item?.gust)) ? Number(item.gust) : rowWind;
    if ((Number.isFinite(rowWind) && rowWind >= 30) || (Number.isFinite(rowGust) && rowGust >= 45)) {
      weightedSevereWindHours += w;
    }
    if ((Number.isFinite(rowWind) && rowWind >= 20) || (Number.isFinite(rowGust) && rowGust >= 30)) {
      weightedStrongWindHours += w;
    }
    if (Number.isFinite(rowGust)) {
      weightedTrendPeakGust = Math.max(weightedTrendPeakGust, rowGust);
    }
    const rowPrecip = Number(item?.precipChance);
    if (Number.isFinite(rowPrecip) && rowPrecip >= 60) {
      weightedHighPrecipHours += w;
    }
    if (Number.isFinite(rowPrecip) && rowPrecip >= 40) {
      weightedModeratePrecipHours += w;
    }
    // Temporal weighting for cold/heat exposure
    const rowTemp = Number(item?.temp);
    const rowWindForFeels = Number.isFinite(rowWind) ? rowWind : 0;
    if (Number.isFinite(rowTemp)) {
      const fl = computeFeelsLikeF(rowTemp, rowWindForFeels);
      if (Number.isFinite(fl)) {
        if (fl <= 0) weightedExtremeColdHours += w;
        if (fl <= 15) weightedColdExposureHours += w;
        if (fl >= 85) weightedHeatExposureHours += w;
      }
    }
  });

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
    && selectedStartMinutes < sunriseMinutes;
  const forecastStartMs = parseIsoTimeToMs(weatherData?.forecastStartTime);
  const selectedDateMs =
    typeof selectedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)
      ? Date.parse(`${selectedDate}T12:00:00Z`)
      : null;
  const forecastLeadHoursRaw =
    forecastStartMs !== null
      ? (forecastStartMs - Date.now()) / (1000 * 60 * 60)
      : Number.isFinite(selectedDateMs)
        ? (selectedDateMs - Date.now()) / (1000 * 60 * 60)
        : null;
  const forecastLeadHours = Number.isFinite(forecastLeadHoursRaw) ? Number(forecastLeadHoursRaw) : null;
  const alertsRelevantForSelectedTime = forecastLeadHours === null || forecastLeadHours <= 48;

  if (avalancheRelevant) {
    if (avalancheUnknown) {
      // Scale the unknown-coverage penalty by snowpack: a closed/out-of-season
      // center over a deep or above-average snowpack warrants more weight than
      // one over a thin or negligible snowpack.
      let unknownImpact = T.avalanche.unknown;
      let unknownMessage = SCORING_CONFIG.messages.avalancheUnknown;
      if (snowpackStrongSignal) {
        unknownImpact += T.avalanche.unknownSnowpackBoost;
        unknownMessage += snowpackAboveAverage
          ? ` Snowpack is running above seasonal average (${Math.round(snowpackPercentOfAverage)}%), so treat slopes with added caution.`
          : ' A deep snowpack is present despite no active forecast.';
      } else if (snowpackMinimalSignal) {
        unknownImpact = Math.max(0, unknownImpact - T.avalanche.unknownSnowpackReduce);
        unknownMessage += ' Observed snowpack is minimal, but verify conditions directly.';
      }
      applyFactor('Avalanche Uncertainty', unknownImpact, unknownMessage, 'Avalanche center coverage');
    } else if (Number.isFinite(avalancheDangerLevel)) {
      if (avalancheDangerLevel >= 4 || normalizedRisk.includes('high') || normalizedRisk.includes('extreme')) {
        applyFactor('Avalanche', T.avalanche.high, 'High avalanche danger reported. Avoid avalanche terrain and steep loaded slopes.', 'Avalanche center forecast');
      } else if (avalancheDangerLevel === 3 || normalizedRisk.includes('considerable')) {
        applyFactor('Avalanche', T.avalanche.considerable, 'Considerable avalanche danger. Conservative terrain selection and strict spacing are required.', 'Avalanche center forecast');
      } else if (avalancheDangerLevel === 2 || normalizedRisk.includes('moderate')) {
        applyFactor('Avalanche', T.avalanche.moderate, 'Moderate avalanche danger. Evaluate snowpack and avoid connected terrain traps.', 'Avalanche center forecast');
      } else if (avalancheDangerLevel === 1) {
        applyFactor('Avalanche', T.avalanche.low, 'Low avalanche danger still requires basic avalanche precautions in suspect terrain.', 'Avalanche center forecast');
      }
    }

    if (avalancheProblemCount >= T.avalanche.manyProblemsCount) {
      applyFactor(
        'Avalanche',
        T.avalanche.manyProblemsImpact,
        `${avalancheProblemCount} avalanche problems are listed by the center, increasing snowpack complexity.`,
        'Avalanche problem list',
      );
    }

    // High-consequence problem type (persistent/deep/wet slab/glide/cornice).
    if (!avalancheUnknown && avalancheProblemTypeImpact > 0) {
      const dominantType = avalancheProblems
        .map((p) => String(p?.name || p?.problem_description || ''))
        .find((name) => T.avalanche.problemTypeWeights.some((w) => name.toLowerCase().includes(w.match)));
      applyFactor(
        'Avalanche Problem Type',
        Math.min(avalancheProblemTypeImpact, T.avalanche.problemTypeCap),
        `${dominantType || 'A persistent/slab'} problem is listed — these are harder to predict and can produce large, unsurvivable avalanches.`,
        'Avalanche problem list',
      );
    }

    // Danger differs across elevation bands → elevation-aware terrain choice.
    if (!avalancheUnknown && avalancheBandSpread >= 2) {
      applyFactor(
        'Avalanche Elevation Spread',
        T.avalanche.elevationBandSpread,
        'Avalanche danger varies by elevation band — match terrain choices to the elevations you will actually travel.',
        'Avalanche center forecast',
      );
    }
  }

  const effectiveWind = Math.max(
    Number.isFinite(wind) ? wind : 0,
    Number.isFinite(gust) ? gust : 0,
    weightedTrendPeakGust,
  );
  if (effectiveWind >= T.wind.severeEffective || (Number.isFinite(wind) && wind >= T.wind.severeStart)) {
    applyFactor(
      'Wind',
      T.wind.severeImpact,
      `Severe wind exposure expected (start wind ${Math.round(Number.isFinite(wind) ? wind : 0)} mph, gust ${Math.round(Number.isFinite(gust) ? gust : effectiveWind)} mph, trend peak ${Math.round(effectiveWind)} mph).`,
      'NOAA hourly forecast',
    );
  } else if (effectiveWind >= T.wind.strongEffective || (Number.isFinite(wind) && wind >= T.wind.strongStart)) {
    applyFactor(
      'Wind',
      T.wind.strongImpact,
      `Strong winds expected (start wind ${Math.round(Number.isFinite(wind) ? wind : 0)} mph, gust ${Math.round(Number.isFinite(gust) ? gust : effectiveWind)} mph, trend peak ${Math.round(effectiveWind)} mph).`,
      'NOAA hourly forecast',
    );
  } else if (effectiveWind >= T.wind.moderateEffective || (Number.isFinite(wind) && wind >= T.wind.moderateStart)) {
    applyFactor('Wind', T.wind.moderateImpact, `Moderate wind signal (trend peak ${Math.round(effectiveWind)} mph) may affect exposed movement.`, 'NOAA hourly forecast');
  }

  if (weightedSevereWindHours >= T.wind.durSevereHigh) {
    applyFactor('Wind', T.wind.durSevereHighImpact, `${severeWindHours}/${trend.length} trend hours are severe wind windows (>=30 mph sustained or >=45 mph gust).`, 'NOAA hourly trend');
  } else if (weightedSevereWindHours >= T.wind.durSevereLow) {
    applyFactor('Wind', T.wind.durSevereLowImpact, `${severeWindHours}/${trend.length} trend hours show severe wind windows.`, 'NOAA hourly trend');
  } else if (weightedStrongWindHours >= T.wind.durStrongHigh) {
    applyFactor('Wind', T.wind.durStrongHighImpact, `${strongWindHours}/${trend.length} trend hours are windy (>=20 mph sustained or >=30 mph gust).`, 'NOAA hourly trend');
  } else if (weightedStrongWindHours >= T.wind.durStrongLow) {
    applyFactor('Wind', T.wind.durStrongLowImpact, `${strongWindHours}/${trend.length} trend hours are windy and may reduce margin on exposed terrain.`, 'NOAA hourly trend');
  }

  if (Number.isFinite(trendPeakPrecip) && trendPeakPrecip >= T.storm.peakHigh) {
    applyFactor('Storm', T.storm.peakHighImpact, `Peak precipitation chance in the window reaches ${Math.round(trendPeakPrecip)}%.`, 'NOAA hourly forecast');
  } else if (Number.isFinite(trendPeakPrecip) && trendPeakPrecip >= T.storm.peakMid) {
    applyFactor('Storm', T.storm.peakMidImpact, `Peak precipitation chance in the window reaches ${Math.round(trendPeakPrecip)}%.`, 'NOAA hourly forecast');
  } else if (Number.isFinite(trendPeakPrecip) && trendPeakPrecip >= T.storm.peakLow) {
    applyFactor('Storm', T.storm.peakLowImpact, `Peak precipitation chance in the window reaches ${Math.round(trendPeakPrecip)}%.`, 'NOAA hourly forecast');
  }

  if (weightedHighPrecipHours >= T.storm.durHighHours) {
    applyFactor('Storm', T.storm.durHighImpact, `${highPrecipHours}/${trend.length} trend hours are high precip windows (>=60%).`, 'NOAA hourly trend');
  } else if (weightedHighPrecipHours >= T.storm.durMidHours) {
    applyFactor('Storm', T.storm.durMidImpact, `${highPrecipHours}/${trend.length} trend hours are high precip windows.`, 'NOAA hourly trend');
  } else if (weightedModeratePrecipHours >= T.storm.durModHours) {
    applyFactor('Storm', T.storm.durModImpact, `${moderatePrecipHours}/${trend.length} trend hours are moderate precip windows (>=40%).`, 'NOAA hourly trend');
  }

  // Convective signal: fire on either the summary description or multiple
  // trend hours flagged thunder/lightning (structured per-hour conditions).
  const convectiveFromDescription = /thunderstorm|lightning|blizzard/.test(weatherDescription);
  const convectiveFromTrend = convectiveTrendHours >= T.storm.convectiveTrendHours;
  if (convectiveFromDescription || convectiveFromTrend) {
    const detail = convectiveFromDescription
      ? `Convective or severe weather signal in forecast: "${weatherData.description}".`
      : `Convective signal across ${convectiveTrendHours}/${trend.length} trend hours (thunder/lightning).`;
    applyFactor('Storm', T.storm.convectiveImpact, detail, convectiveFromDescription ? 'NOAA short forecast' : 'NOAA hourly trend');
  } else if (/snow|sleet|freezing rain|ice/.test(weatherDescription)) {
    applyFactor('Winter Weather', T.storm.winterImpact, `Frozen precipitation in forecast ("${weatherData.description}") increases travel hazard.`, 'NOAA short forecast');
  }

  if (radarEchoDetected && (convectiveFromDescription || convectiveFromTrend)) {
    applyFactor('Storm', 4, 'NOAA MRMS radar currently detects precipitation at the objective, confirming the forecast convective/storm signal.', localConditionsData?.radar?.source || 'NOAA MRMS radar');
  }

  if (visibilityRiskScore !== null) {
    const visibilityTier = findTier(visibilityRiskScore, T.visibility, 'min');
    const visibilityImpact = visibilityTier ? visibilityTier.impact : 0;
    if (visibilityImpact > 0) {
      const activeHoursNote =
        visibilityActiveHours !== null && trend.length > 0
          ? ` ${Math.round(visibilityActiveHours)}/${trend.length} trend hours show reduced-visibility signal.`
          : '';
      applyFactor(
        'Visibility',
        visibilityImpact,
        `Whiteout/visibility risk is ${visibilityRiskLevel || 'elevated'} (${Math.round(visibilityRiskScore)}/100).${activeHoursNote}`,
        weatherData?.visibilityRisk?.source || 'Derived weather visibility model',
      );
    }
  } else if (/fog|smoke|haze/.test(weatherDescription)) {
    applyFactor('Visibility', T.visibilityDescriptionImpact, `Reduced-visibility weather in forecast ("${weatherData.description}").`, 'NOAA short forecast');
  }

  if (Number.isFinite(trendMinFeelsLike)) {
    const coldTier = findTier(trendMinFeelsLike, T.cold, 'max');
    if (coldTier === T.cold[0]) {
      applyFactor('Cold', coldTier.impact, `Minimum apparent temperature in the window is ${Math.round(trendMinFeelsLike)}F.`, 'NOAA temp + windchill');
    } else if (coldTier === T.cold[1]) {
      applyFactor('Cold', coldTier.impact, `Very cold apparent temperature in the window (${Math.round(trendMinFeelsLike)}F).`, 'NOAA temp + windchill');
    } else if (coldTier === T.cold[2]) {
      applyFactor('Cold', coldTier.impact, `Cold apparent temperature in the window (${Math.round(trendMinFeelsLike)}F).`, 'NOAA temp + windchill');
    } else if (coldTier === T.cold[3]) {
      applyFactor('Cold', coldTier.impact, `Cool apparent temperatures (${Math.round(trendMinFeelsLike)}F) reduce comfort and dexterity margin.`, 'NOAA temp + windchill');
    }
  }

  // Use temporally-weighted cold duration values
  const weightedColdOnlyHours = weightedColdExposureHours - weightedExtremeColdHours;
  const coldDurationImpact = Math.min(
    T.coldDuration.cap,
    Math.round(weightedExtremeColdHours * T.coldDuration.extremeWeight + weightedColdOnlyHours * T.coldDuration.coldWeight),
  );
  if (coldDurationImpact > 0) {
    const coldLabel = extremeColdHours > 0
      ? `${extremeColdHours}/${trend.length} trend hours are at or below 0F and ${coldExposureHours - extremeColdHours} additional hours are below 15F apparent temperature.`
      : `${coldExposureHours}/${trend.length} trend hours are at or below 15F apparent temperature.`;
    applyFactor('Cold', coldDurationImpact, coldLabel, 'NOAA hourly trend');
  }

  const heatRiskLevel = Number(heatRiskData?.level);
  if (Number.isFinite(heatRiskLevel) && heatRiskLevel >= 4) {
    applyFactor('Heat', T.heat.level4Impact, `Heat risk is ${heatRiskData?.label || 'Extreme'} with significant heat-stress potential in the selected window.`, heatRiskData?.source || 'Heat risk synthesis');
  } else if (Number.isFinite(heatRiskLevel) && heatRiskLevel >= 3) {
    applyFactor('Heat', T.heat.level3Impact, `Heat risk is ${heatRiskData?.label || 'High'} in the selected window.`, heatRiskData?.source || 'Heat risk synthesis');
  } else if (Number.isFinite(heatRiskLevel) && heatRiskLevel >= 2) {
    applyFactor('Heat', T.heat.level2Impact, `Heat risk is ${heatRiskData?.label || 'Elevated'} in the selected window.`, heatRiskData?.source || 'Heat risk synthesis');
  } else if (Number.isFinite(heatRiskLevel) && heatRiskLevel >= 1) {
    applyFactor('Heat', T.heat.level1Impact, `Heat risk is ${heatRiskData?.label || 'Caution'}; monitor pace and hydration.`, heatRiskData?.source || 'Heat risk synthesis');
  } else if (Number.isFinite(trendMaxFeelsLike) && trendMaxFeelsLike >= T.heat.peakFeelsLike) {
    applyFactor('Heat', T.heat.peakImpact, `Peak apparent temperature in the window reaches ${Math.round(trendMaxFeelsLike)}F.`, 'NOAA temp + humidity');
  } else if (Number.isFinite(trendMaxFeelsLike) && trendMaxFeelsLike >= T.heat.warmFeelsLike && weightedHeatExposureHours >= T.heat.warmDurHours) {
    applyFactor('Heat', T.heat.warmImpact, `${heatExposureHours}/${trend.length} trend hours are warm (>=85F apparent).`, 'NOAA hourly trend');
  }

  if (rainfallData?.fallbackMode === 'zeroed_totals') {
    applyFactor('Surface Conditions', T.surface.dataUnavailableImpact, 'Precipitation data unavailable (upstream outage) — surface conditions are unknown; treat as potentially hazardous.', rainfallData?.source || 'Open-Meteo precipitation history');
  } else if (Number.isFinite(rainPast24hIn) && rainPast24hIn >= T.surface.rainHeavy) {
    applyFactor('Surface Conditions', T.surface.rainHeavyImpact, `Recent rainfall is heavy (${rainPast24hIn.toFixed(2)} in in 24h), increasing slick/trail-softening risk.`, rainfallData?.source || 'Open-Meteo precipitation history');
  } else if (Number.isFinite(rainPast24hIn) && rainPast24hIn >= T.surface.rainModerate) {
    applyFactor('Surface Conditions', T.surface.rainModerateImpact, `Recent rainfall (${rainPast24hIn.toFixed(2)} in in 24h) can create slippery or muddy travel.`, rainfallData?.source || 'Open-Meteo precipitation history');
  }

  if (Number.isFinite(observedRain24hIn) && observedRain24hIn >= T.surface.rainHeavy) {
    applyFactor('Surface Conditions', 3, `NWS RFC radar/gauge analysis observed ${observedRain24hIn.toFixed(2)} in of rain in the last 24h.`, localConditionsData?.radar?.source || 'NWS RFC QPE');
  }

  if (
    Number.isFinite(streamPeakFlowCfs)
    && Number.isFinite(currentStreamflowCfs)
    && currentStreamflowCfs > 0
    && streamPeakFlowCfs >= currentStreamflowCfs * 1.5
  ) {
    applyFactor('Stream Crossing', 4, `Nearby gauge flow is forecast to rise from about ${Math.round(currentStreamflowCfs)} to ${Math.round(streamPeakFlowCfs)} cfs. Verify that this gauge represents the route-crossed drainage.`, streamflowForecast?.source || 'NOAA NWPS');
  }

  if (Number.isFinite(snowPast24hIn) && snowPast24hIn >= T.surface.snowHeavy) {
    applyFactor('Surface Conditions', T.surface.snowHeavyImpact, `Recent snowfall is substantial (${snowPast24hIn.toFixed(1)} in in 24h), increasing trail and route uncertainty.`, rainfallData?.source || 'Open-Meteo precipitation history');
  } else if (Number.isFinite(snowPast24hIn) && snowPast24hIn >= T.surface.snowModerate) {
    applyFactor('Surface Conditions', T.surface.snowModerateImpact, `Recent snowfall (${snowPast24hIn.toFixed(1)} in in 24h) can hide surface hazards and slow travel.`, rainfallData?.source || 'Open-Meteo precipitation history');
  }

  // Terrain-condition synthesis (snow/wet/icy surface). Only fires when the
  // input is present and confidence is not low. Captured here as a surface
  // factor; diminishing returns within the weather group prevent double-count
  // with the rainfall factors above.
  const terrainImpactLevel = String(terrainConditionData?.impact || '').toLowerCase();
  const terrainConfidence = String(terrainConditionData?.confidence || '').toLowerCase();
  if (terrainConditionData && typeof terrainConditionData === 'object' && terrainConfidence !== 'low') {
    if (terrainImpactLevel === 'high') {
      applyFactor('Surface Conditions', T.surface.terrainHighImpact, `Trail surface is hazardous (${terrainConditionData.label || 'high-impact surface'}). ${terrainConditionData.recommendedTravel || ''}`.trim(), terrainConditionData.source || 'Terrain condition synthesis');
    } else if (terrainImpactLevel === 'moderate') {
      applyFactor('Surface Conditions', T.surface.terrainModerateImpact, `Trail surface is variable (${terrainConditionData.label || 'moderate-impact surface'}).`, terrainConditionData.source || 'Terrain condition synthesis');
    }
  }

  // Snowpack anomaly: deep / above-average snowpack raises route-finding,
  // postholing, lingering-snow, and creek-crossing uncertainty.
  if (snowpackHasData && snowpackStrongSignal) {
    if (snowpackAboveAverage) {
      applyFactor('Snowpack', T.snowpack.aboveAverageImpact, `Snowpack is running above seasonal average (${Math.round(snowpackPercentOfAverage)}% of normal), increasing lingering-snow, postholing, and creek-crossing uncertainty.`, snowpackData?.source || 'Snowpack synthesis');
    } else if (snowpackDeep) {
      const depthNote = Number.isFinite(snowpackMaxDepthIn) ? `${Math.round(snowpackMaxDepthIn)} in depth` : `${Math.round(snowpackMaxSweIn)} in SWE`;
      applyFactor('Snowpack', T.snowpack.deepImpact, `Deep snowpack present (${depthNote}), increasing route-finding and travel difficulty.`, snowpackData?.source || 'Snowpack synthesis');
    }
  }

  if (Number.isFinite(expectedRainWindowIn) && expectedRainWindowIn >= T.storm.expectedRainHigh) {
    applyFactor('Storm', T.storm.expectedRainHighImpact, `Expected rain in selected travel window is ${expectedRainWindowIn.toFixed(2)} in.`, rainfallData?.source || 'Open-Meteo precipitation forecast');
  } else if (Number.isFinite(expectedRainWindowIn) && expectedRainWindowIn >= T.storm.expectedRainLow) {
    applyFactor('Storm', T.storm.expectedRainLowImpact, `Expected rain in selected travel window is ${expectedRainWindowIn.toFixed(2)} in.`, rainfallData?.source || 'Open-Meteo precipitation forecast');
  }

  if (Number.isFinite(expectedSnowWindowIn) && expectedSnowWindowIn >= T.storm.expectedSnowHigh) {
    applyFactor('Winter Weather', T.storm.expectedSnowHighImpact, `Expected snowfall in selected travel window is ${expectedSnowWindowIn.toFixed(1)} in.`, rainfallData?.source || 'Open-Meteo precipitation forecast');
  } else if (Number.isFinite(expectedSnowWindowIn) && expectedSnowWindowIn >= T.storm.expectedSnowLow) {
    applyFactor('Winter Weather', T.storm.expectedSnowLowImpact, `Expected snowfall in selected travel window is ${expectedSnowWindowIn.toFixed(1)} in.`, rainfallData?.source || 'Open-Meteo precipitation forecast');
  }

  if (isDaytime === false && !isNightBeforeSunrise) {
    applyFactor('Darkness', T.darknessImpact, 'Selected forecast period is nighttime, reducing navigation margin and terrain visibility.', 'NOAA isDaytime flag');
  }

  if (Number.isFinite(tempRange) && tempRange >= T.volatilityRange) {
    applyFactor(
      'Weather Volatility',
      T.volatilityImpact,
      `Large ${effectiveTrendWindowHours}-hour temperature swing (${Math.round(tempRange)}F) suggests unstable conditions.`,
      'NOAA hourly trend',
    );
  }
  if (Number.isFinite(trendPeakGust) && trendPeakGust >= T.wind.gustGuard && (!Number.isFinite(gust) || gust < T.wind.gustGuard)) {
    applyFactor('Wind', T.wind.gustGuardImpact, `Peak gusts in the next ${effectiveTrendWindowHours} hours reach ${Math.round(trendPeakGust)} mph.`, 'NOAA hourly trend');
  }

  // Combined hazard escalation: co-occurring weather hazards compound risk
  const weatherCats = {
    wind: factors.some((f) => f.group === 'weather' && /^wind$/i.test(f.hazard)),
    coldHeat: factors.some((f) => f.group === 'weather' && /^(cold|heat)$/i.test(f.hazard)),
    precipStorm: factors.some((f) => f.group === 'weather' && /^(storm|winter weather)$/i.test(f.hazard)),
    visibility: factors.some((f) => f.group === 'weather' && /^visibility$/i.test(f.hazard)),
  };
  const activeWeatherCategories = Object.values(weatherCats).filter(Boolean).length;
  if (activeWeatherCategories >= 3) {
    applyFactor('Combined Exposure', T.combinedExposure.tripleImpact, `${activeWeatherCategories} weather hazard categories are active simultaneously, compounding exposure risk.`, 'Safety score synthesis');
  } else if (activeWeatherCategories >= 2) {
    const hasDangerousPair =
      (weatherCats.wind && weatherCats.coldHeat) ||
      (weatherCats.wind && weatherCats.precipStorm) ||
      (weatherCats.coldHeat && weatherCats.precipStorm);
    if (hasDangerousPair) {
      applyFactor('Combined Exposure', T.combinedExposure.pairImpact, 'Co-occurring weather hazards increase exposure risk.', 'Safety score synthesis');
    }
  }

  // Condition trajectory: deteriorating conditions are riskier than improving
  if (trend.length >= 4) {
    const halfLen = Math.floor(trend.length / 2);
    const firstHalfGusts = trend.slice(0, halfLen).map((item) => {
      const g = Number.isFinite(Number(item?.gust)) ? Number(item.gust) : Number(item?.wind);
      return Number.isFinite(g) ? g : 0;
    });
    const secondHalfGusts = trend.slice(halfLen).map((item) => {
      const g = Number.isFinite(Number(item?.gust)) ? Number(item.gust) : Number(item?.wind);
      return Number.isFinite(g) ? g : 0;
    });
    const firstHalfPrecips = trend.slice(0, halfLen).map((item) => {
      const p = Number(item?.precipChance);
      return Number.isFinite(p) ? p : 0;
    });
    const secondHalfPrecips = trend.slice(halfLen).map((item) => {
      const p = Number(item?.precipChance);
      return Number.isFinite(p) ? p : 0;
    });
    const avgArr = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const firstAvgGust = avgArr(firstHalfGusts);
    const secondAvgGust = avgArr(secondHalfGusts);
    const firstAvgPrecip = avgArr(firstHalfPrecips);
    const secondAvgPrecip = avgArr(secondHalfPrecips);
    const windDeteriorating = secondAvgGust >= firstAvgGust + 8 && secondAvgGust >= 20;
    const precipDeteriorating = secondAvgPrecip >= firstAvgPrecip + 15 && secondAvgPrecip >= 40;
    if (windDeteriorating && precipDeteriorating) {
      applyFactor('Condition Trajectory', T.trajectory.bothImpact, 'Both wind and precipitation are deteriorating through the travel window.', 'NOAA hourly trend');
    } else if (windDeteriorating) {
      applyFactor('Condition Trajectory', T.trajectory.singleImpact, 'Wind conditions are deteriorating through the travel window.', 'NOAA hourly trend');
    } else if (precipDeteriorating) {
      applyFactor('Condition Trajectory', T.trajectory.singleImpact, 'Precipitation is increasing through the travel window.', 'NOAA hourly trend');
    }
  }

  // Forecast uncertainty removed from score — kept only in confidence penalties below

  if (alertsRelevantForSelectedTime && Number.isFinite(alertsCount) && alertsCount > 0) {
    const listedEvents = alertEvents.length ? ` (${alertEvents.join(', ')})` : '';
    if (highestAlertSeverity === 'extreme') {
      applyFactor('Official Alert', T.alerts.extreme, `${alertsCount} active NWS alert(s)${listedEvents} with EXTREME severity.`, 'NOAA/NWS Active Alerts');
    } else if (highestAlertSeverity === 'severe') {
      applyFactor('Official Alert', T.alerts.severe, `${alertsCount} active NWS alert(s)${listedEvents} with severe impacts possible.`, 'NOAA/NWS Active Alerts');
    } else if (highestAlertSeverity === 'moderate') {
      applyFactor('Official Alert', T.alerts.moderate, `${alertsCount} active NWS alert(s)${listedEvents} indicate moderate hazard.`, 'NOAA/NWS Active Alerts');
    } else {
      applyFactor('Official Alert', T.alerts.minor, `${alertsCount} active NWS alert(s)${listedEvents} are in effect.`, 'NOAA/NWS Active Alerts');
    }
  }

  if (airQualityRelevantForScoring && Number.isFinite(usAqi)) {
    const aqiTier = findTier(usAqi, T.airQuality, 'min');
    if (aqiTier) {
      const aqiMessage =
        aqiTier.min >= 201 ? `Air quality is hazardous (US AQI ${Math.round(usAqi)}).`
        : aqiTier.min >= 151 ? `Air quality is unhealthy (US AQI ${Math.round(usAqi)}).`
        : aqiTier.min >= 101 ? `Air quality is unhealthy for sensitive groups (US AQI ${Math.round(usAqi)}).`
        : `Air quality is moderate (US AQI ${Math.round(usAqi)}). Consider reducing intensity for sustained exertion.`;
      applyFactor('Air Quality', aqiTier.impact, aqiMessage, airQualityData?.source || 'Open-Meteo Air Quality');
    }
  }

  const fireLevel = fireRiskData?.level != null ? Number(fireRiskData.level) : null;
  if (fireLevel !== null && Number.isFinite(fireLevel) && fireLevel >= 4) {
    applyFactor('Fire Danger', T.fire.level4, 'Extreme fire-weather/alert signal for this objective window.', fireRiskData?.source || 'Fire risk synthesis');
  } else if (fireLevel !== null && Number.isFinite(fireLevel) && fireLevel >= 3) {
    applyFactor('Fire Danger', T.fire.level3, 'High fire-weather signal: elevated spread potential or fire-weather alerts.', fireRiskData?.source || 'Fire risk synthesis');
  } else if (fireLevel !== null && Number.isFinite(fireLevel) && fireLevel >= 2) {
    applyFactor('Fire Danger', T.fire.level2, 'Elevated fire risk signal from weather, smoke, or alert context.', fireRiskData?.source || 'Fire risk synthesis');
  }

  // Unknown core weather conditions must affect both the score and confidence.
  // Apply this before group aggregation so the returned score, tier, factors,
  // and group breakdown cannot contradict one another during an upstream outage.
  if (weatherDataUnavailable) {
    applyFactor(
      'Weather Unavailable',
      T.weather.unavailableImpact,
      'All weather data is unavailable — wind, precipitation, and temperature conditions are unknown.',
      'System',
    );
  }

  // --- Cross-group interaction penalties ---
  const hasWindFactor = factors.some((f) => /^wind$/i.test(f.hazard));
  const hasStormOrWinterWeather = factors.some((f) => /^(storm|winter weather)$/i.test(f.hazard));
  const hasVisibilityFactor = factors.some((f) => /^visibility$/i.test(f.hazard));
  const avalancheConsiderable = avalancheRelevant && Number.isFinite(avalancheDangerLevel) && avalancheDangerLevel >= 3;
  const avalancheModerate = avalancheRelevant && Number.isFinite(avalancheDangerLevel) && avalancheDangerLevel >= 2;

  if (avalancheConsiderable && hasWindFactor) {
    applyFactor('Avalanche Wind Loading', T.crossGroup.avalancheWindLoading, 'Wind loading compounds avalanche hazard at considerable or higher danger.', 'Cross-group interaction');
  }
  if (avalancheModerate && hasStormOrWinterWeather) {
    applyFactor('Avalanche Storm Loading', T.crossGroup.avalancheStormLoading, 'Active storm snow increases avalanche hazard at moderate or higher danger.', 'Cross-group interaction');
  }
  if (fireLevel !== null && Number.isFinite(fireLevel) && fireLevel >= 2 && Number.isFinite(heatRiskLevel) && heatRiskLevel >= 2) {
    applyFactor('Fire-Heat Compound', T.crossGroup.fireHeatCompound, 'Co-occurring fire danger and heat risk compound outdoor exposure hazard.', 'Cross-group interaction');
  }
  if (avalancheConsiderable && hasVisibilityFactor) {
    applyFactor('Avalanche Visibility', T.crossGroup.avalancheVisibility, 'Low visibility in avalanche terrain reduces ability to identify hazards.', 'Cross-group interaction');
  }

  // --- Group impacts with diminishing returns ---
  const rawGroupImpacts = factors.reduce((acc, factor) => {
    const group = factor.group || 'weather';
    acc[group] = (acc[group] || 0) + Number(factor.impact || 0);
    return acc;
  }, {});
  const groupImpacts = Object.entries(rawGroupImpacts).reduce((acc, [group, rawImpact]) => {
    const scale = Number(SCORING_CONFIG.groupScales[group] || 100);
    const raw = Number.isFinite(rawImpact) ? Math.round(rawImpact) : 0;
    const effective = Math.round(diminishingReturn(raw, scale));
    // Keep capped/cap as aliases for backward compatibility
    acc[group] = { raw, effective, scale, capped: effective, cap: scale };
    return acc;
  }, {});
  const totalEffectiveImpact = Object.values(groupImpacts).reduce((sum, entry) => sum + Number(entry.effective || 0), 0);
  const score = Math.max(0, Math.round(SCORING_CONFIG.maxScore - totalEffectiveImpact));

  let confidence = 100;
  const confidenceReasons = [];
  const applyConfidencePenalty = (points, reason) => {
    if (!Number.isFinite(points) || points <= 0) {
      return;
    }
    confidence -= points;
    if (reason) {
      confidenceReasons.push(reason);
    }
  };

  if (weatherDataUnavailable) {
    applyConfidencePenalty(30, 'Complete weather data unavailable — do not rely on this report for go/no-go decisions.');
  }

  const nowMs = Date.now();
  const weatherIssuedMs = parseIsoTimeToMs(weatherData?.issuedTime);
  if (!weatherDataUnavailable && weatherIssuedMs === null) {
    applyConfidencePenalty(8, 'Weather issue time unavailable.');
  } else if (!weatherDataUnavailable && weatherIssuedMs !== null) {
    const weatherAgeHours = (nowMs - weatherIssuedMs) / (1000 * 60 * 60);
    if (weatherAgeHours > 18) {
      applyConfidencePenalty(12, `Weather issuance is ${Math.round(weatherAgeHours)}h old.`);
    } else if (weatherAgeHours > 10) {
      applyConfidencePenalty(7, `Weather issuance is ${Math.round(weatherAgeHours)}h old.`);
    } else if (weatherAgeHours > 6) {
      applyConfidencePenalty(4, `Weather issuance is ${Math.round(weatherAgeHours)}h old.`);
    }
  }

  if (trend.length < 6) {
    applyConfidencePenalty(6, 'Limited hourly trend depth (<6 points).');
  }

  const observedTempF = Number(observedStation?.tempF);
  const observedWindMph = Number(observedStation?.windMph);
  if (observedStation?.available && Number.isFinite(observedTempF) && Number.isFinite(tempF) && Math.abs(observedTempF - tempF) >= 15) {
    applyConfidencePenalty(5, `Nearby station temperature differs from the forecast by ${Math.round(Math.abs(observedTempF - tempF))}F; mountain microclimates may be significant.`);
  }
  if (observedStation?.available && Number.isFinite(observedWindMph) && Number.isFinite(wind) && Math.abs(observedWindMph - wind) >= 15) {
    applyConfidencePenalty(5, `Nearby station wind differs from the forecast by ${Math.round(Math.abs(observedWindMph - wind))} mph; exposed terrain may vary further.`);
  }

  if (avalancheRelevant) {
    if (avalancheUnknown) {
      applyConfidencePenalty(20, 'Avalanche danger is unknown for this objective.');
    } else {
      const avalanchePublishedMs = parseIsoTimeToMs(avalancheData?.publishedTime);
      if (avalanchePublishedMs === null) {
        applyConfidencePenalty(8, 'Avalanche bulletin publish time unavailable.');
      } else {
        const avalancheAgeHours = (nowMs - avalanchePublishedMs) / (1000 * 60 * 60);
        if (avalancheAgeHours > 72) {
          applyConfidencePenalty(12, `Avalanche bulletin is ${Math.round(avalancheAgeHours)}h old.`);
        } else if (avalancheAgeHours > 48) {
          applyConfidencePenalty(8, `Avalanche bulletin is ${Math.round(avalancheAgeHours)}h old.`);
        } else if (avalancheAgeHours > 24) {
          applyConfidencePenalty(4, `Avalanche bulletin is ${Math.round(avalancheAgeHours)}h old.`);
        }
      }
    }
  }

  if (alertsRelevantForSelectedTime && alertsData?.status === 'unavailable') {
    applyConfidencePenalty(8, 'NWS alerts feed unavailable.');
  } else if (!alertsRelevantForSelectedTime) {
    applyConfidencePenalty(4, 'NWS alerts are current-state only and not forecast-valid for the selected start time.');
  }
  if (airQualityRelevantForScoring && airQualityData?.status === 'unavailable') {
    applyConfidencePenalty(6, 'Air quality feed unavailable.');
  } else if (airQualityRelevantForScoring && airQualityData?.status === 'no_data') {
    applyConfidencePenalty(3, 'Air quality point data unavailable.');
  }
  const rainfallAnchorMs = parseIsoTimeToMs(rainfallData?.anchorTime);
  if (rainfallData?.status === 'unavailable') {
    applyConfidencePenalty(5, 'Precipitation history feed unavailable.');
  } else if (rainfallData?.status === 'no_data') {
    applyConfidencePenalty(3, 'Precipitation history has no usable anchor/sample data.');
  } else if (rainfallData?.fallbackMode === 'zeroed_totals') {
    applyConfidencePenalty(8, 'Precipitation totals are fallback estimates due upstream feed outage.');
  } else if (rainfallAnchorMs === null) {
    applyConfidencePenalty(3, 'Precipitation anchor time unavailable.');
  } else {
    const rainfallAgeHours = (nowMs - rainfallAnchorMs) / (1000 * 60 * 60);
    if (rainfallAgeHours > 36) {
      applyConfidencePenalty(7, `Precipitation anchor is ${Math.round(rainfallAgeHours)}h old.`);
    } else if (rainfallAgeHours > 18) {
      applyConfidencePenalty(4, `Precipitation anchor is ${Math.round(rainfallAgeHours)}h old.`);
    } else if (rainfallAgeHours > 10) {
      applyConfidencePenalty(2, `Precipitation anchor is ${Math.round(rainfallAgeHours)}h old.`);
    }
  }
  if (forecastLeadHours !== null && forecastLeadHours >= 72) {
    applyConfidencePenalty(8, `Selected start is ${Math.round(forecastLeadHours)}h ahead (lower forecast certainty).`);
  } else if (forecastLeadHours !== null && forecastLeadHours >= 48) {
    applyConfidencePenalty(6, `Selected start is ${Math.round(forecastLeadHours)}h ahead (lower forecast certainty).`);
  } else if (forecastLeadHours !== null && forecastLeadHours >= 24) {
    applyConfidencePenalty(4, `Selected start is ${Math.round(forecastLeadHours)}h ahead (lower forecast certainty).`);
  }
  if (!fireRiskData || fireRiskData.status === 'unavailable') {
    applyConfidencePenalty(3, 'Fire risk synthesis unavailable.');
  }

  confidence = Math.max(20, Math.min(100, Math.round(confidence)));

  const factorsSorted = [...factors].sort((a, b) => b.impact - a.impact);
  const primaryHazard = factorsSorted[0]?.hazard || 'None';
  const sourcesUsed = [
    !weatherDataUnavailable ? 'NOAA/NWS hourly forecast' : null,
    avalancheRelevant ? 'Avalanche center forecast' : null,
    alertsRelevantForSelectedTime && (alertsData?.status === 'ok' || alertsData?.status === 'none' || alertsData?.status === 'none_for_selected_start')
      ? 'NOAA/NWS active alerts'
      : null,
    airQualityRelevantForScoring && (airQualityData?.status === 'ok' || airQualityData?.status === 'no_data')
      ? 'Open-Meteo air quality'
      : null,
    (rainfallData?.status === 'ok' || rainfallData?.status === 'partial' || rainfallData?.status === 'no_data') && rainfallData?.fallbackMode !== 'zeroed_totals'
      ? 'Open-Meteo precipitation history/forecast'
      : null,
    heatRiskData?.status === 'ok' ? 'Heat risk synthesis (forecast + lower-terrain adjustment)' : null,
    fireRiskData?.status === 'ok' ? 'Fire risk synthesis (NOAA + NWS + AQI)' : null,
  ].filter(Boolean);

  // 5-tier display with confidence-modulated tier selection
  const { tier, tierClass } = computeTier(score, confidence);

  return {
    scoreVersion: SCORING_CONFIG.scoreVersion,
    score,
    confidence,
    tier,
    tierClass,
    primaryHazard,
    explanations: explanations.length > 0 ? explanations : [SCORING_CONFIG.messages.stableConditions],
    factors: factorsSorted,
    groupImpacts,
    confidenceReasons,
    sourcesUsed,
    airQualityCategory: aqiCategory,
  };
};

module.exports = { calculateSafetyScore, SCORING_CONFIG, computeTier };
