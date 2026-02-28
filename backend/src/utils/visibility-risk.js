const { toFiniteNumberOrNull, computeFeelsLikeF } = require('./weather-normalizers');

const VISIBILITY_RISK_SOURCE = 'Derived from weather description, precipitation, wind, humidity, and cloud cover signals';

const TEMP_LAPSE_F_PER_1000FT = 3.3;
const WIND_INCREASE_MPH_PER_1000FT = 2;
const GUST_INCREASE_MPH_PER_1000FT = 2.5;

const buildVisibilityRisk = (weatherData) => {
  const description = String(weatherData?.description || '').toLowerCase().trim();
  const precipChance = toFiniteNumberOrNull(weatherData?.precipChance);
  const humidity = toFiniteNumberOrNull(weatherData?.humidity);
  const cloudCover = toFiniteNumberOrNull(weatherData?.cloudCover);
  const windSpeed = toFiniteNumberOrNull(weatherData?.windSpeed);
  const windGust = toFiniteNumberOrNull(weatherData?.windGust);
  const isDaytime = typeof weatherData?.isDaytime === 'boolean' ? weatherData.isDaytime : null;
  const trend = Array.isArray(weatherData?.trend) ? weatherData.trend : [];

  const signalsMissing =
    !description ||
    description.includes('weather data unavailable') ||
    description.includes('unavailable');

  if (
    signalsMissing &&
    precipChance === null &&
    humidity === null &&
    cloudCover === null &&
    windSpeed === null &&
    windGust === null &&
    trend.length === 0
  ) {
    return {
      score: null,
      level: 'Unknown',
      summary: 'Visibility/whiteout signal unavailable for this selected period.',
      factors: [],
      activeHours: null,
      windowHours: null,
      source: VISIBILITY_RISK_SOURCE,
    };
  }

  let score = 0;
  const factors = [];
  const addRisk = (points, message) => {
    if (!Number.isFinite(points) || points <= 0 || !message) {
      return;
    }
    score += points;
    factors.push(message);
  };

  if (/whiteout|ground blizzard|blizzard/.test(description)) {
    addRisk(55, 'whiteout/blizzard wording in forecast');
  } else if (/snow squall|heavy snow|blowing snow|snow showers/.test(description)) {
    addRisk(38, 'snowfall or blowing-snow signal');
  } else if (/\bsnow\b/.test(description)) {
    addRisk(12, 'light snow signal');
  } else if (/dense fog|freezing fog|fog|mist|haze|smoke/.test(description)) {
    addRisk(30, 'fog/smoke/haze signal');
  } else if (/drizzle|rain|showers/.test(description)) {
    addRisk(12, 'rain/drizzle signal');
  }

  if (precipChance !== null && precipChance >= 80) {
    addRisk(22, `high precip chance (${Math.round(precipChance)}%)`);
  } else if (precipChance !== null && precipChance >= 60) {
    addRisk(16, `elevated precip chance (${Math.round(precipChance)}%)`);
  } else if (precipChance !== null && precipChance >= 40) {
    addRisk(10, `moderate precip chance (${Math.round(precipChance)}%)`);
  } else if (precipChance !== null && precipChance >= 25) {
    addRisk(4, `minor precip chance (${Math.round(precipChance)}%)`);
  }

  const effectiveWind = Math.max(
    windSpeed !== null ? windSpeed : 0,
    windGust !== null ? windGust : 0,
  );
  if (effectiveWind >= 45) {
    addRisk(20, `strong transport winds (${Math.round(effectiveWind)} mph)`);
  } else if (effectiveWind >= 35) {
    addRisk(14, `wind-driven visibility reduction possible (${Math.round(effectiveWind)} mph)`);
  } else if (effectiveWind >= 25) {
    addRisk(8, `moderate wind signal (${Math.round(effectiveWind)} mph)`);
  }

  if (humidity !== null && cloudCover !== null && humidity >= 92 && cloudCover >= 92) {
    addRisk(18, `saturated low-contrast air mass (${Math.round(humidity)}% RH / ${Math.round(cloudCover)}% cloud)`);
  } else if (humidity !== null && humidity >= 90) {
    addRisk(8, `very high humidity (${Math.round(humidity)}%)`);
  }

  if (cloudCover !== null && cloudCover >= 95) {
    addRisk(8, `overcast signal (${Math.round(cloudCover)}% cloud)`);
  } else if (cloudCover !== null && cloudCover >= 80) {
    addRisk(4, `mostly overcast signal (${Math.round(cloudCover)}% cloud)`);
  }

  let activeHours = 0;
  if (trend.length > 0) {
    activeHours = trend.filter((point) => {
      const pointCondition = String(point?.condition || '').toLowerCase();
      const pointPrecip = toFiniteNumberOrNull(point?.precipChance);
      const pointHumidity = toFiniteNumberOrNull(point?.humidity);
      const pointCloud = toFiniteNumberOrNull(point?.cloudCover);
      const pointWind = toFiniteNumberOrNull(point?.wind);
      const pointGust = toFiniteNumberOrNull(point?.gust);
      const pointEffectiveWind = Math.max(pointWind !== null ? pointWind : 0, pointGust !== null ? pointGust : 0);

      let pointRiskSignals = 0;
      if (/whiteout|blizzard|snow squall|blowing snow|fog|mist|haze|smoke/.test(pointCondition)) pointRiskSignals += 2;
      if (pointPrecip !== null && pointPrecip >= 60) pointRiskSignals += 2;
      else if (pointPrecip !== null && pointPrecip >= 40) pointRiskSignals += 1;
      if (pointHumidity !== null && pointCloud !== null && pointHumidity >= 92 && pointCloud >= 92) pointRiskSignals += 2;
      else if (pointCloud !== null && pointCloud >= 90) pointRiskSignals += 1;
      if (pointEffectiveWind >= 35) pointRiskSignals += 2;
      else if (pointEffectiveWind >= 25) pointRiskSignals += 1;

      return pointRiskSignals >= 3;
    }).length;

    if (activeHours >= 6) {
      addRisk(12, `${activeHours}/${trend.length} trend hours show persistent reduced visibility`);
    } else if (activeHours >= 3) {
      addRisk(7, `${activeHours}/${trend.length} trend hours show reduced visibility`);
    } else if (activeHours >= 1) {
      addRisk(3, `${activeHours}/${trend.length} trend hours show brief reduced visibility`);
    }
  }

  if (isDaytime === false) {
    addRisk(6, 'nighttime period reduces terrain contrast');
  }

  const boundedScore = Math.max(0, Math.min(100, Math.round(score)));
  const level =
    boundedScore >= 80
      ? 'Extreme'
      : boundedScore >= 60
        ? 'High'
        : boundedScore >= 40
          ? 'Moderate'
          : boundedScore >= 20
            ? 'Low'
            : 'Minimal';

  const summary =
    level === 'Extreme'
      ? 'Whiteout conditions are plausible; terrain contrast and navigation margin may collapse quickly.'
      : level === 'High'
        ? 'Poor visibility is likely during this window. Expect route-finding and terrain-reading difficulty.'
        : level === 'Moderate'
          ? 'Intermittent visibility reductions are possible. Keep close navigation checks.'
          : level === 'Low'
            ? 'Mostly workable visibility with occasional reduced-contrast periods.'
            : 'No strong whiteout signal in the selected period.';

  return {
    score: boundedScore,
    level,
    summary,
    factors: factors.slice(0, 4),
    activeHours,
    windowHours: trend.length,
    source: VISIBILITY_RISK_SOURCE,
  };
};

