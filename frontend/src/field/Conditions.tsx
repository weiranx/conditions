import {
  Flame,
  ThermometerSun,
  Wind,
  Eye,
  Sun,
  Droplets,
  TriangleAlert,
  CircleHelp,
  Snowflake,
  Radio,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  ConditionTrend,
  ConditionScale,
  AccumulationBars,
} from "./ConditionCharts";
import { fieldSignals } from "./field-signals";
import type { Workspace } from "./model/useWorkspace";
import { resolveReportFeatureFlags } from "../contexts/feature-flags";
import { Details, SourceLink } from "./Details";
import { ComfortScore } from "./ComfortScore";
import { shortHour, type SkyHour } from "./sky/sky-model";
import { PrecipMountain } from "./sky/PrecipMountain";
import { knownFeet } from "./sky/status";
import { minutesToTwentyFourHourClock, parseHourLabelToMinutes, parseSolarClockMinutes, parseTimeInputMinutes } from "../app/core";
import { adjustPointToElevation } from "../app/approach-elevation";

/** US EPA AQI categories. */
const AQI_BANDS = [
  { from: 0, label: "Good" },
  { from: 51, label: "Moderate" },
  { from: 101, label: "Sensitive" },
  { from: 151, label: "Unhealthy" },
  { from: 201, label: "Very unhealthy" },
  { from: 301, label: "Hazardous" },
];

/** One exposure measure: a headline value, a small neutral chart, and its evidence tucked away. */
function ExposureCard({ icon, title, value, tone = "ok", status, children, note, evidence, className = "" }: {
  icon: ReactNode;
  title: string;
  value: ReactNode;
  tone?: "ok" | "over" | "missing";
  status?: string;
  children?: ReactNode;
  note?: ReactNode;
  evidence?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`sky-card sky-exposure condition-card ${className}`} aria-label={title}>
      <span className="sky-card-head">
        <span className="sky-exposure-title">{icon}{title}</span>
        {status && <span className={`sky-status is-${tone}`}>{tone === "over" && <TriangleAlert size={14} aria-hidden="true" />}{status}</span>}
      </span>
      <span className={`sky-big${tone === "over" ? " is-over" : ""}`}>{value}</span>
      {children}
      {note && <p className="sky-cap is-body">{note}</p>}
      {evidence && <div className="sky-evidence">{evidence}</div>}
    </section>
  );
}

const levelTone = (label: string | null | undefined): "ok" | "over" | "missing" => {
  const text = String(label || "").toLowerCase();
  if (!text || /unavailable|unknown/.test(text)) return "missing";
  return /high|extreme|elevated|poor|unhealthy|severe/.test(text) ? "over" : "ok";
};

