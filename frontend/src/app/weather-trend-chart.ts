import type { WeatherTrendRow } from './types';

// Which of the backend's hourly weather rows a chart draws, and its name.

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

/** One point per hour for the chosen measurement; null where the hour has no reading. */
export function buildWeatherTrendChartData(rows: WeatherTrendRow[], metric: WeatherTrendMetricKey) {
  return rows.map((row) => ({
    label: row.label,
    hourValue: row.hourValue,
    value: row[metric],
    windDirectionLabel: row.windDirectionLabel,
  }));
}
