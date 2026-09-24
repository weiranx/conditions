import type { TimeStyle, UserPreferences } from "../app/types";
import { formatClockForStyle } from "../app/core";
import { compareTripDays, sameTripRank, type MultiDayTripForecastDay } from "../app/trip-forecast";
import { resolveReportFeatureFlags } from "../contexts/feature-flags";
import { checkSummary } from "./verdict-copy";

/** The lead sentence of each check that set the day's decision. */
export const dayConcerns = (day: MultiDayTripForecastDay) => [...new Set(day.limitingChecks.map(checkSummary).filter(Boolean))];

/** The longest run of hours within limits, when some but not all hours are. */
export function longestStretch(day: MultiDayTripForecastDay, timeStyle: TimeStyle): string | null {
  const span = day.travelBestWindow;
  if (!span || day.travelPassHours === 0 || day.travelPassHours >= day.travelTotalHours) return null;
  return `Longest stretch ${span.length} h from ${formatClockForStyle(span.start, timeStyle)}`;
}

const WEATHER_WINDOW_LABEL = { GO: "WEATHER CLEAR", CAUTION: "WEATHER CAUTION", "NO-GO": "WEATHER BLOCKED" } as const;

/**
 * What the chat about Compare days reads: each day's decision, the checks
 * behind it, and the hourly readings for the travel window. Full reports stay
 * out; a week of them is several times the size the chat accepts
 * (MAX_REPORT_LENGTH in backend/src/routes/report-chat.js).
 */
export function buildTripChatContext(days: MultiDayTripForecastDay[], plan: {
  objectiveName: string;
  position: { lat: number; lng: number };
  timezone?: string | null;
  startTime: string;
  travelWindowHours: number;
  preferences: UserPreferences;
  note?: string | null;
}) {
  const flags = resolveReportFeatureFlags(days[0]?.safetyData.featureFlags);
  const { preferences } = plan;
  const ranked = [...days].sort(compareTripDays);
  const best = ranked[0];
  return {
    contextType: "multi-day-trip-plan",
    featureFlags: flags,
    objective: {
      name: plan.objectiveName || "Selected objective",
      latitude: plan.position.lat,
      longitude: plan.position.lng,
      timezone: plan.timezone || null,
    },
    plan: {
      dailyStartTime: plan.startTime,
      travelWindowHours: plan.travelWindowHours,
      days: days.length,
      scope: "Weather and travel-window checks only. Avalanche conditions are excluded; each day's full report covers every hazard.",
      forecastNote: plan.note || null,
    },
    limits: {
      maxWindGustMph: preferences.maxWindGustMph,
      maxPrecipChancePct: preferences.maxPrecipChance,
      minFeelsLikeF: preferences.minFeelsLikeF,
      maxFeelsLikeF: preferences.maxFeelsLikeF,
    },
    displayUnits: {
      temperature: preferences.temperatureUnit,
      wind: preferences.windSpeedUnit,
      elevation: preferences.elevationUnit,
      time: preferences.timeStyle,
    },
    ranking: {
      method: "Weather decision, then report score, then hours with every reading present and within the limits.",
      bestDate: best?.date ?? null,
      datesTiedWithBest: best ? ranked.filter((day) => day !== best && sameTripRank(day, best)).map((day) => day.date) : [],
    },
    days: days.map((day) => ({
      date: day.date,
      weatherWindowLabel: WEATHER_WINDOW_LABEL[day.decisionLevel],
      decisionLevel: day.decisionLevel,
      decisionHeadline: day.decisionHeadline,
      limitingChecks: day.limitingChecks,
      weatherWindowScore: day.score,
      weatherDescription: day.weatherDescription,
      temperatureHighF: day.tempHighF,
      temperatureLowF: day.tempLowF,
      departureWindGustMph: day.windGustMph,
      peakWindGustMph: day.peakGustMph,
      windDirection: day.windDirection,
      departurePrecipitationChancePct: day.precipChance,
      peakPrecipitationChancePct: day.peakPrecipChance,
      expectedRainIn: day.expectedRainIn,
      expectedSnowIn: day.expectedSnowIn,
      cloudCoverPct: day.cloudCoverPct,
      travelHoursWithinLimits: day.travelPassHours,
      travelHoursEvaluated: day.travelTotalHours,
      longestStretchWithinLimits: day.travelBestWindow,
      ...(flags.daylightTimeline ? { sunrise: day.sunrise, sunset: day.sunset, daylightLength: day.dayLength } : {}),
      ...(flags.weatherContextDetails ? { visibilityRisk: day.visibilityLevel, visibilitySummary: day.visibilitySummary } : {}),
      activeWeatherAlerts: day.alertCount,
      ...(flags.airQualityDetails ? { airQualityAqi: day.airQualityAqi, airQualityCategory: day.airQualityCategory } : {}),
      partialData: day.partialData,
      dataWarning: day.apiWarning,
      forecastIssuedTime: day.sourceIssuedTime,
      hourlyTravelWindow: day.hourlyWeather.map((hour) => ({
        time: hour.time,
        temperatureF: hour.temp,
        windMph: hour.wind,
        gustMph: hour.gust,
        precipitationChancePct: hour.precipChance,
        condition: hour.condition,
      })),
    })),
  };
}
