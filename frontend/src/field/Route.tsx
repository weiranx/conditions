import { KM_PER_MILE } from "../app/constants";
import { formatSnowDepthForElevationUnit, parseSolarClockMinutes, parseTimeInputMinutes } from "../app/core";
import { useState } from "react";
import { CircleCheck, CircleDashed, Clock, Eye, Signpost, type LucideIcon, CloudRain, Footprints, Info, Moon, MoveRight, Route as RouteIcon, Thermometer, TrendingDown, TrendingUp, TriangleAlert, Wind } from "lucide-react";
import { Markdown } from "./Markdown";
import type { Workspace } from "./model/useWorkspace";
import { useAiAvailability } from "../hooks/useAiAvailability";
import { Details } from "./Details";
import { dateLabel } from "./data";
import {
  buildCheckpointProfile,
  buildDistanceTicks,
  buildProfileTicks,
  buildRouteLegs,
  checkpointFeelsLike,
  checkpointHazards,
  checkpointLimitFlags,
  checkpointTone,
  compareCheckpointToObjective,
  describeCheckpointHazard,
  describeStaleRouteAnalysis,
  describeRouteTiming,
  formatEtaDate,
  formatLegDuration,
  hasRouteNumber,
  objectiveHourAt,
  splitRouteBriefing,
} from "./route-planning";
import "./route-planning.css";
import { RouteWeatherChart } from "./RouteWeatherChart";
import { RouteSuggestions } from "./RouteSuggestions";
import "./sky/plan.css";
import { WeatherSymbol } from "./Forecast";
import "./forecast.css";
import { RouteProfile, type ProfileLevel, type ProfileStop } from "./sky/RouteProfile";
import { knownFeet } from "./sky/status";
import { skyAt } from "./sky/sky-model";

const BRIEF_ICONS: Record<string, LucideIcon> = {
  "hazard-zones": TriangleAlert,
  "weather-window": Clock,
  "other-concerns": Eye,
  "decision-points": Signpost,
};

