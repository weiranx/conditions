import { useId, useState } from "react";
import "./forecast.css";
import { weatherAppearance } from "./weather-appearance";
import {
  buildWeatherTrendRows,
  buildWeatherTrendChartData,
  WEATHER_TREND_METRIC_LABELS,
  type WeatherTrendMetricKey,
} from "../app/weather-card-state";
import { windDirectionFromDegrees } from "../app/wind-analysis";
import { resolveReportFeatureFlags } from "../contexts/feature-flags";
import {
  Check,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  Moon,
  Sun,
  Sunrise,
  Thermometer,
  TriangleAlert,
  Wind,
} from "lucide-react";
import type { PersistedReport } from "../app/report-storage";
import type { WeatherTrendPoint } from "../app/types";
import {
  buildTravelWindowInsights,
  buildTravelWindowRows,
} from "../app/travel-window";
import {
  formatClockForStyle,
  formatTemperatureForUnit,
  formatWindForUnit,
} from "../app/core";

function WeatherSymbol({ point }: { point: WeatherTrendPoint }) {
  const condition = point.condition.toLowerCase();
  if (/thunder|storm|lightning/.test(condition))
    return <CloudLightning size={64} strokeWidth={1.2} aria-hidden="true" />;
  if (/snow|sleet|ice|freezing/.test(condition))
    return <CloudSnow size={64} strokeWidth={1.2} aria-hidden="true" />;
  if (/rain|shower|drizzle/.test(condition))
    return <CloudRain size={64} strokeWidth={1.2} aria-hidden="true" />;
  if (/fog|mist|haze|smoke/.test(condition))
    return <CloudFog size={64} strokeWidth={1.2} aria-hidden="true" />;
  if (/partly|mostly sunny|mostly clear/.test(condition))
    return point.isDaytime === false ? (
      <CloudMoon size={64} strokeWidth={1.2} />
    ) : (
      <CloudSun size={64} strokeWidth={1.2} />
    );
  if (/cloud|overcast/.test(condition))
    return <Cloud size={64} strokeWidth={1.2} aria-hidden="true" />;
  if (/sun|clear|fair/.test(condition))
    return point.isDaytime === false ? (
      <Moon size={64} strokeWidth={1.2} />
    ) : (
      <Sun size={64} strokeWidth={1.2} />
    );
  return <Cloud size={64} strokeWidth={1.2} aria-hidden="true" />;
}

