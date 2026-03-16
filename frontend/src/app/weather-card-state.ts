import type { SafetyData, WeatherTrendPoint } from './types';
import type { VisibilityRiskEstimate } from './visibility';
import {
  formatClockForStyle,
  minutesToTwentyFourHourClock,
  parseHourLabelToMinutes,
  parseOptionalFiniteNumber,
  parseSolarClockMinutes,
  parseTimeInputMinutes,
} from './core';
import { computeFeelsLikeF } from './planner-helpers';
import {
  normalizeWindHintDirection,
} from './wind-analysis';
import { windDirectionToDegrees } from '../utils/avalanche';
import {
  weatherConditionEmoji,
} from './weather-display';
import {
  estimateVisibilityRiskFromPoint,
  normalizeVisibilityRiskLevel,
  visibilityRiskPillClass,
} from './visibility';
import type { TimeStyle } from './types';

export type WeatherTrendMetricKey =
  | 'temp'
  | 'feelsLike'
  | 'wind'
  | 'gust'
  | 'pressure'
  | 'precipChance'
  | 'humidity'
  | 'dewPoint'
  | 'cloudCover'
  | 'windDirection';

export const WEATHER_TREND_METRIC_LABELS: Record<WeatherTrendMetricKey, string> = {
  temp: 'Temp',
  feelsLike: 'Feels-like',
  wind: 'Wind',
  gust: 'Gust',
  pressure: 'Pressure',
  precipChance: 'Precip',
  humidity: 'Humidity',
  dewPoint: 'Dew Point',
  cloudCover: 'Cloud Cover',
  windDirection: 'Wind Direction',
};

export type WeatherTrendChartRow = {
  label: string;
  hourValue: string | null;
  temp: number | null;
  feelsLike: number | null;
  wind: number | null;
  gust: number | null;
  pressure: number | null;
  precipChance: number | null;
  humidity: number | null;
  dewPoint: number | null;
  cloudCover: number | null;
  windDirection: number | null;
  windDirectionLabel: string | null;
};

export function buildWeatherTrendRows(
  trendWindow: WeatherTrendPoint[],
  timeStyle: TimeStyle,
): WeatherTrendChartRow[] {
  return trendWindow.map((point) => {
    const parsedPointMinutes =
      parseTimeInputMinutes(String(point?.time || '').trim()) ??
      parseHourLabelToMinutes(String(point?.time || '').trim()) ??
      parseSolarClockMinutes(point?.time || undefined);
    const temp = parseOptionalFiniteNumber(point?.temp);
    const wind = parseOptionalFiniteNumber(point?.wind);
    const gust = parseOptionalFiniteNumber(point?.gust);
    const pressure = parseOptionalFiniteNumber(point?.pressure);
    const humidity = parseOptionalFiniteNumber(point?.humidity);
    const dewPoint = parseOptionalFiniteNumber(point?.dewPoint);
    const cloudCover = parseOptionalFiniteNumber(point?.cloudCover);
    const windDirectionLabel = normalizeWindHintDirection(point?.windDirection || null);
    const windDirectionDegrees =
      windDirectionLabel && windDirectionLabel !== 'CALM' && windDirectionLabel !== 'VRB'
        ? windDirectionToDegrees(windDirectionLabel)
        : null;
    return {
      label: formatClockForStyle(point?.time || '', timeStyle),
      hourValue: parsedPointMinutes === null ? null : minutesToTwentyFourHourClock(parsedPointMinutes),
      temp,
      feelsLike: temp !== null && wind !== null ? computeFeelsLikeF(temp, wind) : null,
      wind,
      gust: gust ?? wind,
      pressure,
      precipChance: parseOptionalFiniteNumber(point?.precipChance),
      humidity,
      dewPoint,
      cloudCover,
      windDirection: windDirectionDegrees,
      windDirectionLabel: windDirectionLabel || null,
    };
  });
}

export function weatherTrendValueForMetric(row: WeatherTrendChartRow, metric: WeatherTrendMetricKey): number | null {
  switch (metric) {
    case 'temp': return row.temp;
    case 'feelsLike': return row.feelsLike;
    case 'wind': return row.wind;
    case 'gust': return row.gust;
    case 'pressure': return row.pressure;
    case 'precipChance': return row.precipChance;
    case 'humidity': return row.humidity;
    case 'dewPoint': return row.dewPoint;
    case 'cloudCover': return row.cloudCover;
    case 'windDirection': return row.windDirection;
    default: return null;
  }
}

