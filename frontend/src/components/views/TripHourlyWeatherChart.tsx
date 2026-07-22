import React from 'react';
import type { TimeStyle, WeatherTrendPoint } from '../../app/types';

const LazyTripHourlyWeatherChartContent = React.lazy(() =>
  import('./TripHourlyWeatherChartContent').then((module) => ({
    default: module.TripHourlyWeatherChartContent,
  })),
);

export type HourlyMetric = 'temperature' | 'wind' | 'precipitation';

export interface TripHourlyWeatherChartProps {
  points: WeatherTrendPoint[];
  dayLabel: string;
  windowLabel: string;
  timeStyle: TimeStyle;
  formatTempDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  formatWindDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
}

export function TripHourlyWeatherChart(props: TripHourlyWeatherChartProps) {
  const [metric, setMetric] = React.useState<HourlyMetric>('temperature');
  if (props.points.length < 2) return null;

  return (
    <React.Suspense
      fallback={(
        <section
          className="ssr-trip-panel ssr-trip-hourly"
          role="status"
          aria-busy="true"
          aria-labelledby="trip-hourly-loading-title"
        >
          <div className="ssr-trip-panel-head ssr-trip-hourly-head">
            <div>
              <span>Selected-day timeline</span>
              <h2 id="trip-hourly-loading-title">Hourly weather · {props.dayLabel}</h2>
              <p>Loading the hourly timeline…</p>
            </div>
          </div>
          <div className="ssr-trip-hourly-chart" aria-hidden="true" />
        </section>
      )}
    >
      <LazyTripHourlyWeatherChartContent
        {...props}
        metric={metric}
        onMetricChange={setMetric}
      />
    </React.Suspense>
  );
}