export function Conditions({ workspace: w, hours: skyHours = [] }: { workspace: Workspace; hours?: SkyHour[] }) {
  const data = w.safetyData!;
  const signals = fieldSignals(data.localConditions, w.preferences);
  const unusual = signals.filter((signal) => signal.tone === "attention");
  const missing = signals.filter((signal) => signal.tone === "unavailable");
  const flags = resolveReportFeatureFlags(data.featureFlags);
  const hours = (data.weather.trend || []).slice(0, w.travelWindowHours);
  const start = hours.length
    ? w.formatClockForStyle(hours[0].time, w.preferences.timeStyle)
    : "Start";
  const end = hours.length
    ? w.formatClockForStyle(hours[hours.length - 1].time, w.preferences.timeStyle)
    : "End";
  const percent = (value: number) => `${Math.round(value)}%`;
  const hourMinutes = hours.map((hour) => parseTimeInputMinutes(hour.time) ?? parseHourLabelToMinutes(hour.time) ?? NaN);
  // Heat builds lowest on the route, so the heat card leads with the trailhead and keeps the summit for reference.
  const approach = w.approachProfile;
  const trailheadTemps = approach && approach.trailheadElevationFt < approach.objectiveElevationFt - 500
    ? hours.map((hour, i) => adjustPointToElevation(hour, approach.objectiveElevationFt, approach.trailheadElevationFt, {
      minuteOfDay: Number.isFinite(hourMinutes[i]) ? hourMinutes[i] : 720,
      sunriseMinutes: parseSolarClockMinutes(data.solar?.sunrise),
      sunsetMinutes: parseSolarClockMinutes(data.solar?.sunset),
    }).temp)
    : null;
  const hourTicks = hourMinutes.map((minute) => shortHour(minute, w.preferences.timeStyle === "24h" ? "24h" : "12h"));
  const uvDisplay = (value: number | null | undefined) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value < 0.1 && value > 0 ? "<0.1" : value.toFixed(1)
      : "Unavailable";
  const peakUv = data.atmosphere?.uvIndexMax;
  const hasPeakUv = typeof peakUv === "number" && Number.isFinite(peakUv) && peakUv >= 0;
  const aqi = data.airQuality?.usAqi;
  const aqiKnown = typeof aqi === "number" && Number.isFinite(aqi);
  const visibility = w.weatherVisibilityRisk?.level || data.weather.visibilityRisk?.level || null;
  const fireLevel = Number(w.fireRiskLevel);
  const objectiveFt = knownFeet(data.weather.elevation);
  const freezingFt = knownFeet(data.atmosphere?.freezingLevelFt);
  const snowLevelFt = knownFeet(data.atmosphere?.snowLevelFt);
  const precipLevels = [
    ...(freezingFt !== null && freezingFt > 0 ? [{ label: "Freezing level", ft: freezingFt, tone: "cold" as const }] : []),
    ...(snowLevelFt !== null && snowLevelFt > 0 ? [{ label: "Snow level", ft: snowLevelFt, tone: "snow" as const }] : []),
  ];
  const skyClock = (minute: number) =>
    w.formatClockForStyle(minutesToTwentyFourHourClock(((minute % 1440) + 1440) % 1440), w.preferences.timeStyle);
  return (
    <div className="field-conditions sky-conditions">
      <section className="sky-section" aria-labelledby="sky-precip-title">
        <div className="sky-sh">
          <h2 id="sky-precip-title">Rain and snow</h2>
          <p>{w.expectedTravelWindowHours}-hour window and the days before it.</p>
        </div>
        {objectiveFt !== null && skyHours.length > 0 && (
          <section className="sky-card sky-precip-card" aria-label="Rain and snow on the mountain">
            <span className="sky-card-head">
              <span className="sky-exposure-title"><Snowflake size={16} aria-hidden="true" />Rain or snow on your route</span>
              <span className="sky-muted">Heights to scale · ridge illustrative</span>
            </span>
            <PrecipMountain
              hours={skyHours}
              objectiveFt={objectiveFt}
              trailheadFt={w.approachProfile?.trailheadElevationFt ?? null}
              levels={precipLevels}
              format={{ elevation: (ft) => w.formatElevationDisplay(ft), clock: skyClock }}
              timeStyle={w.preferences.timeStyle}
            />
          </section>
        )}
        <div className="sky-duo">
          <section className="sky-card report-precip-panel" aria-label="Expected precipitation">
            <span className="sky-card-head">
              <span className="sky-exposure-title"><Droplets size={16} aria-hidden="true" />Expected during your trip</span>
              <SourceLink url={w.safeRainfallLink} />
            </span>
            <div className="sky-stat-row">
              <div>
                <span className="sky-muted">Rain</span>
                <span className="sky-big">{w.expectedRainWindowDisplay}</span>
              </div>
              <div>
                <span className="sky-muted"><Snowflake size={13} aria-hidden="true" /> Snow</span>
                <span className="sky-big">{w.expectedSnowWindowDisplay}</span>
              </div>
            </div>
            <p className="sky-cap is-body">{w.precipInsightLine}</p>
            <details className="sky-details">
              <summary>What these totals mean</summary>
              <p>{w.rainfallNoteLine} {w.expectedPrecipNoteLine}</p>
            </details>
          </section>
          <section className="sky-card" aria-label="Recent precipitation">
            <span className="sky-card-head"><span>Recently fallen</span><span className="sky-muted">{w.rainfallModeLabel}</span></span>
            <div className="report-precip-charts">
              <AccumulationBars
                label="Rain"
                rows={[
                  { label: "12 hours", value: w.rainfall12hIn, display: w.rainfall12hDisplay },
                  { label: "24 hours", value: w.rainfall24hIn, display: w.rainfall24hDisplay },
                  { label: "48 hours", value: w.rainfall48hIn, display: w.rainfall48hDisplay },
                ]}
              />
              <AccumulationBars
                label="Snow"
                rows={[
                  { label: "12 hours", value: w.snowfall12hIn, display: w.snowfall12hDisplay },
                  { label: "24 hours", value: w.snowfall24hIn, display: w.snowfall24hDisplay },
                  { label: "48 hours", value: w.snowfall48hIn, display: w.snowfall48hDisplay },
                ]}
              />
            </div>
            <div className="sky-evidence">
              <Details title="Precipitation intervals and source data" value={w.rainfallPayload} />
            </div>
          </section>
        </div>
      </section>

      <section className="sky-section" aria-labelledby="sky-exposure-title">
        <div className="sky-sh">
          <h2 id="sky-exposure-title">Beyond the weather</h2>
          <p>Heat, fire, air, visibility and sun for this outing.</p>
        </div>
        <div className="sky-exposure-grid field-condition-grid">
          {flags.heatRiskDetails && (
            <ExposureCard className="is-heat" icon={<ThermometerSun size={16} aria-hidden="true" />} title="Heat exposure"
              value={w.heatRiskLabel || "Unavailable"} tone={levelTone(w.heatRiskLabel)}
              note={w.heatRiskGuidance}
              evidence={<Details title="Heat-stress measurements" value={data.heatRisk} />}>
              <ConditionTrend label={trailheadTemps ? "Temperature, trailhead to summit" : "Temperature at the summit"}
                values={trailheadTemps ?? hours.map((hour) => hour.temp)} format={w.formatTempDisplay} start={start} end={end}
                compare={trailheadTemps && approach ? {
                  primaryLabel: `Trailhead ${w.formatElevationDisplay(Math.round(approach.trailheadElevationFt / 100) * 100)}`,
                  label: `Summit ${w.formatElevationDisplay(approach.objectiveElevationFt)}`,
                  values: hours.map((hour) => hour.temp),
                } : undefined}
                hours={hourTicks} bands={[{ from: 85, to: 200, label: "hot", tone: "caution" }, { from: -100, to: 32, label: "freezing", tone: "cold" }]} />
            </ExposureCard>
          )}
          {flags.fireRiskDetails && (
            <ExposureCard className="is-fire" icon={<Flame size={16} aria-hidden="true" />} title="Fire weather"
              value={w.fireRiskLabel || "Unavailable"} tone={Number.isFinite(fireLevel) && fireLevel >= 3 ? "over" : levelTone(w.fireRiskLabel) === "missing" ? "missing" : "ok"}
              note={data.fireRisk?.guidance}
              evidence={<Details title="Fire-weather drivers and alerts" value={data.fireRisk} />}>
              <ConditionTrend label="Relative humidity" values={hours.map((hour) => hour.humidity)} format={percent} start={start} end={end} domain={[0, 100]}
                hours={hourTicks} bands={[{ from: 0, to: 30, label: "dry, fire spreads faster", tone: "caution" }]} />
            </ExposureCard>
          )}
          {flags.airQualityDetails && (
            <ExposureCard className="is-air" icon={<Wind size={16} aria-hidden="true" />} title="Air quality"
              value={w.airQualityFutureNotApplicable ? "Current only" : aqiKnown ? <>{aqi}<span className="sky-big-unit"> AQI</span></> : "Unavailable"}
              tone={w.airQualityFutureNotApplicable || !aqiKnown ? "missing" : aqi > 100 ? "over" : "ok"}
              status={w.airQualityFutureNotApplicable ? "Not for your date" : data.airQuality?.category || undefined}
              note={w.airQualityFutureNotApplicable ? "Current AQI does not represent the selected future date." : !aqiKnown ? "Unavailable" : undefined}
              evidence={<Details title="Air-quality sources, timing, and pollutants" value={data.airQuality} />}>
              {!w.airQualityFutureNotApplicable && (
                <ConditionScale label="US air-quality index" value={data.airQuality?.usAqi} maximum={500} bands={AQI_BANDS} />
              )}
            </ExposureCard>
          )}
          <ExposureCard className="is-visibility" icon={<Eye size={16} aria-hidden="true" />} title="Visibility"
            value={visibility || "Unavailable"} tone={levelTone(visibility)}
            note={w.weatherVisibilityDetail}
            evidence={<Details title="Visibility risk and active hours" value={data.weather.visibilityRisk} />}>
            <ConditionTrend label="Cloud cover" values={hours.map((hour) => hour.cloudCover)} format={percent} start={start} end={end} domain={[0, 100]}
              hours={hourTicks} kind="bars" />
          </ExposureCard>
          {flags.weatherContextDetails && (
            <ExposureCard className="is-atmosphere" icon={<Sun size={16} aria-hidden="true" />} title="Sun and atmosphere"
              value={hasPeakUv ? <><span className="sky-big-unit">UV </span>{uvDisplay(peakUv)}</> : "UV unavailable"}
              tone={hasPeakUv ? (Number(peakUv) >= 8 ? "over" : "ok") : "missing"}
              status={hasPeakUv ? "Daily peak" : undefined}
              note={hasPeakUv
                ? "The day's maximum; it may fall outside your hours. A low reading at an early start says little about later."
                : "The start-time reading alone cannot describe sun exposure later in the day."}
              evidence={<>
                <Details title="UV, freezing level, and atmospheric context" value={data.atmosphere} />
                <Details title="24-hour temperature context" value={data.weather.temperatureContext24h} />
              </>}>
              <dl className="sky-list is-compact report-atmosphere-facts">
                <div><dt>UV near your start</dt><dd>{uvDisplay(data.atmosphere?.uvIndex)}</dd></div>
                <div><dt>Freezing level</dt><dd>{w.formatElevationDisplay(data.atmosphere?.freezingLevelFt)}</dd></div>
                <div><dt>Snow level</dt><dd>{w.formatElevationDisplay(data.atmosphere?.snowLevelFt)}</dd></div>
                <div><dt>Pressure</dt><dd>{w.weatherPressureTrendSummary || "Trend unavailable"}</dd></div>
              </dl>
            </ExposureCard>
          )}
          {data.pleasantness && (
            <ComfortScore comfort={data.pleasantness} localize={w.localizeUnitText}
              approach={w.approachProfile} elevation={(ft) => w.formatElevationDisplay(ft)} />
          )}
        </div>
      </section>

      {flags.fieldObservations && (
        <section className="sky-section" aria-labelledby="sky-field-title">
          <div className="sky-sh">
            <h2 id="sky-field-title">Field reports and access</h2>
            <p>Nearby stations and reports may not describe your exact route.</p>
          </div>
          <div className="sky-card sky-field-card">
            <span className="sky-card-head">
              <span className="sky-exposure-title"><Radio size={16} aria-hidden="true" />Station, radar, water, smoke and access</span>
              <span className={`sky-status is-${unusual.length ? "over" : missing.length === 5 ? "missing" : "ok"}`}>
                {unusual.length
                  ? `${unusual.length} to review`
                  : missing.length === 5
                    ? "Observations incomplete"
                    : "Nothing unusual reported"}
              </span>
            </span>
            {unusual.length > 0 && (
              <ul className="sky-signal-list">
                {unusual.map((signal) => (
                  <li key={signal.key} className="field-signal">
                    <TriangleAlert size={18} aria-hidden="true" />
                    <div>
                      <strong>{signal.title}</strong>
                      <p>{signal.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {missing.length > 0 && (
              <p className="sky-missing-line">
                <CircleHelp size={16} aria-hidden="true" />
                <span><strong>{missing.length} {missing.length === 1 ? "feed" : "feeds"} unavailable:</strong> {missing.map((signal) => signal.title).join(" · ")}</span>
              </p>
            )}
            <div className="sky-evidence is-list">
              {(
                [
                  ["Nearby weather station", data.localConditions?.weatherObservation],
                  ["Radar and lightning", data.localConditions?.radar],
                  ["Trail and road access", data.localConditions?.access],
                  ["Land-manager closures", data.localConditions?.closures],
                  ["Wildfire incidents and detections", data.localConditions?.wildfire],
                  ["Stream crossings and flow", data.localConditions?.streamflow],
                  ["Smoke observations and forecast", data.localConditions?.smoke],
                  ["Coastal tides", data.localConditions?.tides],
                ] as const
              ).map(([title, value]) => (
                <Details key={title} title={title} value={value} />
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
