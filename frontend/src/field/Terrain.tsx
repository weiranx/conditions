import { lazy, Suspense, useMemo, useState } from "react";
import { Mountain, Minus, Plus, Satellite } from "lucide-react";
import { Streamdown } from "streamdown";
import type { Workspace } from "./model/useWorkspace";
import { buildTerrainWindow } from "../app/terrain-window";
import { resolveReportFeatureFlags } from "../contexts/feature-flags";
import { useAiAvailability } from "../hooks/useAiAvailability";
import { planFromReport } from "./data";
import { WindCompass } from "./WindCompass";
import { ConditionTrend } from "./ConditionCharts";
import { Details, SourceLink } from "./Details";
const FieldMap = lazy(() => import("./FieldMap"));

function TerrainWindow({ workspace: w }: { workspace: Workspace }) {
  const flags = resolveReportFeatureFlags(w.safetyData?.featureFlags);
  const [selection, setSelection] = useState({ lane: 0, hour: 0 });
  const model = useMemo(
    () =>
      buildTerrainWindow({
        travelRows: w.travelWindowRows,
        elevationBands: w.elevationForecastBands,
        avalancheProblems: flags.avalancheDetails
          ? w.safetyData?.avalanche?.problems || []
          : [],
        avalancheRelevant: flags.avalancheDetails && w.avalancheRelevant,
        avalancheUnknown: flags.avalancheDetails && w.avalancheUnknown,
        avalancheDanger: flags.avalancheDetails
          ? w.overallAvalancheLevel
          : null,
        leewardAspects: flags.windLoadingDetails ? w.leewardAspectHints : [],
        secondaryAspects: flags.windLoadingDetails
          ? w.secondaryWindAspects
          : [],
        preferences: w.preferences,
      }),
    [
      w.travelWindowRows,
      w.elevationForecastBands,
      w.safetyData,
      w.avalancheRelevant,
      w.avalancheUnknown,
      w.overallAvalancheLevel,
      w.leewardAspectHints,
      w.secondaryWindAspects,
      w.preferences,
      flags.avalancheDetails,
      flags.windLoadingDetails,
    ],
  );
  const lane = model.lanes[selection.lane] || model.lanes[0];
  const cell = lane?.cells[selection.hour];
  return (
    <section className="field-panel">
      <h2>Terrain through the day</h2>
      <details className="field-detail-disclosure">
        <summary>How to read this terrain view</summary>
        <p>{model.explanation}</p>
      </details>
      {model.lanes.length ? (
        <>
          <div className="field-table-scroll">
            <table className="field-data-table field-terrain-matrix">
              <thead>
                <tr>
                  <th>Elevation / aspect</th>
                  {model.hours.map((hour, i) => (
                    <th key={i}>
                      {w.formatClockForStyle(
                        hour.time,
                        w.preferences.timeStyle,
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {model.lanes.map((lane, i) => (
                  <tr key={lane.id}>
                    <th>
                      {lane.elevationLabel}
                      <small>
                        {w.formatElevationDisplay(lane.elevationFt)} ·{" "}
                        {lane.aspectLabel}
                      </small>
                    </th>
                    {lane.cells.map((cell, j) => (
                      <td key={j}>
                        <button
                          className={`is-${cell.level}`}
                          aria-pressed={
                            selection.lane === i && selection.hour === j
                          }
                          aria-label={`${lane.elevationLabel}, ${lane.aspectLabel}, ${w.formatClockForStyle(model.hours[j].time, w.preferences.timeStyle)}: ${cell.level}`}
                          onClick={() => setSelection({ lane: i, hour: j })}
                        >
                          {cell.level === "lower"
                            ? "Lower"
                            : cell.level === "avoid"
                              ? "Avoid"
                              : cell.level === "unknown"
                                ? "Unknown"
                                : "Caution"}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cell && (
            <div className="field-feedback">
              <div>
                <strong>
                  {lane.elevationLabel} · {lane.aspectLabel}
                </strong>
                <p>
                  {cell.reasons.join(" ") ||
                    "No additional terrain-specific threshold failures in the available model. This is not an assessment of slope stability."}
                </p>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="field-muted">
          Insufficient hourly or elevation data to construct the terrain view.
        </p>
      )}
    </section>
  );
}

export function Terrain({ workspace: w }: { workspace: Workspace }) {
  const data = w.safetyData!;
  const flags = resolveReportFeatureFlags(data.featureFlags);
  const available = useAiAvailability(data.capabilities);
  const target = w.targetElevationForecast;
  return (
    <section>
      <div className="field-chapter-heading">
        <h2>Terrain and snow</h2>
        <p>Read the objective, elevation, and surface evidence together.</p>
      </div>

      <section className="field-panel field-terrain-overview report-terrain-hero">
        <div className="field-panel-heading">
          <div>
            <span className="field-kicker">Surface assessment</span>
            <h2>
              {data.terrainCondition?.label?.replace(
                /^[\p{Extended_Pictographic}\uFE0F\s]+/u,
                "",
              ) || "Surface conditions"}
            </h2>
          </div>
          <Mountain size={24} />
        </div>
        <dl className="report-terrain-numbers">
          <div>
            <dt>Objective elevation</dt>
            <dd>{w.formatElevationDisplay(data.weather.elevation)}</dd>
          </div>
          <div>
            <dt>Snow depth · nearby station</dt>
            <dd>
              {data.snowpack?.snotel?.snowDepthIn == null
                ? "Unavailable"
                : w.preferences.elevationUnit === "m"
                  ? `${Math.round(data.snowpack.snotel.snowDepthIn * 2.54)} cm`
                  : `${data.snowpack.snotel.snowDepthIn} in`}
            </dd>
          </div>
          <div>
            <dt>Surface confidence</dt>
            <dd>{data.terrainCondition?.confidence || "Unknown"}</dd>
          </div>
        </dl>
        <p>{w.terrainConditionDetails.summary}</p>
        <Details
          title="Surface, freeze/thaw, and travel evidence"
          value={data.terrainCondition}
        />
      </section>
      <details className="field-panel report-map-disclosure">
        <summary>Explore terrain map</summary>{" "}
        <Suspense
          fallback={<div className="field-map-loading">Loading terrain…</div>}
        >
          <FieldMap plan={planFromReport(w.reportSnapshot!)} workspace={w} />
        </Suspense>
      </details>
      {flags.elevationForecast && (
        <section className="field-panel">
          <h2>Weather at elevation</h2>
          <p>Estimates use the objective forecast and elevation adjustments.</p>
          <div className="field-inline-form">
            <label>
              Target elevation ({w.elevationUnitLabel})
              <input
                inputMode="numeric"
                value={w.targetElevationInput}
                onChange={w.handleTargetElevationChange}
              />
            </label>
            <button
              className="field-button"
              aria-label="Decrease target elevation"
              disabled={!w.canDecreaseTargetElevation}
              onClick={() => w.handleTargetElevationStep(-1000)}
            >
              <Minus size={15} />
            </button>
            <button
              className="field-button"
              aria-label="Increase target elevation"
              onClick={() => w.handleTargetElevationStep(1000)}
            >
              <Plus size={15} />
            </button>
          </div>
          {target && (
            <dl className="field-detail-grid">
              <div>
                <dt>Temperature / feels like</dt>
                <dd>
                  {w.formatTempDisplay(target.temp)} /{" "}
                  {w.formatTempDisplay(target.feelsLike)}
                </dd>
              </div>
              <div>
                <dt>Wind / gust</dt>
                <dd>
                  {w.formatWindDisplay(target.windSpeed)} /{" "}
                  {w.formatWindDisplay(target.windGust)}
                </dd>
              </div>
            </dl>
          )}
          <ConditionTrend
            label="Temperature by elevation"
            values={w.elevationForecastBands.map((band) => band.temp)}
            format={w.formatTempDisplay}
            start={w.elevationForecastBands[0]?.label || "Lower terrain"}
            end={w.elevationForecastBands.at(-1)?.label || "Upper terrain"}
          />
          <div className="field-elevation-list">
            {w.elevationForecastBands.map((band) => (
              <div key={band.label}>
                <span>
                  {band.label}
                  <small>{w.formatElevationDisplay(band.elevationFt)}</small>
                </span>
                <strong>{w.formatTempDisplay(band.temp)}</strong>
                <span>{w.formatWindDisplay(band.windGust)} gust</span>
              </div>
            ))}
          </div>
          <p className="field-muted">
            {data.weather.elevationForecastNote ||
              "These are planning estimates, not observations at the selected elevation."}
          </p>
        </section>
      )}
      {flags.terrainWindow && <TerrainWindow workspace={w} />}
      {flags.avalancheDetails && (
        <section className="field-panel">
          <div className="field-panel-heading">
            <div>
              <span className="field-kicker">Regional bulletin</span>
              <h2>Avalanche outlook</h2>
            </div>
            <span className="field-badge">
              {w.avalancheUnknown
                ? "Unknown danger"
                : data.avalanche?.risk || "Unavailable"}
            </span>
          </div>
          {w.avalancheExpiredForSelectedStart && (
            <p className="field-warning">
              This bulletin expires before the selected departure. Check for a
              current forecast.
            </p>
          )}
          <p>
            {!w.avalancheRelevant
              ? w.avalancheNotApplicableReason
              : data.avalanche?.bottomLine || data.avalanche?.relevanceReason}
          </p>
          <div className="field-avalanche-bands">
            {w.avalancheElevationRows.map((band) => (
              <div key={band.key}>
                <span>{band.label}</span>
                <strong>
                  {band.rating === null
                    ? "No rating"
                    : w.getDangerText(band.rating)}
                </strong>
              </div>
            ))}
          </div>
          {data.avalanche?.problems?.map((problem, i) => (
            <article className="field-avalanche-problem" key={i}>
              <h3>{problem.name}</h3>
              <p>{problem.discussion || problem.problem_description}</p>
              <Details
                title="Affected aspects, elevations, size, and likelihood"
                value={{
                  likelihood: problem.likelihood,
                  size: problem.size,
                  location: problem.location,
                }}
              />
            </article>
          ))}
          <p>{data.avalanche?.advice}</p>
          <SourceLink url={w.safeAvalancheLink}>
            Read the complete bulletin
          </SourceLink>
          <Details
            title="Avalanche forecast coverage and validity"
            value={data.avalanche}
          />
        </section>
      )}
      {flags.windLoadingDetails && (
        <section className="field-panel">
          <h2>Wind transport and loading</h2>
          <WindCompass
            leeward={w.leewardAspectHints}
            secondary={w.secondaryWindAspects}
          />

          <p>{w.windLoadingActionLine}</p>
          <dl className="field-detail-grid">
            <div>
              <dt>Loading / confidence</dt>
              <dd>
                {w.windLoadingLevel} · {w.windLoadingConfidence}
              </dd>
            </div>
            <div>
              <dt>Active window</dt>
              <dd>{w.windLoadingActiveWindowLabel}</dd>
              <small>{w.windLoadingActiveHoursDetail}</small>
            </div>
            <div>
              <dt>Leeward aspects</dt>
              <dd>
                {w.leewardAspectHints.join(", ") ||
                  "No reliable directional signal"}
              </dd>
            </div>
            <div>
              <dt>Secondary aspects</dt>
              <dd>{w.secondaryWindAspects.join(", ") || "None identified"}</dd>
            </div>
            <div>
              <dt>Elevation focus</dt>
              <dd>{w.windLoadingElevationFocus}</dd>
            </div>
            <div>
              <dt>Peak gust</dt>
              <dd>{w.formatWindDisplay(w.windGustMph)}</dd>
              <small>{w.resolvedWindDirectionSource}</small>
            </div>
          </dl>
          <Details
            title="Wind loading notes and overlapping avalanche problems"
            value={{
              summary: w.windLoadingSummary,
              notes: w.windLoadingNotes,
              overlap: w.aspectOverlapProblems,
            }}
          />
        </section>
      )}
      {flags.snowpackDetails && (
        <section className="field-panel">
          <div className="field-panel-heading">
            <div>
              <span className="field-kicker">Snow observations</span>
              <h2>
                {w.snowpackInterpretation?.headline || "Snowpack assessment"}
              </h2>
            </div>
            <span className="field-badge">{w.snowpackStatusLabel}</span>
          </div>

          {w.snowpackDepthConflict && (
            <p className="field-warning">
              {w.snowpackDepthConflictCaption} · {w.snowpackDepthRangeDisplay}
            </p>
          )}
          <dl className="field-detail-grid">
            <div>
              <dt>Best depth estimate</dt>
              <dd>{w.snowpackBestDepthDisplay}</dd>
              <small>{w.snowpackBestDepthSource}</small>
            </div>
            <div>
              <dt>Snow water equivalent</dt>
              <dd>{w.snowpackBestSweDisplay}</dd>
              <small>{w.snowpackBestSweSource}</small>
            </div>
          </dl>
          <details className="field-detail-disclosure">
            <summary>Compare snow observations</summary>{" "}
            <div className="field-table-scroll">
              <table className="field-data-table">
                <thead>
                  <tr>
                    <th>Observation</th>
                    <th>Depth</th>
                    <th>Snow water</th>
                    <th>Distance / source</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th>SNOTEL</th>
                    <td>{w.snotelDepthDisplay}</td>
                    <td>{w.snotelSweDisplay}</td>
                    <td>
                      {w.snotelDistanceDisplay}
                      <SourceLink url={w.safeSnotelLink} />
                    </td>
                  </tr>
                  <tr>
                    <th>NOHRSC</th>
                    <td>{w.nohrscDepthDisplay}</td>
                    <td>{w.nohrscSweDisplay}</td>
                    <td>
                      <SourceLink url={w.safeNohrscLink} />
                    </td>
                  </tr>
                  <tr>
                    <th>CDEC</th>
                    <td>{w.cdecDepthDisplay}</td>
                    <td>{w.cdecSweDisplay}</td>
                    <td>
                      {w.cdecDistanceDisplay}
                      <SourceLink url={w.safeCdecLink} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="field-muted">{w.snowpackObservationContext}</p>
            <p>{w.snowpackHistoricalComparisonLine}</p>
            <ul className="field-prose-list">
              {w.snowpackInterpretation?.bullets.map((text, i) => (
                <li key={i}>{text}</li>
              ))}
            </ul>
          </details>
          <Details
            title="Snowpack quality, history, and observation details"
            value={data.snowpack}
          />
        </section>
      )}
      {flags.satelliteImagery && flags.snowpackDetails && (
        <section className="field-panel">
          <div className="field-panel-heading">
            <div>
              <h2>Satellite snow imagery</h2>
              <p className="field-muted">
                Imagery can lag current conditions; interpret it alongside
                observations.
              </p>
            </div>
            <Satellite size={22} />
          </div>
          {!w.viewingHistoryReport && (
            <button
              className="field-button"
              disabled={w.snowVisionLoading || !available.snowVision}
              onClick={w.handleRequestSnowVisionAction}
            >
              {w.snowVisionLoading
                ? "Analyzing imagery…"
                : "Analyze snow imagery"}
            </button>
          )}
          {w.snowVisionError && (
            <p className="field-warning" role="alert">
              {w.snowVisionError}
            </p>
          )}
          {w.snowVisionImage && (
            <img
              className="field-satellite-image"
              src={w.snowVisionImage}
              alt="Satellite imagery used for the snow analysis"
            />
          )}
          {w.snowVisionAnalysis && (
            <div className="field-markdown">
              <Streamdown>{w.snowVisionAnalysis}</Streamdown>
            </div>
          )}
          {!available.snowVision && !w.snowVisionAnalysis && (
            <p className="field-muted">
              Satellite analysis is unavailable on this server.
            </p>
          )}
        </section>
      )}
    </section>
  );
}
