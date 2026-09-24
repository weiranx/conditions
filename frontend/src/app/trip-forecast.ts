import type { SafetyData, UserPreferences, DecisionLevel, TravelWindowRow, TravelWindowSpan, WeatherTrendPoint } from './types';
import { DATE_FMT } from './constants';
import { evaluateBackcountryDecision } from './decision';
import { buildTravelWindowRows, buildTravelWindowInsights, buildTrendWindowFromStart } from './travel-window';

export type MultiDayTripForecastDay = {
  date: string;
  safetyData: SafetyData;
  decisionLevel: DecisionLevel;
  decisionHeadline: string;
  /** Messages that set a CAUTION or NO-GO decision, most limiting first. Empty for GO. */
  limitingChecks: string[];
  score: number | null;
  weatherDescription: string;
  tempHighF: number | null;
  tempLowF: number | null;
  /** Departure reading. */
  windGustMph: number | null;
  /** Highest reading from departure through the travel window, as the decision checks it. */
  peakGustMph: number | null;
  windDirection: string | null;
  /** Departure reading. */
  precipChance: number | null;
  /** Highest reading from departure through the travel window, as the decision checks it. */
  peakPrecipChance: number | null;
  expectedRainIn: number | null;
  expectedSnowIn: number | null;
  humidityPct: number | null;
  cloudCoverPct: number | null;
  isDaytime: boolean | null;
  travelSummary: string;
  travelPassHours: number;
  travelTotalHours: number;
  /** Longest run of consecutive hours within every limit. */
  travelBestWindow: TravelWindowSpan | null;
  sunrise: string | null;
  sunset: string | null;
  dayLength: string | null;
  visibilityLevel: string | null;
  visibilitySummary: string | null;
  alertCount: number;
  airQualityAqi: number | null;
  airQualityCategory: string | null;
  partialData: boolean;
  apiWarning: string | null;
  sourceIssuedTime: string | null;
  hourlyWeather: WeatherTrendPoint[];
  deltas?: {
    score: number | null;
    tempHighF: number | null;
    tempLowF: number | null;
    windGustMph: number | null;
    precipChance: number | null;
  } | null;
};

const diffOrNull = (current: number | null, previous: number | null): number | null =>
  current != null && previous != null ? Math.round((current - previous) * 10) / 10 : null;

const finiteNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// The highest of the readings that exist; a missing reading is not a calm or dry one.
const peakReading = (values: unknown[]): number | null => {
  const known = values.map(finiteNumberOrNull).filter((value): value is number => value !== null);
  return known.length ? Math.max(...known) : null;
};

const LIMIT_NAMES: Record<string, string> = {
  'Gust above limit': 'wind gusts',
  'Precip above limit': 'rain / snow chance',
  'Feels-like below limit': 'cold',
  'Heat above limit': 'heat',
  'Severe weather risk': 'severe weather',
  'Deep snow / postholing risk': 'deep snow',
};

// Names the limits behind a day with no clean hour, most widespread first;
// some (heat below the decision's own threshold, deep snow) raise no caution
// of their own.
function everyHourCrossesALimit(rows: TravelWindowRow[]): string {
  const hours = new Map<string, number>();
  rows.forEach((row) => row.failedRuleLabels.forEach((label) => hours.set(label, (hours.get(label) || 0) + 1)));
  const crossed = [...hours]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label]) => LIMIT_NAMES[label] ?? label.toLowerCase());
  return `No hour is within all of your limits${crossed.length ? ` (${crossed.join(', ')})` : ''}.`;
}

const DECISION_PRIORITY: Record<DecisionLevel, number> = { GO: 2, CAUTION: 1, 'NO-GO': 0 };

/**
 * Best first: the decision, then the report score, then hours within the
 * user's limits. A missing score ranks below any real one.
 */
export function compareTripDays(a: MultiDayTripForecastDay, b: MultiDayTripForecastDay): number {
  return DECISION_PRIORITY[b.decisionLevel] - DECISION_PRIORITY[a.decisionLevel]
    // Two missing scores give NaN, which falls through to the next key.
    || (b.score ?? -Infinity) - (a.score ?? -Infinity)
    || b.travelPassHours - a.travelPassHours;
}

export const sameTripRank = (a: MultiDayTripForecastDay, b: MultiDayTripForecastDay) => compareTripDays(a, b) === 0;

