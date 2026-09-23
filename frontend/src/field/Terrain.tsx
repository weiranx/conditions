import { SurfacePrediction } from "./SurfacePrediction";
import { lazy, Suspense, useMemo, useState } from "react";
import { Mountain, Minus, Plus, Satellite } from "lucide-react";
import { Streamdown } from "streamdown";
import type { Workspace } from "./model/useWorkspace";
import { buildTerrainWindow } from "../app/terrain-window";
import { resolveReportFeatureFlags } from "../contexts/feature-flags";
import { useAiAvailability } from "../hooks/useAiAvailability";
import { planFromReport } from "./data";
import { WindCompass } from "./WindCompass";
import { Details, SourceLink } from "./Details";
import { MountainSection } from "./sky/MountainSection";
import { StatusTag } from "./sky/BriefSections";
import { surfaceLabel, terrainStatus } from "./sky/status";
import type { SkyHour } from "./sky/sky-model";
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
    <section className="sky-section" aria-labelledby="sky-terrain-day">
      <div className="sky-sh">
        <h2 id="sky-terrain-day">Terrain through the day</h2>
        <p>By elevation and aspect. Select a cell for the reasons.</p>
      </div>
      <div className="sky-card sky-terrain-window">
      <details className="sky-details">
        <summary>How to read this view</summary>
        <p>{model.explanation}</p>
      </details>
      {model.lanes.length ? (
        <>
          <div className="field-table-scroll">
            <table className="sky-table sky-terrain-matrix">
              <thead>
                <tr>
                  <th scope="col">Elevation / aspect</th>
                  {model.hours.map((hour, i) => (
                    <th scope="col" key={i}>
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
                    <th scope="row">
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
            <div className={`sky-terrain-reason is-${cell.level}`} aria-live="polite">
              <strong>
                {lane.elevationLabel} · {lane.aspectLabel} · {w.formatClockForStyle(model.hours[selection.hour]?.time, w.preferences.timeStyle)}
              </strong>
              <p>
                {cell.reasons.join(" ") ||
                  "Nothing here crosses a terrain-specific limit in the available data. This is not a slope-stability assessment."}
              </p>
            </div>
          )}
        </>
      ) : (
        <p className="sky-empty">
          Not enough hourly or elevation data to build the terrain view.
        </p>
      )}
      </div>
    </section>
  );
}

const AVALANCHE_SCALE = ["Low", "Moderate", "Considerable", "High", "Extreme"];

