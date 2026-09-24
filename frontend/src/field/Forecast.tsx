import { useState } from "react";
import "./sky/sky.css";
import "./sky/parts.css";
import "./forecast.css";
import { buildReportWeatherRows } from "./report-weather";
import { weatherAppearance } from "./weather-appearance";
import { bluebirdPercentage } from "../app/bluebird";
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
  CircleHelp,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Moon,
  Sun,
  TriangleAlert,
} from "lucide-react";
import type { PersistedReport } from "../app/report-storage";
import { summarizeApproachHours, type ApproachProfile } from "../app/approach-elevation";
import { computeFeelsLikeF } from "../app/planner-helpers";
import type { WeatherTrendPoint } from "../app/types";
import { buildTravelWindowInsights } from "../app/travel-window";
import {
  formatClockForStyle,
  formatTemperatureForUnit,
  formatWindForUnit,
  parseHourLabelToMinutes,
  parseSolarClockMinutes,
  parseTimeInputMinutes,
} from "../app/core";
import { HourChart, type HourChartKind, type HourGuide, type HourTone } from "./sky/HourChart";
import { buildSkyHours, shortHour, type PlannedRow } from "./sky/sky-model";
import { plainReason } from "./sky/status";

function WeatherSymbol({ point, size = 22 }: { point: Pick<WeatherTrendPoint, "condition" | "isDaytime">; size?: number }) {
  const condition = (point.condition || "").toLowerCase();
  const props = { size, strokeWidth: 1.6, "aria-hidden": true } as const;
  if (/thunder|storm|lightning/.test(condition)) return <CloudLightning {...props} />;
  if (/snow|sleet|ice|freezing/.test(condition)) return <CloudSnow {...props} />;
  if (/rain|shower|drizzle/.test(condition)) return <CloudRain {...props} />;
  if (/fog|mist|haze|smoke/.test(condition)) return <CloudFog {...props} />;
  if (/partly|mostly sunny|mostly clear/.test(condition))
    return point.isDaytime === false ? <CloudMoon {...props} /> : <CloudSun {...props} />;
  if (/cloud|overcast/.test(condition)) return <Cloud {...props} />;
  if (/sun|clear|fair/.test(condition))
    return point.isDaytime === false ? <Moon {...props} /> : <Sun {...props} />;
  return <Cloud {...props} />;
}

