import { 
  parseWindMph, 
  inferWindGustFromPeriods, 
  findNearestWindDirection,
  normalizeWindDirection
} from './wind';
import { 
  parseIsoTimeToMs, 
  buildPlannedStartIso, 
  hourLabelFromIso 
} from './time';

export const FT_PER_METER = 3.28084;
export const TEMP_LAPSE_F_PER_1000FT = 3.3;
export const WIND_INCREASE_MPH_PER_1000FT = 2;
export const GUST_INCREASE_MPH_PER_1000FT = 2.5;

export const OPEN_METEO_CODE_LABELS: Record<number, string> = {
  0: 'Clear',
  1: 'Mainly Clear',
  2: 'Partly Cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing Rime Fog',
  51: 'Light Drizzle',
  53: 'Moderate Drizzle',
  55: 'Dense Drizzle',
  56: 'Light Freezing Drizzle',
  57: 'Dense Freezing Drizzle',
  61: 'Slight Rain',
  63: 'Moderate Rain',
  65: 'Heavy Rain',
  66: 'Light Freezing Rain',
  67: 'Heavy Freezing Rain',
  71: 'Slight Snow Fall',
  73: 'Moderate Snow Fall',
  75: 'Heavy Snow Fall',
  77: 'Snow Grains',
  80: 'Slight Rain Showers',
  81: 'Moderate Rain Showers',
  82: 'Violent Rain Showers',
  85: 'Slight Snow Showers',
  86: 'Heavy Snow Showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with Slight Hail',
  99: 'Thunderstorm with Heavy Hail',
};

export const openMeteoCodeToText = (code: number): string => OPEN_METEO_CODE_LABELS[code] || 'Unknown';

export const estimateWindGustFromWindSpeed = (windSpeedMph: number | string | null | undefined): number => {
  const speed = Number(windSpeedMph);
  if (!Number.isFinite(speed)) {
    return 0;
  }
  if (speed <= 5) return Math.round(speed * 1.5);
  if (speed <= 15) return Math.round(speed * 1.4);
  if (speed <= 30) return Math.round(speed * 1.35);
  return Math.round(speed * 1.25);
};

export const findNearestCardinalFromDegreeSeries = (degreeSeries: (number | string | null | undefined)[] | null | undefined, anchorIdx: number): string | null => {
  if (!Array.isArray(degreeSeries) || !degreeSeries.length) {
    return null;
  }
  const findValue = (idx: number): number | null => {
    const val = degreeSeries[idx];
    return (val !== null && val !== undefined && Number.isFinite(Number(val))) ? Number(val) : null;
  };

  let degrees = findValue(anchorIdx);
  if (degrees === null) {
    for (let offset = 1; offset <= 3; offset += 1) {
      degrees = findValue(anchorIdx - offset) ?? findValue(anchorIdx + offset);
      if (degrees !== null) break;
    }
  }
  if (degrees === null) return null;

  const cardinals = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(degrees / 22.5) % 16;
  return cardinals[index];
};

export const mmToInches = (mm: number | null | undefined): number | null => (Number.isFinite(mm) ? Number(((mm as number) / 25.4).toFixed(2)) : null);
export const cmToInches = (cm: number | null | undefined): number | null => (Number.isFinite(cm) ? Number(((cm as number) / 2.54).toFixed(2)) : null);

export const seriesHasFiniteValues = (series: (number | string | null | undefined)[] | null | undefined): boolean => Array.isArray(series) && series.some((v) => Number.isFinite(Number(v)));

export const sumRollingAccumulation = (timeArray: (string | null | undefined)[], valueSeries: (number | string | null | undefined)[], anchorMs: number, windowHours: number): number | null => {
  if (!Array.isArray(timeArray) || !Array.isArray(valueSeries) || !Number.isFinite(anchorMs)) {
    return null;
  }
  const windowMs = windowHours * 60 * 60 * 1000;
  const startMs = anchorMs - windowMs;
  let total = 0;
  let hasSamples = false;
  for (let i = 0; i < timeArray.length; i += 1) {
    const tMs = parseIsoTimeToMs(timeArray[i]);
    if (tMs !== null && tMs >= startMs && tMs <= anchorMs) {
      const val = Number(valueSeries[i]);
      if (Number.isFinite(val)) {
        total += val;
        hasSamples = true;
      }
    }
  }
  return hasSamples ? total : null;
};

