const { computeFeelsLikeF } = require('./weather-normalizers');
const { clampTravelWindowHours, parseIsoTimeToMs } = require('./time');

// Pleasantness is intentionally independent from the safety score. It describes
// forecast comfort across the selected travel window; it must never be used as a
// go/no-go signal or allowed to offset a hazard.
const PLEASANTNESS_CONFIG = {
  scoreVersion: '1.3.0',
  weights: {
    temperature: 30,
    wind: 25,
    precipitation: 25,
    views: 15,
    airQuality: 5,
  },
  labels: [
    { min: 90, label: 'Excellent' },
    { min: 75, label: 'Pleasant' },
    { min: 60, label: 'Mixed' },
    { min: 40, label: 'Uncomfortable' },
    { min: 0, label: 'Harsh' },
  ],
};

const TEMPERATURE_CURVE = [
  [-20, 0], [0, 10], [15, 25], [30, 50], [40, 75], [48, 95],
  [55, 100], [68, 100], [75, 90], [82, 70], [90, 40], [100, 10], [110, 0],
];

const WIND_CURVE = [
  [0, 100], [5, 100], [10, 92], [15, 78], [20, 60],
  [25, 42], [30, 25], [40, 5], [50, 0],
];

const PRECIPITATION_CURVE = [
  [0, 100], [10, 98], [20, 90], [35, 72], [50, 50],
  [65, 30], [80, 12], [100, 0],
];

const AIR_QUALITY_CURVE = [
  [0, 100], [50, 100], [75, 85], [100, 65], [150, 30],
  [200, 10], [300, 0],
];

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

const finiteNumber = (value) => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const inRange = (value, min, max = Infinity) => {
  const numeric = finiteNumber(value);
  return numeric !== null && numeric >= min && numeric <= max ? numeric : null;
};

const scoreOnCurve = (value, curve) => {
  const numeric = finiteNumber(value);
  if (numeric === null) return null;
  if (numeric <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i += 1) {
    const [rightX, rightY] = curve[i];
    if (numeric <= rightX) {
      const [leftX, leftY] = curve[i - 1];
      const progress = (numeric - leftX) / (rightX - leftX);
      return clamp(leftY + ((rightY - leftY) * progress));
    }
  }
  return curve[curve.length - 1][1];
};

// Most of the score reflects the whole outing, while the least-comfortable hour
// gets extra weight so one rough period is not hidden by a long benign window.
const combineWindowScores = (scores) => {
  const valid = scores.map((entry) => typeof entry === 'number' ? { score: entry, hours: 1 } : entry)
    .filter((entry) => entry && Number.isFinite(entry.score) && entry.hours > 0);
  if (valid.length === 0) return null;
  const average = valid.reduce((sum, entry) => sum + entry.score * entry.hours, 0)
    / valid.reduce((sum, entry) => sum + entry.hours, 0);
  return Math.round((average * 0.8) + (Math.min(...valid.map((entry) => entry.score)) * 0.2));
};

const coveredHours = (rows) => Math.round(rows.reduce((sum, row) => sum + row.hours, 0) * 100) / 100;

// Hourly forecasts describe intervals. Clip them to the actual departure and
// return, deduplicate overlapping intervals, and retain gaps as missing coverage.
const selectComfortWindow = (weather, requestedHours, selectedStartTime) => {
  const source = Array.isArray(weather?.trend) ? weather.trend : [];
  const start = parseIsoTimeToMs(selectedStartTime ?? weather?.forecastStartTime ?? source.find((row) => row?.timeIso)?.timeIso);
  if (start === null || !source.some((row) => row?.timeIso)) {
    return source.slice(0, requestedHours).map((row) => ({ ...row, hours: 1 }));
  }
  const hourMs = 3600000;
  const end = start + requestedHours * hourMs;
  const timed = source.map((row) => ({ row, start: parseIsoTimeToMs(row?.timeIso) }))
    .filter((entry) => entry.start !== null && entry.start < end && entry.start + hourMs > start)
    .sort((a, b) => b.start - a.start);
  const boundaries = [...new Set([start, end, ...timed.flatMap((entry) => [
    Math.max(start, entry.start), Math.min(end, entry.start + hourMs),
  ])])].sort((a, b) => a - b);
  const samples = new Map();
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const entry = timed.find((point) => point.start <= boundaries[i] && point.start + hourMs > boundaries[i]);
    if (!entry) continue;
    const sample = samples.get(entry) || { ...entry.row, hours: 0 };
    sample.hours += (boundaries[i + 1] - boundaries[i]) / hourMs;
    samples.set(entry, sample);
  }
  return [...samples.values()];
};