export function buildTripForecastDays(
  serverDays: unknown[], dates: string[], safeStartTime: string,
  safeTravelWindowHours: number, preferences: UserPreferences,
  ignoreAvalancheForDecision = true,
): MultiDayTripForecastDay[] {
  const dailyResults = serverDays.map((entry, index) => {
      try {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return null;
        }
        const dayData = entry as SafetyData;
        const fallbackDate = dates[index] || dates[0];
        const decisionOptions = { ignoreAvalancheForDecision };
        const dayDecision = evaluateBackcountryDecision(dayData, safeStartTime, preferences, decisionOptions);
        const trendWindow = buildTrendWindowFromStart(dayData.weather?.trend || [], safeStartTime, safeTravelWindowHours);
        const tripSnowContext = {
          snowDepthIn: dayData.terrainCondition?.signals?.maxSnowDepthIn
            ?? dayData.snowpack?.snotel?.snowDepthIn
            ?? dayData.snowpack?.nohrsc?.snowDepthIn
            ?? null,
        };
        const travelRows = buildTravelWindowRows(trendWindow, preferences, tripSnowContext);
        const travelInsights = buildTravelWindowInsights(travelRows, preferences.timeStyle);
        const noCleanTravelHours = travelRows.length > 0 && travelInsights.passHours === 0;
        const noCleanHoursCaution = noCleanTravelHours && dayDecision.level !== 'NO-GO';
        const decisionLevel = noCleanHoursCaution ? 'CAUTION' : dayDecision.level;
        const decisionHeadline = noCleanHoursCaution
          ? 'No travel hour meets every threshold — re-time the start, shorten the objective, or choose another day.'
          : dayDecision.headline;
        const limitingChecks = decisionLevel === 'NO-GO'
          ? dayDecision.blockers
          : decisionLevel === 'CAUTION'
            ? [...(noCleanHoursCaution ? [everyHourCrossesALimit(travelRows)] : []), ...dayDecision.cautions]
            : [];
        const peakPrecipRaw = peakReading([dayData?.weather?.precipChance, ...trendWindow.map((point) => point.precipChance)]);

        // Match the score shown by the individual Planner report exactly.
        const rawSafetyScore = finiteNumberOrNull(dayData?.safety?.score);
        const score = rawSafetyScore !== null ? Math.round(rawSafetyScore) : null;
        const tempHighRaw = finiteNumberOrNull(
          dayData?.weather?.dailyTempHighF ?? dayData?.weather?.temperatureContext24h?.maxTempF,
        );
        const tempLowRaw = finiteNumberOrNull(
          dayData?.weather?.dailyTempLowF ?? dayData?.weather?.temperatureContext24h?.minTempF,
        );
        const gustRaw = finiteNumberOrNull(dayData?.weather?.windGust);
        const precipRaw = finiteNumberOrNull(dayData?.weather?.precipChance);
        const humidityRaw = finiteNumberOrNull(dayData?.weather?.humidity);
        const cloudCoverRaw = finiteNumberOrNull(dayData?.weather?.cloudCover);
        const expectedRainRaw = finiteNumberOrNull(dayData?.rainfall?.expected?.rainWindowIn);
        const expectedSnowRaw = finiteNumberOrNull(dayData?.rainfall?.expected?.snowWindowIn);
        const airQualityAqiRaw = finiteNumberOrNull(dayData?.airQuality?.forecast?.usAqi ?? dayData?.airQuality?.usAqi);
        const airQualityCategoryRaw = dayData?.airQuality?.forecast?.category || dayData?.airQuality?.category || null;
        const airQualityCategory = airQualityCategoryRaw?.trim().toLowerCase() === 'unknown'
          ? null
          : airQualityCategoryRaw;

        return {
          date: dayData?.forecast?.selectedDate && DATE_FMT.test(dayData.forecast.selectedDate) ? dayData.forecast.selectedDate : fallbackDate,
          safetyData: dayData,
          decisionLevel,
          decisionHeadline,
          limitingChecks,
          score,
          weatherDescription: String(dayData?.weather?.description || 'Unknown'),
          tempHighF: tempHighRaw,
          tempLowF: tempLowRaw,
          windGustMph: gustRaw,
          peakGustMph: peakReading([gustRaw, ...trendWindow.map((point) => point.gust)]),
          windDirection: dayData?.weather?.windDirection || null,
          precipChance: precipRaw !== null ? Math.round(precipRaw) : null,
          peakPrecipChance: peakPrecipRaw !== null ? Math.round(peakPrecipRaw) : null,
          expectedRainIn: expectedRainRaw,
          expectedSnowIn: expectedSnowRaw,
          humidityPct: humidityRaw !== null ? Math.round(humidityRaw) : null,
          cloudCoverPct: cloudCoverRaw !== null ? Math.round(cloudCoverRaw) : null,
          isDaytime: typeof dayData?.weather?.isDaytime === 'boolean' ? dayData.weather.isDaytime : null,
          travelSummary: `${travelInsights.passHours}/${travelRows.length}h passing`,
          travelPassHours: travelInsights.passHours,
          travelTotalHours: travelRows.length,
          travelBestWindow: travelInsights.bestWindow,
          sunrise: dayData?.solar?.sunrise || null,
          sunset: dayData?.solar?.sunset || null,
          dayLength: dayData?.solar?.dayLength || null,
          visibilityLevel: dayData?.weather?.visibilityRisk?.level || null,
          visibilitySummary: dayData?.weather?.visibilityRisk?.summary || null,
          alertCount: Math.max(0, Math.round(Number(dayData?.alerts?.activeCount) || 0)),
          airQualityAqi: airQualityAqiRaw !== null ? Math.round(airQualityAqiRaw) : null,
          airQualityCategory,
          partialData: Boolean(dayData?.partialData),
          apiWarning: dayData?.apiWarning || null,
          sourceIssuedTime: dayData?.weather?.issuedTime || null,
          hourlyWeather: trendWindow,
        } as MultiDayTripForecastDay;
      } catch {
        return null;
      }
    });

  const rows = dailyResults.filter((entry): entry is MultiDayTripForecastDay => Boolean(entry)).sort((a, b) => a.date.localeCompare(b.date));
  // Day-over-day trend deltas relative to the previous available day.
  rows.forEach((row, idx) => {
    if (idx === 0) {
      row.deltas = null;
      return;
    }
    const prev = rows[idx - 1];
    row.deltas = {
      score: diffOrNull(row.score, prev.score),
      tempHighF: diffOrNull(row.tempHighF, prev.tempHighF),
      tempLowF: diffOrNull(row.tempLowF, prev.tempLowF),
      windGustMph: diffOrNull(row.windGustMph, prev.windGustMph),
      precipChance: diffOrNull(row.precipChance, prev.precipChance),
    };
  });
  return rows;
}