export function Terrain({ workspace: w, hours }: { workspace: Workspace; hours: SkyHour[] }) {
  const data = w.safetyData!;
  const flags = resolveReportFeatureFlags(data.featureFlags);
  const available = useAiAvailability(data.capabilities);
  const target = w.targetElevationForecast;
  const surface = surfaceLabel(data);
  const status = terrainStatus(data);
  const objectiveFt = Number.isFinite(Number(data.weather.elevation)) ? Number(data.weather.elevation) : null;
  const freezing = Number(data.atmosphere?.freezingLevelFt);
  const snowLevel = Number(data.atmosphere?.snowLevelFt);
  const levels = [
    ...(Number.isFinite(freezing) && freezing > 0 ? [{ label: "Freezing level", ft: freezing, tone: "cold" as const }] : []),
    ...(Number.isFinite(snowLevel) && snowLevel > 0 ? [{ label: "Snow level", ft: snowLevel, tone: "snow" as const }] : []),
  ];
  const objectiveBand = w.elevationForecastBands.find((b) => objectiveFt !== null && Math.abs(b.elevationFt - objectiveFt) < 150);
  const avalancheLevel = w.overallAvalancheLevel as number | null;
  const snowDepth = data.snowpack?.snotel?.snowDepthIn == null
    ? "Unavailable"
    : w.preferences.elevationUnit === "m"
      ? `${Math.round(data.snowpack.snotel.snowDepthIn * 2.54)} cm`
      : `${data.snowpack.snotel.snowDepthIn} in`;
  return (
    <div className="sky-terrain">
      <p className="sky-lead">
        {objectiveFt !== null ? <>Your objective at <strong>{w.formatElevationDisplay(objectiveFt)}</strong> is </> : <>The surface is </>}
        <strong className={status === "over" ? "is-over" : status === "missing" ? "is-missing" : undefined}>
          {surface ? surface.toLowerCase() : "not assessed"}
        </strong>.
        {levels.length > 0 && (
          <> {levels.map((l, i) => (
            <span key={l.label}>{i > 0 ? "; " : ""}{i > 0 ? l.label.toLowerCase() : l.label} near{" "}
              <strong className={l.tone === "cold" && objectiveFt !== null && l.ft <= objectiveFt ? "is-cold" : undefined}>{w.formatElevationDisplay(l.ft)}</strong>
            </span>
          ))}{levels.some((l) => l.tone === "cold" && objectiveFt !== null && l.ft <= objectiveFt) ? ", below your objective" : ""}.</>
        )}{" "}
        <span className="sky-lead-note">{w.terrainConditionDetails.summary}</span>
      </p>

      {flags.elevationForecast && (
        <section className="sky-section" aria-labelledby="sky-terrain-mountain">
          <div className="sky-sh">
            <h2 id="sky-terrain-mountain">The mountain at your start</h2>
            <p>Forecast by elevation. Heights are to scale; the ridge is illustrative.</p>
          </div>
          <div className="sky-card sky-mountain-card">
            {w.elevationForecastBands.length > 0 ? (
              <MountainSection
                bands={w.elevationForecastBands}
                objectiveFt={objectiveFt}
                objectiveLabel={objectiveBand ? `Objective · ${w.formatTempDisplay(objectiveBand.temp)}` : "Objective"}
                target={w.hasTargetElevation && target && Number.isFinite(w.targetElevationFt) && Math.abs(w.targetElevationFt - (objectiveFt ?? -1e9)) > 100
                  ? { ft: w.targetElevationFt, label: `${w.formatElevationDisplay(w.targetElevationFt)} · ${w.formatTempDisplay(target.temp)}` }
                  : null}
                levels={levels}
                sky={hours[0] ? { zenith: hours[0].zenith, horizon: hours[0].horizon } : null}
                format={{ elevation: (ft) => w.formatElevationDisplay(ft), temp: (f) => w.formatTempDisplay(f), wind: (mph) => w.formatWindDisplay(mph) }}
              />
            ) : (
              <p className="sky-empty">Elevation bands are unavailable for this plan.</p>
            )}
            <div className="sky-elevation-check">
              <label>
                <span>Check an elevation ({w.elevationUnitLabel})</span>
                <span className="sky-stepper-row">
                  <button type="button" className="sky-stepper" aria-label="Decrease target elevation"
                    disabled={!w.canDecreaseTargetElevation} onClick={() => w.handleTargetElevationStep(-1000)}>
                    <Minus size={18} aria-hidden="true" />
                  </button>
                  <input inputMode="numeric" value={w.targetElevationInput} onChange={w.handleTargetElevationChange} />
                  <button type="button" className="sky-stepper" aria-label="Increase target elevation"
                    onClick={() => w.handleTargetElevationStep(1000)}>
                    <Plus size={18} aria-hidden="true" />
                  </button>
                </span>
              </label>
              {target && (
                <dl className="sky-inline-facts">
                  <div><dt>Temperature</dt><dd>{w.formatTempDisplay(target.temp)}</dd></div>
                  <div><dt>Feels like</dt><dd>{w.formatTempDisplay(target.feelsLike)}</dd></div>
                  <div><dt>Wind</dt><dd>{w.formatWindDisplay(target.windSpeed)}</dd></div>
                  <div><dt>Gust</dt><dd>{w.formatWindDisplay(target.windGust)}</dd></div>
                </dl>
              )}
            </div>
            <p className="sky-cap">
              {data.weather.elevationForecastNote ||
                "These are planning estimates, not observations at the selected elevation."}
            </p>
          </div>
        </section>
      )}

      <div className="sky-duo sky-section">
        <section className="sky-card field-terrain-overview" aria-labelledby="sky-terrain-surface">
          <span className="sky-card-head">
            <span id="sky-terrain-surface">Surface</span>
            <StatusTag status={status}>{surface || "Not assessed"}</StatusTag>
          </span>
          <dl className="sky-list">
            <div><dt>Objective elevation</dt><dd>{w.formatElevationDisplay(data.weather.elevation)}</dd></div>
            <div><dt>Snow depth · nearby station</dt><dd>{snowDepth}</dd></div>
            <div><dt>Confidence</dt><dd>{data.terrainCondition?.confidence || "Unknown"}</dd></div>
          </dl>
          <div className="sky-prose">
            <SurfacePrediction condition={data.terrainCondition} />
          </div>
          <Details title="Surface, freeze/thaw, and travel evidence" value={data.terrainCondition} />
        </section>
        {flags.windLoadingDetails && (
          <section className="sky-card" aria-labelledby="sky-terrain-wind">
            <span className="sky-card-head">
              <span id="sky-terrain-wind">Wind loading</span>
              <span className="sky-chip">{w.windLoadingLevel} · {w.windLoadingConfidence}</span>
            </span>
            <div className="sky-wind-row">
              <WindCompass leeward={w.leewardAspectHints} secondary={w.secondaryWindAspects} />
              <p className="sky-cap is-body">{w.windLoadingActionLine}</p>
            </div>
            <dl className="sky-list">
              <div><dt>Active window</dt><dd>{w.windLoadingActiveWindowLabel}<small>{w.windLoadingActiveHoursDetail}</small></dd></div>
              <div><dt>Leeward aspects</dt><dd>{w.leewardAspectHints.join(", ") || "No reliable directional signal"}</dd></div>
              <div><dt>Secondary aspects</dt><dd>{w.secondaryWindAspects.join(", ") || "None identified"}</dd></div>
              <div><dt>Elevation focus</dt><dd>{w.windLoadingElevationFocus}</dd></div>
              <div><dt>Peak gust</dt><dd>{w.formatWindDisplay(w.windGustMph)}<small>{w.resolvedWindDirectionSource}</small></dd></div>
            </dl>
            <Details
              title="Wind loading notes and overlapping avalanche problems"
              value={{ summary: w.windLoadingSummary, notes: w.windLoadingNotes, overlap: w.aspectOverlapProblems }}
            />
          </section>
        )}
      </div>

      {flags.terrainWindow && <TerrainWindow workspace={w} />}

      {flags.avalancheDetails && (
        <section className="sky-section" aria-labelledby="sky-terrain-avalanche">
          <div className="sky-sh">
            <h2 id="sky-terrain-avalanche">Avalanche outlook</h2>
            <p>Regional bulletin{data.avalanche?.center ? ` · ${data.avalanche.center}` : ""}</p>
          </div>
          <div className="sky-card">
            <div className="sky-danger" role="img"
              aria-label={avalancheLevel ? `Avalanche danger ${avalancheLevel} of 5, ${AVALANCHE_SCALE[avalancheLevel - 1] || ""}.` : "No avalanche danger rating."}>
              {AVALANCHE_SCALE.map((label, i) => (
                <span key={label} className={avalancheLevel === i + 1 ? `is-on${i >= 2 ? " is-over" : ""}` : undefined}>
                  <i />{label}
                </span>
              ))}
            </div>
            <span className="sky-card-head">
              <span>{w.avalancheUnknown ? "Unknown danger" : data.avalanche?.risk || "Unavailable"}</span>
            </span>
            {w.avalancheExpiredForSelectedStart && (
              <p className="sky-notice is-caution">
                This bulletin expires before the selected departure. Check for a current forecast.
              </p>
            )}
            <p className="sky-cap is-body">
              {!w.avalancheRelevant ? w.avalancheNotApplicableReason : data.avalanche?.bottomLine || data.avalanche?.relevanceReason}
            </p>
            {w.avalancheElevationRows.length > 0 && (
              <dl className="sky-list">
                {w.avalancheElevationRows.map((band) => (
                  <div key={band.key}>
                    <dt>{band.label}</dt>
                    <dd>{band.rating === null ? "No rating" : w.getDangerText(band.rating)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {data.avalanche?.problems?.map((problem, i) => (
              <article className="sky-problem" key={i}>
                <h3>{problem.name}</h3>
                <p>{problem.discussion || problem.problem_description}</p>
                <Details
                  title="Affected aspects, elevations, size, and likelihood"
                  value={{ likelihood: problem.likelihood, size: problem.size, location: problem.location }}
                />
              </article>
            ))}
            {data.avalanche?.advice && <p className="sky-cap is-body">{data.avalanche.advice}</p>}
            <SourceLink url={w.safeAvalancheLink}>Read the complete bulletin</SourceLink>
            <Details title="Avalanche forecast coverage and validity" value={data.avalanche} />
          </div>
        </section>
      )}

      {flags.snowpackDetails && (
        <section className="sky-section" aria-labelledby="sky-terrain-snow">
          <div className="sky-sh">
            <h2 id="sky-terrain-snow">Snow observations</h2>
            <p>{w.snowpackStatusLabel}</p>
          </div>
          <div className="sky-card">
            <span className="sky-card-head"><span>{w.snowpackInterpretation?.headline || "Snowpack assessment"}</span></span>
            {w.snowpackDepthConflict && (
              <p className="sky-notice is-caution">
                {w.snowpackDepthConflictCaption} · {w.snowpackDepthRangeDisplay}
              </p>
            )}
            <div className="sky-stat-row">
              <div><span className="sky-muted">Best depth estimate</span><span className="sky-big">{w.snowpackBestDepthDisplay}</span><small>{w.snowpackBestDepthSource}</small></div>
              <div><span className="sky-muted">Snow water equivalent</span><span className="sky-big">{w.snowpackBestSweDisplay}</span><small>{w.snowpackBestSweSource}</small></div>
            </div>
            <div className="sky-table-scroll">
              <table className="sky-table">
                <thead>
                  <tr>
                    <th scope="col">Observation</th>
                    <th scope="col" className="is-num">Depth</th>
                    <th scope="col" className="is-num">Snow water</th>
                    <th scope="col" className="is-end">Distance / source</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">SNOTEL station</th>
                    <td className="is-num">{w.snotelDepthDisplay}</td>
                    <td className="is-num">{w.snotelSweDisplay}</td>
                    <td className="is-end">{w.snotelDistanceDisplay} <SourceLink url={w.safeSnotelLink} /></td>
                  </tr>
                  <tr>
                    <th scope="row">NOHRSC model</th>
                    <td className="is-num">{w.nohrscDepthDisplay}</td>
                    <td className="is-num">{w.nohrscSweDisplay}</td>
                    <td className="is-end"><SourceLink url={w.safeNohrscLink} /></td>
                  </tr>
                  <tr>
                    <th scope="row">CDEC station</th>
                    <td className="is-num">{w.cdecDepthDisplay}</td>
                    <td className="is-num">{w.cdecSweDisplay}</td>
                    <td className="is-end">{w.cdecDistanceDisplay} <SourceLink url={w.safeCdecLink} /></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="sky-cap">{w.snowpackObservationContext}</p>
            {w.snowpackHistoricalComparisonLine && <p className="sky-cap is-body">{w.snowpackHistoricalComparisonLine}</p>}
            {Boolean(w.snowpackInterpretation?.bullets.length) && (
              <ul className="sky-bullets">
                {w.snowpackInterpretation?.bullets.map((text, i) => <li key={i}>{text}</li>)}
              </ul>
            )}
            <Details title="Snowpack quality, history, and observation details" value={data.snowpack} />
          </div>
        </section>
      )}

      {flags.satelliteImagery && flags.snowpackDetails && (
        <section className="sky-card sky-section" aria-labelledby="sky-terrain-satellite">
          <span className="sky-card-head">
            <span id="sky-terrain-satellite">Satellite snow imagery</span>
            <Satellite size={18} aria-hidden="true" />
          </span>
          <p className="sky-cap is-body">Imagery can lag current conditions; interpret it alongside observations.</p>
          {!w.viewingHistoryReport && (
            <button
              className="field-button"
              disabled={w.snowVisionLoading || !available.snowVision}
              onClick={w.handleRequestSnowVisionAction}
            >
              {w.snowVisionLoading ? "Analyzing imagery…" : "Analyze snow imagery"}
            </button>
          )}
          {w.snowVisionError && <p className="sky-notice is-caution" role="alert">{w.snowVisionError}</p>}
          {w.snowVisionImage && (
            <img className="field-satellite-image" src={w.snowVisionImage} alt="Satellite imagery used for the snow analysis" />
          )}
          {w.snowVisionAnalysis && (
            <div className="field-markdown">
              <Streamdown>{w.snowVisionAnalysis}</Streamdown>
            </div>
          )}
          {!available.snowVision && !w.snowVisionAnalysis && (
            <p className="sky-cap">Satellite analysis is unavailable on this server.</p>
          )}
        </section>
      )}

      <details className="sky-card sky-section sky-map-card report-map-disclosure">
        <summary><Mountain size={18} aria-hidden="true" /> Explore the terrain map</summary>
        <Suspense fallback={<div className="field-map-loading">Loading terrain…</div>}>
          <FieldMap plan={planFromReport(w.reportSnapshot!)} workspace={w} />
        </Suspense>
      </details>
    </div>
  );
}
