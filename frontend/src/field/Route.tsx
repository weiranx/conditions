import { formatSnowDepthForElevationUnit } from "../app/core";
import { useRef, useState } from "react";
import { ArrowRight, Mountain, Upload } from "lucide-react";
import { Streamdown } from "streamdown";
import type { Workspace } from "./model/useWorkspace";
import { parseGpxFile } from "../lib/gpx";
import { useAiAvailability } from "../hooks/useAiAvailability";
import { Details } from "./Details";

export function Route({ workspace: w }: { workspace: Workspace }) {
  const upload = useRef<HTMLInputElement>(null);
  const [checkpoint, setCheckpoint] = useState(0);
  const available = useAiAvailability(w.safetyData?.capabilities);
  const result = w.routeAnalysis;
  const gpx = w.importedGpxRoute;
  const readOnly = w.viewingHistoryReport;
  const selected =
    result?.summaries[Math.min(checkpoint, result.summaries.length - 1)];
  const elevations =
    result?.summaries.map((point) => point.elev_ft).filter(Number.isFinite) ||
    [];
  const low = Math.min(...elevations);
  const high = Math.max(...elevations);
  const points =
    result?.summaries.map((point, index) => ({
      x: 20 + (index * 960) / Math.max(1, result.summaries.length - 1),
      y: 155 - ((point.elev_ft - low) / Math.max(100, high - low)) * 125,
    })) || [];
  function analyze(name: string, useGpx = false) {
    if (!name.trim()) return;
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
      {!result && w.routeSuggestions && (
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
                  disabled={w.routeLoading}
                  onClick={() => analyze(route.name)}
                >
                  Analyze this route
                  <ArrowRight size={14} />
                </button>
              )}
            </article>
          ))}
        </div>
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
                {result.summaries.length} checkpoints
              </span>
            </div>
            {result.partialData && (
              <p className="field-warning">
                Some checkpoints have incomplete source data. Review each
                forecast before relying on this analysis.
              </p>
            )}
            {elevations.length === points.length && points.length > 1 && (
              <svg
                className="field-route-profile"
                viewBox="0 0 1000 180"
                preserveAspectRatio="none"
                role="img"
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
                      r={i === checkpoint ? 5 : 3}
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
            <div
              className="field-preset-list"
              role="group"
              aria-label="Route checkpoints"
            >
              {result.summaries.map((point, i) => (
                <button
                  key={i}
                  aria-pressed={checkpoint === i}
                  onClick={() => setCheckpoint(i)}
                >
                  {point.name}
                </button>
              ))}
            </div>
            {selected && (
              <div className="field-checkpoint">
                <h3>{selected.name}</h3>
                <p>
                  {w.formatElevationDisplay(selected.elev_ft)} ·{" "}
                  {w.formatDistanceDisplay(selected.distance_miles)} · Arrive{" "}
                  {selected.etaDate || ""}{" "}
                  {selected.etaTime || "Time unavailable"}
                </p>
                <dl className="field-detail-grid">
                  <div>
                    <dt>Planning score</dt>
                    <dd>{selected.score ?? "—"}/100</dd>
                    <small>
                      {selected.dataAvailable
                        ? "Forecast available"
                        : "Missing data"}
                    </small>
                  </div>
                  <div>
                    <dt>Weather</dt>
                    <dd>{w.formatTempDisplay(selected.weather.temp)}</dd>
                    <small>{selected.weather.description}</small>
                  </div>
                  <div>
                    <dt>Wind gust</dt>
                    <dd>{w.formatWindDisplay(selected.weather.windGust)}</dd>
                    <small>
                      Feels like{" "}
                      {w.formatTempDisplay(selected.weather.feelsLike)}
                    </small>
                  </div>
                  <div>
                    <dt>Precipitation</dt>
                    <dd>{selected.weather.precipChance ?? "—"}%</dd>
                  </div>
                  <div>
                    <dt>Avalanche</dt>
                    <dd>{selected.avalanche?.risk || "Unavailable"}</dd>
                  </div>
                  <div>
                    <dt>Alerts / snow depth</dt>
                    <dd>
                      {selected.activeAlerts} alerts ·{" "}
                      {formatSnowDepthForElevationUnit(
                        selected.snowDepthIn,
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
