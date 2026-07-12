const { computeFeelsLikeF } = require('./weather-normalizers');
const { clampTravelWindowHours } = require('./time');

// Pleasantness is intentionally independent from the safety score. It describes
// forecast comfort across the selected travel window; it must never be used as a
// go/no-go signal or allowed to offset a hazard.
const PLEASANTNESS_CONFIG = {
  scoreVersion: '1.2.0',
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
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(numeric) ? numeric : null;
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
  const valid = scores.filter(Number.isFinite);
  if (valid.length === 0) return null;
  const average = valid.reduce((sum, score) => sum + score, 0) / valid.length;
  return Math.round((average * 0.8) + (Math.min(...valid) * 0.2));
};

const precipitationConditionCap = (condition) => {
  const normalized = String(condition || '').toLowerCase();
  if (!normalized) return 100;
  const convective = /thunder|lightning/.test(normalized);
  if (convective && normalized.includes('slight chance')) return 55;
  if (convective && /chance|isolated|scattered/.test(normalized)) return 35;
  if (convective || /blizzard|freezing rain|ice pellet/.test(normalized)) return 8;
  if (/heavy rain|downpour/.test(normalized)) return 20;
  if (/heavy snow/.test(normalized)) return 35;
  if (/rain|shower/.test(normalized)) return 45;
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
  if (/cloudy/.test(normalized)) return 75;
  if (/partly|few clouds|scattered clouds/.test(normalized)) return 90;
  if (/clear|sunny/.test(normalized)) return 100;
  return 75;
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
}) => {
  const requestedHours = clampTravelWindowHours(selectedTravelWindowHours, 12);
  const weatherDescription = String(weatherData?.description || '');
  const trend = Array.isArray(weatherData?.trend)
    ? weatherData.trend.slice(0, requestedHours)
    : [];

  const pointTemp = finiteNumber(weatherData?.temp);
  const pointWind = finiteNumber(weatherData?.windSpeed);
  const pointFeelsLike = finiteNumber(weatherData?.feelsLike)
    ?? (pointTemp !== null ? computeFeelsLikeF(pointTemp, pointWind ?? 0) : null);

  const temperatureRows = trend
    .map((row) => {
      const temp = finiteNumber(row?.temp);
      const wind = finiteNumber(row?.wind) ?? 0;
      if (temp === null) return null;
      const feelsLike = computeFeelsLikeF(temp, wind);
      return {
        feelsLike,
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
  if (temperatureRows.length === 0 && pointFeelsLike !== null) {
    temperatureRows.push({
      feelsLike: pointFeelsLike,
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
      return baseScore === null ? null : clamp(baseScore - row.moisturePenalty);
    })
    .filter(Number.isFinite);
  const peakMoisturePenalty = temperatureRows.length
    ? Math.max(...temperatureRows.map((row) => row.moisturePenalty))
    : 0;
  const dewPointValues = temperatureRows.map((row) => row.dewPoint).filter(Number.isFinite);
  const humidityValues = temperatureRows.map((row) => row.humidity).filter(Number.isFinite);

  const windRows = trend.map((row) => {
    const sustained = finiteNumber(row?.wind);
    const gust = finiteNumber(row?.gust) ?? sustained;
    if (sustained === null && gust === null) return null;
    return Math.max(sustained ?? 0, (gust ?? 0) * 0.65);
  }).filter(Number.isFinite);
  const pointGust = finiteNumber(weatherData?.windGust) ?? pointWind;
  if (windRows.length === 0 && (pointWind !== null || pointGust !== null)) {
    windRows.push(Math.max(pointWind ?? 0, (pointGust ?? 0) * 0.65));
  }

  const precipRows = trend.map((row) => {
    const chanceScore = scoreOnCurve(finiteNumber(row?.precipChance), PRECIPITATION_CURVE);
    const cap = precipitationConditionCap(row?.condition);
    return chanceScore === null ? (cap < 100 ? cap : null) : Math.min(chanceScore, cap);
  }).filter(Number.isFinite);
  const pointPrecip = finiteNumber(weatherData?.precipChance);
  if (precipRows.length === 0) {
    const chanceScore = scoreOnCurve(pointPrecip, PRECIPITATION_CURVE);
    const cap = precipitationConditionCap(weatherDescription);
    const pointScore = chanceScore === null ? (cap < 100 ? cap : null) : Math.min(chanceScore, cap);
    if (pointScore !== null) precipRows.push(pointScore);
  }

  const viewRows = trend.map((row) => {
    const conditionScore = conditionViewScore(row?.condition);
    const coverScore = cloudCoverScore(finiteNumber(row?.cloudCover));
    let rowScore = conditionScore ?? coverScore;
    if (rowScore === null) return null;
    if (row?.isDaytime === false) rowScore = Math.max(35, rowScore - 25);
    return rowScore;
  }).filter(Number.isFinite);
  if (viewRows.length === 0) {
    let pointViewScore = conditionViewScore(weatherDescription)
      ?? cloudCoverScore(finiteNumber(weatherData?.cloudCover));
    if (pointViewScore !== null && weatherData?.isDaytime === false) {
      pointViewScore = Math.max(35, pointViewScore - 25);
    }
    if (pointViewScore !== null) viewRows.push(pointViewScore);
  }

  let viewsScore = combineWindowScores(viewRows);
  const visibilityRisk = finiteNumber(weatherData?.visibilityRisk?.score);
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
      score: combineWindowScores(windRows.map((value) => scoreOnCurve(value, WIND_CURVE))),
      weight: PLEASANTNESS_CONFIG.weights.wind,
      message: (() => {
        const sustainedValues = trend.map((row) => finiteNumber(row?.wind)).filter(Number.isFinite);
        const gustValues = trend.map((row) => finiteNumber(row?.gust)).filter(Number.isFinite);
        if (sustainedValues.length === 0 && pointWind !== null) sustainedValues.push(pointWind);
        if (gustValues.length === 0 && pointGust !== null) gustValues.push(pointGust);
        const peakWind = sustainedValues.length ? Math.round(Math.max(...sustainedValues)) : null;
        const peakGustValue = gustValues.length ? Math.round(Math.max(...gustValues)) : null;
        if (peakWind === null && peakGustValue === null) return 'Wind comfort is unavailable.';
        return `Peak wind is ${peakWind ?? '—'} mph with gusts to ${peakGustValue ?? peakWind ?? '—'} mph.`;
      })(),
    },
    {
      factor: 'Precipitation',
      score: combineWindowScores(precipRows),
      weight: PLEASANTNESS_CONFIG.weights.precipitation,
      message: (() => {
        const chances = trend.map((row) => finiteNumber(row?.precipChance)).filter(Number.isFinite);
        if (chances.length === 0 && pointPrecip !== null) chances.push(pointPrecip);
        const peakChance = chances.length ? Math.round(Math.max(...chances)) : null;
        return peakChance === null
          ? `Forecast conditions: ${weatherDescription || 'unavailable'}.`
          : `Precipitation chance peaks at ${peakChance}% during the selected window.`;
      })(),
    },
    {
      factor: 'Views & daylight',
      score: viewsScore,
      weight: PLEASANTNESS_CONFIG.weights.views,
      message: visibilityRisk !== null && visibilityRisk >= 20
        ? `${weatherDescription || 'Forecast conditions'} with a ${Math.round(visibilityRisk)}/100 visibility-risk signal.`
        : `${weatherDescription || 'Sky and visibility details unavailable'}.`,
    },
    {
      factor: 'Air quality',
      score: String(airQualityData?.status || '').toLowerCase() === 'not_applicable_future_date'
        ? null
        : scoreOnCurve(finiteNumber(airQualityData?.usAqi), AIR_QUALITY_CURVE),
      weight: PLEASANTNESS_CONFIG.weights.airQuality,
      message: finiteNumber(airQualityData?.usAqi) !== null
        ? `Air quality is ${airQualityData?.category || 'reported'} (AQI ${Math.round(finiteNumber(airQualityData.usAqi))}).`
        : 'Air-quality comfort is unavailable for this date.',
    },
  ];

  const availableComponents = componentInputs.filter((component) => Number.isFinite(component.score));
  const coreComponentNames = ['Temperature', 'Wind', 'Precipitation'];
  const availableCoreComponents = availableComponents.filter((component) => coreComponentNames.includes(component.factor));
  if (availableCoreComponents.length < 2 || (/weather data unavailable/i.test(weatherDescription) && trend.length === 0)) {
    return {
      scoreVersion: PLEASANTNESS_CONFIG.scoreVersion,
      score: null,
      confidence: 0,
      label: 'Unknown',
      summary: 'Pleasantness is unavailable because the report lacks enough core temperature, wind, and precipitation data.',
      factors: [],
      disclaimer: 'Weather comfort only; this score does not change the safety score or go/no-go decision.',
    };
  }

  const availableWeight = availableComponents.reduce((sum, component) => sum + component.weight, 0);
  const weightedTotal = availableComponents.reduce((sum, component) => sum + (component.score * component.weight), 0);
  let score = clamp(Math.round(weightedTotal / availableWeight));

  // A weighted average alone can call a day "Excellent" even when one core
  // comfort dimension is plainly rough (for example, ideal temperatures in
  // 20 mph wind). These caps keep a severe component from being averaged away.
  const coreScores = availableComponents
    .filter((component) => ['Temperature', 'Wind', 'Precipitation'].includes(component.factor))
    .map((component) => component.score);
  const contextScores = availableComponents
    .filter((component) => ['Views & daylight', 'Air quality'].includes(component.factor))
    .map((component) => component.score);
  const worstCoreScore = coreScores.length ? Math.min(...coreScores) : 100;
  const worstContextScore = contextScores.length ? Math.min(...contextScores) : 100;
  if (worstCoreScore < 25) score = Math.min(score, 39);
  else if (worstCoreScore < 50) score = Math.min(score, 59);
  else if (worstCoreScore < 70) score = Math.min(score, 74);
  else if (worstCoreScore < 85) score = Math.min(score, 89);
  if (worstContextScore < 25) score = Math.min(score, 74);
  else if (worstContextScore < 50) score = Math.min(score, 84);
  else if (worstContextScore < 70) score = Math.min(score, 89);

  // Do not let missing core inputs or a short severe period disappear inside
  // the weighted average. Forecast qualifiers get a less restrictive cap than
  // explicit severe conditions, while blizzard/icing conditions remain Harsh.
  if (availableCoreComponents.length < coreComponentNames.length) {
    score = Math.min(score, 74);
  }
  const windowConditions = [weatherDescription, ...trend.map((row) => String(row?.condition || ''))]
    .map((condition) => condition.toLowerCase())
    .filter(Boolean);
  const hasHarshCondition = windowConditions.some((condition) => /blizzard|freezing rain|ice pellet/.test(condition));
  const hasConvectiveCondition = windowConditions.some((condition) => /thunder|lightning/.test(condition));
  const hasQualifiedConvectiveCondition = windowConditions.some((condition) =>
    /thunder|lightning/.test(condition) && /slight chance|chance|isolated|scattered/.test(condition));
  const hasExplicitConvectiveCondition = hasConvectiveCondition && windowConditions.some((condition) =>
    /thunder|lightning/.test(condition) && !/slight chance|chance|isolated|scattered/.test(condition));
  const hasSeverePrecipitation = windowConditions.some((condition) => /heavy rain|heavy snow|downpour/.test(condition));
  if (hasHarshCondition) score = Math.min(score, 39);
  else if (hasExplicitConvectiveCondition || hasSeverePrecipitation) score = Math.min(score, 59);
  else if (hasQualifiedConvectiveCondition) score = Math.min(score, 74);
  const factors = availableComponents
    .map((component) => ({
      factor: component.factor,
      score: Math.round(component.score),
      weight: component.weight,
      impact: Math.round((component.weight * (1 - (component.score / 100))) * 10) / 10,
      message: component.message,
    }))
    .sort((a, b) => b.impact - a.impact);

  const expectedTrendHours = Math.min(requestedHours, 12);
  const trendCoverage = expectedTrendHours > 0 ? Math.min(1, trend.length / expectedTrendHours) : 1;
  const trendPenalty = trend.length === 0 ? 15 : Math.round((1 - trendCoverage) * 10);
  const confidence = clamp(Math.round(availableWeight - trendPenalty));
  const label = labelForScore(score);
  const limiters = factors.filter((factor) => factor.score < 85).slice(0, 2).map((factor) => factor.factor.toLowerCase());
  const summary = limiters.length > 0
    ? `${label} overall; ${joinNaturally(limiters)} ${limiters.length === 1 ? 'is' : 'are'} the main comfort ${limiters.length === 1 ? 'limiter' : 'limiters'}.`
    : `${label} overall, with comfortable weather across the selected travel window.`;

  return {
    scoreVersion: PLEASANTNESS_CONFIG.scoreVersion,
    score,
    confidence,
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