export const sumForwardAccumulation = (timeArray: (string | null | undefined)[], valueSeries: (number | string | null | undefined)[], startMs: number, windowHours: number): number | null => {
  if (!Array.isArray(timeArray) || !Array.isArray(valueSeries) || !Number.isFinite(startMs)) {
    return null;
  }
  const windowMs = windowHours * 60 * 60 * 1000;
  const endMs = startMs + windowMs;
  let total = 0;
  let hasSamples = false;
  for (let i = 0; i < timeArray.length; i += 1) {
    const tMs = parseIsoTimeToMs(timeArray[i]);
    if (tMs !== null && tMs >= startMs && tMs < endMs) {
      const val = Number(valueSeries[i]);
      if (Number.isFinite(val)) {
        total += val;
        hasSamples = true;
      }
    }
  }
  return hasSamples ? total : null;
};

export const computeFeelsLikeF = (tempF: number | null | undefined, windMph: number | null | undefined): number | null => {
  if (!Number.isFinite(tempF)) {
    return tempF ?? null;
  }
  const t = tempF as number;
  const w = windMph ?? 0;
  if (t <= 50 && w >= 3) {
    const feelsLike = 35.74 + (0.6215 * t) - (35.75 * Math.pow(w, 0.16)) + (0.4275 * t * Math.pow(w, 0.16));
    return Math.round(feelsLike);
  }
  return Math.round(t);
};

export const celsiusToF = (valueC: number | string | null | undefined): number | null => {
  const numeric = Number(valueC);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return (numeric * 9) / 5 + 32;
};

export const normalizeNoaaDewPointF = (dewpointField: any): number | null => {
  const value = Number(dewpointField?.value);
  if (!Number.isFinite(value)) {
    return null;
  }
  const unitCode = String(dewpointField?.unitCode || '').toLowerCase();
  if (unitCode.includes('degc') || unitCode.includes('unit:degc') || unitCode.includes('wmo:degc')) {
    const converted = celsiusToF(value);
    return Number.isFinite(converted) ? Math.round(converted as number) : null;
  }
  return Math.round(value);
};

export const normalizePressureHpa = (value: number | string | null | undefined): number | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.round(numeric * 10) / 10;
};

export const normalizeNoaaPressureHpa = (barometricPressureField: any): number | null => {
  if (barometricPressureField === null || barometricPressureField === undefined) {
    return null;
  }
  if (typeof barometricPressureField === 'number') {
    return normalizePressureHpa(barometricPressureField > 2000 ? barometricPressureField / 100 : barometricPressureField);
  }

  const rawValue = Number(barometricPressureField?.value);
  if (!Number.isFinite(rawValue)) {
    return null;
  }
  const unitCode = String(barometricPressureField?.unitCode || '').toLowerCase();
  if (unitCode.includes('hpa') || unitCode.includes('hectopascal') || unitCode.includes('millibar') || unitCode.includes('mb')) {
    return normalizePressureHpa(rawValue);
  }
  if (unitCode.includes('pa') || rawValue > 2000) {
    return normalizePressureHpa(rawValue / 100);
  }
  return normalizePressureHpa(rawValue);
};

export const clampPercent = (value: number | string | null | undefined): number | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
};

export const inferNoaaCloudCoverFromIcon = (iconUrl: string | null | undefined): number | null => {
  const icon = String(iconUrl || '').toLowerCase();
  if (!icon) {
    return null;
  }
  const tokens = icon
    .split(/[\/,?]/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.some((token) => token.startsWith('ovc'))) return 95;
  if (tokens.some((token) => token.startsWith('bkn'))) return 75;
  if (tokens.some((token) => token.startsWith('sct'))) return 50;
  if (tokens.some((token) => token.startsWith('few'))) return 20;
  if (tokens.some((token) => token === 'skc' || token === 'clr')) return 5;
  return null;
};

