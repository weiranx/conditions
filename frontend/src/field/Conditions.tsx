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
import type { Workspace } from "./model/useWorkspace";
import { resolveReportFeatureFlags } from "../contexts/feature-flags";
import { SourceLink } from "./Details";
import { Evidence } from "./Evidence";
import { evidenceFormat } from "./evidence-format";
import { FieldFeedEvidence } from "./FieldFeedEvidence";
import { ComfortScore } from "./ComfortScore";
import { shortHour, type SkyHour } from "./sky/sky-model";
import { PrecipMountain } from "./sky/PrecipMountain";
import { capitalize } from "../app/objective-terms";
import { knownFeet } from "./sky/status";
import { minutesToTwentyFourHourClock, parseHourLabelToMinutes, parseTimeInputMinutes } from "../app/core";

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

export function Conditions({ workspace: w, hours: skyHours = [] }: { workspace: Workspace; hours?: SkyHour[] }) {
  const data = w.safetyData!;
  const signals = w.evaluation?.fieldSignals ?? [];
  // Comfort as scored for the plan's current approach.
  const comfort = w.evaluation?.pleasantness ?? data.pleasantness ?? null;
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
  // Heat builds lowest on the route, so the heat card leads with the start and keeps the objective for reference.
  const trailhead = w.evaluation?.trailheadTemperatures ?? null;
  const trailheadTemps = trailhead?.temps ?? null;
  const hourTicks = hourMinutes.map((minute) => shortHour(minute, w.preferences.timeStyle === "24h" ? "24h" : "12h"));
  const uvDisplay = (value: number | null | undefined) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value < 0.1 && value > 0 ? "<0.1" : value.toFixed(1)
      : "Unavailable";
  const peakUv = data.atmosphere?.uvIndexMax;
  const hasPeakUv = typeof peakUv === "number" && Number.isFinite(peakUv) && peakUv >= 0;
  const aqi = data.airQuality?.usAqi;
  const aqiKnown = typeof aqi === "number" && Number.isFinite(aqi);
  const { rainfall, heatRisk, fireRisk, visibility, sourceFreshness } = w.interpretation!;
  const airQualityFutureNotApplicable = sourceFreshness.airQualityFutureNotApplicable;
  const objectiveFt = knownFeet(data.weather.elevation);
  const freezingFt = knownFeet(data.atmosphere?.freezingLevelFt);
  const snowLevelFt = knownFeet(data.atmosphere?.snowLevelFt);
  const precipLevels = [
    ...(freezingFt !== null && freezingFt > 0 ? [{ label: "Freezing level", ft: freezingFt, tone: "cold" as const }] : []),
    ...(snowLevelFt !== null && snowLevelFt > 0 ? [{ label: "Snow level", ft: snowLevelFt, tone: "snow" as const }] : []),
  ];
  const f = evidenceFormat(w);
  const heatMetrics = data.heatRisk?.metrics;
  const air = data.airQuality;
  const tempContext = data.weather.temperatureContext24h;
  const moon = data.atmosphere?.moon;
  const skyClock = (minute: number) =>
    w.formatClockForStyle(minutesToTwentyFourHourClock(((minute % 1440) + 1440) % 1440), w.preferences.timeStyle);
  return (
    <div className="field-conditions sky-conditions">
      <section className="sky-section" aria-labelledby="sky-precip-title">
        <div className="sky-sh">
          <h2 id="sky-precip-title">Rain and snow</h2>
          <p>{rainfall.expectedTravelWindowHours}-hour window and the days before it.</p>
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
              trailheadFt={w.planApproach?.trailheadElevationFt ?? null}
              levels={precipLevels}
              format={{ elevation: (ft) => w.formatElevationDisplay(ft), clock: skyClock }}
              timeStyle={w.preferences.timeStyle}
              terms={w.objectiveTerms}
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
                <span className="sky-big">{rainfall.expectedRainWindowDisplay}</span>
              </div>
              <div>
                <span className="sky-muted"><Snowflake size={13} aria-hidden="true" /> Snow</span>
                <span className="sky-big">{rainfall.expectedSnowWindowDisplay}</span>
              </div>
            </div>
            <p className="sky-cap is-body">{rainfall.insightLine}</p>
            <details className="sky-details">
              <summary>What these totals mean</summary>
              <p>{rainfall.noteLine} {rainfall.expectedNoteLine}</p>
            </details>
          </section>
          <section className="sky-card" aria-label="Recent precipitation">
            <span className="sky-card-head"><span>Recently fallen</span><span className="sky-muted">{rainfall.modeLabel}</span></span>
            <div className="report-precip-charts">
              <AccumulationBars
                label="Rain"
                rows={[
                  { label: "12 hours", value: rainfall.rainIn.past12h, display: rainfall.rainDisplay.past12h },
                  { label: "24 hours", value: rainfall.rainIn.past24h, display: rainfall.rainDisplay.past24h },
                  { label: "48 hours", value: rainfall.rainIn.past48h, display: rainfall.rainDisplay.past48h },
                ]}
              />
              <AccumulationBars
                label="Snow"
                rows={[
                  { label: "12 hours", value: rainfall.snowIn.past12h, display: rainfall.snowDisplay.past12h },
                  { label: "24 hours", value: rainfall.snowIn.past24h, display: rainfall.snowDisplay.past24h },
                  { label: "48 hours", value: rainfall.snowIn.past48h, display: rainfall.snowDisplay.past48h },
                ]}
              />
            </div>
            <div className="sky-evidence">
              <Evidence
                title="Expected precipitation and source"
                rows={[
                  [`Rain in your ${rainfall.expectedTravelWindowHours}-hour window`, rainfall.expectedRainWindowDisplay],
                  [`Snow in your ${rainfall.expectedTravelWindowHours}-hour window`, rainfall.expectedSnowWindowDisplay],
                  ["Source", w.rainfallPayload?.source],
                  ["Issued", f.time(w.rainfallPayload?.issuedTime)],
                ]}
                notes={[rainfall.noteLine, rainfall.expectedNoteLine]}
                links={[{ url: w.rainfallPayload?.link }]}
              />
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
              value={heatRisk.label || "Unavailable"} tone={heatRisk.status}
              note={heatRisk.guidance}
              evidence={<Evidence
                title="What sets the heat risk"
                points={f.texts(data.heatRisk?.reasons)}
                rows={[
                  ["Temperature", f.temp(heatMetrics?.tempF)],
                  ["Feels like", f.temp(heatMetrics?.feelsLikeF)],
                  ["Humidity", f.percent(heatMetrics?.humidity)],
                  ["Hottest in the next 12 hours", f.temp(heatMetrics?.peakTemp12hF)],
                  ["Hottest feels-like, next 12 hours", f.temp(heatMetrics?.peakFeelsLike12hF)],
                  [heatMetrics?.lowerTerrainLabel ? `Feels like at ${heatMetrics.lowerTerrainLabel}` : "Feels like lower down",
                    [f.temp(heatMetrics?.lowerTerrainFeelsLikeF), f.elevation(heatMetrics?.lowerTerrainElevationFt)].filter(Boolean).join(" at ") || null],
                  ["Source", data.heatRisk?.source],
                ]}
              />}>
              <ConditionTrend label={trailheadTemps ? `Temperature, ${w.objectiveTerms.start} to ${w.objectiveTerms.top}` : `Temperature at the ${w.objectiveTerms.top}`}
                values={trailheadTemps ?? hours.map((hour) => hour.temp)} format={w.formatTempDisplay} start={start} end={end}
                compare={trailhead ? {
                  primaryLabel: `${capitalize(w.objectiveTerms.start)} ${w.formatElevationDisplay(Math.round(trailhead.trailheadElevationFt / 100) * 100)}`,
                  label: `${capitalize(w.objectiveTerms.top)} ${w.formatElevationDisplay(trailhead.objectiveElevationFt)}`,
                  values: hours.map((hour) => hour.temp),
                } : undefined}
                hours={hourTicks} bands={[{ from: 85, to: 200, label: "hot", tone: "caution" }, { from: -100, to: 32, label: "freezing", tone: "cold" }]} />
            </ExposureCard>
          )}
          {flags.fireRiskDetails && (
            <ExposureCard className="is-fire" icon={<Flame size={16} aria-hidden="true" />} title="Fire risk"
              value={fireRisk.label || "Unavailable"} tone={fireRisk.status}
              note={(fireRisk.level ?? 0) >= 1 && data.fireRisk?.reasons?.[0]
                ? `${w.localizeUnitText(data.fireRisk.reasons[0])} ${data.fireRisk.guidance || ""}`.trim()
                : data.fireRisk?.guidance}
              evidence={<Evidence
                title="What sets the fire risk"
                points={f.texts(data.fireRisk?.reasons)}
                rows={[["Source", data.fireRisk?.source]]}
              >
                {Boolean(data.fireRisk?.alertsConsidered?.length) && (
                  <ul className="sky-bullets">
                    {data.fireRisk!.alertsConsidered!.map((alert, i) => (
                      <li key={i}>
                        {[alert.event, alert.severity, f.time(alert.expires) && `until ${f.time(alert.expires)}`].filter(Boolean).join(" · ")}
                        {" "}<SourceLink url={alert.link}>Alert</SourceLink>
                      </li>
                    ))}
                  </ul>
                )}
              </Evidence>}>
              <ConditionTrend label="Relative humidity" values={hours.map((hour) => hour.humidity)} format={percent} start={start} end={end} domain={[0, 100]}
                hours={hourTicks} bands={[{ from: 0, to: 30, label: "dry, fire spreads faster", tone: "caution" }]} />
            </ExposureCard>
          )}
          {flags.airQualityDetails && (
            <ExposureCard className="is-air" icon={<Wind size={16} aria-hidden="true" />} title="Air quality"
              value={airQualityFutureNotApplicable ? "Current only" : aqiKnown ? <>{aqi}<span className="sky-big-unit"> AQI</span></> : "Unavailable"}
              tone={airQualityFutureNotApplicable || !aqiKnown ? "missing" : aqi > 100 ? "over" : "ok"}
              status={airQualityFutureNotApplicable ? "Not for your date" : data.airQuality?.category || undefined}
              note={airQualityFutureNotApplicable ? "Current AQI does not represent the selected future date." : !aqiKnown ? "Unavailable" : undefined}
              evidence={<Evidence
                title="Pollutants, timing, and source"
                rows={[
                  ["Reading", air?.dataType === "modeled_forecast" ? "Modeled forecast" : air?.dataType === "observed_nowcast" ? "Current observation" : null],
                  ["Measured", f.observed(air?.measuredTime)],
                  ["Valid for", f.time(air?.validTime)],
                  ["Main pollutant", air?.observation?.dominant?.parameter],
                  ["Reporting area", air?.observation?.dominant?.reportingArea],
                  ["Fine particles (PM2.5)", f.number(air?.pm25, " µg/m³")],
                  ["Coarse particles (PM10)", f.number(air?.pm10, " µg/m³")],
                  ["Ozone", f.number(air?.ozone, " µg/m³")],
                  ["Forecast", air?.forecast && (f.number(air.forecast.usAqi) || air.forecast.category)
                    ? [f.number(air.forecast.usAqi, " AQI"), air.forecast.category, f.time(air.forecast.validTime)].filter(Boolean).join(" · ")
                    : null],
                  ["Source", air?.source],
                ]}
                notes={[air?.note, air?.observation?.note]}
              />}>
              {!airQualityFutureNotApplicable && (
                <ConditionScale label="US air-quality index" value={data.airQuality?.usAqi} maximum={500} bands={AQI_BANDS} />
              )}
            </ExposureCard>
          )}
          <ExposureCard className="is-visibility" icon={<Eye size={16} aria-hidden="true" />} title="Visibility"
            value={visibility.level === "Unknown" ? "Unavailable" : visibility.level} tone={visibility.status}
            note={visibility.detail}
            evidence={<Evidence
              title="What limits visibility"
              points={f.texts(visibility.factors)}
              rows={[
                ["Hours affected", visibility.activeHours !== null && visibility.windowHours !== null
                  ? `${visibility.activeHours} of ${visibility.windowHours}` : null],
                ["Source", visibility.source],
              ]}
            />}>
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
                <Evidence
                  title="More sun, sky, and temperature"
                  rows={[
                    ["UV category", data.atmosphere?.uvCategory],
                    ["Wind chill", f.temp(data.atmosphere?.windChill)],
                    ["Thunderstorm chance", [f.percent(data.atmosphere?.thunderProbability), data.atmosphere?.thunderCategory].filter(Boolean).join(" · ") || null],
                    ["Precipitation type", data.atmosphere?.precipType?.label],
                    ["24-hour low", f.temp(tempContext?.minTempF)],
                    ["24-hour high", f.temp(tempContext?.maxTempF)],
                    ["Overnight low", f.temp(tempContext?.overnightLowF)],
                    ["Daytime high", f.temp(tempContext?.daytimeHighF)],
                    ["Moon", moon?.name ? [moon.name, typeof moon.illumination === "number" && `${f.percent(moon.illumination <= 1 ? moon.illumination * 100 : moon.illumination)} lit`].filter(Boolean).join(" · ") : null],
                  ]}
                  notes={[f.text(data.atmosphere?.precipType?.reason)]}
                />
              </>}>
              <dl className="sky-list is-compact report-atmosphere-facts">
                <div><dt>UV near your start</dt><dd>{uvDisplay(data.atmosphere?.uvIndex)}</dd></div>
                <div><dt>Freezing level</dt><dd>{w.formatElevationDisplay(data.atmosphere?.freezingLevelFt)}</dd></div>
                <div><dt>Snow level</dt><dd>{w.formatElevationDisplay(data.atmosphere?.snowLevelFt)}</dd></div>
                <div><dt>Pressure</dt><dd>{w.interpretation!.pressureTrend || "Trend unavailable"}</dd></div>
              </dl>
            </ExposureCard>
          )}
          {comfort && (
            <ComfortScore comfort={comfort} localize={w.localizeUnitText}
              elevation={(ft) => w.formatElevationDisplay(ft)} />
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
              <FieldFeedEvidence local={data.localConditions} f={f} />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
