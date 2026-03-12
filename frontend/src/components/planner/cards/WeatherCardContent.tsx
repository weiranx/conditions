import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ElevationDangerGradient } from './ElevationDangerGradient';
import { WeatherHourPillStrip } from '../WeatherHourPillStrip';
import type { WeatherHourOption } from '../WeatherHourPillStrip';
import type { AvalancheElevationBand, ElevationForecastBand } from '../../../app/types';

interface TrendChartRow {
  label: string;
  value: number | null;
  hourValue?: string | null;
  windDirectionLabel?: string | null;
}

interface TrendMetricOption {
  key: string;
  label: string;
}

interface TargetElevationForecast {
  deltaFt: number;
  temp: number;
  feelsLike: number;
  windSpeed: number;
  windGust: number;
}

export interface WeatherCardContentProps {
  // Temperature section
  formattedTemp: string;
  formattedFeelsLike: string;
  trendTempRange: { low: number; high: number } | null;
  conditionText: string;
  conditionIsCold: boolean;
  displayTime: string;

  // Forecast period
  forecastPeriodLabel: string;
  previewActive: boolean;

  // Pressure
  pressureTrendSummary: string | null;
  pressureTrendDirection: string | null;
  pressureDeltaLabel: string | null;
  pressureRangeLabel: string | null;

  // Hour picker
  hourOptions: WeatherHourOption[];
  selectedHourIndex: number;
  onHourSelect: (value: string) => void;
  weatherConditionEmoji: (desc: string, isDaytime?: boolean | null) => string;

  // Trend chart
  trendChartData: TrendChartRow[];
  trendHasData: boolean;
  trendMetric: string;
  trendMetricLabel: string;
  trendMetricOptions: TrendMetricOption[];
  trendLineColor: string;
  trendYAxisDomain: [number | string, number | string];
  trendTickFormatter: (value: number) => string;
  formatWeatherTrendValue: (value: number, windDir?: string | null) => string;
  onTrendMetricChange: (key: string) => void;
  onTrendChartClick: (chartState: unknown) => void;
  selectedHourValue: string | null;
  travelWindowHoursLabel: string;

  // Metrics
  formattedWind: string;
  formattedGust: string;
  precipLabel: string;
  humidityLabel: string;
  dewPointLabel: string;
  pressureLabel: string;
  pressureContextLine: string;
  windDirection: string;
  cloudCoverLabel: string;

  // Visibility
  visibilityScoreLabel: string;
  visibilityPill: string;
  visibilityRiskLevel: string;
  visibilityActiveWindowText: string | null;
  visibilityScoreMeaning: string;
  visibilityDetail: string;
  visibilityContextLine: string | null;

  // Target elevation
  targetElevationInput: string;
  onTargetElevationChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onTargetElevationStep: (delta: number) => void;
  canDecreaseTargetElevation: boolean;
  hasTargetElevation: boolean;
  targetElevationForecast: TargetElevationForecast | null;
  targetElevationFt: number;
  targetElevationStepFeet: number;
  elevationUnitLabel: string;

  // Elevation forecast
  elevationForecastBands: ElevationForecastBand[];
  objectiveElevationFt: number;
  objectiveElevationLabel: string;
  avalancheElevations: { below?: AvalancheElevationBand; at?: AvalancheElevationBand; above?: AvalancheElevationBand } | undefined;
  elevationForecastNote: string | undefined;

  // Blended source
  isBlended: boolean;

  // External links
  safeWeatherLink: string | null;
  weatherLinkCta: string;

  // Format functions
  formatTempDisplay: (value: number | null | undefined) => string;
  formatWindDisplay: (value: number | null | undefined) => string;
  formatElevationDisplay: (value: number | null | undefined) => string;
  formatElevationDeltaDisplay: (value: number | null | undefined) => string;
  localizeUnitText: (text: string) => string;
  getDangerLevelClass: (level: number | undefined) => string;
  getDangerText: (level: number) => string;
}