export const inferNoaaCloudCoverFromForecastText = (shortForecast: string | null | undefined): number | null => {
  const text = String(shortForecast || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) {
    return null;
  }
  if (text.includes('overcast')) return 95;
  if (text.includes('mostly cloudy')) return 80;
  if (text.includes('partly cloudy') || text.includes('partly sunny')) return 50;
  if (text.includes('mostly sunny')) return 25;
  if (text.includes('sunny') || text.includes('clear')) return 10;
  if (text.includes('cloudy')) return 70;
  return null;
};

export const resolveNoaaCloudCover = (forecastPeriod: any): { value: number | null; source: string } => {
  const skyCoverValue = clampPercent(forecastPeriod?.skyCover?.value);
  if (Number.isFinite(skyCoverValue)) {
    return { value: skyCoverValue, source: 'NOAA skyCover' };
  }
  const fromIcon = inferNoaaCloudCoverFromIcon(forecastPeriod?.icon);
  if (Number.isFinite(fromIcon)) {
    return { value: fromIcon, source: 'NOAA icon-derived cloud cover' };
  }
  const fromText = inferNoaaCloudCoverFromForecastText(forecastPeriod?.shortForecast);
  if (Number.isFinite(fromText)) {
    return { value: fromText, source: 'NOAA shortForecast-derived cloud cover' };
  }
  return { value: null, source: 'Unavailable' };
};

const toFiniteNumberOrNull = (value: any): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const VISIBILITY_RISK_SOURCE = 'Derived from weather description, precipitation, wind, humidity, and cloud cover signals';

export interface VisibilityRisk {
  score: number | null;
  level: string;
  summary: string;
  factors: string[];
  activeHours: number | null;
  windowHours: number | null;
  source: string;
}

