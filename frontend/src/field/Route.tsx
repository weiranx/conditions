import { formatSnowDepthForElevationUnit } from "../app/core";
import { useRef, useState } from "react";
import { ArrowRight, Mountain, Upload } from "lucide-react";
import { Streamdown } from "streamdown";
import type { Workspace } from "./model/useWorkspace";
import { parseGpxFile } from "../lib/gpx";
import { useAiAvailability } from "../hooks/useAiAvailability";
import { Details } from "./Details";
import { buildCheckpointProfile, hasRouteNumber } from "./route-planning";
import "./route-planning.css";

export function Route({ workspace: w }: { workspace: Workspace }) {
  const upload = useRef<HTMLInputElement>(null);
  const [checkpoint, setCheckpoint] = useState(0);
  const available = useAiAvailability(w.safetyData?.capabilities);
  const result = w.routeAnalysis;
  const gpx = w.importedGpxRoute;
  const readOnly = w.viewingHistoryReport;
  const selectedIndex = Math.min(checkpoint, Math.max(0, (result?.summaries.length ?? 1) - 1));
  const selected = result?.summaries[selectedIndex];
  const profile = buildCheckpointProfile(result?.summaries ?? []);
  const points = profile?.points ?? [];
  const returned = result?.summaries.filter((p) => p.dataAvailable).length ?? 0;
  const displayNumber = (value: unknown, format: (n: number) => string) =>
    hasRouteNumber(value) ? format(value) : "Unavailable";
  function analyze(name: string, useGpx = false) {
    if (!name.trim() || readOnly || w.routeLoading || !available.routeAnalysis) return;
    w.handleFetchRouteAnalysis(
      w.objectiveName,
      name,
      w.position.lat,
      w.position.lng,
      w.forecastDate,
      w.alpineStartTime,
      w.travelWindowHours,
      useGpx && gpx
        ? {
            waypoints: gpx.checkpoints,
            routeMetadata: {
              fileName: gpx.fileName,
              pointCount: gpx.pointCount,
              distanceMiles: gpx.distanceMiles,
              elevationGainFt: gpx.elevationGainFt,
              minElevationFt: gpx.minElevationFt,
              maxElevationFt: gpx.maxElevationFt,
              routeShape: gpx.routeShape,
            },
          }
        : undefined,
    );
    setCheckpoint(0);
  }
  return (
    <section>
      <div className="field-chapter-heading">
        <h2>Conditions along your route</h2>
        <p>
          Evaluate timed checkpoints from a mapped route or your own GPX track.
        </p>
      </div>
      {!readOnly && (
        <section className="field-panel">
          <div className="field-panel-heading">
            <div>
              <h3>Choose a route</h3>
              <p className="field-muted">
                Route suggestions and analysis use the current objective, start,
                and duration.
              </p>
            </div>
            <button
              className="field-button"
              disabled={w.routeLoading || !available.routeAnalysis}
              onClick={() =>
                w.handleFetchRouteSuggestions(
                  w.objectiveName,
                  w.position.lat,
                  w.position.lng,
                )
              }
            >
              Find routes <ArrowRight size={15} />
            </button>
          </div>
          <p className="field-route-plan-context">
            {w.forecastDate} · {w.alpineStartTime} start · {w.travelWindowHours} hours
            {w.objectiveTimezone ? ` · ${w.objectiveTimezone}` : ""}
          </p>
          <form
            className="field-inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              analyze(w.customRouteName);
            }}
          >
            <label>
              Route name
              <input
                value={w.customRouteName}
                onChange={(e) => w.setCustomRouteName(e.target.value)}
                placeholder="Enter a named route"
                maxLength={250}
              />
            </label>
            <button
              className="field-button field-button-primary"
              disabled={
                w.routeLoading ||
                !available.routeAnalysis ||
                !w.customRouteName.trim()
              }
            >
              Analyze route
            </button>
          </form>
          {w.featureFlags.gpxImport && (
            <>
              <input
                type="file"
                accept=".gpx,application/gpx+xml"
                ref={upload}
                hidden
                onChange={async (e) => {
                  const input = e.target;
                  const file = input.files?.[0];
                  if (!file) return;
                  try {
                    w.setImportedGpxRoute(await parseGpxFile(file));
                    w.setRouteError(null);
                  } catch (error) {
                    w.setRouteError(
                      error instanceof Error
                        ? error.message
                        : "Could not read GPX.",
                    );
                  }
                  input.value = "";
                }}
              />
              <button
                className="field-text-button"
                onClick={() => upload.current?.click()}
              >
                <Upload size={15} />
                Import GPX for analysis
              </button>
            </>
          )}
          {gpx && (
            <div className="field-route-import">
              <strong>{gpx.name}</strong>
              <p>
                {w.formatDistanceDisplay(gpx.distanceMiles)} ·{" "}
                {w.formatElevationDeltaDisplay(gpx.elevationGainFt)} gain ·{" "}
                {gpx.checkpoints.length} checkpoints
              </p>
              <div className="field-action-row">
                <button
                  className="field-button"
                  disabled={w.routeLoading || !available.routeAnalysis}
                  onClick={() => analyze(gpx.name, true)}
                >
                  Analyze GPX checkpoints
                </button>
                <button
                  className="field-button"
                  onClick={() => w.setImportedGpxRoute(null)}
                >
                  Remove GPX
                </button>
              </div>
            </div>
          )}
          {!available.routeAnalysis && (
            <p className="field-feedback">
              Route analysis is unavailable on this server. Saved analysis
              remains readable.
            </p>
          )}
        </section>
      )}
      {w.routeLoading && (
        <div className="field-panel" role="status">
          <h3>
            {w.routeLoadingState?.kind === "analysis"
              ? "Checking route checkpoints"
              : "Finding route options"}
          </h3>
          <p>
            {w.routeLoadingState?.routeName} · Live route analysis can take a
            minute or more.
          </p>
        </div>
      )}
      {w.routeError && (
        <p className="field-warning" role="alert">
          {w.routeError}
        </p>
      )}
      {w.routeSuggestions && w.routeSuggestions.length > 0 && (
        <details className="field-route-alternatives" open={!result}>
          <summary>Route options ({w.routeSuggestions.length})</summary>
        <div className="field-route-options">
          {w.routeSuggestions.map((route, i) => (
            <article className="field-panel" key={i}>
              <div className="field-panel-heading">
                <div>
                  <span className="field-kicker">{route.class}</span>
                  <h3>{route.name}</h3>
                </div>
                <Mountain size={20} />
              </div>
              <p>{route.description}</p>
              <p>
                {w.formatDistanceDisplay(route.distance_rt_miles)} round trip ·{" "}
                {w.formatElevationDeltaDisplay(route.elev_gain_ft)} gain
              </p>
              {!readOnly && (
                <button
                  className="field-text-button"
                  disabled={w.routeLoading || !available.routeAnalysis}
                  onClick={() => analyze(route.name)}
                >
                  Analyze this route
                  <ArrowRight size={14} />
                </button>
              )}
            </article>
          ))}
        </div>
        </details>
      )}
      {!w.routeLoading && w.routeSuggestions?.length === 0 && (
        <p className="field-feedback">No route suggestions found. Enter a route name or import a GPX track.</p>
      )}
      {result && (
        <>
          <section className="field-panel">
            <div className="field-panel-heading">
              <div>
                <span className="field-kicker">
                  {result.routeSourceDetails?.sourceLabel ||
                    result.routeSource ||
                    "Route analysis"}
                </span>
                <h2>Checkpoint forecast</h2>
              </div>
              <span className="field-badge">
                {returned} of {result.summaries.length} forecasts returned
              </span>
            </div>
            {result.routeSource === "generated" && (
              <p className="field-feedback">Estimated checkpoints · Route geometry is generated and has not been verified against a mapped trail.</p>
            )}
            {(result.partialData || returned < result.summaries.length) && (
              <p className="field-warning">
                Some checkpoints have incomplete source data. Review each
                forecast before relying on this analysis.
              </p>
            )}
            {profile && (
              <svg
                className="field-route-profile"
                viewBox="0 0 1000 180"
                preserveAspectRatio="none"
                role="group"
                aria-label="Elevation profile across route checkpoints"
              >
                <path
                  d={`M 20,180 L ${points.map((p) => `${p.x},${p.y}`).join(" L ")} L 980,180 Z`}
                  fill="currentColor"
                  opacity=".08"
                />
                <polyline
                  points={points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
                {points.map((point, i) => (
                  <g
                    key={i}
                    role="button"
                    tabIndex={0}
                    aria-label={`Select ${result.summaries[i].name}`}
                    aria-pressed={i === selectedIndex}
                    onClick={() => setCheckpoint(i)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setCheckpoint(i);
                      }
                    }}
                  >
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={i === selectedIndex ? 5 : 3}
                      fill="currentColor"
                    />
                    <rect
                      x={point.x - 20}
                      y="0"
                      width="40"
                      height="180"
                      fill="transparent"
                    />
                  </g>
                ))}
              </svg>
            )}
            {profile && (
              <p className="field-route-profile-caption">
                {w.formatElevationDisplay(profile.low)}–{w.formatElevationDisplay(profile.high)} · {profile.axis === "distance"
                  ? "Spaced by route distance"
                  : profile.axis === "progress" ? "Spaced by estimated route progress" : "Checkpoint order; distance unavailable"}
              </p>
            )}
            <div className="field-panel-heading">
              <div>
                <h3>Checkpoint itinerary</h3>
                <p className="field-muted">Estimated arrivals use your planned duration, not terrain-adjusted pace. Times are local to the objective.</p>
              </div>
            </div>
            {result.summaries.length === 0 ? (
              <p className="field-feedback">No checkpoint forecasts were returned. Try another route or import a GPX track.</p>
            ) : (
              <ol className="field-route-itinerary" aria-label="Checkpoint itinerary">
                {result.summaries.map((point, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className="field-route-stop"
                      aria-pressed={selectedIndex === i}
                      aria-controls="field-route-checkpoint-detail"
                      onClick={() => setCheckpoint(i)}
                    >
                      <span className="field-route-stop-number" aria-hidden="true">{i + 1}</span>
                      <span className="field-route-stop-place">
                        <strong>{point.name}</strong>
                        <small>{displayNumber(point.elev_ft, w.formatElevationDisplay)} · {hasRouteNumber(point.distance_miles) ? `${w.formatDistanceDisplay(point.distance_miles)} along route` : "Distance unavailable"}</small>
                      </span>
                      <span>
                        <strong>{point.etaTime || "Time unavailable"}</strong>
                        <small>{point.etaDate || "Date unavailable"}</small>
                      </span>
                      <span>
                        <strong>{point.dataAvailable ? displayNumber(point.weather.temp, w.formatTempDisplay) : "Unavailable"}</strong>
                        <small>Gust {point.dataAvailable ? displayNumber(point.weather.windGust, w.formatWindDisplay) : "unavailable"}</small>
                      </span>
                      <span className="field-route-stop-evidence">
                        <strong>{point.dataAvailable ? "Forecast returned" : "Missing forecast"}</strong>
                        <small>{point.dataAvailable && hasRouteNumber(point.activeAlerts) && point.activeAlerts > 0
                          ? `${point.activeAlerts} active alerts` : "View checkpoint details"}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {selected && (
              <div className="field-checkpoint" id="field-route-checkpoint-detail" role="region" aria-label="Selected checkpoint" aria-live="polite">
                <h3>{selected.name}</h3>
                <p>
                  {displayNumber(selected.elev_ft, w.formatElevationDisplay)} ·{" "}
                  {hasRouteNumber(selected.distance_miles) ? `${w.formatDistanceDisplay(selected.distance_miles)} along route` : "Distance unavailable"} · Arrive{" "}
                  {selected.etaDate || ""}{" "}
                  {selected.etaTime || "Time unavailable"}
                </p>
                <dl className="field-detail-grid">
                  <div>
                    <dt>Planning score</dt>
                    <dd>{selected.dataAvailable ? displayNumber(selected.score, (n) => `${n}/100`) : "Unavailable"}</dd>
                    <small>
                      {selected.dataAvailable
                        ? "Forecast available"
                        : "Missing data"}
                    </small>
                  </div>
                  <div>
                    <dt>Weather</dt>
                    <dd>{selected.dataAvailable ? displayNumber(selected.weather.temp, w.formatTempDisplay) : "Unavailable"}</dd>
                    <small>{selected.dataAvailable ? selected.weather.description : "Forecast did not load"}</small>
                  </div>
                  <div>
                    <dt>Wind gust</dt>
                    <dd>{selected.dataAvailable ? displayNumber(selected.weather.windGust, w.formatWindDisplay) : "Unavailable"}</dd>
                    <small>
                      Feels like{" "}
                      {selected.dataAvailable ? displayNumber(selected.weather.feelsLike, w.formatTempDisplay) : "unavailable"}
                    </small>
                  </div>
                  <div>
                    <dt>Precipitation</dt>
                    <dd>{selected.dataAvailable ? displayNumber(selected.weather.precipChance, (n) => `${n}%`) : "Unavailable"}</dd>
                  </div>
                  <div>
                    <dt>Avalanche</dt>
                    <dd>{(selected.dataAvailable && selected.avalanche?.risk) || "Unavailable"}</dd>
                  </div>
                  <div>
                    <dt>Alerts / snow depth</dt>
                    <dd>
                      {selected.dataAvailable ? displayNumber(selected.activeAlerts, (n) => `${n} alerts`) : "Alerts unavailable"} ·{" "}
                      {formatSnowDepthForElevationUnit(
                        selected.dataAvailable ? selected.snowDepthIn : null,
                        w.preferences.elevationUnit,
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </section>
          <section className="field-panel">
            <span className="field-kicker">
              {result.analysisSource === "ai"
                ? "AI route explanation"
                : "Route explanation"}
            </span>
            <div className="field-markdown">
              <Streamdown>{result.analysis}</Streamdown>
            </div>
          </section>
          <Details
            title="Terrain sampling and route provenance"
            value={{
              terrain: result.terrainProfile,
              source: result.routeSourceDetails,
              route: result.routeMetadata,
            }}
          />
        </>
      )}
      {!result && readOnly && (
        <p className="field-muted">
          No route analysis was stored with this report. Edit the plan to
          generate one.
        </p>
      )}
    </section>
  );
}
