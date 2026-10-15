import { Check, Clock3, Mountain, Route, ShieldCheck, Sunrise } from "lucide-react";

/**
 * The report's chapters, in their default order. The activity reorders the first four.
 * `short` names the chapter in the section bar; `hint` says what the chapter holds.
 */
export const REPORT_CHAPTERS = [
  { id: "forecast", label: "Weather", short: "Weather", icon: Sunrise, hint: "Hour by hour, rain and snow, heat, fire and air." },
  { id: "timing", label: "Timing", short: "Timing", icon: Clock3, hint: "Start times, daylight and your planning limits." },
  { id: "terrain", label: "Terrain & snow", short: "Terrain", icon: Mountain, hint: "The mountain by elevation, the surface, avalanche and snow." },
  { id: "route", label: "Route", short: "Route", icon: Route, hint: "Conditions at each checkpoint along the way." },
  { id: "sources", label: "Checks & sources", short: "Sources", icon: ShieldCheck, hint: "Every check, official alerts and how fresh each source is." },
  { id: "gear", label: "Gear & actions", short: "Gear", icon: Check, hint: "What to bring and what to do before you leave." },
] as const;

export type ReportChapter = (typeof REPORT_CHAPTERS)[number]["id"];

export const chapterLabel = (id: ReportChapter) => REPORT_CHAPTERS.find((c) => c.id === id)!.label;