// The measurements a traveller picks between first; the rest follow.
const METRICS: WeatherTrendMetricKey[] = ["temp", "feelsLike", "gust", "wind", "precipChance", "cloudCover", "humidity", "dewPoint", "pressure", "windDirection"];

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function Forecast({ report, approach = null, elevation = (ft) => `${ft} ft` }: {
  report: PersistedReport;
  /** When set, hours are checked at the party's estimated elevation, matching the brief. */
  approach?: ApproachProfile | null;
  elevation?: (ft: number) => string;
}) {
  const [hour, setHour] = useState(0);
  const [metric, setMetric] = useState<WeatherTrendMetricKey>("temp");
  const flags = resolveReportFeatureFlags(report.safetyData.featureFlags);
  const preferences = report.preferences!;
  const trend = (report.safetyData.weather.trend || []).slice(0, report.plan.travelWindowHours);
  const rows = buildReportWeatherRows(report.safetyData, preferences, report.plan.travelWindowHours,
    approach ? { profile: approach, start: report.plan.alpineStartTime } : null);
  const approachSummary = summarizeApproachHours(rows);
  const nearFt = (ft: number | undefined) => elevation(Math.round((ft ?? 0) / 100) * 100);
  // The values a row was actually checked against: the party's elevation on the approach.
  const checkedPoint = (index: number) => {
    const point = trend[index];
    const row = rows[index];
    if (!row?.approachAdjusted) return point;
    return {
      ...point,
      temp: finite(point.temp) ? row.temp : point.temp,
      wind: finite(point.wind) ? row.wind : point.wind,
      gust: row.gust,
    };
  };
  const bluebird = bluebirdPercentage(trend);
  const insight = buildTravelWindowInsights(rows, preferences.timeStyle);
  const selectedIndex = Math.min(hour, Math.max(0, trend.length - 1));
  const selected = trend[selectedIndex];
  const selectedRow = rows[selectedIndex];
  const temp = (value: number | null | undefined) => formatTemperatureForUnit(value, preferences.temperatureUnit);
  const wind = (value: number | null | undefined) => formatWindForUnit(value, preferences.windSpeedUnit);
  const percent = (value: number | null | undefined) => (finite(value) ? `${Math.round(value)}%` : "—");
  const clock = (value: string) => formatClockForStyle(value, preferences.timeStyle);

  if (!selected)
    return (
      <div className="field-empty-inline">
        <CloudSun />
        <h3>Hourly forecast is unavailable.</h3>
        <p>
          The summary forecast is still available under Checks &amp; sources.
          Generate a new report to try again.
        </p>
      </div>
    );

  const temperatures = trend.map((point) => point.temp).filter(finite);
  const low = Math.min(...temperatures);
  const high = Math.max(...temperatures);
  const tones: HourTone[] = rows.map((row) => row.failedRules.length > 0 ? "over" : !row.complete ? "missing" : row.pass ? "within" : "over");
  const minutes = trend.map((point) => parseTimeInputMinutes(point.time) ?? parseHourLabelToMinutes(point.time) ?? NaN);
  const labels = minutes.map((m, i) => Number.isFinite(m) ? shortHour(m, preferences.timeStyle === "24h" ? "24h" : "12h") : clock(trend[i].time));
  const sky = buildSkyHours(rows as PlannedRow[], {
    start: trend[0].time,
    sunriseMinutes: parseSolarClockMinutes(report.safetyData.solar?.sunrise),
    sunsetMinutes: parseSolarClockMinutes(report.safetyData.solar?.sunset),
  });
  const tints = sky.map((h) => h.horizon);

  const trendRows = buildWeatherTrendRows(trend, preferences.timeStyle);
  const chart = buildWeatherTrendChartData(trendRows, metric)
    .map((point) => (finite(point.value) ? point.value : null));
  const windArrows = buildWeatherTrendChartData(trendRows, "windDirection").map((point) => (finite(point.value) ? point.value : null));
  const isTemp = ["temp", "feelsLike", "dewPoint"].includes(metric);
  const isPercent = ["precipChance", "cloudCover", "humidity"].includes(metric);
  const chartKind: HourChartKind = metric === "windDirection" ? "direction" : isPercent ? "bars" : "line";
  const chartPalette = isTemp ? "temperature" : metric === "precipChance" || metric === "humidity" ? "cold" : "neutral";
  const isWind = ["wind", "gust"].includes(metric);
  const metricValue = (value: number) =>
    isTemp ? temp(value)
        : isWind ? wind(value)
          : metric === "windDirection" ? windDirectionFromDegrees(value)
            : `${Math.round(value * 10) / 10}${metric === "pressure" ? " hPa" : "%"}`;
  const compactValue = (value: number) =>
    isTemp ? formatTemperatureForUnit(value, preferences.temperatureUnit, { includeUnit: false })
      : isWind ? formatWindForUnit(value, preferences.windSpeedUnit).replace(/\s*[a-z/]+$/i, "")
        : metric === "windDirection" ? windDirectionFromDegrees(value)
          : metric === "pressure" ? `${Math.round(value)}` : `${Math.round(value)}%`;
  const guides: HourGuide[] = isTemp
    ? [{ value: 32, label: `freezing ${temp(32)}`, tone: "cold" },
      ...(metric === "feelsLike" ? [{ value: preferences.minFeelsLikeF, label: `your floor ${temp(preferences.minFeelsLikeF)}`, tone: "caution" as const }] : [])]
    : metric === "gust" ? [{ value: preferences.maxWindGustMph, label: `your limit ${wind(preferences.maxWindGustMph)}`, tone: "caution" }]
      : metric === "precipChance" ? [{ value: preferences.maxPrecipChance, label: `your limit ${preferences.maxPrecipChance}%`, tone: "caution" }]
        : [];

  // Lead: what the traveller needs from this chapter in two sentences.
  const overIdx = tones.flatMap((t, i) => (t === "over" ? [i] : []));
  const missingCount = tones.filter((t) => t === "missing").length;
  const gusts = trend.map((p) => p.gust).filter(finite);
  const peakGust = gusts.length ? Math.max(...gusts) : null;
  const peakGustAt = peakGust === null ? -1 : trend.findIndex((p) => p.gust === peakGust);
  const rains = trend.map((p) => p.precipChance).filter(finite);
  const peakRain = rains.length ? Math.max(...rains) : null;
  const peakRainAt = peakRain === null ? -1 : trend.findIndex((p) => p.precipChance === peakRain);
  const lowAt = temperatures.length ? trend.findIndex((p) => p.temp === low) : -1;

  const appearance = weatherAppearance(selected);
  const tone = tones[selectedIndex];
  // The readout shows the objective forecast; approach hours add what was checked below it.
  const feelsLike = finite(selected.temp) && finite(selected.wind) ? computeFeelsLikeF(selected.temp, selected.wind) : null;
  const selectedAdjusted = Boolean(selectedRow?.approachAdjusted);

  return (
    <div className="forecast sky-weather">
      <p className="sky-lead">
        {overIdx.length > 0
          ? <><strong className="is-over">{overIdx.length} of {rows.length} hours</strong> cross your limits, starting {clock(trend[overIdx[0]].time)}. </>
          : missingCount > 0
            ? <><strong className="is-missing">{missingCount} of {rows.length} hours</strong> have incomplete readings; the rest are within your limits. </>
            : <><strong>All {rows.length} hours</strong> are within your limits. </>}
        {peakGust !== null && <>Gusts peak at <strong>{wind(peakGust)}</strong> at {clock(trend[peakGustAt].time)}</>}
        {peakRain !== null && <>{peakGust !== null ? " and rain chance at " : "Rain chance peaks at "}<strong>{peakRain}%</strong> at {clock(trend[peakRainAt].time)}</>}
        {(peakGust !== null || peakRain !== null) && ". "}
        {temperatures.length > 0 && <>The low is <strong>{temp(low)}</strong> at {clock(trend[lowAt].time)}. </>}
        <span className="sky-lead-note">{insight.conditionTrendSummary}</span>
        {approachSummary && (
          <span className="sky-lead-note">
            {" "}{approachSummary.adjustedHours} h {approachSummary.adjustedHours === 1 ? "is" : "are"} checked at your
            estimated elevation ({approachSummary.lowFt === approachSummary.highFt ? `~${nearFt(approachSummary.lowFt)}` : `~${nearFt(approachSummary.lowFt)}–${nearFt(approachSummary.highFt)}`}),
            not the summit; the chart shows the summit forecast.
          </span>
        )}
      </p>

      <section className="sky-section" aria-labelledby="sky-weather-hours">
        <div className="sky-sh">
          <h2 id="sky-weather-hours">Hour by hour</h2>
          <p>Pick a measurement. Hatched hours cross a limit; the strip below shows daylight.</p>
        </div>
        <div className="sky-card sky-hour-card">
          {flags.hourlyWeatherCharts && (
            <>
              <div className="sky-segmented" role="group" aria-label="Hourly chart metric">
                {METRICS.map((key) => (
                  <button key={key} type="button" aria-pressed={metric === key} onClick={() => setMetric(key)}>
                    {WEATHER_TREND_METRIC_LABELS[key]}
                  </button>
                ))}
              </div>
              {chart.some((v) => v !== null) ? (
                <HourChart labels={labels} values={chart} tones={tones} tints={tints} guides={guides}
                  format={compactValue} describe={metricValue} selected={selectedIndex} onSelect={setHour}
                  kind={chartKind} palette={chartPalette} coldBelow={isTemp ? 32 : undefined}
                  domain={isPercent ? [0, 100] : undefined} arrows={isWind ? windArrows : undefined}
                  label={`${WEATHER_TREND_METRIC_LABELS[metric]} by hour. Use the arrow keys to move between hours.`} />
              ) : (
                <p className="sky-empty">
                  No hourly {WEATHER_TREND_METRIC_LABELS[metric].toLowerCase()} data is available.
                </p>
              )}
            </>
          )}
          <div className={`forecast-readout weather-${appearance.condition} ${appearance.night ? "weather-night" : "weather-day"} is-${tone}`} aria-live="polite">
            <div className="forecast-readout-main">
              <span className="sky-muted">Forecast at {clock(selected.time)}</span>
              <div className="forecast-readout-temp">
                <strong>{temp(selected.temp)}</strong>
                <WeatherSymbol point={selected} size={34} />
              </div>
              <span>{selected.condition || "Forecast unavailable"}</span>
            </div>
            <dl className="forecast-readout-grid">
              <div><dt>Feels like</dt><dd>{temp(feelsLike)}</dd></div>
              <div><dt>Wind</dt><dd>{wind(selected.wind)}</dd></div>
              <div><dt>Gusts</dt><dd className={!selectedAdjusted && selectedRow.failedRuleLabels.includes("Gust above limit") ? "is-over" : undefined}>{wind(selected.gust)}</dd></div>
              <div><dt>Rain chance</dt><dd className={selectedRow.failedRuleLabels.includes("Precip above limit") ? "is-over" : undefined}>{percent(selected.precipChance)}</dd></div>
              <div><dt>Cloud cover</dt><dd>{percent(selected.cloudCover)}</dd></div>
              <div><dt>Humidity</dt><dd>{percent(selected.humidity)}</dd></div>
              <div><dt>Dew point</dt><dd>{temp(selected.dewPoint)}</dd></div>
              <div><dt>Pressure</dt><dd>{selected.pressure ?? "—"} hPa</dd></div>
              <div><dt>Wind from</dt><dd>{selected.windDirection || "—"}</dd></div>
            </dl>
            {selectedAdjusted && (
              <p className="forecast-readout-approach">
                Checked near {nearFt(selectedRow.elevationFt)} on the approach: feels like{" "}
                {finite(selected.temp) && finite(selected.wind) ? temp(selectedRow.feelsLike) : "—"}, gusts {wind(selectedRow.gust)}.
                {selectedRow.inversionRisk ? " Clear, calm conditions: the trailhead may be colder than the summit." : ""}
              </p>
            )}
            <p className={`forecast-readout-status is-${tone}`}>
              {tone === "within" ? <Check size={16} aria-hidden="true" /> : tone === "over" ? <TriangleAlert size={16} aria-hidden="true" /> : <CircleHelp size={16} aria-hidden="true" />}
              <span>{selectedRow.pass ? "Within your weather limits at this hour." : plainReason(selectedRow.reasonSummary, selectedRow.failedRules)}</span>
            </p>
          </div>
        </div>
      </section>

      <section className="sky-section" aria-labelledby="sky-weather-table">
        <div className="sky-sh">
          <h2 id="sky-weather-table">Every hour against your limits</h2>
          <p>Select an hour to see all of its readings above.</p>
        </div>
        <div className="sky-card sky-table-card">
          <table className="sky-table">
            <thead>
              <tr>
                <th scope="col">Hour</th>
                <th scope="col" className="is-sky"><span className="sr-only">Sky</span></th>
                <th scope="col" className="is-num">Temp</th>
                <th scope="col" className="is-num">Feels</th>
                <th scope="col" className="is-num">Gust</th>
                <th scope="col" className="is-num">Rain</th>
                <th scope="col" className="is-end">Limits</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const point = checkedPoint(index);
                const t = tones[index];
                const gustOver = row.failedRuleLabels.includes("Gust above limit");
                const rainOver = row.failedRuleLabels.includes("Precip above limit");
                const coldOver = row.failedRuleLabels.includes("Feels-like below limit") || row.failedRuleLabels.includes("Heat above limit");
                return (
                  <tr key={`${row.time}-${index}`} className={`is-${t}${index === selectedIndex ? " is-selected" : ""}`}>
                    <th scope="row">
                      <button type="button" aria-pressed={index === selectedIndex} onClick={() => setHour(index)}
                        aria-label={`${clock(row.time)}${row.approachAdjusted ? `, checked near ${nearFt(row.elevationFt)}` : ""}: ${row.pass ? "within thresholds" : row.reasonSummary}`}>
                        {clock(row.time)}
                      </button>
                      {row.approachAdjusted && (
                        <small className="sky-approach-tag" aria-hidden="true">
                          ~{nearFt(row.elevationFt)}{row.inversionRisk ? " · inversion" : ""}
                        </small>
                      )}
                    </th>
                    <td className="is-sky"><WeatherSymbol point={point} size={18} /></td>
                    <td className={`is-num${finite(point.temp) && point.temp <= 32 ? " is-cold" : ""}`}>{temp(point.temp)}</td>
                    <td className={`is-num${coldOver ? " is-over" : finite(row.feelsLike) && row.feelsLike <= 32 ? " is-cold" : ""}`}>{finite(point.temp) && finite(point.wind) ? temp(row.feelsLike) : "—"}</td>
                    <td className={`is-num${gustOver ? " is-over" : ""}`}>{wind(point.gust)}</td>
                    <td className={`is-num${rainOver ? " is-over" : ""}`}>{finite(point.precipChance) ? `${point.precipChance}%` : "—"}</td>
                    <td className="is-end">
                      <span className={`sky-status is-${t === "within" ? "ok" : t}`}>
                        {t === "within" ? <Check size={14} aria-hidden="true" /> : t === "over" ? <TriangleAlert size={14} aria-hidden="true" /> : <CircleHelp size={14} aria-hidden="true" />}
                        <span className="sky-status-word">{t === "within" ? "Within" : t === "over" ? "Over" : "Incomplete"}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sky-section" aria-labelledby="sky-weather-window">
        <div className="sky-sh"><h2 id="sky-weather-window">Across your window</h2></div>
        <div className="sky-trio">
          <div className="sky-card">
            <span className="sky-card-head"><span>Temperature range</span></span>
            {temperatures.length > 0 ? (
              <>
                <span className="sky-big">{temp(low)} <span className="sky-big-sep">to</span> {temp(high)}</span>
                <p className="sky-cap">Window high {temp(high)} · Low {temp(low)}</p>
              </>
            ) : <span className="sky-big is-small">Unavailable</span>}
          </div>
          <div className="sky-card">
            <span className="sky-card-head"><span>Clear, dry daylight</span></span>
            <span className="sky-big">{bluebird.percent === null ? "—" : `${bluebird.percent}%`}</span>
            <p className="sky-cap">Bluebird day <strong>{bluebird.percent === null ? "Unavailable" : `${bluebird.percent}%`}</strong> of available daylight hours</p>
            <details className="sky-details forecast-bluebird-details">
              <summary>About this percentage</summary>
              <p>
                Share of available daylight forecast hours in this window with cloud cover ≤20%,
                precipitation chance ≤10%, and no forecast rain, snow, fog, haze, smoke, or storms.
                This estimates clear, dry hours; it is not the probability of a whole bluebird day.
              </p>
              <p>
                {bluebird.completeHours}/{bluebird.daylightHours} daylight hours have cloud and precipitation readings.
                {" "}{bluebird.reason || `${bluebird.bluebirdHours} meet the bluebird criteria.`}
                {" "}Available forecast: {trend.length}/{report.plan.travelWindowHours} requested hours.
              </p>
            </details>
          </div>
          <div className="sky-card">
            <span className="sky-card-head"><span>Hours within limits</span></span>
            <span className="sky-big">{rows.filter((row) => row.pass).length}<span className="sky-big-unit"> of {rows.length}</span></span>
            <p className="sky-cap">{insight.conditionTrendLabel}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