const precipitationConditionCap = (condition, chance = null) => {
  const normalized = String(condition || '').toLowerCase();
  if (!normalized) return 100;
  const convective = /thunder|lightning/.test(normalized);
  if (convective && normalized.includes('slight chance')) return 55;
  if (convective && /chance|isolated|scattered/.test(normalized)) return 35;
  if (convective || /blizzard|freezing rain|ice pellet/.test(normalized)) return 8;
  if (/heavy rain|downpour/.test(normalized)) return 20;
  if (/heavy snow/.test(normalized)) return 35;
  if (/rain|shower/.test(normalized)) {
    if (/chance|possible|isolated|scattered/.test(normalized)) {
      return chance !== null ? 100 - (55 * chance / 100) : normalized.includes('slight chance') ? 85 : 65;
    }
    return 45;
  }
  if (/drizzle/.test(normalized)) return 55;
  if (/snow|flurr/.test(normalized)) return 65;
  return 100;
};

const conditionViewScore = (condition) => {
  const normalized = String(condition || '').toLowerCase();
  if (!normalized) return null;
  const convective = /thunder|lightning/.test(normalized);
  if (convective && normalized.includes('slight chance')) return 65;
  if (convective && /chance|isolated|scattered/.test(normalized)) return 45;
  if (convective || /blizzard|freezing rain/.test(normalized)) return 10;
  if (/fog|dense mist/.test(normalized)) return 20;
  if (/smoke|haze/.test(normalized)) return 35;
  if (/heavy rain|heavy snow|downpour/.test(normalized)) return 30;
  if (/rain|shower|snow|drizzle|flurr/.test(normalized)) return 50;
  if (/overcast/.test(normalized)) return 55;
  if (/mostly cloudy/.test(normalized)) return 70;
  if (/partly|few clouds|scattered clouds/.test(normalized)) return 90;
  if (/cloudy/.test(normalized)) return 75;
  if (/clear|sunny/.test(normalized)) return 100;
  return null;
};

const cloudCoverScore = (cloudCover) => scoreOnCurve(cloudCover, [
  [0, 100], [20, 95], [50, 85], [75, 70], [100, 55],
]);

// Moisture only modifies temperature comfort where people meaningfully feel it:
// warm/muggy air or cool air near saturation. The cap prevents double-counting
// precipitation, fog, or heat that already affect other components.
const moistureComfortPenalty = ({ tempF, humidity, dewPointF, condition }) => {
  const temp = finiteNumber(tempF);
  const relativeHumidity = finiteNumber(humidity);
  const dewPoint = finiteNumber(dewPointF);
  if (temp === null) return 0;

  if (temp >= 65) {
    if (dewPoint !== null) {
      if (dewPoint >= 75) return 8;
      if (dewPoint >= 70) return 6;
      if (dewPoint >= 65) return 4;
      if (dewPoint >= 60) return 2;
      return 0;
    }

    if (relativeHumidity !== null) {
      if (temp >= 85 && relativeHumidity >= 70) return 8;
      if (temp >= 85 && relativeHumidity >= 55) return 6;
      if (temp >= 80 && relativeHumidity >= 45) return 4;
      if (temp >= 75 && relativeHumidity >= 55) return 2;
      if (relativeHumidity >= 80) return 2;
    }
    return 0;
  }

  if (temp >= 32 && temp <= 50 && relativeHumidity !== null && relativeHumidity >= 85) {
    let penalty = relativeHumidity >= 95 ? 4 : 2;
    if (/fog|mist|drizzle|rain|snow/.test(String(condition || '').toLowerCase())) penalty += 2;
    return Math.min(6, penalty);
  }

  return 0;
};

const labelForScore = (score) => {
  if (!Number.isFinite(score)) return 'Unknown';
  return PLEASANTNESS_CONFIG.labels.find((entry) => score >= entry.min)?.label || 'Harsh';
};

const formatRange = (values, suffix) => {
  const valid = values.filter(Number.isFinite);
  if (valid.length === 0) return null;
  const low = Math.round(Math.min(...valid));
  const high = Math.round(Math.max(...valid));
  return low === high ? `${low}${suffix}` : `${low}–${high}${suffix}`;
};

