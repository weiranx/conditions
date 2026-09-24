import { SurfacePrediction } from "./SurfacePrediction";
import { lazy, Suspense, useMemo, useState } from "react";
import { Info, Mountain, Minus, Plus, RefreshCw, Satellite, Sparkles } from "lucide-react";
import type { Workspace } from "./model/useWorkspace";
import { buildTerrainWindow, buildTerrainWindowByAspect } from "../app/terrain-window";
import { resolveReportFeatureFlags } from "../contexts/feature-flags";
import { useAiAvailability } from "../hooks/useAiAvailability";
import { planFromReport } from "./data";
import { WindCompass } from "./WindCompass";
import { Details, SourceLink } from "./Details";
import { AiExplanationSkeleton, SnowAnalysis } from "./AiExplanation";
import { MountainSection } from "./sky/MountainSection";
import { AvalancheMountain, type AvalancheBandKey } from "./sky/AvalancheMountain";
import { AspectRose, type RoseAspect } from "./sky/AspectRose";
import { SnowColumns } from "./sky/SnowColumns";
import { parseTerrainFromLocation } from "../utils/avalanche";
import { parseHourLabelToMinutes, parseTimeInputMinutes } from "../app/core";

const parseClock = (time: string) => parseTimeInputMinutes(time) ?? parseHourLabelToMinutes(time) ?? NaN;
import { StatusTag } from "./sky/BriefSections";
import { knownFeet, surfaceLabel, terrainStatus } from "./sky/status";
import { shortHour, type SkyHour } from "./sky/sky-model";
import { estimateAtElevation, rebaseElevationBands } from "../app/elevation-forecast";
const FieldMap = lazy(() => import("./FieldMap"));