export const buildVisibilityRisk = (weatherData: any): VisibilityRisk => {
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
  const factors: string[] = [];
  const addRisk = (points: number, message: string) => {
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
    activeHours = trend.filter((point: any) => {
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

export interface ElevationForecastBand {
  label: string;
  deltaFromObjectiveFt: number;
  elevationFt: number;
  temp: number;
  feelsLike: number | null;
  windSpeed: number;
  windGust: number;
}

interface BuildElevationForecastBandsOptions {
  baseElevationFt: number | null | undefined;
  tempF: number | null | undefined;
  windSpeedMph: number | null | undefined;
  windGustMph: number | null | undefined;
}

export const buildElevationForecastBands = ({ baseElevationFt, tempF, windSpeedMph, windGustMph }: BuildElevationForecastBandsOptions): ElevationForecastBand[] => {
  if (!Number.isFinite(baseElevationFt) || !Number.isFinite(tempF)) {
    return [];
  }

  const objectiveElevationFt = Math.max(0, Math.round(baseElevationFt as number));
  const tF = tempF as number;
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

  const seenElevations = new Set<number>();
  return bandTemplates
    .map((band) => {
      const elevationFt = Math.max(
        0,
        Math.min(objectiveElevationFt, Math.round(objectiveElevationFt + band.deltaFromObjectiveFt)),
      );
      const actualDeltaFromObjectiveFt = elevationFt - objectiveElevationFt;
      const deltaKft = actualDeltaFromObjectiveFt / 1000;
      const estimatedTempF = Math.round(tF - (deltaKft * TEMP_LAPSE_F_PER_1000FT));
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

export const createUnavailableWeatherData = ({ lat, lon, forecastDate }: { lat: number; lon: number; forecastDate: string | null }): any => ({
  temp: null,
  feelsLike: null,
  dewPoint: null,
  elevation: null,
  elevationSource: null,
  elevationUnit: 'ft',
  description: 'Weather data unavailable',
  windSpeed: null,
  windGust: null,
  windDirection: null,
  pressure: null,
  humidity: null,
  cloudCover: null,
  precipChance: null,
  isDaytime: null,
  issuedTime: null,
  timezone: null,
  forecastStartTime: null,
  forecastEndTime: null,
  forecastDate: forecastDate || null,
  trend: [],
  temperatureContext24h: null,
  visibilityRisk: buildVisibilityRisk({
    description: 'Weather data unavailable',
    trend: [],
  }),
  elevationForecast: [],
  elevationForecastNote: 'Weather forecast data unavailable; elevation-based estimate could not be generated.',
  forecastLink: `https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${lon}`,
  sourceDetails: {
    primary: 'Unavailable',
    blended: false,
    fieldSources: {},
  },
});

export const normalizeAlertSeverity = (value: string | null | undefined): string => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'extreme') return 'extreme';
  if (normalized === 'severe') return 'severe';
  if (normalized === 'moderate') return 'moderate';
  if (normalized === 'minor') return 'minor';
  return 'unknown';
};

export const formatAlertSeverity = (value: string | null | undefined): string => {
  const normalized = normalizeAlertSeverity(value);
  if (normalized === 'unknown') return 'Unknown';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

export const getHigherSeverity = (sevA: string, sevB: string): string => {
  const ALERT_SEVERITY_RANK: Record<string, number> = { unknown: 0, minor: 1, moderate: 2, severe: 3, extreme: 4 };
  const rankA = ALERT_SEVERITY_RANK[normalizeAlertSeverity(sevA)] || 0;
  const rankB = ALERT_SEVERITY_RANK[normalizeAlertSeverity(sevB)] || 0;
  return rankA >= rankB ? sevA : sevB;
};

export const createUnavailableAlertsData = (status: string = 'unavailable'): any => ({
  source: 'NOAA/NWS Active Alerts',
  status,
  activeCount: 0,
  totalActiveCount: 0,
  highestSeverity: 'None',
  alerts: [],
});

export const classifyUsAqi = (aqi: number | string | null | undefined): string => {
  const value = Number(aqi);
  if (!Number.isFinite(value)) return 'Unknown';
  if (value <= 50) return 'Good';
  if (value <= 100) return 'Moderate';
  if (value <= 150) return 'Unhealthy for Sensitive Groups';
  if (value <= 200) return 'Unhealthy';
  if (value <= 300) return 'Very Unhealthy';
  return 'Hazardous';
};

export const createUnavailableAirQualityData = (status: string = 'unavailable'): any => ({
  source: 'Open-Meteo Air Quality API',
  status,
  usAqi: null,
  category: 'Unknown',
  pm25: null,
  pm10: null,
  ozone: null,
  measuredTime: null,
});

export const createUnavailableRainfallData = (status: string = 'unavailable'): any => ({
  source: 'Open-Meteo Precipitation History',
  status,
  mode: 'unknown',
  issuedTime: null,
  anchorTime: null,
  timezone: 'UTC',
  expected: {
    status: 'unavailable',
    travelWindowHours: 12,
    startTime: null,
    endTime: null,
    rainWindowMm: null,
    rainWindowIn: null,
    snowWindowCm: null,
    snowWindowIn: null,
    note: 'Expected precipitation forecast unavailable.',
  },
  totals: {
    rainPast12hMm: null,
    rainPast24hMm: null,
    rainPast48hMm: null,
    rainPast12hIn: null,
    rainPast24hIn: null,
    rainPast48hIn: null,
    snowPast12hCm: null,
    snowPast24hCm: null,
    snowPast48hCm: null,
    snowPast12hIn: null,
    snowPast24hIn: null,
    snowPast48hIn: null,
    past12hMm: null,
    past24hMm: null,
    past48hMm: null,
    past12hIn: null,
    past24hIn: null,
    past48hIn: null,
  },
  note: 'Precipitation history and forecast unavailable.',
  link: null,
});

export const buildOpenMeteoRainfallSourceLink = (lat: number, lon: number): string => {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: 'UTC',
    past_days: '3',
    forecast_days: '8',
    hourly: 'precipitation,rain,snowfall',
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
};

export const clampTravelWindowHours = (value: number | string | null | undefined, fallback: number = 12): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(1, Math.min(24, Math.round(numeric)));
};

export const ALERT_SEVERITY_RANK: Record<string, number> = {
  unknown: 0,
  minor: 1,
  moderate: 2,
  severe: 3,
  extreme: 4,
};

export const normalizeNwsAlertText = (value: string | null | undefined, maxLength: number = 4000): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};

export const normalizeNwsAreaList = (areaDescValue: string | null | undefined): string[] => {
  if (typeof areaDescValue !== 'string') {
    return [];
  }
  return areaDescValue
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 12);
};
