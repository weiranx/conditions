import { Sparkles } from "lucide-react";
import type { Workspace } from "./model/useWorkspace";
import { minutesToTwentyFourHourClock } from "../app/core";
import { isOverHour, type SkyHour } from "./sky/sky-model";
import { durationLabel, knownFeet } from "./sky/status";

/*
 * Each report chapter opens with one lead: the checks' sentence, or under
 * AI-first the AI's analysis of the chapter. The leads sit in the chapter
 * heading, outside the chapter body, so they show while a chapter is still
 * loading or folded shut on a phone. They are small on purpose: the chapters
 * themselves load lazily, and these render with the report.
 */

/** The AI's analysis as a chapter's lead, marked as the AI's, with the full read one tap away. */
export function AiLead({ text, onReadAll }: { text: string; onReadAll?: () => void }) {
  return (
    <p className="sky-lead is-ai">
      <span className="sky-ai-mark"><Sparkles size={12} aria-hidden="true" />AI</span>{" "}
      {text}
      {onReadAll && <>{" "}<button type="button" className="sky-lead-link" onClick={onReadAll}>Full AI read</button></>}
    </p>
  );
}

/** Timing: when you are back, against sunset, and a clearly better start when there is one. */
export function TimingLead({ workspace: w, hours }: { workspace: Workspace; hours: SkyHour[] }) {
  const comparison = w.startTimeScenarios.comparison;
  const sunrise = w.sunriseMinutesForPlan;
  const sunset = w.sunsetMinutesForPlan;
  const clock = (minute: number) =>
    w.formatClockForStyle(minutesToTwentyFourHourClock(((minute % 1440) + 1440) % 1440), w.preferences.timeStyle);
  const clockText = (value: string) => w.formatClockForStyle(value, w.preferences.timeStyle);
  const planDaylight = sunset !== null && Number.isFinite(w.returnMinutes) ? sunset - (w.returnMinutes as number) : null;
  const overPlan = hours.filter(isOverHour).length;
  const daylightLength = sunrise !== null && sunset !== null && sunset > sunrise ? sunset - sunrise : null;
  const best = comparison?.scenarios.find((s) => s.startTime === comparison.bestStartTime);
  // Another start is suggested only when it is clearly better than the plan.
  const suggestion = comparison?.suggestion ?? null;
  return (
    <p className="sky-lead">
      Your <strong>{w.displayStartTime} start</strong> has you back at{" "}
      <strong>{w.formatClockForStyle(w.returnTimeDisplay, w.preferences.timeStyle)}{w.returnExtendsPastMidnight ? " (+1 day)" : ""}</strong>
      {planDaylight !== null && (planDaylight < 0
        ? <>, <strong className="is-over">{durationLabel(-planDaylight)} after sunset</strong></>
        : <>, {durationLabel(planDaylight)} before sunset</>)}
      {overPlan > 0 && <>, with <strong className="is-over">{overPlan} h over your limits</strong></>}.{" "}
      {suggestion && best && (
        <>Starting at <strong>{clockText(best.startTime)}</strong> {suggestion}. </>
      )}
      <span className="sky-lead-note">
        {sunrise !== null && sunset !== null
          ? `Sunrise ${clock(sunrise)} · Sunset ${clock(sunset)}${daylightLength ? ` · ${durationLabel(daylightLength)} of daylight` : ""}.`
          : "Sunrise and sunset are unavailable for this plan."}
      </span>
    </p>
  );
}

/** Terrain & snow: the surface at the objective and the freezing and snow levels around it. */
export function TerrainLead({ workspace: w }: { workspace: Workspace }) {
  const data = w.safetyData!;
  const { terrainCondition } = w.evaluation!.interpretation;
  const surface = terrainCondition.surfaceLabel;
  const status = terrainCondition.status;
  const objectiveFt = knownFeet(data.weather.elevation);
  const freezing = knownFeet(data.atmosphere?.freezingLevelFt) ?? NaN;
  const snowLevel = knownFeet(data.atmosphere?.snowLevelFt) ?? NaN;
  const levels = [
    ...(Number.isFinite(freezing) && freezing > 0 ? [{ label: "Freezing level", ft: freezing, tone: "cold" as const }] : []),
    ...(Number.isFinite(snowLevel) && snowLevel > 0 ? [{ label: "Snow level", ft: snowLevel, tone: "snow" as const }] : []),
  ];
  const belowObjective = (l: (typeof levels)[number]) => l.tone === "cold" && objectiveFt !== null && l.ft <= objectiveFt;
  return (
    <p className="sky-lead">
      {objectiveFt !== null ? <>Your objective at <strong>{w.formatElevationDisplay(objectiveFt)}</strong> is </> : <>The surface is </>}
      <strong className={status === "over" ? "is-over" : status === "missing" ? "is-missing" : undefined}>
        {surface ? surface.toLowerCase() : "not assessed"}
      </strong>.
      {levels.length > 0 && (
        <> {levels.map((l, i) => (
          <span key={l.label}>{i > 0 ? "; " : ""}{i > 0 ? l.label.toLowerCase() : l.label} near{" "}
            <strong className={belowObjective(l) ? "is-cold" : undefined}>{w.formatElevationDisplay(l.ft)}</strong>
          </span>
        ))}{levels.some(belowObjective) ? ", below your objective" : ""}.</>
      )}{" "}
      <span className="sky-lead-note">{terrainCondition.summary}</span>
    </p>
  );
}

/** Checks & sources: the counts only, since every check is listed right below. */
export function SourcesLead({ workspace: w }: { workspace: Workspace }) {
  const checks = w.decision?.checks || [];
  const review = checks.filter((check) => !check.ok).length;
  const freshness = w.interpretation!.sourceFreshness;
  const current = freshness.rows.filter((row) => row.state === "fresh" || row.state === "aging").length;
  const missing = freshness.rows.filter((row) => row.state === "missing").map((row) => row.label);
  return (
    <p className="sky-lead">
      <strong>{checks.length - review} of {checks.length} checks</strong> pass
      {review > 0 && <> · <strong className="is-over">{review} need review</strong></>}
      {" "}· <strong>{current} of {freshness.rows.length} sources</strong> current
      {missing.length > 0 && <> · <strong className="is-missing">{missing.join(", ")}</strong> missing</>}.
    </p>
  );
}