const buildElevationForecastBands = ({ baseElevationFt, tempF, windSpeedMph, windGustMph }) => {
  if (!Number.isFinite(baseElevationFt) || !Number.isFinite(tempF)) {
    return [];
  }

  const objectiveElevationFt = Math.max(0, Math.round(baseElevationFt));
  const bandTemplates =
    objectiveElevationFt >= 13000
      ? [
          { label: 'Approach Terrain', deltaFromObjectiveFt: -3500 },
          { label: 'Mid Mountain', deltaFromObjectiveFt: -2200 },
          { label: 'Near Objective', deltaFromObjectiveFt: -1000 },
          { label: 'Objective Elevation', deltaFromObjectiveFt: 0 },
        ]
      : objectiveElevationFt >= 9000
        ? [
            { label: 'Approach Terrain', deltaFromObjectiveFt: -2800 },
            { label: 'Mid Mountain', deltaFromObjectiveFt: -1700 },
            { label: 'Near Objective', deltaFromObjectiveFt: -800 },
            { label: 'Objective Elevation', deltaFromObjectiveFt: 0 },
          ]
        : objectiveElevationFt >= 6000
          ? [
              { label: 'Lower Terrain', deltaFromObjectiveFt: -2000 },
              { label: 'Mid Terrain', deltaFromObjectiveFt: -1200 },
              { label: 'Near Objective', deltaFromObjectiveFt: -500 },
              { label: 'Objective Elevation', deltaFromObjectiveFt: 0 },
            ]
          : [
              { label: 'Lower Terrain', deltaFromObjectiveFt: -1000 },
              { label: 'Mid Terrain', deltaFromObjectiveFt: -500 },
              { label: 'Near Objective', deltaFromObjectiveFt: -200 },
              { label: 'Objective Elevation', deltaFromObjectiveFt: 0 },
            ];

  const seenElevations = new Set();
  return bandTemplates
    .map((band) => {
      const elevationFt = Math.max(
        0,
        Math.min(objectiveElevationFt, Math.round(objectiveElevationFt + band.deltaFromObjectiveFt)),
      );
      const actualDeltaFromObjectiveFt = elevationFt - objectiveElevationFt;
      const deltaKft = actualDeltaFromObjectiveFt / 1000;
      const estimatedTempF = Math.round(tempF - (deltaKft * TEMP_LAPSE_F_PER_1000FT));
      const estimatedWindSpeed = Math.max(0, Math.round((windSpeedMph || 0) + (deltaKft * WIND_INCREASE_MPH_PER_1000FT)));
      const estimatedWindGust = Math.max(0, Math.round((windGustMph || 0) + (deltaKft * GUST_INCREASE_MPH_PER_1000FT)));

      return {
        label: band.label,
        deltaFromObjectiveFt: actualDeltaFromObjectiveFt,
        elevationFt,
        temp: estimatedTempF,
        feelsLike: computeFeelsLikeF(estimatedTempF, estimatedWindSpeed),
        windSpeed: estimatedWindSpeed,
        windGust: estimatedWindGust,
      };
    })
    .filter((band) => {
      if (seenElevations.has(band.elevationFt)) {
        return false;
      }
      seenElevations.add(band.elevationFt);
      return true;
    })
    .sort((a, b) => a.elevationFt - b.elevationFt);
};

module.exports = {
  VISIBILITY_RISK_SOURCE,
  buildVisibilityRisk,
  buildElevationForecastBands,
};
