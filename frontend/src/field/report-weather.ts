import type { SafetyData, UserPreferences, WeatherTrendPoint } from "../app/types";
import { annotateExposure, buildTravelWindowRows } from "../app/travel-window";
import { minutesToTwentyFourHourClock, parseHourLabelToMinutes, parseTimeInputMinutes } from "../app/core";
import { dateTimeInputsFor } from "../app/date-time-inputs";

const clockMinutes = (value: string) => parseTimeInputMinutes(value) ?? parseHourLabelToMinutes(value);

// Use the original readings for coverage: legacy travel rows normalize gaps to zero.
export function buildReportWeatherRows(data: SafetyData, preferences: UserPreferences, hours: number) {
  const trend = (data.weather.trend || []).slice(0, hours);
  const rows = buildTravelWindowRows(trend, preferences, {
    snowDepthIn: data.terrainCondition?.signals?.maxSnowDepthIn
      ?? data.snowpack?.snotel?.snowDepthIn ?? data.snowpack?.nohrsc?.snowDepthIn ?? null,
  }).map((row, index) => {
    const point = trend[index];
    const complete = [point.temp, point.wind, point.gust, point.precipChance]
      .every((value) => typeof value === "number" && Number.isFinite(value));
    const measured = (value: unknown) => typeof value === "number" && Number.isFinite(value);
    const knownFailures = row.failedRuleLabels.flatMap((label, index) => {
      const known = label === "Gust above limit" ? measured(point.gust)
        : label === "Precip above limit" ? measured(point.precipChance)
        : label === "Feels-like below limit" || label === "Heat above limit" ? measured(point.temp) && measured(point.wind)
        : true;
      return known ? [{ label, reason: row.failedRules[index] }] : [];
    });
    return {
      ...row,
      complete,
      pass: complete && row.pass,
      failedRules: knownFailures.map(failure => failure.reason),
      failedRuleLabels: [...knownFailures.map(failure => failure.label), ...(!complete ? ["Incomplete hourly evidence"] : [])],
      reasonSummary: complete ? row.reasonSummary : [
        "Hourly evidence is incomplete. Verify the missing weather observations.",
        ...knownFailures.map(failure => failure.reason),
      ].join(" "),
    };
  });
  annotateExposure(rows);
  return rows;
}

// Place readings at their planned time instead of treating the first N records
// as N hours of coverage. An hourly reading covers [timestamp, timestamp + 1h).
export function buildPlannedReportWeatherRows(data: SafetyData, preferences: UserPreferences, hours: number,
  plan: { start: string; date: string }) {
  const trend = data.weather.trend || [];
  const readings = buildReportWeatherRows(data, preferences, trend.length);
  const start = clockMinutes(plan.start);
  const planDay = Date.parse(`${plan.date}T00:00:00Z`);
  let legacyDay = 0;
  let previousClock: number | null = null;
  const timed = trend.map((point, index) => {
    let minute = clockMinutes(point.time);
    let dayOffset = legacyDay;
    if (point.timeIso && Number.isFinite(planDay)) {
      // ISO offsets and the objective timezone take precedence over the viewer's timezone.
      const local = data.weather.timezone && /(?:Z|[+-]\d{2}:\d{2})$/.test(point.timeIso)
        ? dateTimeInputsFor(new Date(point.timeIso), data.weather.timezone)
        : { date: point.timeIso.slice(0, 10), time: point.timeIso.slice(11, 16) };
      minute = clockMinutes(local.time);
      dayOffset = (Date.parse(`${local.date}T00:00:00Z`) - planDay) / 86400000;
    } else if (minute !== null) {
      if ((previousClock !== null && previousClock - minute > 720)
        || (previousClock === null && start !== null && start - minute > 720)) legacyDay += 1;
      dayOffset = legacyDay;
    }
    previousClock = minute;
    return { row: readings[index], minute: minute === null ? NaN : dayOffset * 1440 + minute };
  }).sort((a, b) => b.minute - a.minute);

  const rows = Array.from({ length: hours }, (_, index) => {
    const minute = start === null ? NaN : start + index * 60;
    const time = Number.isFinite(minute) ? minutesToTwentyFourHourClock(minute % 1440) : "Unavailable";
    const end = minute + 60;
    const overlaps = timed.filter(entry => entry.minute < end && entry.minute + 60 > minute);
    // Check every subinterval, including the part after the final clock-hour
    // boundary. Sampling only the slot's start misses late storms and gaps.
    const boundaries = [...new Set([minute, end, ...overlaps.flatMap(entry => [
      Math.max(minute, entry.minute), Math.min(end, entry.minute + 60),
    ])])].sort((a, b) => a - b);
    const used = new Set<typeof timed[number]>();
    let covered = Number.isFinite(minute);
    for (const boundary of boundaries.slice(0, -1)) {
      const entry = overlaps.find(item => item.minute <= boundary && boundary < item.minute + 60);
      if (entry) used.add(entry);
      else covered = false;
    }
    const contributing = [...used].map(entry => entry.row);
    if (contributing.length === 0) {
      const missing: WeatherTrendPoint = { time, temp: NaN, wind: NaN, gust: NaN, precipChance: NaN, condition: "Unavailable" };
      const row = buildReportWeatherRows({ ...data, weather: { ...data.weather, trend: [missing] } }, preferences, 1)[0];
      return { ...row, reasonSummary: "No hourly forecast covers this planned time. Verify conditions before departure." };
    }
    const complete = covered && contributing.every(row => row.complete);
    const pass = complete && contributing.every(row => row.pass);
    const failedRules = [...new Set(contributing.flatMap(row => row.failedRules))];
    const failedRuleLabels = [...new Set([
      ...contributing.flatMap(row => row.failedRuleLabels),
      ...(!covered ? ["Incomplete hourly coverage"] : []),
    ])];
    // Keep both cold and heat hazards in the reasons; display the breached
    // temperature extreme alongside the largest wind/precipitation readings.
    const coldest = contributing.reduce((a, b) => a.feelsLike < b.feelsLike ? a : b);
    const hottest = contributing.reduce((a, b) => a.feelsLike > b.feelsLike ? a : b);
    const thermal = coldest.feelsLike < preferences.minFeelsLikeF ? coldest : hottest;
    return {
      ...thermal, time, complete, pass, failedRules, failedRuleLabels,
      wind: Math.max(...contributing.map(row => row.wind)),
      gust: Math.max(...contributing.map(row => row.gust)),
      precipChance: Math.max(...contributing.map(row => row.precipChance)),
      lightningRisk: contributing.some(row => row.lightningRisk),
      condition: [...new Set(contributing.map(row => row.condition))].join(" / "),
      reasonSummary: pass ? "Meets thresholds" : [
        ...(!covered ? ["Hourly forecast coverage is incomplete for this planned hour."] : []),
        ...(!contributing.every(row => row.complete) ? ["Hourly evidence is incomplete. Verify the missing weather observations."] : []),
        ...failedRules,
      ].join(" "),
    };
  });
  annotateExposure(rows);
  return rows;
}