export function Forecast({ report }: { report: PersistedReport }) {
  const [hour, setHour] = useState(0);
  const [metric, setMetric] = useState<WeatherTrendMetricKey>("temp");
  const flags = resolveReportFeatureFlags(report.safetyData.featureFlags);
  const gradientId = useId();
  const preferences = report.preferences!;
  const trend = (report.safetyData.weather.trend || []).slice(
    0,
    report.plan.travelWindowHours,
  );
  const rows = buildTravelWindowRows(trend, preferences, {
    snowDepthIn:
      report.safetyData.terrainCondition?.signals?.maxSnowDepthIn ??
      report.safetyData.snowpack?.snotel?.snowDepthIn ??
      report.safetyData.snowpack?.nohrsc?.snowDepthIn ??
      null,
  }).map((row, index) => {
    const point = trend[index];
    const complete = [
      point.temp,
      point.wind,
      point.gust,
      point.precipChance,
    ].every((value) => typeof value === "number" && Number.isFinite(value));
    return complete
      ? row
      : {
          ...row,
          pass: false,
          reasonSummary:
            "Hourly evidence is incomplete. Verify the missing weather observations.",
        };
  });
  const insight = buildTravelWindowInsights(rows, preferences.timeStyle);
  const selectedIndex = Math.min(hour, Math.max(0, trend.length - 1));
  const selected = trend[selectedIndex];
  const selectedRow = rows[selectedIndex];
  const temp = (value: number | null | undefined) =>
    formatTemperatureForUnit(value, preferences.temperatureUnit);
  const wind = (value: number | null | undefined) =>
    formatWindForUnit(value, preferences.windSpeedUnit);
  const clock = (value: string) =>
    formatClockForStyle(value, preferences.timeStyle);
  const temperatures = trend.map((point) => point.temp).filter(Number.isFinite);
  const low = Math.min(...temperatures);
  const high = Math.max(...temperatures);
  const chart = buildWeatherTrendChartData(
    buildWeatherTrendRows(trend, preferences.timeStyle),
    metric,
  ).map((point) => ({
    ...point,
    value: Number.isFinite(point.value) ? point.value : null,
  }));
  const chartValues = chart
    .map((point) => point.value)
    .filter(
      (value): value is number => value !== null && Number.isFinite(value),
    );
  const chartLow = Math.min(...chartValues);
  const chartHigh = Math.max(...chartValues);
  const metricValue = (value: number | null) =>
    value === null
      ? "Unavailable"
      : ["temp", "feelsLike", "dewPoint"].includes(metric)
        ? temp(value)
        : ["wind", "gust"].includes(metric)
          ? wind(value)
          : metric === "windDirection"
            ? windDirectionFromDegrees(value)
            : `${Math.round(value * 10) / 10}${metric === "pressure" ? " hPa" : "%"}`;
  const points = chart.map((point, index) => ({
    x: 20 + (index * 960) / Math.max(1, trend.length - 1),
    y:
      point.value === null
        ? null
        : 95 -
          ((point.value - chartLow) / Math.max(1, chartHigh - chartLow)) * 65,
  }));
  const chartPath = points
    .map((point, index) =>
      point.y === null
        ? ""
        : `${index === 0 || points[index - 1].y === null ? "M" : "L"} ${point.x},${point.y}`,
    )
    .join(" ");

  if (!selected)
    return (
      <div className="field-empty-inline">
        <CloudSun />
        <h3>Hourly evidence is unavailable.</h3>
        <p>
          The summary forecast remains available in the source evidence.
          Generate a new brief to try again.
        </p>
      </div>
    );

  const appearance = weatherAppearance(selected);
  return (
    <div className="forecast">
      <div
        className={`forecast-sky weather-${appearance.condition} ${appearance.night ? "weather-night" : "weather-day"}`}
        aria-live="polite"
      >
        <div className="forecast-atmosphere" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div className="forecast-current">
          <span className="forecast-eyebrow">
            Forecast at {clock(selected.time)}
          </span>
          <div className="forecast-temperature">
            <strong>{temp(selected.temp)}</strong>
            <WeatherSymbol point={selected} />
          </div>
          <h3>{selected.condition || "Forecast unavailable"}</h3>
          {temperatures.length > 0 && (
            <p className="forecast-range">
              Window high {temp(high)} <span>·</span> Low {temp(low)}
            </p>
          )}
        </div>
        <dl className="forecast-metrics">
          <div>
            <dt>
              <Wind size={16} /> Wind
            </dt>
            <dd>{wind(selected.wind)}</dd>
            <small>Gusts {wind(selected.gust)}</small>
          </div>
          <div>
            <dt>
              <Droplets size={16} /> Precipitation
            </dt>
            <dd>
              {selected.precipChance ?? "—"}
              <span>%</span>
            </dd>
          </div>
          <div>
            <dt>
              <Cloud size={16} /> Cloud cover
            </dt>
            <dd>
              {selected.cloudCover ?? "—"}
              <span>%</span>
            </dd>
          </div>
          <div>
            <dt>
              <Thermometer size={16} /> Feels like
            </dt>
            <dd>
              {temp(
                Number.isFinite(selected.temp) && Number.isFinite(selected.wind)
                  ? selectedRow.feelsLike
                  : null,
              )}
            </dd>
          </div>
        </dl>
        <div className="forecast-context">
          <span>
            Humidity <strong>{selected.humidity ?? "—"}%</strong>
          </span>
          <span>
            Dew point <strong>{temp(selected.dewPoint)}</strong>
          </span>
          <span>
            Pressure <strong>{selected.pressure ?? "—"} hPa</strong>
          </span>
          <span>
            Wind from <strong>{selected.windDirection || "—"}</strong>
          </span>
        </div>
        <div className="forecast-hour-status">
          {selectedRow.pass ? <Check size={16} /> : <TriangleAlert size={16} />}
          <p>
            {selectedRow.pass
              ? "Within your selected weather thresholds at this hour."
              : selectedRow.reasonSummary}
          </p>
        </div>
      </div>

      {flags.hourlyWeatherCharts && (
        <div className="forecast-timeline">
          <div className="forecast-timeline-heading">
            <h3>
              <Thermometer size={16} /> Hour by hour
            </h3>
            <select
              aria-label="Hourly chart metric"
              value={metric}
              onChange={(e) =>
                setMetric(e.target.value as WeatherTrendMetricKey)
              }
            >
              {Object.entries(WEATHER_TREND_METRIC_LABELS).map(
                ([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ),
              )}
            </select>
          </div>
          {chartValues.length > 0 ? (
            <div className="forecast-chart">
              <div className="forecast-chart-readout">
                <strong>{metricValue(chart[selectedIndex].value)}</strong>
                <span>
                  Range {metricValue(chartLow)} – {metricValue(chartHigh)}
                </span>
              </div>
              <svg
                viewBox="0 0 1000 120"
                preserveAspectRatio="none"
                role="img"
                aria-label={`${WEATHER_TREND_METRIC_LABELS[metric]} ranges from ${metricValue(chartLow)} to ${metricValue(chartHigh)} across ${trend.length} forecast hours.`}
              >
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor="currentColor"
                      stopOpacity=".16"
                    />
                    <stop
                      offset="100%"
                      stopColor="currentColor"
                      stopOpacity="0"
                    />
                  </linearGradient>
                </defs>
                <line
                  x1="20"
                  y1="30"
                  x2="980"
                  y2="30"
                  className="forecast-chart-grid"
                />
                <line
                  x1="20"
                  y1="95"
                  x2="980"
                  y2="95"
                  className="forecast-chart-grid"
                />
                {points.every((p) => p.y !== null) && (
                  <path
                    d={`${chartPath} L ${points[points.length - 1].x},115 L ${points[0].x},115 Z`}
                    fill={`url(#${gradientId})`}
                  />
                )}
                <path d={chartPath} className="forecast-chart-line" />
                <line
                  x1={points[selectedIndex].x}
                  y1="15"
                  x2={points[selectedIndex].x}
                  y2="115"
                  className="forecast-chart-selection"
                />
                {points.map((point, index) => (
                  <g
                    key={index}
                    role="button"
                    tabIndex={0}
                    aria-label={`${clock(trend[index].time)}, ${metricValue(chart[index].value)}`}
                    onClick={() => setHour(index)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setHour(index);
                      }
                    }}
                  >
                    {point.y !== null && (
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={index === selectedIndex ? 5 : 2.5}
                        className={
                          index === selectedIndex ? "is-active" : undefined
                        }
                      />
                    )}
                    <rect
                      x={point.x - 20}
                      y="0"
                      width="40"
                      height="120"
                      fill="transparent"
                    />
                  </g>
                ))}
              </svg>
              <div className="forecast-chart-labels">
                <span>{clock(trend[0].time)}</span>
                <span>{clock(trend[trend.length - 1].time)}</span>
              </div>
            </div>
          ) : (
            <p className="field-muted">
              No hourly {WEATHER_TREND_METRIC_LABELS[metric].toLowerCase()}{" "}
              evidence is available.
            </p>
          )}
          <div
            className="forecast-hours"
            role="group"
            aria-label="Select a forecast hour"
          >
            {rows.map((row, index) => {
              return (
                <button
                  key={`${row.time}-${index}`}
                  className={index === selectedIndex ? "is-selected" : ""}
                  aria-pressed={index === selectedIndex}
                  aria-label={`${clock(row.time)}: ${row.pass ? "within thresholds" : row.reasonSummary}`}
                  onClick={() => setHour(index)}
                >
                  <span>{clock(row.time)}</span>
                  <WeatherSymbol point={trend[index]} />
                  <strong>{temp(trend[index].temp)}</strong>
                  <small className={row.pass ? "is-clear" : "is-caution"}>
                    <i />
                    {row.pass ? "Within limits" : "Review"}
                  </small>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="field-window-summary">
        <Sunrise size={23} />
        <div>
          <h3>
            {rows.filter((row) => row.pass).length} of {rows.length} forecast
            hours within limits
          </h3>
          <p>{insight.conditionTrendSummary}</p>
        </div>
      </div>
    </div>
  );
}