export function buildWeatherTrendChartData(
  rows: WeatherTrendChartRow[],
  metric: WeatherTrendMetricKey,
) {
  return rows.map((row) => ({
    label: row.label,
    hourValue: row.hourValue,
    value: weatherTrendValueForMetric(row, metric),
    windDirectionLabel: row.windDirectionLabel,
  }));
}

export function buildPressureTrend(
  rows: WeatherTrendChartRow[],
  travelWindowHoursLabel: string,
): { summary: string; direction: string; deltaLabel: string; rangeLabel: string } | null {
  const pressureValues = rows
    .map((row) => row.pressure)
    .filter((value): value is number => Number.isFinite(Number(value)));
  if (pressureValues.length < 2) return null;
  const start = pressureValues[0];
  const end = pressureValues[pressureValues.length - 1];
  const delta = end - start;
  const direction = delta >= 1 ? 'Rising' : delta <= -1 ? 'Falling' : 'Steady';
  const deltaLabel = `${delta > 0 ? '+' : ''}${delta.toFixed(1)} hPa`;
  const rangeLabel = `${start.toFixed(1)} → ${end.toFixed(1)} hPa`;
  const summary = `${direction} pressure over ${travelWindowHoursLabel}: ${deltaLabel} (${rangeLabel})`;
  return { summary, direction, deltaLabel, rangeLabel };
}

export function buildWeatherTrendTempRange(rows: WeatherTrendChartRow[]) {
  const temps = rows.map(r => r.temp).filter((t): t is number => Number.isFinite(Number(t)));
  if (temps.length < 2) return null;
  return { low: Math.min(...temps), high: Math.max(...temps) };
}

export function getWeatherTrendLineColor(metric: WeatherTrendMetricKey): string {
  switch (metric) {
    case 'temp': return '#d56d45';
    case 'feelsLike': return '#c8576f';
    case 'wind': return '#3f82b8';
    case 'gust': return '#d2993a';
    case 'pressure': return '#5f7f92';
    case 'precipChance': return '#1f7d65';
    case 'humidity': return '#3b9bb8';
    case 'dewPoint': return '#5b7ca0';
    case 'cloudCover': return '#7f8e99';
    default: return '#6d7a88';
  }
}

export function getWeatherTrendYAxisDomain(metric: WeatherTrendMetricKey): [number, number] | ['auto', 'auto'] {
  if (metric === 'windDirection') return [0, 360];
  if (metric === 'precipChance' || metric === 'humidity' || metric === 'cloudCover') return [0, 100];
  return ['auto', 'auto'];
}

export function buildWeatherTrendMetricOptions(
  tempUnitLabel: string,
  windUnitLabel: string,
): Array<{ key: WeatherTrendMetricKey; label: string }> {
  return [
    { key: 'temp', label: `Temp (${tempUnitLabel})` },
    { key: 'feelsLike', label: `Feels (${tempUnitLabel})` },
    { key: 'wind', label: `Wind (${windUnitLabel})` },
    { key: 'gust', label: `Gust (${windUnitLabel})` },
    { key: 'pressure', label: 'Pressure (hPa)' },
    { key: 'precipChance', label: 'Precip (%)' },
    { key: 'humidity', label: 'Humidity (%)' },
    { key: 'dewPoint', label: `Dew (${tempUnitLabel})` },
    { key: 'cloudCover', label: 'Cloud (%)' },
    { key: 'windDirection', label: 'Wind Dir (deg)' },
  ];
}

export interface WeatherHourOption {
  value: string;
  label: string;
  tempLabel: string | null;
  point: WeatherTrendPoint;
}

export function buildWeatherHourQuickOptions(
  safetyData: SafetyData | null,
  timeStyle: TimeStyle,
  formatTempDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string,
): WeatherHourOption[] {
  const options: WeatherHourOption[] = [];
  if (!safetyData || !Array.isArray(safetyData.weather.trend)) return options;
  const seenStartTimes = new Set<string>();
  for (const point of safetyData.weather.trend) {
    const rawTime = String(point?.time || '').trim();
    const parsedMinutes =
      parseTimeInputMinutes(rawTime) ??
      parseHourLabelToMinutes(rawTime) ??
      parseSolarClockMinutes(rawTime || undefined);
    if (parsedMinutes === null) continue;
    const value = minutesToTwentyFourHourClock(parsedMinutes);
    if (seenStartTimes.has(value)) continue;
    seenStartTimes.add(value);
    options.push({
      value,
      label: formatClockForStyle(value, timeStyle),
      tempLabel: Number.isFinite(Number(point?.temp)) ? formatTempDisplay(Number(point?.temp)) : null,
      point,
    });
    if (options.length >= 12) break;
  }
  return options;
}