export function WeatherCardContent(props: WeatherCardContentProps) {
  return (
    <>
      <div className="weather-row">
        <div>
          <div className="big-stat">{props.formattedTemp}</div>
          <div className="stat-label">Feels like {props.formattedFeelsLike}</div>
          {props.trendTempRange && (
            <div className="weather-temp-range">
              Low {props.formatTempDisplay(props.trendTempRange.low)} / High {props.formatTempDisplay(props.trendTempRange.high)}
            </div>
          )}
        </div>
        <div className="weather-condition">
          <div className={`big-stat condition-text ${props.conditionIsCold ? 'is-cold' : ''}`}>
            {props.conditionText}
          </div>
          <div className="stat-label">Conditions at {props.displayTime}</div>
        </div>
      </div>

      <p className="weather-period-line">Using forecast period: {props.forecastPeriodLabel}</p>

      {props.pressureTrendSummary && (
        <div className="weather-pressure-chip-row" title={props.pressureTrendSummary}>
          <span className={`weather-pressure-chip ${props.pressureTrendDirection === 'Falling' ? 'pressure-falling' : props.pressureTrendDirection === 'Rising' ? 'pressure-rising' : 'pressure-steady'}`}>
            {props.pressureTrendDirection} {props.pressureDeltaLabel}
          </span>
          <small className="weather-pressure-range">{props.pressureRangeLabel}</small>
        </div>
      )}

      {props.previewActive && <p className="weather-preview-note">Hour preview only updates this Weather card.</p>}

      {props.hourOptions.length > 1 && (
        <WeatherHourPillStrip
          options={props.hourOptions}
          selectedIndex={props.selectedHourIndex}
          onSelect={props.onHourSelect}
          weatherConditionEmoji={props.weatherConditionEmoji}
        />
      )}

      <WeatherTrendPanel {...props} />

      <WeatherMetrics {...props} />

      <TargetElevationSection {...props} />

      {props.isBlended && (
        <p className="muted-note">
          Weather is blended. NOAA is primary; Open-Meteo filled missing fields.
        </p>
      )}
      {props.safeWeatherLink && (
        <a href={props.safeWeatherLink} target="_blank" rel="noreferrer" className="avy-external-link weather-external-link">
          {props.weatherLinkCta}
        </a>
      )}

      <ElevationForecastSection {...props} />
    </>
  );
}

// ── Trend Panel ─────────────────────────────────────────