export function Route({ workspace: w }: { workspace: Workspace }) {
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
  // Arrivals come back as 24-hour clocks; show them in the user's time style.
  const clock = (value: string | undefined) => (value ? w.formatClockForStyle(value, w.preferences.timeStyle) : "");
  // Straight lines between checkpoints undercount the trail, so mark them approximate.
  const miles = (value: number) => `${result?.timing?.distanceBasis === "straight-line" ? "≈ " : ""}${w.formatDistanceDisplay(value)}`;
  const sunrise = parseSolarClockMinutes(w.safetyData?.solar?.sunrise);
  const sunset = parseSolarClockMinutes(w.safetyData?.solar?.sunset);
  const stops: ProfileStop[] = (result?.summaries ?? []).map((p) => ({
    sky: (() => {
      const arrival = parseTimeInputMinutes(p.etaTime || "");
      if (arrival === null || !p.dataAvailable) return null;
      return {
        ...skyAt(arrival, sunrise, sunset, p.weather.description, p.weather.precipChance),
        temp: hasRouteNumber(p.weather.temp) ? w.formatTempDisplay(p.weather.temp) : null,
      };
    })(),
    name: p.name,
    eta: clock(p.etaTime),
    tone: checkpointTone(p, w.preferences),
    dark: p.daylight === "dark",
  }));
  const overStops = stops.filter((stop) => stop.tone === "over").length;
  const hazardStops = stops.filter((stop) => stop.tone === "hazard").length;
  const missingStops = stops.filter((stop) => stop.tone === "missing").length;
  // Return checkpoints repeat an outbound location, so count each place once.
  const estimatedPlaces = new Set((result?.summaries ?? []).filter((p) => p.locationEstimated && p.leg !== "return").map((p) => p.name)).size;
  const estimatedElevations = points.filter((point) => point.estimated).length;
  const darkStops = stops.filter((stop) => stop.dark).length;
  // -1 when no checkpoint elevation is known, so no stop is named the high point.
  const highIndex = (result?.summaries ?? []).reduce((best, p, i, all) =>
    (hasRouteNumber(p.elev_ft) && (best < 0 || p.elev_ft > (all[best].elev_ft ?? -Infinity)) ? i : best), -1);
  const meta = result?.routeMetadata || (gpx ? { distanceMiles: gpx.distanceMiles, elevationGainFt: gpx.elevationGainFt, maxElevationFt: gpx.maxElevationFt } : null);
  const lastDistance = result?.summaries.at(-1)?.distance_miles;
  const distance = hasRouteNumber(meta?.distanceMiles) ? meta.distanceMiles : hasRouteNumber(lastDistance) ? lastDistance : null;
  const gain = hasRouteNumber(meta?.elevationGainFt) ? meta.elevationGainFt : null;
  const highPoint = hasRouteNumber(meta?.maxElevationFt) ? meta.maxElevationFt : profile ? profile.high : null;
  // Out-and-backs and loops both end back at the start.
  const returnStop = result?.summaries.at(-1)?.leg === "return" || result?.timing?.routeShape === "loop" ? result?.summaries.at(-1) : undefined;
  const lastStop = result?.summaries.at(-1);
  const legs = buildRouteLegs(result?.summaries ?? []);
  const selectedTone = stops[selectedIndex]?.tone ?? "missing";
  const selectedFeelsLike = selected?.dataAvailable ? checkpointFeelsLike(selected) : null;
  const selectedFlags = selected ? checkpointLimitFlags(selected, w.preferences) : { feelsLike: false, gust: false, precip: false };
  const selectedHazards = selected ? checkpointHazards(selected) : [];
  const selectedVsObjective = selected
    ? compareCheckpointToObjective(selected, objectiveHourAt(w.safetyData?.weather?.trend, selected.etaDate, selected.etaTime))
    : null;
  const celsius = w.preferences.temperatureUnit === "c";
  const kph = w.preferences.windSpeedUnit === "kph";
  const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : "±"}${Math.abs(value)}`;
  const vsObjective = selectedVsObjective ? [
    selectedVsObjective.temp !== null ? `${signed(Math.round(selectedVsObjective.temp * (celsius ? 5 / 9 : 1)))}°${celsius ? "C" : "F"}` : null,
    selectedVsObjective.gust !== null ? `gusts ${signed(Math.round(selectedVsObjective.gust * (kph ? 1.609344 : 1)))} ${kph ? "km/h" : "mph"}` : null,
    selectedVsObjective.precip !== null ? `rain ${signed(Math.round(selectedVsObjective.precip))}%` : null,
  ].filter(Boolean).join(" · ") : "";
  const staleChanges = readOnly ? [] : describeStaleRouteAnalysis(result, {
    date: w.forecastDate, start: w.alpineStartTime, travelWindowHours: w.travelWindowHours, lat: w.position.lat, lon: w.position.lng,
  });
  const vert = (feet: number) => (Math.abs(feet) < 10 ? "level" : w.formatElevationDeltaDisplay(feet));
  const profileLegs = legs.map((leg) => {
    const parts = [leg.distanceMiles !== null ? miles(leg.distanceMiles) : null, leg.elevationDeltaFt !== null ? vert(leg.elevationDeltaFt) : null]
      .filter((part): part is string => part !== null);
    return parts.length ? { label: parts.join(" · "), short: parts[0] } : null;
  });
  const metric = w.preferences.elevationUnit === "m";
  const distanceTicks = buildDistanceTicks(profile?.spanMiles ?? null, metric ? KM_PER_MILE : 1)
    .map((tick) => ({ x: tick.x, label: tick.value === 0 ? "0" : `${tick.value} ${metric ? "km" : "mi"}` }));
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
    ...(distance !== null ? [{ label: "Distance", value: hasRouteNumber(meta?.distanceMiles) ? w.formatDistanceDisplay(distance) : miles(distance) }] : []),
    ...(gain !== null ? [{ label: "Gain", value: w.formatElevationDeltaDisplay(gain) }] : []),
    ...(highPoint !== null ? [{ label: "High point", value: w.formatElevationDisplay(highPoint) }] : []),
    ...(highIndex >= 0 && result?.summaries[highIndex]?.etaTime && highIndex !== (result?.summaries.length ?? 0) - 1
      ? [{ label: "Top out", value: clock(result.summaries[highIndex].etaTime) }] : []),
    ...(lastStop?.etaTime
      ? [{ label: returnStop ? "Back at start" : "Finish", value: clock(lastStop.etaTime), ...(lastStop.daylight === "dark" ? { note: "After dark" } : {}) }] : []),
    // The duration this analysis was run with, which the plan may have changed since.
    { label: "Planned time", value: `${result?.timing?.travelWindowHours ?? w.travelWindowHours} h` },
  ];
  const canAnalyze = !readOnly && !w.routeLoading && available.routeAnalysis && Boolean(w.plannedRouteName);
  function analyze() {
    if (!canAnalyze) return;
    w.handleAnalyzePlannedRoute();
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
              <>You reach the high point, {result.summaries[highIndex].name}, at <strong className={stops[highIndex]?.tone === "over" ? "is-over" : undefined}>{clock(result.summaries[highIndex].etaTime)}</strong>{returnStop?.etaTime
                ? <> and are back at the start around <strong>{clock(returnStop.etaTime)}</strong>{returnStop.daylight === "dark" ? ", after dark" : ""}</>
                : null}. </>
            )}
            {overStops > 0
              ? <strong className="is-over">{overStops} {overStops === 1 ? "checkpoint crosses" : "checkpoints cross"} your limits.</strong>
              : hazardStops > 0
                ? <strong className="is-over">{hazardStops} {hazardStops === 1 ? "checkpoint is" : "checkpoints are"} under a weather alert or avalanche danger.</strong>
              : missingStops > 0
                ? <strong className="is-missing">{missingStops} checkpoint {missingStops === 1 ? "forecast is" : "forecasts are"} missing or incomplete, so {missingStops === 1 ? "it" : "they"} can't be checked against every limit.</strong>
                : "Every checkpoint forecast is within your limits."}
          </>
        ) : (
          <>Check conditions at timed checkpoints along a mapped route or your own GPX track.</>
        )}
      </p>
      {!readOnly && (
        <form
          className="sky-card sky-section sky-route-choose"
          aria-label="Planned route"
          onSubmit={(e) => {
            e.preventDefault();
            analyze();
          }}
        >
          {gpx ? (
            <p className="sky-route-planned">
              <RouteIcon size={16} aria-hidden="true" />
              <span><strong>{w.plannedRouteName}</strong> · your GPX track, {gpx.checkpoints.length} checkpoints</span>
            </p>
          ) : (
            <label className="sky-route-planned-name">
              Route
              <input
                value={w.customRouteName}
                onChange={(e) => w.setCustomRouteName(e.target.value)}
                placeholder="Enter a named route"
                maxLength={250}
              />
            </label>
          )}
          {!gpx && available.routeAnalysis && (
            <button
              type="button"
              className="field-button"
              disabled={readOnly || w.routeLoading}
              onClick={() => w.handleFetchRouteSuggestions(w.objectiveName, w.position.lat, w.position.lng)}
            >
              {w.routeLoadingState?.kind === "suggestions" ? "Finding routes…" : "Suggest routes"}
            </button>
          )}
          <button className="field-button field-button-primary" disabled={!canAnalyze}>
            {result ? "Analyze again" : "Analyze route"}
          </button>
          {!gpx && (
            <div className="sky-route-suggestions">
              <RouteSuggestions workspace={w} />
            </div>
          )}
          <p className="field-route-plan-context">
            {dateLabel(w.forecastDate)} · {w.displayStartTime} start · {w.travelWindowHours} hours
            {w.objectiveTimezone ? ` · ${w.objectiveTimezone}` : ""}
            {!w.plannedRouteName && !result ? " · Name a route to check conditions along it." : ""}
          </p>
          {!available.routeAnalysis && (
            <p className="field-feedback">
              Route analysis is unavailable on this server. Saved analysis
              remains readable.
            </p>
          )}
        </form>
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
      {result && staleChanges.length > 0 && (
        <p className="sky-notice is-missing sky-route-stale" role="status">
          <CircleDashed size={18} aria-hidden="true" />
          <span>
            The plan's {staleChanges.join(", ")} changed after this route was analyzed, so these checkpoints are for the earlier plan.
            {canAnalyze ? " Analyze again to update them." : ""}
          </span>
        </p>
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
              {estimatedPlaces > 0 && (
                <p className="sky-notice is-missing">
                  <CircleDashed size={18} aria-hidden="true" />
                  <span>
                    {estimatedPlaces === 1 ? "One checkpoint wasn't" : `${estimatedPlaces} checkpoints weren't`} found on the map, so {estimatedPlaces === 1 ? "its location is" : "their locations are"} an estimate and {estimatedPlaces === 1 ? "its forecast" : "their forecasts"} may be for the wrong spot.
                  </span>
                </p>
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
                  ticks={profileTicks} levels={profileLevels} distanceTicks={distanceTicks} legs={profileLegs}
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
                    {hazardStops > 0 && <li><span className="sky-swatch is-hazard" aria-hidden="true" />Alert or avalanche danger</li>}
                    {estimatedElevations > 0 && <li><span className="sky-swatch is-estimated" aria-hidden="true" />Elevation unknown</li>}
                    {missingStops > 0 && <li><span className="sky-swatch is-missing" aria-hidden="true" />Can't check every limit</li>}
                    {darkStops > 0 && <li><span className="sky-swatch is-night" aria-hidden="true" />After dark</li>}
                  </ul>
                </div>
              )}
              {result.summaries.length > 1 && (
                <div className="sky-route-weather-block">
                  <div className="sky-route-itinerary-head">
                    <h3>Weather along the route</h3>
                    <p>Each checkpoint's forecast at your estimated arrival. Hatched checkpoints cross a limit; the strip shows the sky.</p>
                  </div>
                  <RouteWeatherChart workspace={w} summaries={result.summaries} tones={stops.map((stop) => (stop.tone === "hazard" ? "within" : stop.tone))}
                    selected={selectedIndex} onSelect={setCheckpoint} />
                </div>
              )}
              <div className="sky-route-itinerary-head">
                <h3>Checkpoint itinerary</h3>
                <p>{describeRouteTiming(result.timing)} Times are local to the objective.</p>
              </div>
              {result.summaries.length === 0 ? (
                <p className="field-feedback">No checkpoint forecasts were returned. Try another route, or import a GPX track in the plan.</p>
              ) : (
                <ol className="field-route-itinerary" aria-label="Checkpoint itinerary">
                  {result.summaries.map((point, i) => {
                    const leg = legs[i];
                    const showDate = i === 0 || point.etaDate !== result.summaries[i - 1].etaDate;
                    const turnsBack = point.leg !== "return" && result.summaries[i + 1]?.leg === "return";
                    return (
                      <li key={i} className={`is-${stops[i]?.tone}${point.leg === "return" ? " is-return" : ""}${turnsBack ? " is-turnaround" : ""}`}>
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
                              {hasRouteNumber(point.distance_miles) && point.distance_miles > 0 ? ` · at ${miles(point.distance_miles)}` : ""}
                              {point.locationEstimated ? " · location estimated" : ""}
                            </small>
                          </span>
                          <span className="field-route-stop-time">
                            <strong>{clock(point.etaTime) || "Time unavailable"}</strong>
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
                                {checkpointHazards(point).filter((hazard) => hazard.kind === "avalanche").map((hazard) => (
                                  <span key="avalanche" className="sky-route-pill is-over"><TriangleAlert size={13} aria-hidden="true" />{describeCheckpointHazard(hazard)}</span>
                                ))}
                              </>
                            ) : (
                              <span className="sky-route-pill is-missing">Missing forecast</span>
                            )}
                            {point.daylight === "dark" && <span className="sky-route-pill is-night"><Moon size={13} aria-hidden="true" />After dark</span>}
                          </span>
                        </button>
                        {turnsBack && <p className="field-route-turn" aria-hidden="true">Return by the same route</p>}
                        {leg && (leg.minutes !== null || leg.elevationDeltaFt !== null || leg.distanceMiles !== null) && (
                          <p className="field-route-leg" aria-label={`To ${result.summaries[i + 1]?.name ?? "the next checkpoint"}`}>
                            {leg.distanceMiles !== null && <span><Footprints size={13} aria-hidden="true" />{miles(leg.distanceMiles)}</span>}
                            {leg.elevationDeltaFt !== null && (
                              Math.abs(leg.elevationDeltaFt) < 10
                                ? <span><MoveRight size={13} aria-hidden="true" />Level</span>
                                : leg.elevationDeltaFt > 0
                                  ? <span className="is-up"><TrendingUp size={13} aria-hidden="true" />{w.formatElevationDeltaDisplay(leg.elevationDeltaFt)}</span>
                                  : <span className="is-down"><TrendingDown size={13} aria-hidden="true" />{w.formatElevationDeltaDisplay(leg.elevationDeltaFt)}</span>
                            )}
                            {leg.minutes !== null && <span><Clock size={13} aria-hidden="true" />{formatLegDuration(leg.minutes)}</span>}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
              {selected && (
                <div className={`field-checkpoint forecast-readout is-${selectedTone}`} id="field-route-checkpoint-detail" role="region" aria-label="Selected checkpoint" aria-live="polite">
                  <div className="forecast-readout-main">
                    <span className="field-checkpoint-kicker">
                      <span className={`field-route-stop-number is-${selectedTone}`} aria-hidden="true">{selectedIndex + 1}</span>
                      {clock(selected.etaTime) || "Time unavailable"}{selected.etaDate ? ` · ${formatEtaDate(selected.etaDate)}` : ""}
                    </span>
                    <h3>{selected.name}</h3>
                    <div className="forecast-readout-temp">
                      <strong>{selected.dataAvailable ? displayNumber(selected.weather.temp, w.formatTempDisplay) : "—"}</strong>
                      {selected.dataAvailable && <WeatherSymbol point={{ condition: selected.weather.description || "", isDaytime: selected.daylight !== "dark" }} size={34} />}
                    </div>
                    <span>{selected.dataAvailable ? selected.weather.description || "Conditions not described" : "Forecast did not load"}</span>
                  </div>
                  <dl className="forecast-readout-grid">
                    <div><dt>Feels like</dt><dd className={selectedFlags.feelsLike ? "is-over" : undefined}>{selectedFeelsLike !== null ? w.formatTempDisplay(selectedFeelsLike) : "—"}</dd></div>
                    <div><dt>Gusts</dt><dd className={selectedFlags.gust ? "is-over" : undefined}>{selected.dataAvailable && hasRouteNumber(selected.weather.windGust) ? w.formatWindDisplay(selected.weather.windGust) : "—"}</dd></div>
                    <div><dt>Rain chance</dt><dd className={selectedFlags.precip ? "is-over" : undefined}>{selected.dataAvailable && hasRouteNumber(selected.weather.precipChance) ? `${selected.weather.precipChance}%` : "—"}</dd></div>
                    <div><dt>Elevation</dt><dd>{hasRouteNumber(selected.elev_ft) ? w.formatElevationDisplay(selected.elev_ft) : "—"}</dd></div>
                    <div><dt>Along route</dt><dd>{hasRouteNumber(selected.distance_miles) ? (selected.distance_miles > 0 ? miles(selected.distance_miles) : "Start") : "—"}</dd></div>
                    <div><dt>Vs. objective</dt><dd>{vsObjective || "—"}</dd></div>
                    {selected.dataAvailable && selected.avalanche?.risk && <div><dt>Avalanche</dt><dd>{selected.avalanche.risk}</dd></div>}
                    <div><dt>Alerts</dt><dd className={selected.activeAlerts > 0 ? "is-over" : undefined}>{selected.dataAvailable ? (selected.activeAlerts > 0 ? `${selected.activeAlerts} active` : "None") : "—"}</dd></div>
                    {selected.dataAvailable && hasRouteNumber(selected.snowDepthIn) && selected.snowDepthIn > 0 && (
                      <div><dt>Snow depth</dt><dd>{formatSnowDepthForElevationUnit(selected.snowDepthIn, w.preferences.elevationUnit)}</dd></div>
                    )}
                  </dl>
                  <p className={`forecast-readout-status is-${selectedTone}`}>
                    {selectedTone === "over" || selectedTone === "hazard" ? <TriangleAlert size={16} aria-hidden="true" />
                      : selectedTone === "missing" ? <CircleDashed size={16} aria-hidden="true" />
                        : <CircleCheck size={16} aria-hidden="true" />}
                    <span>
                      {selectedTone === "over"
                        ? `Over your limits: ${[
                          selectedFlags.feelsLike && selectedFeelsLike !== null ? `feels like ${w.formatTempDisplay(selectedFeelsLike)}` : null,
                          selectedFlags.gust ? `gusts ${w.formatWindDisplay(selected.weather.windGust)} (limit ${w.formatWindDisplay(w.preferences.maxWindGustMph)})` : null,
                          selectedFlags.precip ? `rain chance ${selected.weather.precipChance}% (limit ${w.preferences.maxPrecipChance}%)` : null,
                        ].filter(Boolean).join(", ")}.`
                        : selectedTone === "hazard"
                          ? `Within your limits, but with ${selectedHazards.map(describeCheckpointHazard).join(" and ")} here.`
                        : selectedTone === "missing"
                          ? "Some readings are missing here, so not every limit can be checked."
                          : "Within your limits at this arrival."}
                      {selected.daylight === "dark" ? " You arrive after dark." : ""}
                      {selected.locationEstimated ? " This place wasn't found on the map, so the forecast is for an estimated location." : ""}
                    </span>
                  </p>
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
                  {/* Gear is covered by the Gear & actions chapter; older analyses still carry a gear check. */}
                  {briefing.filter((part) => part !== bottomLine && part.key !== "gear-check").map((part) => {
                    const Icon = BRIEF_ICONS[part.key] ?? Info;
                    return (
                      <div key={part.key} className={`sky-route-brief-part is-${part.key}`}>
                        <h3><Icon size={16} aria-hidden="true" />{part.label}</h3>
                        <p>{part.text}</p>
                      </div>
                    );
                  })}
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
