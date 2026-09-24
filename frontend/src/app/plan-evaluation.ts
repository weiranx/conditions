import type { MultiDayTripForecastDay, PlanEvaluation, StartTimeScenarioComparison, TravelWindowRow, UserPreferences } from './types';

type PlanPreferences = Pick<UserPreferences,
  'maxWindGustMph' | 'maxPrecipChance' | 'minFeelsLikeF' | 'maxFeelsLikeF'
  | 'temperatureUnit' | 'windSpeedUnit' | 'elevationUnit' | 'timeStyle' | 'defaultActivity'>;

/**
 * The traveler's limits and display units as /api/safety and /api/evaluate
 * read them. The backend owns what they mean; this only serializes settings.
 */
export function planSettingsParams(preferences: PlanPreferences): Record<string, string> {
  return {
    max_gust_mph: String(preferences.maxWindGustMph),
    max_precip_chance: String(preferences.maxPrecipChance),
    min_feels_like_f: String(preferences.minFeelsLikeF),
    max_feels_like_f: String(preferences.maxFeelsLikeF),
    temp_unit: preferences.temperatureUnit,
    wind_unit: preferences.windSpeedUnit,
    elevation_unit: preferences.elevationUnit,
    time_style: preferences.timeStyle,
  };
}

/** The full plan a report is checked against: when, for how long, the settings and the approach. */
export function buildPlanParams(input: {
  preferences: PlanPreferences;
  date: string;
  start: string;
  travelWindowHours: number;
  /** Approach inputs, e.g. from buildApproachRequestParams. */
  approach?: Record<string, string>;
  /** An elevation, in feet, to estimate conditions at. */
  targetElevationFt?: number | null;
}): Record<string, string> {
  return {
    date: input.date,
    start: input.start,
    travel_window_hours: String(input.travelWindowHours),
    activity: input.preferences.defaultActivity,
    ...planSettingsParams(input.preferences),
    ...(input.approach || {}),
    ...(typeof input.targetElevationFt === 'number' && Number.isFinite(input.targetElevationFt)
      ? { target_elevation_ft: String(Math.round(input.targetElevationFt)) }
      : {}),
  };
}

/** Params as a query string, without a leading "&". */
export function planParamsQuery(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

/** A stable key for comparing plans: same params in any order give the same key. */
export function planParamsKey(params: Record<string, string> | null | undefined): string {
  const entries = Object.entries(params || {}).filter(([, value]) => value !== '' && value !== undefined);
  return JSON.stringify(entries.sort(([a], [b]) => a.localeCompare(b)));
}

type WireRow = Omit<TravelWindowRow, 'temp' | 'feelsLike' | 'wind' | 'gust' | 'precipChance' | 'objectiveReading'> & {
  temp: number | null;
  feelsLike: number | null;
  wind: number | null;
  gust: number | null;
  precipChance: number | null;
  objectiveReading?: { temp: number | null; wind: number | null; gust: number | null };
};

const reading = (value: number | null | undefined) => (typeof value === 'number' ? value : NaN);

// Missing readings are null on the wire; rows keep them as NaN so a gap is never drawn as 0.
function hydrateRows(rows: WireRow[] | undefined): TravelWindowRow[] {
  return (rows || []).map(({ objectiveReading, ...row }) => ({
    ...row,
    temp: reading(row.temp),
    feelsLike: reading(row.feelsLike),
    wind: reading(row.wind),
    gust: reading(row.gust),
    precipChance: reading(row.precipChance),
    ...(objectiveReading ? {
      objectiveReading: {
        temp: reading(objectiveReading.temp),
        wind: reading(objectiveReading.wind),
        gust: reading(objectiveReading.gust),
      },
    } : {}),
  }));
}

/** An evaluation as received, with its rows ready to draw; null when it is not one. */
export function readPlanEvaluation(value: unknown): PlanEvaluation | null {
  if (!value || typeof value !== 'object') return null;
  const evaluation = value as PlanEvaluation;
  // An evaluation from before the report interpretation moved to the backend is re-requested.
  if (!evaluation.decision || !evaluation.travelWindow?.planned || !evaluation.travelWindow?.readings
    || !evaluation.interpretation || !evaluation.terrain || !evaluation.elevation) return null;
  return {
    ...evaluation,
    travelWindow: {
      planned: { ...evaluation.travelWindow.planned, rows: hydrateRows(evaluation.travelWindow.planned.rows as unknown as WireRow[]) },
      readings: { ...evaluation.travelWindow.readings, rows: hydrateRows(evaluation.travelWindow.readings.rows as unknown as WireRow[]) },
    },
  };
}

/** A start-time comparison as received, with each departure's rows ready to draw. */
export function readStartTimeComparison(value: unknown): StartTimeScenarioComparison | null {
  if (!value || typeof value !== 'object') return null;
  const comparison = value as StartTimeScenarioComparison;
  if (!Array.isArray(comparison.scenarios) || !comparison.scenarios.length) return null;
  return {
    ...comparison,
    scenarios: comparison.scenarios.map((scenario) => ({
      ...scenario,
      planned: { ...scenario.planned, rows: hydrateRows(scenario.planned?.rows as unknown as WireRow[]) },
    })),
  };
}

/** Days of a multi-day comparison as received; entries that are not days are dropped. */
export function readTripDays(value: unknown): MultiDayTripForecastDay[] {
  if (!Array.isArray(value)) return [];
  return value.filter((day): day is MultiDayTripForecastDay => Boolean(day) && typeof day === 'object'
    && typeof (day as MultiDayTripForecastDay).date === 'string'
    && typeof (day as MultiDayTripForecastDay).rankValue === 'number'
    && Boolean((day as MultiDayTripForecastDay).safetyData) && typeof (day as MultiDayTripForecastDay).safetyData === 'object');
}
