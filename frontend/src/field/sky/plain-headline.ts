import { isOverHour, skyRuns, spanLabel, type SkyHour } from "./sky-model";

const CAUSES: Array<[RegExp, string]> = [
  [/^gust/i, "strong wind"],
  [/^precip/i, "rain"],
  [/^feels .+</i, "cold"],
  [/^feels .+>/i, "heat"],
  [/^condition:/i, "poor weather"],
  [/^snow depth/i, "deep snow"],
];

/**
 * The decision in plain words, from the hours that cross your limits:
 * "Strong wind and rain during 6:30 PM–8:30 PM". Null when nothing names a cause,
 * so the caller keeps the decision's own headline.
 */
export function plainHeadline(hours: SkyHour[], clock: (minute: number) => string): string | null {
  const runs = skyRuns(hours).filter((run) => run.tone === "over");
  if (!runs.length) return null;
  const causes: string[] = [];
  for (const hour of hours.filter(isOverHour)) {
    for (const rule of hour.failedRules) {
      const cause = CAUSES.find(([pattern]) => pattern.test(rule.trim()))?.[1];
      if (cause && !causes.includes(cause)) causes.push(cause);
    }
  }
  if (!causes.length) return null;
  const what = causes.length === 1 ? causes[0] : `${causes.slice(0, -1).join(", ")} and ${causes[causes.length - 1]}`;
  const first = hours[runs[0].start].minute;
  // Minutes past 1440 are after midnight, on the next calendar day.
  const after = first >= 1440 ? "after midnight, " : "";
  const when = runs.length === 1 ? `${after || "during "}${spanLabel(hours, runs[0], clock)}` : `${after || "from "}${clock(first)}`;
  return `${what[0].toUpperCase()}${what.slice(1)} ${when}`;
}
