import { Check, Clock3, Mountain, Route, ShieldCheck, Sunrise } from "lucide-react";

/** The report's chapters, in their default order. The activity reorders the first four. */
export const REPORT_CHAPTERS = [
  { id: "forecast", label: "Weather", icon: Sunrise },
  { id: "timing", label: "Timing", icon: Clock3 },
  { id: "terrain", label: "Terrain & snow", icon: Mountain },
  { id: "route", label: "Route", icon: Route },
  { id: "sources", label: "Checks & sources", icon: ShieldCheck },
  { id: "gear", label: "Gear & actions", icon: Check },
] as const;

export type ReportChapter = (typeof REPORT_CHAPTERS)[number]["id"];

export const chapterLabel = (id: ReportChapter) => REPORT_CHAPTERS.find((c) => c.id === id)!.label;