const joinNaturally = (items) => {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
};

const calculatePleasantnessScore = ({
  weatherData,
  airQualityData,
  selectedTravelWindowHours = null,
  selectedStartTime = null,
  scoreFeatures = null,
}) => {
  const scoreFeatureEnabled = (key) => scoreFeatures?.[key] !== false;
  const airQualityEnabled = scoreFeatureEnabled('airQualityDetails');
  const daylightEnabled = scoreFeatureEnabled('daylightTimeline');
  const weatherContextEnabled = scoreFeatureEnabled('weatherContextDetails');
  const requestedHours = clampTravelWindowHours(finiteNumber(selectedTravelWindowHours) ?? 12, 12);
  const weatherDescription = String(weatherData?.description || '');
  const trend = selectComfortWindow(weatherData, requestedHours, selectedStartTime);
  const hourlyConditions = [...new Set(trend.map((row) => String(row?.condition || '').trim()).filter(Boolean))];
  const conditionDescription = hourlyConditions.join('; ') || weatherDescription;

  const pointTemp = finiteNumber(weatherData?.temp);
  const pointWind = inRange(weatherData?.windSpeed, 0);
  const pointFeelsLike = finiteNumber(weatherData?.feelsLike)
    ?? (pointTemp !== null ? computeFeelsLikeF(pointTemp, pointWind ?? 0) : null);

  const temperatureRows = trend
    .map((row) => {
      const temp = finiteNumber(row?.temp);
      const wind = inRange(row?.wind, 0) ?? 0;
      const feelsLike = finiteNumber(row?.feelsLike) ?? (temp === null ? null : computeFeelsLikeF(temp, wind));
      if (feelsLike === null) return null;
      return {
        feelsLike,
        hours: row.hours,
        humidity: finiteNumber(row?.humidity),
        dewPoint: finiteNumber(row?.dewPoint),
        moisturePenalty: moistureComfortPenalty({
          tempF: temp,
          humidity: row?.humidity,
          dewPointF: row?.dewPoint,
          condition: row?.condition,
        }),
      };
    })
    .filter(Boolean);
  const temperatureHours = coveredHours(temperatureRows);
  if (temperatureRows.length === 0 && pointFeelsLike !== null) {
    temperatureRows.push({
      feelsLike: pointFeelsLike,
      hours: 1,
      humidity: finiteNumber(weatherData?.humidity),
      dewPoint: finiteNumber(weatherData?.dewPoint),
      moisturePenalty: moistureComfortPenalty({
        tempF: pointTemp,
        humidity: weatherData?.humidity,
        dewPointF: weatherData?.dewPoint,
        condition: weatherDescription,
      }),
    });
  }
  const feelsLikeValues = temperatureRows.map((row) => row.feelsLike).filter(Number.isFinite);
  const temperatureScores = temperatureRows
    .map((row) => {
      const baseScore = scoreOnCurve(row.feelsLike, TEMPERATURE_CURVE);
      return baseScore === null ? null : { score: clamp(baseScore - row.moisturePenalty), hours: row.hours };
    })
    .filter(Boolean);
  const peakMoisturePenalty = temperatureRows.length
    ? Math.max(...temperatureRows.map((row) => row.moisturePenalty))
    : 0;
  const dewPointValues = temperatureRows.map((row) => row.dewPoint).filter(Number.isFinite);
  const humidityValues = temperatureRows.map((row) => row.humidity).filter(Number.isFinite);

  const windRows = trend.map((row) => {
    const sustained = inRange(row?.wind, 0);
    const gust = inRange(row?.gust, 0) ?? sustained;
    if (sustained === null && gust === null) return null;
    return { score: scoreOnCurve(Math.max(sustained ?? 0, (gust ?? 0) * 0.65), WIND_CURVE), hours: row.hours };
  }).filter(Boolean);
  const windHours = coveredHours(windRows);
  const pointGust = inRange(weatherData?.windGust, 0);
  if (windRows.length === 0 && (pointWind !== null || pointGust !== null)) {
    windRows.push({ score: scoreOnCurve(Math.max(pointWind ?? 0, (pointGust ?? 0) * 0.65), WIND_CURVE), hours: 1 });
  }

  const precipitationScore = (row) => {
    const chance = inRange(row?.precipChance, 0, 100);
    const chanceScore = scoreOnCurve(chance, PRECIPITATION_CURVE);
    const cap = precipitationConditionCap(row?.condition, chance);
    return chanceScore === null ? (cap < 100 ? cap : null) : Math.min(chanceScore, cap);
  };
  const precipRows = trend.map((row) => ({ score: precipitationScore(row), hours: row.hours })).filter((row) => row.score !== null);
  const precipitationHours = coveredHours(precipRows);
  const pointPrecip = inRange(weatherData?.precipChance, 0, 100);
  if (precipRows.length === 0) {
    const pointScore = precipitationScore({ precipChance: pointPrecip, condition: weatherDescription });
    if (pointScore !== null) precipRows.push({ score: pointScore, hours: 1 });
  }

  const viewRows = trend.map((row) => {
    const conditionScore = conditionViewScore(row?.condition);
    const coverScore = cloudCoverScore(inRange(row?.cloudCover, 0, 100));
    let rowScore = conditionScore ?? coverScore;
    if (rowScore === null) return null;
    if (daylightEnabled && row?.isDaytime === false) rowScore = Math.max(0, rowScore - 25);
    return { score: rowScore, hours: row.hours };
  }).filter(Boolean);
  const viewsHours = coveredHours(viewRows);
  if (viewRows.length === 0) {
    let pointViewScore = conditionViewScore(weatherDescription)
      ?? cloudCoverScore(inRange(weatherData?.cloudCover, 0, 100));
    if (daylightEnabled && pointViewScore !== null && weatherData?.isDaytime === false) {
      pointViewScore = Math.max(0, pointViewScore - 25);
    }
    if (pointViewScore !== null) viewRows.push({ score: pointViewScore, hours: 1 });
  }

  let viewsScore = combineWindowScores(viewRows);
  const visibilityRisk = weatherContextEnabled ? inRange(weatherData?.visibilityRisk?.score, 0, 100) : null;
  if (visibilityRisk !== null) {
    const visibilityComfort = clamp(100 - visibilityRisk);
    viewsScore = viewsScore === null
      ? Math.round(visibilityComfort)
      : Math.round((viewsScore * 0.65) + (visibilityComfort * 0.35));
  }

  const componentInputs = [
    {
      factor: 'Temperature',
      score: combineWindowScores(temperatureScores),
      weight: PLEASANTNESS_CONFIG.weights.temperature,
      hours: temperatureHours,
      message: (() => {
        const range = formatRange(feelsLikeValues, '°F');
        if (!range) return 'Temperature comfort is unavailable.';
        if (peakMoisturePenalty <= 0) return `Feels-like temperatures span ${range} during the selected window.`;
        const peakDewPoint = dewPointValues.length ? Math.round(Math.max(...dewPointValues)) : null;
        const peakHumidity = humidityValues.length ? Math.round(Math.max(...humidityValues)) : null;
        const moistureSignal = peakDewPoint !== null
          ? `dew point peaks at ${peakDewPoint}°F`
          : `relative humidity peaks at ${peakHumidity}%`;
        return `Feels-like temperatures span ${range}; ${moistureSignal}, reducing temperature comfort by up to ${peakMoisturePenalty} points.`;
      })(),
    },
    {
      factor: 'Wind',
      score: combineWindowScores(windRows),
      weight: PLEASANTNESS_CONFIG.weights.wind,
      hours: windHours,
      message: (() => {
        const sustainedValues = trend.map((row) => inRange(row?.wind, 0)).filter(Number.isFinite);
        const gustValues = trend.map((row) => inRange(row?.gust, 0)).filter(Number.isFinite);
        if (sustainedValues.length === 0 && pointWind !== null) sustainedValues.push(pointWind);
        if (gustValues.length === 0 && pointGust !== null) gustValues.push(pointGust);
        const peakWind = sustainedValues.length ? Math.round(Math.max(...sustainedValues)) : null;
        const peakGustValue = gustValues.length ? Math.round(Math.max(...gustValues)) : null;
        if (peakWind === null && peakGustValue === null) return 'Wind comfort is unavailable.';
        return `Peak wind is ${peakWind === null ? 'unavailable' : `${peakWind} mph`}; ${peakGustValue === null ? 'gust readings unavailable' : `gusts reach ${peakGustValue} mph`}.`;
      })(),
    },
    {
      factor: 'Precipitation',
      score: combineWindowScores(precipRows),
      weight: PLEASANTNESS_CONFIG.weights.precipitation,
      hours: precipitationHours,
      message: (() => {
        const chances = trend.map((row) => inRange(row?.precipChance, 0, 100)).filter(Number.isFinite);
        if (chances.length === 0 && pointPrecip !== null) chances.push(pointPrecip);
        const peakChance = chances.length ? Math.round(Math.max(...chances)) : null;
        return peakChance === null
          ? `Forecast conditions: ${conditionDescription || 'unavailable'}.`
          : `Precipitation chance peaks at ${peakChance}% during the selected window.`;
      })(),
    },
    {
      factor: 'Views & daylight',
      score: viewsScore,
      weight: PLEASANTNESS_CONFIG.weights.views,
      hours: viewsHours,
      message: visibilityRisk !== null && visibilityRisk >= 20
        ? `${conditionDescription || 'Forecast conditions'} with a ${Math.round(visibilityRisk)}/100 visibility-risk signal.`
        : `${conditionDescription || 'Sky and visibility details unavailable'}.`,
    },
    {
      factor: 'Air quality',
      score: !airQualityEnabled || String(airQualityData?.status || '').toLowerCase() === 'not_applicable_future_date'
        ? null
        : scoreOnCurve(inRange(airQualityData?.usAqi, 0), AIR_QUALITY_CURVE),
      weight: PLEASANTNESS_CONFIG.weights.airQuality,
      message: finiteNumber(airQualityData?.usAqi) !== null
        ? `Air quality is ${airQualityData?.category || 'reported'} (AQI ${Math.round(finiteNumber(airQualityData.usAqi))}).`
        : 'Air-quality comfort is unavailable for this date.',
    },
  ];

  const availableComponents = componentInputs.filter((component) => Number.isFinite(component.score));
  const coreComponentNames = ['Temperature', 'Wind', 'Precipitation'];
  const availableCoreComponents = availableComponents.filter((component) => coreComponentNames.includes(component.factor));
  const completeHours = coveredHours(trend.filter((row) =>
    (finiteNumber(row?.feelsLike) !== null || finiteNumber(row?.temp) !== null)
    && (inRange(row?.wind, 0) !== null || inRange(row?.gust, 0) !== null)
    && precipitationScore(row) !== null));
  const coverage = { requestedHours, completeHours };
  const confidenceReasons = componentInputs.flatMap((component) => {
    if (component.factor === 'Air quality' && !airQualityEnabled) return [];
    if (component.score === null) return [`${component.factor} data is unavailable${component.factor === 'Air quality' ? ' for this date' : ''}.`];
    if (component.hours < requestedHours) return [
      `${component.factor}: hourly readings cover ${component.hours} of ${requestedHours} planned hours.${component.hours === 0 ? ' Only a summary or start-time reading is available.' : ''}`,
    ];
    return [];
  });
  if (availableCoreComponents.length < 2 || (/weather data unavailable/i.test(weatherDescription) && trend.length === 0)) {
    return {
      scoreVersion: PLEASANTNESS_CONFIG.scoreVersion,
      score: null,
      confidence: 0,
      label: 'Unknown',
      summary: 'Weather comfort is unavailable because the report lacks enough temperature, wind, and precipitation data.',
      coverage,
      confidenceReasons,
      factors: [],
      disclaimer: 'Weather comfort only; this score does not change the safety score or go/no-go decision.',
    };
  }

  const availableWeight = availableComponents.reduce((sum, component) => sum + component.weight, 0);
  const weightedTotal = availableComponents.reduce((sum, component) => sum + (component.score * component.weight), 0);
  const weightedScore = clamp(Math.round(weightedTotal / availableWeight));
  let score = weightedScore;
  const adjustments = [];
  const limitScore = (maximumScore, reason) => {
    if (weightedScore > maximumScore) adjustments.push({ maximumScore, reason });
    score = Math.min(score, maximumScore);
  };

  // A weighted average alone can call a day "Excellent" even when one core
  // comfort dimension is plainly rough (for example, ideal temperatures in
  // 20 mph wind). These caps keep a severe component from being averaged away.
  for (const component of availableComponents) {
    const core = coreComponentNames.includes(component.factor);
    const maximum = component.score < 25 ? (core ? 39 : 74)
      : component.score < 50 ? (core ? 59 : 84)
        : component.score < 70 ? (core ? 74 : 89)
          : core && component.score < 85 ? 89 : 100;
    limitScore(maximum, `${component.factor} limits overall comfort to ${labelForScore(maximum)} (${maximum}/100).`);
  }

  // Do not let missing core inputs or a short severe period disappear inside
  // the weighted average. Forecast qualifiers get a less restrictive cap than
  // explicit severe conditions, while blizzard/icing conditions remain Harsh.
  if (availableCoreComponents.length < coreComponentNames.length) {
    limitScore(74, 'A core weather factor is missing, so comfort cannot be rated above Mixed.');
  }
  if (completeHours < requestedHours) {
    const maximum = completeHours / requestedHours < 0.75 ? 74 : 89;
    limitScore(maximum, `Complete temperature, wind, and precipitation readings cover ${completeHours} of ${requestedHours} planned hours; the rating is limited to ${labelForScore(maximum)}.`);
  }
  const allHoursHaveConditions = coveredHours(trend) === requestedHours && trend.every((row) => String(row?.condition || '').trim());
  const windowConditions = (allHoursHaveConditions ? hourlyConditions : [weatherDescription, ...hourlyConditions])
    .map((condition) => condition.toLowerCase())
    .filter(Boolean);
  const hasHarshCondition = windowConditions.some((condition) => /blizzard|freezing rain|ice pellet/.test(condition));
  const hasConvectiveCondition = windowConditions.some((condition) => /thunder|lightning/.test(condition));
  const hasQualifiedConvectiveCondition = windowConditions.some((condition) =>
    /thunder|lightning/.test(condition) && /slight chance|chance|isolated|scattered/.test(condition));
  const hasExplicitConvectiveCondition = hasConvectiveCondition && windowConditions.some((condition) =>
    /thunder|lightning/.test(condition) && !/slight chance|chance|isolated|scattered/.test(condition));
  const hasSeverePrecipitation = windowConditions.some((condition) => /heavy rain|heavy snow|downpour/.test(condition));
  if (hasHarshCondition) limitScore(39, 'Blizzard or icing conditions in the travel window limit comfort to Harsh.');
  else if (hasExplicitConvectiveCondition || hasSeverePrecipitation) limitScore(59, 'Storms or heavy precipitation in the travel window limit comfort to Uncomfortable.');
  else if (hasQualifiedConvectiveCondition) limitScore(74, 'Possible thunderstorms in the travel window limit comfort to Mixed.');
  const factors = availableComponents
    .map((component) => ({
      factor: component.factor,
      score: Math.round(component.score),
      weight: component.weight,
      impact: Math.round((100 * component.weight / availableWeight * (1 - (component.score / 100))) * 10) / 10,
      message: component.message,
    }))
    .sort((a, b) => b.impact - a.impact);

  const disabledOptionalWeight = airQualityEnabled ? 0 : PLEASANTNESS_CONFIG.weights.airQuality;
  // Count usable readings per factor over the entire outing. A start-time or
  // summary fallback contributes at most one hour; empty rows contribute none.
  const confidence = clamp(Math.round(disabledOptionalWeight + availableComponents.reduce((total, component) =>
    total + component.weight * (component.hours === undefined ? 1 : (component.hours || 1) / requestedHours), 0)));
  const label = labelForScore(score);
  const limiters = factors.filter((factor) => factor.score < 85).slice(0, 2).map((factor) => factor.factor.toLowerCase());
  const outlook = limiters.length > 0
    ? `${label} overall; ${joinNaturally(limiters)} ${limiters.length === 1 ? 'is' : 'are'} the main comfort ${limiters.length === 1 ? 'limiter' : 'limiters'}.`
    : `${label} overall, with comfortable weather across the selected travel window.`;
  const bindingAdjustments = adjustments.filter((adjustment) => adjustment.maximumScore === score);
  const summary = completeHours < requestedHours
    ? `Limited forecast coverage (${completeHours}/${requestedHours} complete hours). ${limiters.length ? outlook : `${label} rating based on available readings.`}`
    : bindingAdjustments.length > 0 ? `${outlook} ${bindingAdjustments[0].reason}` : outlook;

  return {
    scoreVersion: PLEASANTNESS_CONFIG.scoreVersion,
    score,
    confidence,
    confidenceReasons,
    coverage,
    weightedScore,
    adjustments: bindingAdjustments,
    label,
    summary,
    factors,
    disclaimer: 'Weather comfort only; this score does not change the safety score or go/no-go decision.',
  };
};

module.exports = {
  calculatePleasantnessScore,
  labelForScore,
  moistureComfortPenalty,
  PLEASANTNESS_CONFIG,
};
