import React from 'react';
import { CloudRain, Thermometer, Wind } from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatClockForStyle } from '../../app/core';
import type { TimeStyle, WeatherTrendPoint } from '../../app/types';

type HourlyMetric = 'temperature' | 'wind' | 'precipitation';

interface TripHourlyWeatherChartProps {
  points: WeatherTrendPoint[];
  dayLabel: string;
  windowLabel: string;
  timeStyle: TimeStyle;
  formatTempDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  formatWindDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
}

const METRICS: Array<{ key: HourlyMetric; label: string; icon: React.ComponentType<{ 'aria-hidden'?: boolean }> }> = [
  { key: 'temperature', label: 'Temperature', icon: Thermometer },
  { key: 'wind', label: 'Wind & gusts', icon: Wind },
  { key: 'precipitation', label: 'Precipitation', icon: CloudRain },
];

const finiteOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function TripHourlyWeatherChart({
  points,
  dayLabel,
  windowLabel,
  timeStyle,
  formatTempDisplay,
  formatWindDisplay,
}: TripHourlyWeatherChartProps) {
  const [metric, setMetric] = React.useState<HourlyMetric>('temperature');
  const chartData = React.useMemo(() => points.map((point) => ({
    time: formatClockForStyle(point.time, timeStyle),
    condition: point.condition,
    temperature: finiteOrNull(point.temp),
    wind: finiteOrNull(point.wind),
    gust: finiteOrNull(point.gust),
    precipitation: finiteOrNull(point.precipChance),
  })), [points, timeStyle]);

  if (chartData.length < 2) return null;

  const formatValue = (value: number): string => {
    if (metric === 'temperature') return formatTempDisplay(value);
    if (metric === 'wind') return formatWindDisplay(value);
    return `${Math.round(value)}%`;
  };
  const yDomain: [number | 'auto', number | 'auto'] = metric === 'precipitation' ? [0, 100] : ['auto', 'auto'];

  return (
    <section className="ssr-trip-panel ssr-trip-hourly" aria-labelledby="trip-hourly-title">
      <div className="ssr-trip-panel-head ssr-trip-hourly-head">
        <div>
          <span>Selected-day timeline</span>
          <h2 id="trip-hourly-title">Hourly weather · {dayLabel}</h2>
          <p>{windowLabel} · Switch metrics to see how conditions change hour by hour.</p>
        </div>
        <div className="ssr-trip-hourly-tabs" role="group" aria-label="Hourly weather metric">
          {METRICS.map(({ key, label, icon: Icon }) => (
            <button
              type="button"
              key={key}
              className={metric === key ? 'is-active' : ''}
              aria-pressed={metric === key}
              onClick={() => setMetric(key)}
            >
              <Icon aria-hidden /> {label}
            </button>
          ))}
        </div>
      </div>
      <div
        className="ssr-trip-hourly-chart"
        role="img"
        aria-label={`${METRICS.find((option) => option.key === metric)?.label} by hour for ${dayLabel}`}
      >
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 900, height: 280 }}>
          <LineChart data={chartData} margin={{ top: 16, right: 20, bottom: 4, left: 4 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke="var(--ssr-line)" strokeDasharray="3 4" />
            <XAxis
              dataKey="time"
              axisLine={false}
              tickLine={false}
              minTickGap={24}
              tick={{ fill: 'var(--ssr-text-3)', fontSize: 10 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={54}
              domain={yDomain}
              tick={{ fill: 'var(--ssr-text-3)', fontSize: 10 }}
              tickFormatter={(value) => formatValue(Number(value))}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--ssr-surface)',
                border: '1px solid var(--ssr-line-strong)',
                borderRadius: 8,
                color: 'var(--ssr-text)',
                fontSize: 12,
              }}
              labelStyle={{ color: 'var(--ssr-text)', fontWeight: 700 }}
              formatter={(value, name) => [formatValue(Number(value)), name]}
            />
            {metric === 'temperature' && (
              <Line
                type="monotone"
                dataKey="temperature"
                name="Temperature"
                stroke="#d56d45"
                strokeWidth={2.5}
                dot={{ r: 3, fill: '#d56d45', strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            )}
            {metric === 'wind' && (
              <>
                <Legend iconType="plainline" wrapperStyle={{ color: 'var(--ssr-text-3)', fontSize: 11, paddingTop: 8 }} />
                <Line type="monotone" dataKey="wind" name="Sustained" stroke="var(--ssr-brand)" strokeWidth={2.25} dot={false} connectNulls />
                <Line type="monotone" dataKey="gust" name="Gust" stroke="var(--ssr-caution-ink)" strokeWidth={2.25} strokeDasharray="5 4" dot={false} connectNulls />
              </>
            )}
            {metric === 'precipitation' && (
              <Line
                type="monotone"
                dataKey="precipitation"
                name="Precipitation chance"
                stroke="var(--ssr-brand)"
                strokeWidth={2.5}
                dot={{ r: 3, fill: 'var(--ssr-brand)', strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
