import type { UserPreferences } from './types';
import {
  formatRainAmountForElevationUnit,
  formatSnowfallAmountForElevationUnit,
} from './core';
import { parsePrecipNumericValue } from './planner-helpers';

export interface RainfallDisplay {
  rainfallTotals: Record<string, unknown> | null;
  rainfall12hIn: number;
  rainfall24hIn: number;
  rainfall48hIn: number;
  snowfall12hIn: number;
  snowfall24hIn: number;
  snowfall48hIn: number;
  rainfall24hSeverityClass: 'go' | 'caution' | 'nogo' | 'watch';
  rainfallWindowSummary: string;
  snowfallWindowSummary: string;
  rainfall12hDisplay: string;
  rainfall24hDisplay: string;
  rainfall48hDisplay: string;
  snowfall12hDisplay: string;
  snowfall24hDisplay: string;
  snowfall48hDisplay: string;
  expectedTravelWindowHours: number;
  expectedRainWindowDisplay: string;
  expectedSnowWindowDisplay: string;
  expectedPrecipDataAvailable: boolean;
  expectedPrecipSummaryLine: string;
  rainfallModeLabel: string;
  rainfallDataAvailable: boolean;
  rainfallNoteLine: string;
  expectedPrecipNoteLine: string;
  precipInsightLine: string;
  rainfallExpected: Record<string, unknown> | null;
  expectedSnowWindowIn: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildRainfallDisplay(rainfallPayload: any, preferences: UserPreferences, travelWindowHours: number): RainfallDisplay {
  const rainfallTotals = rainfallPayload?.totals || null;
  const rainfall12hIn = parsePrecipNumericValue(rainfallTotals?.rainPast12hIn ?? rainfallTotals?.past12hIn);
  const rainfall24hIn = parsePrecipNumericValue(rainfallTotals?.rainPast24hIn ?? rainfallTotals?.past24hIn);
  const rainfall48hIn = parsePrecipNumericValue(rainfallTotals?.rainPast48hIn ?? rainfallTotals?.past48hIn);
  const rainfall12hMm = parsePrecipNumericValue(rainfallTotals?.rainPast12hMm ?? rainfallTotals?.past12hMm);
  const rainfall24hMm = parsePrecipNumericValue(rainfallTotals?.rainPast24hMm ?? rainfallTotals?.past24hMm);
  const rainfall48hMm = parsePrecipNumericValue(rainfallTotals?.rainPast48hMm ?? rainfallTotals?.past48hMm);
  const snowfall12hIn = parsePrecipNumericValue(rainfallTotals?.snowPast12hIn);
  const snowfall24hIn = parsePrecipNumericValue(rainfallTotals?.snowPast24hIn);
  const snowfall48hIn = parsePrecipNumericValue(rainfallTotals?.snowPast48hIn);
  const snowfall12hCm = parsePrecipNumericValue(rainfallTotals?.snowPast12hCm);
  const snowfall24hCm = parsePrecipNumericValue(rainfallTotals?.snowPast24hCm);
  const snowfall48hCm = parsePrecipNumericValue(rainfallTotals?.snowPast48hCm);
  const rainfall24hSeverityClass: 'go' | 'caution' | 'nogo' | 'watch' =
    Number.isFinite(rainfall24hIn) && rainfall24hIn >= 0.6
      ? 'nogo'
      : Number.isFinite(rainfall24hIn) && rainfall24hIn >= 0.25
        ? 'caution'
        : Number.isFinite(rainfall24hIn)
          ? 'go'
          : 'watch';
  const eu = preferences.elevationUnit;
  const rainfallWindowSummary = [
    formatRainAmountForElevationUnit(rainfall12hIn, rainfall12hMm, eu),
    formatRainAmountForElevationUnit(rainfall24hIn, rainfall24hMm, eu),
    formatRainAmountForElevationUnit(rainfall48hIn, rainfall48hMm, eu),
  ].join(' / ');
  const snowfallWindowSummary = [
    formatSnowfallAmountForElevationUnit(snowfall12hIn, snowfall12hCm, eu),
    formatSnowfallAmountForElevationUnit(snowfall24hIn, snowfall24hCm, eu),
    formatSnowfallAmountForElevationUnit(snowfall48hIn, snowfall48hCm, eu),
  ].join(' / ');
  const rainfall12hDisplay = formatRainAmountForElevationUnit(rainfall12hIn, rainfall12hMm, eu);
  const rainfall24hDisplay = formatRainAmountForElevationUnit(rainfall24hIn, rainfall24hMm, eu);
  const rainfall48hDisplay = formatRainAmountForElevationUnit(rainfall48hIn, rainfall48hMm, eu);
  const snowfall12hDisplay = formatSnowfallAmountForElevationUnit(snowfall12hIn, snowfall12hCm, eu);
  const snowfall24hDisplay = formatSnowfallAmountForElevationUnit(snowfall24hIn, snowfall24hCm, eu);
  const snowfall48hDisplay = formatSnowfallAmountForElevationUnit(snowfall48hIn, snowfall48hCm, eu);
  const rainfallExpected = rainfallPayload?.expected || null;
  const expectedTravelWindowHoursRaw = Number(rainfallExpected?.travelWindowHours);
  const expectedTravelWindowHours = Number.isFinite(expectedTravelWindowHoursRaw) ? Math.max(1, Math.round(expectedTravelWindowHoursRaw)) : travelWindowHours;
  const expectedRainWindowIn = parsePrecipNumericValue(rainfallExpected?.rainWindowIn);
  const expectedRainWindowMm = parsePrecipNumericValue(rainfallExpected?.rainWindowMm);
  const expectedSnowWindowIn = parsePrecipNumericValue(rainfallExpected?.snowWindowIn);
  const expectedSnowWindowCm = parsePrecipNumericValue(rainfallExpected?.snowWindowCm);
  const expectedRainWindowDisplay = formatRainAmountForElevationUnit(expectedRainWindowIn, expectedRainWindowMm, eu);
  const expectedSnowWindowDisplay = formatSnowfallAmountForElevationUnit(expectedSnowWindowIn, expectedSnowWindowCm, eu);
  const expectedPrecipDataAvailable =
    Number.isFinite(expectedRainWindowIn) ||
    Number.isFinite(expectedRainWindowMm) ||
    Number.isFinite(expectedSnowWindowIn) ||
    Number.isFinite(expectedSnowWindowCm);
  const expectedPrecipSummaryLine = expectedPrecipDataAvailable
    ? `Expected in next ${expectedTravelWindowHours}h: rain ${expectedRainWindowDisplay} • snow ${expectedSnowWindowDisplay}.`
    : `Expected precipitation totals are unavailable for the next ${expectedTravelWindowHours}h window.`;
  const rainfallModeLabel =
    rainfallPayload?.mode === 'projected_for_selected_start'
      ? 'Projected around selected start'
      : rainfallPayload?.mode === 'observed_recent'
        ? 'Observed recent accumulation'
        : 'Mode unavailable';
  const rainfallStatus = String(rainfallPayload?.status || '').toLowerCase();
  const rainfallDataAvailable = rainfallStatus === 'ok' || rainfallStatus === 'partial';
  const rainfallNoteLine =
    (typeof rainfallPayload?.note === 'string' && rainfallPayload.note.trim()) ||
    (rainfallDataAvailable
      ? rainfallPayload?.mode === 'projected_for_selected_start'
        ? 'Rolling rain and snowfall totals are anchored to selected start time and can include forecast hours.'
        : 'Rolling rain and snowfall totals are based on recent hours prior to the selected period.'
      : 'Rolling rain/snow totals unavailable for this objective/time.');
  const expectedPrecipNoteLine =
    (typeof rainfallExpected?.note === 'string' && rainfallExpected.note.trim()) ||
    `Expected precipitation totals for the next ${expectedTravelWindowHours}h from selected start time.`;
  const precipInsightLine = (() => {
    const rain24 = Number.isFinite(rainfall24hIn) ? rainfall24hIn : null;
    const snow24 = Number.isFinite(snowfall24hIn) ? snowfall24hIn : null;
    const hasAny24hSignal = rain24 !== null || snow24 !== null;
    const no24hPrecipSignal =
      hasAny24hSignal &&
      (rain24 === null || rain24 <= 0.01) &&
      (snow24 === null || snow24 <= 0.01);
    if (rain24 !== null && rain24 >= 0.6 && snow24 !== null && snow24 >= 2) {
      return `Mixed precip signal: 24h rain ${rainfall24hDisplay} plus 24h snow ${snowfall24hDisplay}.`;
    }
    if (rain24 !== null && rain24 >= 0.6) {
      return `Strong rain signal: 24h rain ${rainfall24hDisplay}. Expect wetter, softer footing.`;
    }
    if (snow24 !== null && snow24 >= 4) {
      return `Strong snow signal: 24h snow ${snowfall24hDisplay}. Fresh coverage likely.`;
    }
    if (rain24 !== null && rain24 >= 0.25) {
      return `Moderate rain signal: 24h rain ${rainfall24hDisplay}. Slick/muddy sections are likely.`;
    }
    if (snow24 !== null && snow24 >= 1.5) {
      return `Moderate snow signal: 24h snow ${snowfall24hDisplay}. Patchy fresh snow likely.`;
    }
    if (no24hPrecipSignal) {
      return `No recent precip signal: 24h rain ${rainfall24hDisplay} • 24h snow ${snowfall24hDisplay}.`;
    }
    if (rain24 !== null || snow24 !== null) {
      return `Light recent precip: 24h rain ${rainfall24hDisplay} • 24h snow ${snowfall24hDisplay}.`;
    }
    return 'Recent rain/snow totals are unavailable for this objective/time.';
  })();

  return {
    rainfallTotals,
    rainfall12hIn,
    rainfall24hIn,
    rainfall48hIn,
    snowfall12hIn,
    snowfall24hIn,
    snowfall48hIn,
    rainfall24hSeverityClass,
    rainfallWindowSummary,
    snowfallWindowSummary,
    rainfall12hDisplay,
    rainfall24hDisplay,
    rainfall48hDisplay,
    snowfall12hDisplay,
    snowfall24hDisplay,
    snowfall48hDisplay,
    expectedTravelWindowHours,
    expectedRainWindowDisplay,
    expectedSnowWindowDisplay,
    expectedPrecipDataAvailable,
    expectedPrecipSummaryLine,
    rainfallModeLabel,
    rainfallDataAvailable,
    rainfallNoteLine,
    expectedPrecipNoteLine,
    precipInsightLine,
    rainfallExpected,
    expectedSnowWindowIn,
  };
}
