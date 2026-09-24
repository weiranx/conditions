import { formatSnowDepthForElevationUnit } from "../app/core";
import { useRef, useState } from "react";
import { ArrowRight, CircleDashed, Clock, CloudRain, Info, Moon, Mountain, MoveRight, Route as RouteIcon, Thermometer, TrendingDown, TrendingUp, TriangleAlert, Upload, Wind } from "lucide-react";
import { Markdown } from "./Markdown";
import type { Workspace } from "./model/useWorkspace";
import { parseGpxFile } from "../lib/gpx";
import { useAiAvailability } from "../hooks/useAiAvailability";
import { Details } from "./Details";
import {
  buildCheckpointProfile,
  buildProfileTicks,
  buildRouteLegs,
  checkpointTone,
  describeRouteTiming,
  formatEtaDate,
  formatLegDuration,
  hasRouteNumber,
  splitRouteBriefing,
} from "./route-planning";
import "./route-planning.css";
import { RouteProfile, type ProfileLevel, type ProfileStop } from "./sky/RouteProfile";
import { knownFeet } from "./sky/status";

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
  const stops: ProfileStop[] = (result?.summaries ?? []).map((p) => ({
    name: p.name,
    eta: p.etaTime || "",
    tone: checkpointTone(p, w.preferences),
    dark: p.daylight === "dark",
  }));
  const overStops = stops.filter((stop) => stop.tone === "over").length;
  const missingStops = stops.filter((stop) => stop.tone === "missing").length;
  const darkStops = stops.filter((stop) => stop.dark).length;
  // -1 when no checkpoint elevation is known, so no stop is named the high point.
  const highIndex = (result?.summaries ?? []).reduce((best, p, i, all) =>
    (hasRouteNumber(p.elev_ft) && (best < 0 || p.elev_ft > (all[best].elev_ft ?? -Infinity)) ? i : best), -1);
  const meta = result?.routeMetadata || (gpx ? { distanceMiles: gpx.distanceMiles, elevationGainFt: gpx.elevationGainFt, maxElevationFt: gpx.maxElevationFt } : null);
  const lastDistance = result?.summaries.at(-1)?.distance_miles;
  const distance = hasRouteNumber(meta?.distanceMiles) ? meta.distanceMiles : hasRouteNumber(lastDistance) ? lastDistance : null;
  const gain = hasRouteNumber(meta?.elevationGainFt) ? meta.elevationGainFt : null;
  const highPoint = hasRouteNumber(meta?.maxElevationFt) ? meta.maxElevationFt : profile ? profile.high : null;
  const returnStop = result?.summaries.at(-1)?.leg === "return" ? result.summaries.at(-1) : undefined;
  const lastStop = result?.summaries.at(-1);
  const legs = buildRouteLegs(result?.summaries ?? []);
  const profileTicks = profile
    ? buildProfileTicks(profile.low, profile.high).map((tick) => ({ y: tick.y, label: w.formatElevationDisplay(tick.feet) }))
    : [];
  // Freezing and snow levels in the profile's frame, when the report has them.
  const profileLevels: ProfileLevel[] = profile
    ? [
      { ft: knownFeet(w.safetyData?.atmosphere?.freezingLevelFt), label: "Freezing level", tone: "cold" as const },
      { ft: knownFeet(w.safetyData?.atmosphere?.snowLevelFt), label: "Snow level", tone: "snow" as const },
    ].flatMap(({ ft, label, tone }) => ft !== null && ft > 0
      ? [{ y: 155 - ((ft - profile.low) / Math.max(100, profile.high - profile.low)) * 125, label: `${label} ${w.formatElevationDisplay(ft)}`, tone }]
      : [])
    : [];
  const briefing = splitRouteBriefing(result?.analysis);
  const bottomLine = briefing?.find((part) => part.key === "bottom-line");
  const facts: { label: string; value: string; note?: string }[] = [
    ...(distance !== null ? [{ label: "Distance", value: w.formatDistanceDisplay(distance) }] : []),
    ...(gain !== null ? [{ label: "Gain", value: w.formatElevationDeltaDisplay(gain) }] : []),
    ...(highPoint !== null ? [{ label: "High point", value: w.formatElevationDisplay(highPoint) }] : []),
    ...(highIndex >= 0 && result?.summaries[highIndex]?.etaTime && highIndex !== (result?.summaries.length ?? 0) - 1
      ? [{ label: "Top out", value: result.summaries[highIndex].etaTime as string }] : []),
    ...(lastStop?.etaTime
      ? [{ label: returnStop ? "Back at start" : "Finish", value: lastStop.etaTime, ...(lastStop.daylight === "dark" ? { note: "After dark" } : {}) }] : []),
    { label: "Planned time", value: `${w.travelWindowHours} h` },
  ];
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
    <div className="sky-route">
      <p className="sky-lead">
        {result && result.summaries.length > 0 ? (
          <>
            {distance !== null && <><strong>{w.formatDistanceDisplay(distance)}</strong> with </>}
            {gain !== null && <><strong>{w.formatElevationDeltaDisplay(gain)}</strong> of gain across </>}
            <strong>{result.summaries.length} checkpoints</strong>.{" "}
            {highIndex >= 0 && result.summaries[highIndex].etaTime && (
              <>You reach the high point, {result.summaries[highIndex].name}, at <strong className={stops[highIndex]?.tone === "over" ? "is-over" : undefined}>{result.summaries[highIndex].etaTime}</strong>{returnStop?.etaTime
                ? <> and are back at the start around <strong>{returnStop.etaTime}</strong>{returnStop.daylight === "dark" ? ", after dark" : ""}</>
                : null}. </>
            )}
            {overStops > 0
              ? <strong className="is-over">{overStops} {overStops === 1 ? "checkpoint crosses" : "checkpoints cross"} your limits.</strong>
              : missingStops > 0
                ? <strong className="is-missing">{missingStops} checkpoint {missingStops === 1 ? "forecast is" : "forecasts are"} missing or incomplete, so {missingStops === 1 ? "it" : "they"} can't be checked against every limit.</strong>
                : "Every checkpoint forecast is within your limits."}
          </>
        ) : (
          <>Check conditions at timed checkpoints along a mapped route or your own GPX track.</>
        )}
      </p>
      {!readOnly && (
        <section className="sky-card sky-section sky-route-choose">
          <div className="field-panel-heading">
            <div>
              <h2 className="sky-card-title">Choose a route</h2>
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
        <div className="sky-notice is-info sky-route-loading" role="status">
          <div>
            <strong>
              {w.routeLoadingState?.kind === "analysis"
                ? "Checking route checkpoints"
                : "Finding route options"}
            </strong>{" "}
            {w.routeLoadingState?.routeName} · Live route analysis can take a
            minute or more.
          </div>
        </div>
      )}
      {w.routeError && (
        <p className="sky-notice is-caution" role="alert">
          {w.routeError}
        </p>
      )}
      {w.routeSuggestions && w.routeSuggestions.length > 0 && (
        <details className="field-route-alternatives sky-section" open={!result}>
          <summary>Route options ({w.routeSuggestions.length})</summary>
        <div className="field-route-options">
          {w.routeSuggestions.map((route, i) => (
            <article className="sky-card" key={i}>
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
          {facts.length > 0 && (
            <dl className="sky-stat-strip sky-section">
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                  {fact.note && <small>{fact.note}</small>}
                </div>
              ))}
            </dl>
          )}
          <section className="sky-section" aria-labelledby="sky-route-along">
            <div className="sky-sh">
              <h2 id="sky-route-along">Conditions along the way</h2>
              <p>Colored by the forecast at the time you reach each point.</p>
            </div>
            <div className="sky-card sky-route-card">
              <span className="sky-card-head">
                <span className="sky-route-source">
                  <RouteIcon size={15} aria-hidden="true" />
                  {result.routeSourceDetails?.sourceLabel ||
                    (result.routeSource === "generated" ? "Generated route" : result.routeSource === "gpx" ? "Your GPX track" : result.routeSource === "nps" ? "National Park Service route" : result.routeSource === "openstreetmap" ? "OpenStreetMap route" : "Route analysis")}
                </span>
                <span className={`sky-chip${returned < result.summaries.length ? " is-missing" : ""}`}>
                  {returned} of {result.summaries.length} forecasts returned
                </span>
              </span>
              {result.routeSource === "generated" && (
                <p className="sky-notice is-info"><Info size={18} aria-hidden="true" /><span>Estimated checkpoints · Route geometry is generated and has not been verified against a mapped trail.</span></p>
              )}
              {(result.partialData || returned < result.summaries.length) && (
                <p className="sky-notice is-missing">
                  <CircleDashed size={18} aria-hidden="true" />
                  <span>
                    Some checkpoints have incomplete source data. Review each
                    forecast before relying on this analysis.
                  </span>
                </p>
              )}
              {profile && (
                <RouteProfile points={points} stops={stops} selected={selectedIndex} onSelect={setCheckpoint}
                  ticks={profileTicks} levels={profileLevels}
                  caption={`Elevation profile across route checkpoints${profileLevels.length ? `. ${profileLevels.map((l) => l.label).join(". ")}` : ""}`} />
              )}
              {profile && (
                <div className="sky-route-legend">
                  <p className="field-route-profile-caption">
                    {profile.axis === "distance"
                      ? "Spaced by route distance"
                      : profile.axis === "progress" ? "Spaced by estimated route progress" : "Checkpoint order; distance unavailable"}
                  </p>
                  <ul aria-label="Profile key">
                    {overStops > 0 && <li><span className="sky-swatch is-over" aria-hidden="true" />Over your limits</li>}
                    {missingStops > 0 && <li><span className="sky-swatch is-missing" aria-hidden="true" />Can't check every limit</li>}
                    {darkStops > 0 && <li><span className="sky-swatch is-night" aria-hidden="true" />After dark</li>}
                  </ul>
                </div>
              )}
              <div className="sky-route-itinerary-head">
                <h3>Checkpoint itinerary</h3>
                <p>{describeRouteTiming(result.timing)} Times are local to the objective.</p>
              </div>
              {result.summaries.length === 0 ? (
                <p className="field-feedback">No checkpoint forecasts were returned. Try another route or import a GPX track.</p>
              ) : (
                <ol className="field-route-itinerary" aria-label="Checkpoint itinerary">
                  {result.summaries.map((point, i) => {
                    const leg = legs[i];
                    const showDate = i === 0 || point.etaDate !== result.summaries[i - 1].etaDate;
                    return (
                      <li key={i} className={`is-${stops[i]?.tone}${point.leg === "return" ? " is-return" : ""}`}>
                        <button
                          type="button"
                          className="field-route-stop"
                          aria-pressed={selectedIndex === i}
                          aria-controls="field-route-checkpoint-detail"
                          onClick={() => setCheckpoint(i)}
                        >
                          <span className={`field-route-stop-number is-${stops[i]?.tone}`} aria-hidden="true">{i + 1}</span>
                          <span className="field-route-stop-place">
                            <strong>{point.name}</strong>
                            <small>
                              {hasRouteNumber(point.elev_ft) ? w.formatElevationDisplay(point.elev_ft) : "Elevation unavailable"}
                              {hasRouteNumber(point.distance_miles) ? ` · ${w.formatDistanceDisplay(point.distance_miles)} along route` : ""}
                            </small>
                          </span>
                          <span className="field-route-stop-time">
                            <strong>{point.etaTime || "Time unavailable"}</strong>
                            <small>{showDate ? formatEtaDate(point.etaDate) || "Date unavailable" : " "}</small>
                          </span>
                          <span className="field-route-stop-wx">
                            {point.dataAvailable ? (
                              <>
                                {hasRouteNumber(point.weather.temp) && <span className="sky-route-pill"><Thermometer size={13} aria-hidden="true" />{w.formatTempDisplay(point.weather.temp)}</span>}
                                {hasRouteNumber(point.weather.windGust) && <span className="sky-route-pill"><Wind size={13} aria-hidden="true" />Gust {w.formatWindDisplay(point.weather.windGust)}</span>}
                                {hasRouteNumber(point.weather.precipChance) && <span className="sky-route-pill"><CloudRain size={13} aria-hidden="true" />{point.weather.precipChance}%</span>}
                                {hasRouteNumber(point.activeAlerts) && point.activeAlerts > 0 && (
                                  <span className="sky-route-pill is-over"><TriangleAlert size={13} aria-hidden="true" />{point.activeAlerts} {point.activeAlerts === 1 ? "alert" : "alerts"}</span>
                                )}
                              </>
                            ) : (
                              <span className="sky-route-pill is-missing">Missing forecast</span>
                            )}
                            {point.daylight === "dark" && <span className="sky-route-pill is-night"><Moon size={13} aria-hidden="true" />After dark</span>}
                          </span>
                        </button>
                        {leg && (leg.minutes !== null || leg.elevationDeltaFt !== null || leg.distanceMiles !== null) && (
                          <p className="field-route-leg">
                            {leg.minutes !== null && <span><Clock size={13} aria-hidden="true" />{formatLegDuration(leg.minutes)}</span>}
                            {leg.elevationDeltaFt !== null && (
                              Math.abs(leg.elevationDeltaFt) < 10
                                ? <span><MoveRight size={13} aria-hidden="true" />Level</span>
                                : leg.elevationDeltaFt > 0
                                  ? <span><TrendingUp size={13} aria-hidden="true" />{w.formatElevationDeltaDisplay(leg.elevationDeltaFt)}</span>
                                  : <span><TrendingDown size={13} aria-hidden="true" />{w.formatElevationDeltaDisplay(leg.elevationDeltaFt)}</span>
                            )}
                            {leg.distanceMiles !== null && <span>{w.formatDistanceDisplay(leg.distanceMiles)}</span>}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
              {selected && (
                <div className="field-checkpoint" id="field-route-checkpoint-detail" role="region" aria-label="Selected checkpoint" aria-live="polite">
                  <div className="field-checkpoint-head">
                    <div>
                      <h3>{selected.name}</h3>
                      <p>
                        {displayNumber(selected.elev_ft, w.formatElevationDisplay)}
                        {hasRouteNumber(selected.distance_miles) ? ` · ${w.formatDistanceDisplay(selected.distance_miles)} along route` : ""}
                        {" · "}Arrive {selected.etaDate ? `${formatEtaDate(selected.etaDate)} ` : ""}
                        {selected.etaTime || "Time unavailable"}
                        {selected.daylight === "dark" ? " · after dark" : ""}
                      </p>
                    </div>
                    <span className={`sky-chip is-${stops[selectedIndex]?.tone}`}>
                      {stops[selectedIndex]?.tone === "over" ? "Over a limit" : stops[selectedIndex]?.tone === "missing" ? "Can't check every limit" : "Within your limits"}
                    </span>
                  </div>
                  <dl className="sky-stat-grid">
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
            </div>
          </section>
          <section className="sky-card sky-section sky-route-brief">
            <span className="sky-card-head">
              {result.analysisSource === "ai"
                ? "AI route explanation"
                : "Route explanation"}
            </span>
            {briefing ? (
              <>
                {bottomLine && (
                  <div className="sky-route-bottom">
                    <span className="field-kicker">Bottom line</span>
                    <p>{bottomLine.text}</p>
                  </div>
                )}
                <div className="sky-route-brief-grid">
                  {briefing.filter((part) => part !== bottomLine).map((part) => (
                    <div key={part.key} className={`sky-route-brief-part is-${part.key}`}>
                      <h3>{part.label}</h3>
                      {part.key === "gear-check" ? (
                        <ul className="sky-route-gear">
                          {part.text.split(/;\s*/).map((item) => item.trim().replace(/\.$/, "")).filter(Boolean).map((item, i) => <li key={i}>{item}</li>)}
                        </ul>
                      ) : (
                        <p>{part.text}</p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="field-markdown">
                <Markdown>{result.analysis}</Markdown>
              </div>
            )}
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
        <p className="sky-empty sky-section">
          No route analysis was stored with this report. Edit the plan to
          generate one.
        </p>
      )}
    </div>
  );
}
