import type { SafetyData, UserPreferences } from "../app/types";
import { buildTravelWindowRows } from "../app/travel-window";

// Use the original readings for coverage: legacy travel rows normalize gaps to zero.
export function buildReportWeatherRows(data: SafetyData, preferences: UserPreferences, hours: number) {
  const trend = (data.weather.trend || []).slice(0, hours);
  return buildTravelWindowRows(trend, preferences, {
    snowDepthIn: data.terrainCondition?.signals?.maxSnowDepthIn
      ?? data.snowpack?.snotel?.snowDepthIn ?? data.snowpack?.nohrsc?.snowDepthIn ?? null,
  }).map((row, index) => {
    const point = trend[index];
    const complete = [point.temp, point.wind, point.gust, point.precipChance]
      .every((value) => typeof value === "number" && Number.isFinite(value));
    return {
      ...row,
      complete,
      pass: complete && row.pass,
      reasonSummary: complete ? row.reasonSummary : "Hourly evidence is incomplete. Verify the missing weather observations.",
    };
  });
}
