import {
  Flame,
  ThermometerSun,
  Wind,
  Eye,
  Sun,
  Smile,
  Droplets,
  TriangleAlert,
  CircleHelp,
} from "lucide-react";
import {
  ConditionTrend,
  ConditionScale,
  AccumulationBars,
} from "./ConditionCharts";
import { fieldSignals } from "./field-signals";
import type { Workspace } from "./model/useWorkspace";
import { resolveReportFeatureFlags } from "../contexts/feature-flags";
import { Details, SourceLink } from "./Details";

export function Conditions({ workspace: w }: { workspace: Workspace }) {
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
    ? w.formatClockForStyle(
        hours[hours.length - 1].time,
        w.preferences.timeStyle,
      )
    : "End";
  const percent = (value: number) => `${Math.round(value)}%`;
  return (
    <div className="field-conditions">
      <section className="field-panel">
        <div className="field-panel-heading">
          <div>
            <span className="field-kicker condition-label">
              <Droplets size={18} />
              Rain and snowfall
            </span>
            <h2>Precipitation around your start</h2>
          </div>
          <SourceLink url={w.safeRainfallLink} />
        </div>

        <dl className="field-detail-grid">
          <div>
            <dt>Expected rain · {w.expectedTravelWindowHours} hour window</dt>
            <dd>{w.expectedRainWindowDisplay}</dd>
          </div>
          <div>
            <dt>Expected snowfall</dt>
            <dd>{w.expectedSnowWindowDisplay}</dd>
          </div>
        </dl>
        <div className="report-precip-charts">
          <AccumulationBars
            label="Recent rainfall"
            rows={[
              {
                label: "12 hours",
                value: w.rainfall12hIn,
                display: w.rainfall12hDisplay,
              },
              {
                label: "24 hours",
                value: w.rainfall24hIn,
                display: w.rainfall24hDisplay,
              },
              {
                label: "48 hours",
                value: w.rainfall48hIn,
                display: w.rainfall48hDisplay,
              },
            ]}
          />
          <AccumulationBars
            label="Recent snowfall"
            rows={[
              {
                label: "12 hours",
                value: w.snowfall12hIn,
                display: w.snowfall12hDisplay,
              },
              {
                label: "24 hours",
                value: w.snowfall24hIn,
                display: w.snowfall24hDisplay,
              },
              {
                label: "48 hours",
                value: w.snowfall48hIn,
                display: w.snowfall48hDisplay,
              },
            ]}
          />
        </div>
        <details className="field-detail-disclosure">
          <summary>View accumulation table</summary>
          <div className="field-table-scroll">
            <table className="field-data-table">
              <thead>
                <tr>
                  <th>{w.rainfallModeLabel}</th>
                  <th>12 hours</th>
                  <th>24 hours</th>
                  <th>48 hours</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>Rain</th>
                  <td>{w.rainfall12hDisplay}</td>
                  <td>{w.rainfall24hDisplay}</td>
                  <td>{w.rainfall48hDisplay}</td>
                </tr>
                <tr>
                  <th>Snow</th>
                  <td>{w.snowfall12hDisplay}</td>
                  <td>{w.snowfall24hDisplay}</td>
                  <td>{w.snowfall48hDisplay}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
        <details className="field-detail-disclosure">
          <summary>What these totals mean</summary>
          <p>{w.precipInsightLine}</p>
          <p>
            {w.rainfallNoteLine} {w.expectedPrecipNoteLine}
          </p>
        </details>
        <Details
          title="Precipitation intervals and source evidence"
          value={w.rainfallPayload}
        />
      </section>
      <div className="field-chapter-heading report-conditions-heading">
        <h2>Beyond the weather</h2>
        <p>Exposure, air quality, and visibility for this outing.</p>
      </div>
      <div className="field-condition-grid">
        {flags.heatRiskDetails && (
          <section className="field-panel condition-card is-heat">
            <span className="field-kicker condition-label">
              <ThermometerSun size={18} />
              Heat exposure
            </span>
            <h2>{w.heatRiskLabel}</h2>
            <ConditionTrend
              label="Temperature"
              values={hours.map((hour) => hour.temp)}
              format={w.formatTempDisplay}
              start={start}
              end={end}
            />
            <p>{w.heatRiskGuidance}</p>
            <Details title="Heat-stress measurements" value={data.heatRisk} />
          </section>
        )}
        {flags.fireRiskDetails && (
          <section className="field-panel condition-card is-fire">
            <span className="field-kicker condition-label">
              <Flame size={18} />
              Fire weather
            </span>
            <h2>{w.fireRiskLabel}</h2>
            <ConditionTrend
              label="Relative humidity"
              values={hours.map((hour) => hour.humidity)}
              format={percent}
              start={start}
              end={end}
              domain={[0, 100]}
            />
            <p>{data.fireRisk?.guidance}</p>
            <Details
              title="Fire-weather drivers and alerts"
              value={data.fireRisk}
            />
          </section>
        )}
        {flags.airQualityDetails && (
          <section className="field-panel condition-card is-air">
            <span className="field-kicker condition-label">
              <Wind size={18} />
              Air quality
            </span>
            <h2>
              {w.airQualityFutureNotApplicable
                ? "Current observations only"
                : `${data.airQuality?.usAqi ?? "—"} AQI`}
            </h2>
            {!w.airQualityFutureNotApplicable && (
              <ConditionScale
                label="US air-quality index"
                value={data.airQuality?.usAqi}
                maximum={500}
              />
            )}
            <p>
              {w.airQualityFutureNotApplicable
                ? "Current AQI does not represent the selected future date."
                : data.airQuality?.category || "Unavailable"}
            </p>

            <Details
              title="Air-quality sources, timing, and pollutants"
              value={data.airQuality}
            />
          </section>
        )}
        <section className="field-panel condition-card is-visibility">
          <span className="field-kicker condition-label">
            <Eye size={18} />
            Visibility risk
          </span>
          <h2>
            {w.weatherVisibilityRisk?.level ||
              data.weather.visibilityRisk?.level ||
              "Unavailable"}
          </h2>
          <ConditionTrend
            label="Cloud cover"
            values={hours.map((hour) => hour.cloudCover)}
            format={percent}
            start={start}
            end={end}
            domain={[0, 100]}
          />
          <p>{w.weatherVisibilityDetail}</p>

          <Details
            title="Visibility risk and active hours"
            value={data.weather.visibilityRisk}
          />
        </section>
        {flags.weatherContextDetails && (
          <section className="field-panel condition-card is-atmosphere">
            <span className="field-kicker condition-label">
              <Sun size={18} />
              Atmosphere
            </span>
            <h2>Sky and pressure</h2>
            <ConditionScale
              label="UV index"
              value={data.atmosphere?.uvIndex}
              maximum={11}
              endLabel="11+"
            />
            <p>
              {w.weatherPressureTrendSummary ||
                "Pressure trend is unavailable."}
            </p>
            <dl className="report-atmosphere-facts">
              <div>
                <dt>Freezing level</dt>
                <dd>
                  {w.formatElevationDisplay(data.atmosphere?.freezingLevelFt)}
                </dd>
              </div>
              <div>
                <dt>Snow level</dt>
                <dd>
                  {w.formatElevationDisplay(data.atmosphere?.snowLevelFt)}
                </dd>
              </div>
            </dl>
            <Details
              title="UV, freezing level, and atmospheric context"
              value={data.atmosphere}
            />
            <Details
              title="24-hour temperature context"
              value={data.weather.temperatureContext24h}
            />
          </section>
        )}
        {data.pleasantness && (
          <section className="field-panel condition-card is-comfort">
            <span className="field-kicker condition-label">
              <Smile size={18} />
              Weather comfort
            </span>
            <h2>{data.pleasantness.label}</h2>
            <ConditionScale
              label="Weather comfort score"
              value={data.pleasantness.score}
              maximum={100}
              format={(value) => `${Math.round(value)}/100`}
            />

            <p className="field-muted">
              {data.pleasantness.disclaimer ||
                "A weather-comfort outlook; separate from the safety decision."}
            </p>
            <Details title="Comfort factors" value={data.pleasantness} />
          </section>
        )}
      </div>
      {flags.fieldObservations && (
        <section className="field-panel">
          <div className="field-panel-heading">
            <h2>Field observations and access</h2>
            <span className={`field-badge ${unusual.length ? "is-watch" : ""}`}>
              {unusual.length
                ? `${unusual.length} to review`
                : missing.length === 5
                  ? "Observations incomplete"
                  : "No unusual signals in available feeds"}
            </span>
          </div>
          <div className="field-signal-grid">
            {unusual.map((signal) => (
              <article className="field-signal" key={signal.key}>
                <TriangleAlert size={20} />
                <div>
                  <strong>{signal.title}</strong>
                  <p>{signal.detail}</p>
                </div>
              </article>
            ))}
          </div>
          {missing.length > 0 && (
            <details className="field-missing-signals">
              <summary>
                <CircleHelp size={16} />
                {missing.length} observation feeds unavailable
              </summary>
              {missing.map((signal) => (
                <p key={signal.key}>{signal.title}</p>
              ))}
            </details>
          )}
          <p>
            Station, radar, water, smoke, and access reports may describe nearby
            conditions rather than your exact route.
          </p>
          {(
            [
              [
                "Nearby weather station",
                data.localConditions?.weatherObservation,
              ],
              ["Radar and lightning", data.localConditions?.radar],
              ["Trail and road access", data.localConditions?.access],
              ["Land-manager closures", data.localConditions?.closures],
              [
                "Wildfire incidents and detections",
                data.localConditions?.wildfire,
              ],
              ["Stream crossings and flow", data.localConditions?.streamflow],
              ["Smoke observations and forecast", data.localConditions?.smoke],
              ["Coastal tides", data.localConditions?.tides],
            ] as const
          ).map(([title, value]) => (
            <Details key={title} title={title} value={value} />
          ))}
        </section>
      )}
    </div>
  );
}