export function findSelectedWeatherHourIndex(
  options: WeatherHourOption[],
  activeValue: string,
): number {
  if (!options.length) return -1;
  const exactIndex = options.findIndex((option) => option.value === activeValue);
  if (exactIndex >= 0) return exactIndex;
  const selectedMinutes = parseTimeInputMinutes(activeValue);
  if (selectedMinutes === null) return 0;
  let bestIndex = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  options.forEach((option, index) => {
    const optionMinutes = parseTimeInputMinutes(option.value);
    if (optionMinutes === null) return;
    let diff = Math.abs(optionMinutes - selectedMinutes);
    if (diff > 720) diff = 1440 - diff;
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = index;
    }
  });
  return bestIndex;
}

export interface WeatherCardValues {
  temp: number;
  wind: number;
  gust: number;
  feelsLike: number;
  description: string;
  isDaytime: boolean | null | undefined;
  emoji: string;
  withEmoji: string;
  precip: number;
  humidity: number;
  dewPoint: number;
  pressure: number | null;
  pressureLabel: string;
  pressureContextLine: string;
  windDirection: string;
  cloudCover: number | null;
  cloudCoverLabel: string;
  displayTime: string;
}

export function buildWeatherCardValues(
  safetyData: SafetyData | null,
  weatherPreviewPoint: WeatherTrendPoint | null,
  selectedHourLabel: string | undefined,
  alpineStartTime: string,
  timeStyle: TimeStyle,
  formatElevationDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean }) => string,
): WeatherCardValues {
  const temp = Number.isFinite(Number(weatherPreviewPoint?.temp)) ? Number(weatherPreviewPoint?.temp) : Number(safetyData?.weather.temp);
  const wind = Number.isFinite(Number(weatherPreviewPoint?.wind)) ? Number(weatherPreviewPoint?.wind) : Number(safetyData?.weather.windSpeed);
  const gust = Number.isFinite(Number(weatherPreviewPoint?.gust)) ? Number(weatherPreviewPoint?.gust) : Number(safetyData?.weather.windGust);
  const feelsLike = Number.isFinite(temp)
    ? computeFeelsLikeF(temp, Number.isFinite(wind) ? wind : 0)
    : Number(safetyData?.weather.feelsLike ?? safetyData?.weather.temp);
  const description = String(weatherPreviewPoint?.condition || safetyData?.weather.description || 'Unknown');
  const isDaytime = typeof weatherPreviewPoint?.isDaytime === 'boolean' ? weatherPreviewPoint.isDaytime : safetyData?.weather.isDaytime;
  const emoji = weatherConditionEmoji(description, isDaytime ?? null);
  const precip = Number.isFinite(Number(weatherPreviewPoint?.precipChance))
    ? Math.round(Number(weatherPreviewPoint?.precipChance))
    : Number(safetyData?.weather.precipChance);
  const humidity = Number.isFinite(Number(weatherPreviewPoint?.humidity))
    ? Number(weatherPreviewPoint?.humidity)
    : Number(safetyData?.weather.humidity);
  const dewPoint = Number.isFinite(Number(weatherPreviewPoint?.dewPoint))
    ? Number(weatherPreviewPoint?.dewPoint)
    : Number(safetyData?.weather.dewPoint);
  const pressure = Number.isFinite(Number(weatherPreviewPoint?.pressure))
    ? Number(weatherPreviewPoint?.pressure)
    : parseOptionalFiniteNumber(safetyData?.weather.pressure);
  const pressureLabel = Number.isFinite(Number(pressure)) ? `${Number(pressure).toFixed(1)} hPa` : 'N/A';

  const pressureObjectiveElevationFt = Number(safetyData?.weather.elevation);
  const estimatedSeaLevelPressureHpa =
    Number.isFinite(Number(pressure)) && Number.isFinite(pressureObjectiveElevationFt) && pressureObjectiveElevationFt >= 0
      ? Number(pressure) * Math.exp((pressureObjectiveElevationFt * 0.3048) / 8434.5)
      : Number.NaN;
  const estimatedSeaLevelPressureLabel = Number.isFinite(estimatedSeaLevelPressureHpa)
    ? `${estimatedSeaLevelPressureHpa.toFixed(1)} hPa`
    : null;
  const pressureContextLine = Number.isFinite(Number(pressure))
    ? [
        Number.isFinite(pressureObjectiveElevationFt) ? `Station at ${formatElevationDisplay(pressureObjectiveElevationFt)}` : 'Station pressure',
        estimatedSeaLevelPressureLabel ? `Sea-level est ${estimatedSeaLevelPressureLabel}` : null,
      ].filter(Boolean).join(' • ')
    : 'Pressure unavailable from selected forecast hour.';

  const windDirection = normalizeWindHintDirection(weatherPreviewPoint?.windDirection ?? safetyData?.weather.windDirection ?? null) || 'N/A';
  const weatherCloudCover = parseOptionalFiniteNumber(safetyData?.weather.cloudCover);
  const cloudCover = Number.isFinite(Number(weatherPreviewPoint?.cloudCover))
    ? Number(weatherPreviewPoint?.cloudCover)
    : weatherCloudCover;
  const cloudCoverLabel = Number.isFinite(cloudCover) ? `${Math.round(cloudCover!)}%` : 'N/A';
  const displayTime = selectedHourLabel || formatClockForStyle(alpineStartTime, timeStyle);

  return {
    temp, wind, gust, feelsLike,
    description, isDaytime, emoji,
    withEmoji: `${emoji} ${description}`,
    precip, humidity, dewPoint,
    pressure, pressureLabel, pressureContextLine,
    windDirection, cloudCover, cloudCoverLabel,
    displayTime,
  };
}