function WeatherTrendPanel(props: WeatherCardContentProps) {
  return (
    <div className="weather-trend-panel" aria-label={`${props.travelWindowHoursLabel} weather trend`}>
      <div className="weather-trend-head">
        <span className="weather-trend-title">Trend ({props.travelWindowHoursLabel})</span>
        <span className="weather-trend-meta">{props.trendMetricLabel}</span>
      </div>
      <div className="weather-trend-selector" role="group" aria-label="Weather trend metric selector">
        {props.trendMetricOptions.map((option) => (
          <button
            key={`weather-trend-metric-${option.key}`}
            type="button"
            className={`weather-trend-btn ${props.trendMetric === option.key ? 'active' : ''}`}
            onClick={() => props.onTrendMetricChange(option.key)}
            aria-pressed={props.trendMetric === option.key}
          >
            {option.label}
          </button>
        ))}
      </div>
      {props.trendHasData ? (
        <div className="chart-wrap weather-trend-chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={props.trendChartData}
              margin={{ top: 10, right: 12, left: 4, bottom: 2 }}
              onClick={props.onTrendChartClick}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.35} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={14} />
              <YAxis
                domain={props.trendYAxisDomain}
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={props.trendTickFormatter}
              />
              <Tooltip
                formatter={(value, _name, item) => {
                  const payload = (item?.payload || {}) as { windDirectionLabel?: string | null };
                  const numeric = Number.isFinite(Number(value)) ? Number(value) : Number.NaN;
                  return [props.formatWeatherTrendValue(numeric, payload.windDirectionLabel), props.trendMetricLabel];
                }}
                labelFormatter={(label) => `${label}`}
              />
              {props.selectedHourValue && props.trendChartData.some((row) => row.hourValue === props.selectedHourValue) && (
                <ReferenceLine
                  x={props.trendChartData.find((row) => row.hourValue === props.selectedHourValue)?.label}
                  stroke="rgba(31, 73, 56, 0.45)"
                  strokeDasharray="4 4"
                />
              )}
              <Line
                type="monotone"
                dataKey="value"
                stroke={props.trendLineColor}
                strokeWidth={2.4}
                dot={(dotProps) => {
                  const { cx, cy, payload } = dotProps as {
                    cx?: number;
                    cy?: number;
                    payload?: { hourValue?: string | null; value?: number | null };
                  };
                  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
                  const pointValue = Number(payload?.value);
                  if (!Number.isFinite(pointValue)) return null;
                  const isSelectedHour = Boolean(props.selectedHourValue && payload?.hourValue === props.selectedHourValue);
                  return (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={isSelectedHour ? 4.8 : 1.9}
                      fill={isSelectedHour ? '#fefaf0' : props.trendLineColor}
                      stroke={props.trendLineColor}
                      strokeWidth={isSelectedHour ? 2.2 : 1.2}
                      style={{ cursor: payload?.hourValue ? 'pointer' : 'default' }}
                      onClick={() => {
                        if (payload?.hourValue) props.onHourSelect(payload.hourValue);
                      }}
                    />
                  );
                }}
                activeDot={{ r: 3.8 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="muted-note">No {props.trendMetricLabel.toLowerCase()} trend data is available for this selected window.</p>
      )}
    </div>
  );
}

// ── Metrics Grid ────────────────────────────────────────

function WeatherMetrics(props: WeatherCardContentProps) {
  return (
    <div className="weather-metrics">
      <div className="metric-chip">
        <span className="stat-label">Wind</span>
        <strong>{props.formattedWind}</strong>
      </div>
      <div className="metric-chip">
        <span className="stat-label">Gusts</span>
        <strong className="gust-value">{props.formattedGust}</strong>
      </div>
      <div className="metric-chip">
        <span className="stat-label">Precip</span>
        <strong>{props.precipLabel}</strong>
      </div>
      <div className="metric-chip">
        <span className="stat-label">Humidity</span>
        <strong>{props.humidityLabel}</strong>
      </div>
      <div className="metric-chip">
        <span className="stat-label">Dew Point</span>
        <strong>{props.dewPointLabel}</strong>
      </div>
      <div className="metric-chip">
        <span className="stat-label">Pressure (station)</span>
        <strong>{props.pressureLabel}</strong>
        <p className="metric-chip-detail pressure-detail">{props.pressureContextLine}</p>
      </div>
      <div className="metric-chip">
        <span className="stat-label">Wind Dir</span>
        <strong>{props.windDirection}</strong>
      </div>
      <div className="metric-chip">
        <span className="stat-label">Cloud Cover</span>
        <strong>{props.cloudCoverLabel}</strong>
      </div>
      <div className="metric-chip metric-chip-wide">
        <span className="stat-label">Whiteout Risk</span>
        <strong>{props.visibilityScoreLabel}</strong>
        <div className="metric-chip-pill-row">
          <span className={`decision-pill ${props.visibilityPill}`}>{props.visibilityRiskLevel}</span>
          {props.visibilityActiveWindowText && <span className="metric-chip-window">{props.visibilityActiveWindowText}</span>}
        </div>
        <p className="metric-chip-detail metric-chip-helper">{props.visibilityScoreMeaning}</p>
        <p className="metric-chip-detail">{props.localizeUnitText(props.visibilityDetail)}</p>
        {props.visibilityContextLine && <p className="metric-chip-detail">{props.visibilityContextLine}</p>}
      </div>
    </div>
  );
}

// ── Target Elevation ────────────────────────────────────

function TargetElevationSection(props: WeatherCardContentProps) {
  return (
    <section className="elevation-forecast" aria-label="Target elevation forecast">
      <div className="elevation-forecast-head">
        <h4>Target Elevation Forecast</h4>
        <label className="target-elev-inline-control">
          <span>Target ({props.elevationUnitLabel})</span>
          <div className="target-elev-input-row">
            <button
              type="button"
              className="target-elev-step-btn"
              onClick={() => props.onTargetElevationStep(-props.targetElevationStepFeet)}
              aria-label="Decrease target elevation by 1000 feet"
              title="Decrease by 1000 ft"
              disabled={!props.canDecreaseTargetElevation}
            >
              -
            </button>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              aria-label={`Target elevation in ${props.elevationUnitLabel}`}
              title={`Optional elevation to estimate weather at that altitude (${props.elevationUnitLabel}).`}
              placeholder={props.elevationUnitLabel === 'm' ? 'e.g. 2600' : 'e.g. 8500'}
              value={props.targetElevationInput}
              onChange={props.onTargetElevationChange}
            />
            <button
              type="button"
              className="target-elev-step-btn"
              onClick={() => props.onTargetElevationStep(props.targetElevationStepFeet)}
              aria-label="Increase target elevation by 1000 feet"
              title="Increase by 1000 ft"
            >
              +
            </button>
          </div>
        </label>
      </div>
      {props.hasTargetElevation ? (
        props.targetElevationForecast ? (
          <article className="elevation-row">
            <div className="elevation-row-main">
              <strong>Estimated at target elevation</strong>
              <span>{props.formatElevationDisplay(props.targetElevationFt)} • {props.formatElevationDeltaDisplay(props.targetElevationForecast.deltaFt)} vs objective</span>
            </div>
            <div className="elevation-row-metrics">
              <span>{props.formatTempDisplay(props.targetElevationForecast.temp)}</span>
              <span>Feels {props.formatTempDisplay(props.targetElevationForecast.feelsLike)}</span>
              <span>Wind {props.formatWindDisplay(props.targetElevationForecast.windSpeed)}</span>
              <span>Gust {props.formatWindDisplay(props.targetElevationForecast.windGust)}</span>
            </div>
          </article>
        ) : (
          <p className="muted-note">Objective elevation is unavailable, so target elevation estimate cannot be generated.</p>
        )
      ) : (
        <p className="muted-note">Set a target elevation to estimate temperature, wind, and feels-like conditions at that altitude.</p>
      )}
    </section>
  );
}

// ── Elevation Forecast ──────────────────────────────────

function ElevationForecastSection(props: WeatherCardContentProps) {
  return (
    <section className="elevation-forecast" aria-label="Forecast by elevation">
      <div className="elevation-forecast-head">
        <h4>Elevation Forecast</h4>
        <span>Objective {props.objectiveElevationLabel}</span>
      </div>
      {props.elevationForecastBands.length > 0 ? (
        <ElevationDangerGradient
          elevationBands={props.elevationForecastBands}
          avalancheElevations={props.avalancheElevations}
          objectiveElevationFt={Number.isFinite(props.objectiveElevationFt) ? props.objectiveElevationFt : null}
          formatTempDisplay={props.formatTempDisplay}
          formatWindDisplay={props.formatWindDisplay}
          formatElevationDisplay={props.formatElevationDisplay}
          getDangerLevelClass={props.getDangerLevelClass}
          getDangerText={props.getDangerText}
        />
      ) : (
        <p className="muted-note">Elevation-adjusted forecast is unavailable for this point.</p>
      )}
      {props.elevationForecastNote && (
        <p className="elevation-note">{props.localizeUnitText(props.elevationForecastNote)}</p>
      )}
    </section>
  );
}