function TerrainWindow({ workspace: w }: { workspace: Workspace }) {
  const flags = resolveReportFeatureFlags(w.safetyData?.featureFlags);
  const [selection, setSelection] = useState<{ lane: number; hour: number; aspect: RoseAspect | null }>({ lane: 0, hour: 0, aspect: null });
  // Without snow to move, lee aspects are no more hazardous than any other.
  const showWindLoading = flags.windLoadingDetails && w.windLoadingApplies;
  const { model, byAspect } = useMemo(
    () => {
      const input = {
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
        leewardAspects: showWindLoading ? w.leewardAspectHints : [],
        secondaryAspects: showWindLoading ? w.secondaryWindAspects : [],
        preferences: w.preferences,
      };
      // The rose draws each aspect on its own; the table keeps the grouped lanes.
      return { model: buildTerrainWindow(input), byAspect: buildTerrainWindowByAspect(input) };
    },
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
      showWindLoading,
    ],
  );
  // Rings of the rose, highest elevation innermost.
  const rings = Array.from(new Map(model.lanes.map((l) => [l.elevationFt, l.elevationLabel])).entries())
    .sort((a, b) => b[0] - a[0]);
  const aspectLane = (aspect: RoseAspect, ring: number) =>
    byAspect.get(aspect)?.lanes.find((l) => l.elevationFt === rings[ring]?.[0] && l.aspects.includes(aspect));
  const laneAt = (aspect: RoseAspect, ring: number) =>
    model.lanes.findIndex((l) => l.elevationFt === rings[ring]?.[0] && l.aspects.includes(aspect));
  // A slope picked on the rose reads its own aspect's cell; a table cell reads the grouped lane.
  const lane = model.lanes[selection.lane] || model.lanes[0];
  const roseRing = lane ? rings.findIndex(([ft]) => ft === lane.elevationFt) : -1;
  const cell = selection.aspect && roseRing >= 0
    ? aspectLane(selection.aspect, roseRing)?.cells[selection.hour]
    : lane?.cells[selection.hour];
  const levelWord = (level: string) =>
    level === "lower" ? "Lower" : level === "avoid" ? "Avoid" : level === "unknown" ? "Unknown" : "Caution";
  const hourText = (i: number) => w.formatClockForStyle(model.hours[i]?.time, w.preferences.timeStyle);
  const roseSelected = selection.aspect && roseRing >= 0 ? { aspect: selection.aspect, ring: roseRing } : null;
  return (
    <section className="sky-section" aria-labelledby="sky-terrain-day">
      <div className="sky-sh">
        <h2 id="sky-terrain-day">Terrain through the day</h2>
        <p>Slopes from above: aspects around, elevation as rings with the highest innermost. Select a slope for the reasons.</p>
      </div>
      <div className="sky-card sky-terrain-window">
      <details className="sky-details">
        <summary>How to read this view</summary>
        <p>{model.explanation}</p>
      </details>
      {model.lanes.length ? (
        <>
          <div className="sky-segmented sky-mountain-hours" role="group" aria-label="Terrain time">
            {model.hours.map((hour, i) => (
              <button key={i} type="button" aria-pressed={i === selection.hour}
                aria-label={hourText(i)} onClick={() => setSelection({ ...selection, hour: i })}>
                {shortHour(parseClock(hour.time), w.preferences.timeStyle)}
              </button>
            ))}
          </div>
          <div className="sky-terrain-rose">
            <AspectRose
              size={236}
              rings={rings.map(([, label]) => label)}
              label={`Terrain at ${hourText(selection.hour)} by aspect and elevation`}
              cellClass={(aspect, ring) => {
                const l = aspectLane(aspect, ring);
                return `is-${l?.cells[selection.hour]?.level ?? "unknown"}`;
              }}
              cellLabel={(aspect, ring) => {
                const l = aspectLane(aspect, ring);
                return `${aspect}, ${rings[ring]?.[1]}, ${hourText(selection.hour)}: ${levelWord(l?.cells[selection.hour]?.level ?? "unknown")}`;
              }}
              selected={roseSelected}
              onSelect={(aspect, ring) => {
                const index = laneAt(aspect, ring);
                if (index >= 0) setSelection({ ...selection, lane: index, aspect });
              }}
            />
            <div className="sky-terrain-rose-side">
              <ul className="sky-legend" aria-label="Legend">
                <li><i className="is-lower" />Lower</li>
                <li><i className="is-caution" />Caution</li>
                <li><i className="is-avoid" />Avoid</li>
                <li><i className="is-unknown" />Unknown</li>
              </ul>
              <ol className="sky-rose-rings" aria-label="Rings, inside to outside">
                {rings.map(([ft, label]) => <li key={ft}>{label} <small>{w.formatElevationDisplay(ft)}</small></li>)}
              </ol>
              {cell && (
                <div className={`sky-terrain-reason is-${cell.level}`} aria-live="polite">
                  <strong>
                    {lane.elevationLabel} · {selection.aspect ?? lane.aspectLabel} · {hourText(selection.hour)} · {levelWord(cell.level)}
                  </strong>
                  <p>
                    {cell.reasons.join(" ") ||
                      "Nothing here crosses a terrain-specific limit in the available data. This is not a slope-stability assessment."}
                  </p>
                </div>
              )}
            </div>
          </div>
          <details className="sky-details">
          <summary>Every hour as a table</summary>
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
                          onClick={() => setSelection({ lane: i, hour: j, aspect: null })}
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
          </details>
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
  // Hour of the travel window the elevation forecast shows; 0 is the planned start.
  const [forecastHour, setForecastHour] = useState(0);
  const hourIndex = forecastHour < hours.length ? forecastHour : 0;
  const selectedHour = hourIndex > 0 ? hours[hourIndex] : null;
  // Bands start from the objective; approach hours carry their summit reading separately.
  const selectedBase = useMemo(
    () => selectedHour
      ? selectedHour.objectiveReading ?? { temp: selectedHour.temp, wind: selectedHour.wind, gust: selectedHour.gust }
      : null,
    [selectedHour],
  );
  const bands = useMemo(
    () => selectedBase
      ? rebaseElevationBands(w.elevationForecastBands, selectedBase)
      : w.elevationForecastBands,
    [selectedBase, w.elevationForecastBands],
  );
  const target = selectedBase && w.targetElevationForecast
    ? estimateAtElevation(selectedBase, w.targetElevationForecast.deltaFt)
    : w.targetElevationForecast;
  const hourLabel = (hour: SkyHour) => w.formatClockForStyle(hour.time, w.preferences.timeStyle);
  const approach = w.approachProfile;
  const approachHours = hours.filter((h) => h.approachAdjusted).length;
  const inversionHours = hours.filter((h) => h.inversionRisk).length;
  const surface = surfaceLabel(data);
  const status = terrainStatus(data);
  const objectiveFt = knownFeet(data.weather.elevation);
  const freezing = knownFeet(data.atmosphere?.freezingLevelFt) ?? NaN;
  const snowLevel = knownFeet(data.atmosphere?.snowLevelFt) ?? NaN;
  const levels = [
    ...(Number.isFinite(freezing) && freezing > 0 ? [{ label: "Freezing level", ft: freezing, tone: "cold" as const }] : []),
    ...(Number.isFinite(snowLevel) && snowLevel > 0 ? [{ label: "Snow level", ft: snowLevel, tone: "snow" as const }] : []),
  ];
  const objectiveBand = bands.find((b) => objectiveFt !== null && Math.abs(b.elevationFt - objectiveFt) < 150);
  const avalancheLevel = w.overallAvalancheLevel as number | null;
  const problemTerrain = (data.avalanche?.problems ?? []).map((problem) => {
    const { aspects, elevations } = parseTerrainFromLocation(problem.location);
    // Rose rings, inside out: above, near and below treeline. An empty set means the bulletin didn't say.
    const ringBands = ["upper", "middle", "lower"] as const;
    const bands: AvalancheBandKey[] = elevations.size
      ? (["above", "at", "below"] as const).filter((_, r) => elevations.has(ringBands[r]))
      : [];
    const aspectText = aspects.size === 8 ? "All aspects" : aspects.size ? [...aspects].join(", ") : "Aspects not stated";
    const bandText = elevations.size === 3 ? "all elevations"
      : elevations.size ? bands.map((b) => ({ above: "above", at: "near", below: "below" })[b]).join(", ") + " treeline"
      : "elevations not stated";
    return {
      name: problem.name || "Avalanche problem",
      bands,
      describe: `${aspectText} · ${bandText}`,
      // "maybe" where the bulletin leaves aspect or elevation unstated, so an unknown is never drawn as affected.
      covers: (aspect: RoseAspect, ring: number) => {
        const aspectHit = aspects.size === 0 ? "maybe" : aspects.has(aspect) ? "yes" : "no";
        const bandHit = elevations.size === 0 ? "maybe" : elevations.has(ringBands[ring]) ? "yes" : "no";
        return aspectHit === "no" || bandHit === "no" ? "no" : aspectHit === "yes" && bandHit === "yes" ? "yes" : "maybe";
      },
    };
  });
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
            <h2 id="sky-terrain-mountain">
              {selectedHour ? <>The mountain at {hourLabel(selectedHour)}</> : "The mountain at your start"}
            </h2>
            <p>Forecast by elevation. Heights are to scale; the ridge is illustrative.</p>
          </div>
          <div className="sky-card sky-mountain-card">
            {hours.length > 1 && w.elevationForecastBands.length > 0 && (
              <div className="sky-segmented sky-mountain-hours" role="group" aria-label="Elevation forecast time">
                {hours.map((hour, i) => {
                  const usable = i === 0 || (hour.thermalComplete && Number.isFinite(hour.temp) && Number.isFinite(hour.wind));
                  return (
                    <button key={hour.index} type="button" aria-pressed={i === hourIndex} disabled={!usable}
                      aria-label={`${i === 0 ? "Start, " : ""}${hourLabel(hour)}${usable ? "" : ", forecast unavailable"}`}
                      onClick={() => setForecastHour(i)}>
                      {i === 0 ? "Start" : shortHour(hour.minute, w.preferences.timeStyle)}
                    </button>
                  );
                })}
              </div>
            )}
            {bands.length > 0 ? (
              <MountainSection
                bands={bands}
                objectiveFt={objectiveFt}
                objectiveLabel={objectiveBand ? `Objective · ${w.formatTempDisplay(objectiveBand.temp)}` : "Objective"}
                target={w.hasTargetElevation && target && Number.isFinite(w.targetElevationFt) && Math.abs(w.targetElevationFt - (objectiveFt ?? -1e9)) > 100
                  ? { ft: w.targetElevationFt, label: `${w.formatElevationDisplay(w.targetElevationFt)} · ${w.formatTempDisplay(target.temp)}` }
                  : null}
                levels={levels}
                sky={hours[hourIndex] ? { zenith: hours[hourIndex].zenith, horizon: hours[hourIndex].horizon } : null}
                weather={hours[hourIndex] ?? null}
                format={{ elevation: (ft) => w.formatElevationDisplay(ft), temp: (f) => w.formatTempDisplay(f), wind: (mph) => w.formatWindDisplay(mph) }}
                when={selectedHour ? `at ${hourLabel(selectedHour)}` : undefined}
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

      <section className="sky-section" aria-labelledby="sky-terrain-approach">
        <div className="sky-sh">
          <h2 id="sky-terrain-approach">Your approach</h2>
          <p>Early hours are checked where you are, not at the objective.</p>
        </div>
        <div className="sky-card">
          <div className="sky-elevation-check">
            <label>
              <span>Trailhead elevation ({w.elevationUnitLabel})</span>
              <input className="sky-approach-input" inputMode="numeric" placeholder="Estimated"
                value={w.trailheadElevationInput} onChange={w.handleTrailheadElevationChange}
                disabled={!w.preferences.approachElevationAdjustment || approach?.source === "gpx" || approach?.source === "route"} />
            </label>
            {approach && (
              <dl className="sky-inline-facts">
                <div><dt>Start</dt><dd>{w.formatElevationDisplay(approach.trailheadElevationFt)}</dd></div>
                <div><dt>Objective</dt><dd>{w.formatElevationDisplay(approach.objectiveElevationFt)}</dd></div>
                {approachHours > 0 && <div><dt>Hours adjusted</dt><dd>{approachHours}</dd></div>}
              </dl>
            )}
          </div>
          <p className="sky-cap">
            {!w.preferences.approachElevationAdjustment
              ? "Approach adjustment is off in Settings, so every hour is checked at the objective."
              : !approach
                ? "No approach below the objective is known, so every hour is checked at the objective. Enter your trailhead elevation to adjust the early hours."
                : `${approach.source === "gpx"
                  ? "Elevation over time follows your imported GPX track and route timing."
                  : approach.source === "route"
                    ? "Elevation over time follows the checkpoints of your analyzed route, starting from its trailhead."
                    : approach.source === "manual"
                    ? "You climb from your trailhead at your ascent rate, then stay at the objective."
                    : "Trailhead estimated from the lowest forecast band. Enter yours for a better estimate."} Temperature and wind use standard per-1,000 ft rates; rain and storm signals are never adjusted.${inversionHours > 0
                  ? ` Clear, calm conditions make a valley inversion likely for ${inversionHours} approach hour${inversionHours === 1 ? "" : "s"}: those hours are treated as colder, not warmer, than the objective.`
                  : ""}`}
          </p>
        </div>
      </section>

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
        {flags.windLoadingDetails && w.windLoadingApplies && (
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
            {w.avalancheRelevant ? (
              <>
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
                  {data.avalanche?.bottomLine || data.avalanche?.relevanceReason}
                </p>
                {w.avalancheElevationRows.length > 0 && (
                  <AvalancheMountain
                    rows={w.avalancheElevationRows}
                    problems={problemTerrain.map((p) => ({ name: p.name, bands: p.bands }))}
                    dangerText={w.getDangerText}
                  />
                )}
                {data.avalanche?.problems?.map((problem, i) => (
                  <article className="sky-problem has-rose" key={i}>
                    <AspectRose
                      compact
                      size={76}
                      rings={["Above treeline", "Near treeline", "Below treeline"]}
                      label={problemTerrain[i].describe}
                      cellClass={(aspect, ring) => ({ yes: "is-affected", maybe: "is-unstated", no: "" })[problemTerrain[i].covers(aspect, ring)]}
                      cellLabel={(aspect, ring) => `${aspect} ${ring}`}
                    />
                    <div>
                    <h3><span className="sky-problem-num" aria-hidden="true">{i + 1}</span>{problem.name}</h3>
                    <p className="sky-problem-where">{problemTerrain[i].describe}</p>
                    <p>{problem.discussion || problem.problem_description}</p>
                    <Details
                      title="Affected aspects, elevations, size, and likelihood"
                      value={{ likelihood: problem.likelihood, size: problem.size, location: problem.location }}
                    />
                    </div>
                  </article>
                ))}
                {data.avalanche?.advice && <p className="sky-cap is-body">{data.avalanche.advice}</p>}
              </>
            ) : (
              <p className="sky-cap is-body">{w.avalancheNotApplicableReason || "No avalanche forecast applies to this plan."}</p>
            )}
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
            <SnowColumns
              metric={w.preferences.elevationUnit === "m"}
              columns={[
                {
                  label: "SNOTEL station",
                  sub: [data.snowpack?.snotel?.stationName, knownFeet(data.snowpack?.snotel?.elevationFt) !== null ? w.formatElevationDisplay(data.snowpack!.snotel!.elevationFt!) : null, w.snotelDistanceDisplay]
                    .filter((part) => part && part !== "N/A" && part !== "Unavailable").join(" · ") || "No station",
                  depthIn: knownFeet(data.snowpack?.snotel?.snowDepthIn),
                  sweIn: knownFeet(data.snowpack?.snotel?.sweIn),
                },
                {
                  label: "NOHRSC model",
                  sub: "Modeled at your objective",
                  depthIn: knownFeet(data.snowpack?.nohrsc?.snowDepthIn),
                  sweIn: knownFeet(data.snowpack?.nohrsc?.sweIn),
                },
                ...(data.snowpack?.cdec ? [{
                  label: "CDEC station",
                  sub: [data.snowpack.cdec.stationName, knownFeet(data.snowpack.cdec.elevationFt) !== null ? w.formatElevationDisplay(data.snowpack.cdec.elevationFt!) : null, w.cdecDistanceDisplay]
                    .filter((part) => part && part !== "N/A" && part !== "Unavailable").join(" · ") || "No station",
                  depthIn: knownFeet(data.snowpack.cdec.snowDepthIn),
                  sweIn: knownFeet(data.snowpack.cdec.sweIn),
                }] : []),
              ]}
            />
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
        <section
          className="sky-card sky-section ai-panel"
          aria-labelledby="sky-terrain-satellite"
          aria-busy={w.snowVisionLoading}
        >
          <div className="ai-panel-head">
            <span className="sky-card-head">
              <span id="sky-terrain-satellite">Satellite snow imagery</span>
              <span className="ai-panel-badge"><Sparkles size={11} aria-hidden="true" />AI</span>
            </span>
            {w.snowVisionAnalysis && !w.viewingHistoryReport ? (
              <button
                className="field-button ai-brief-regenerate"
                disabled={!available.snowVision}
                aria-disabled={w.snowVisionLoading || undefined}
                onClick={w.handleRequestSnowVisionAction}
              >
                <RefreshCw
                  size={14}
                  aria-hidden="true"
                  className={w.snowVisionLoading ? "is-spinning" : undefined}
                />
                {w.snowVisionLoading ? "Re-analyzing…" : "Re-analyze"}
              </button>
            ) : (
              <Satellite size={18} aria-hidden="true" className="sky-muted" />
            )}
          </div>
          {w.snowVisionError && <p className="sky-notice is-caution" role="alert">{w.snowVisionError}</p>}
          {w.snowVisionAnalysis ? (
            <>
              <SnowAnalysis
                text={w.snowVisionAnalysis}
                image={w.snowVisionImage}
                stale={w.snowVisionLoading}
              />
              <p className="ai-brief-footnote">
                <Info size={13} aria-hidden="true" />
                Written by AI from satellite imagery and nearby snow stations. It
                can’t see cornices, ice or surface firmness; verify in the field.
              </p>
            </>
          ) : !w.viewingHistoryReport && available.snowVision ? (
            <>
              <div className="ai-brief-empty">
                <p>
                  An AI read of recent Sentinel-2 imagery around your objective,
                  checked against nearby snow stations. Imagery can lag current
                  conditions by days.
                </p>
                <button
                  className="field-button field-button-primary"
                  aria-disabled={w.snowVisionLoading || undefined}
                  onClick={w.handleRequestSnowVisionAction}
                >
                  <Sparkles size={16} aria-hidden="true" />
                  {w.snowVisionLoading ? "Analyzing imagery…" : "Analyze snow imagery"}
                </button>
              </div>
              {w.snowVisionLoading && <AiExplanationSkeleton />}
            </>
          ) : (
            <p className="sky-cap is-body">
              {w.viewingHistoryReport
                ? "No snow analysis was saved with this report."
                : "Satellite analysis is unavailable on this server."}
            </p>
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