export interface VisibilityRiskDisplay {
  risk: VisibilityRiskEstimate;
  pill: 'go' | 'caution' | 'nogo' | 'watch';
  scoreLabel: string;
  scoreMeaning: string;
  detail: string;
  contextLine: string | null;
  activeWindowText: string | null;
}

export function buildVisibilityRiskDisplay(
  safetyData: SafetyData | null,
  weatherPreviewActive: boolean,
  cardValues: WeatherCardValues,
): VisibilityRiskDisplay {
  const fallback = estimateVisibilityRiskFromPoint({
    description: cardValues.description,
    precipChance: cardValues.precip,
    wind: cardValues.wind,
    gust: cardValues.gust,
    humidity: cardValues.humidity,
    cloudCover: cardValues.cloudCover,
    isDaytime: cardValues.isDaytime ?? null,
  });

  const backendScore = parseOptionalFiniteNumber(safetyData?.weather.visibilityRisk?.score ?? null);
  const backendLevel = normalizeVisibilityRiskLevel(
    safetyData?.weather.visibilityRisk?.level ?? null,
    backendScore,
  );
  const backendFactors =
    Array.isArray(safetyData?.weather.visibilityRisk?.factors) && safetyData!.weather.visibilityRisk!.factors!.length > 0
      ? safetyData!.weather.visibilityRisk!.factors!.slice(0, 3)
      : [];
  const backendSummary = String(safetyData?.weather.visibilityRisk?.summary || '').trim();
  const backendActiveHours = parseOptionalFiniteNumber(safetyData?.weather.visibilityRisk?.activeHours ?? null);
  const backendWindowHours = parseOptionalFiniteNumber(safetyData?.weather.visibilityRisk?.windowHours ?? null);

  const risk: VisibilityRiskEstimate = weatherPreviewActive
    ? fallback
    : {
        score: backendScore ?? fallback.score,
        level: backendScore !== null || backendLevel !== 'Unknown' ? backendLevel : fallback.level,
        summary: backendSummary || fallback.summary,
        factors: backendFactors.length > 0 ? backendFactors : fallback.factors,
        activeHours: backendActiveHours,
        windowHours: backendWindowHours,
        source: String(safetyData?.weather.visibilityRisk?.source || fallback.source),
      };

  const pill = visibilityRiskPillClass(risk.level);
  const scoreLabel = Number.isFinite(Number(risk.score)) ? `${Math.round(Number(risk.score))}/100` : 'N/A';
  const scoreMeaning = Number.isFinite(Number(risk.score)) ? 'Higher score = worse visibility risk.' : 'Visibility score unavailable.';
  const detail = risk.factors.length > 0 ? risk.factors.join(' • ') : risk.summary;

  const contextLine = (() => {
    const precip = Number.isFinite(Number(cardValues.precip)) ? Number(cardValues.precip) : null;
    if ((risk.level === 'Minimal' || risk.level === 'Low') && precip !== null && precip >= 40) {
      return 'Precip signal is present, but no strong fog/blowing-snow/wind combination is detected at this hour.';
    }
    return null;
  })();

  const activeWindowText =
    Number.isFinite(risk.activeHours) &&
    Number.isFinite(risk.windowHours) &&
    Number(risk.windowHours) > 0
      ? `${Math.round(Number(risk.activeHours))}/${Math.round(Number(risk.windowHours))}h low-vis signal`
      : null;

  return { risk, pill, scoreLabel, scoreMeaning, detail, contextLine, activeWindowText };
}
