import { type PersistedReport } from "../app/report-storage";
import type { UserPreferences } from "../app/types";
import type { ParsedGpxRoute } from "../lib/gpx";

export type Page =
  | "home"
  | "planner"
  | "trip"
  | "history"
  | "watches"
  | "settings"
  | "account"
  | "privacy"
  | "terms"
  | "report"
  | "not-found";
export type Plan = {
  name: string;
  lat: number | null;
  lon: number | null;
  date: string;
  start: string;
  hours: number;
  activity: UserPreferences["defaultActivity"];
  route: ParsedGpxRoute | null;
};
export const peaks = [
  {
    name: "Mount Rainier",
    region: "Washington · Cascades",
    lat: 46.8523,
    lon: -121.7603,
  },
  {
    name: "Grand Teton",
    region: "Wyoming · Teton Range",
    lat: 43.7417,
    lon: -110.8024,
  },
  {
    name: "Mount Whitney",
    region: "California · Sierra Nevada",
    lat: 36.5786,
    lon: -118.2923,
  },
];
export const emptyAi = {
  aiBriefNarrative: null,
  snowVisionAnalysis: null,
  snowVisionImage: null,
  reportChatMessages: [],
};
export function planFromReport(report: PersistedReport): Plan {
  return {
    name: report.plan.objectiveName,
    lat: report.plan.lat,
    lon: report.plan.lon,
    date: report.plan.forecastDate,
    start: report.plan.alpineStartTime,
    hours: report.plan.travelWindowHours,
    activity: report.preferences?.defaultActivity || "hiking",
    route: report.route.gpxRoute,
  };
}
export function dateLabel(date: string | null | undefined) {
  if (!date) return "Date unavailable";
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        weekday: "short",
      });
}
export function ageLabel(date: string | null | undefined) {
  if (!date || !Number.isFinite(Date.parse(date)))
    return "Timestamp unavailable";
  const hours = Math.max(0, (Date.now() - Date.parse(date)) / 3600000);
  return hours < 1
    ? "Within the last hour"
    : hours < 24
      ? `${Math.floor(hours)} hours ago`
      : `${Math.floor(hours / 24)} days ago`;
}
