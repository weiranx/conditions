import type { PersistedReport } from './report-storage';

export type ReportChangeTone = 'better' | 'worse' | 'neutral';

export interface ReportChange {
  key: string;
  label: string;
  summary: string;
  tone: ReportChangeTone;
  magnitude: number;
}

export interface ReportComparison {
  baselineAt: string;
  changes: ReportChange[];
  headline: string;
  tone: ReportChangeTone;
}

const finite = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const changedNumber = ({
  key,
  label,
  current,
  previous,
  threshold,
  unit,
  decimals = 0,
  higherIsWorse,
}: {
  key: string;
  label: string;
  current: unknown;
  previous: unknown;
  threshold: number;
  unit: string;
  decimals?: number;
  higherIsWorse: boolean | null;
}): ReportChange | null => {
  const next = finite(current);
  const prior = finite(previous);
  if (next === null || prior === null) return null;
  const delta = next - prior;
  if (Math.abs(delta) < threshold) return null;
  const direction = delta > 0 ? 'increased' : 'decreased';
  const tone: ReportChangeTone = higherIsWorse === null
    ? 'neutral'
    : (delta > 0) === higherIsWorse ? 'worse' : 'better';
  return {
    key,
    label,
    summary: `${label} ${direction} from ${prior.toFixed(decimals)}${unit} to ${next.toFixed(decimals)}${unit}.`,
    tone,
    magnitude: Math.abs(delta) / threshold,
  };
};

export function compareReports(current: PersistedReport, baseline: PersistedReport): ReportComparison {
  const currentData = current.safetyData;
  const baselineData = baseline.safetyData;
  const changes: Array<ReportChange | null> = [
    changedNumber({
      key: 'score',
      label: 'Planning score',
      current: currentData.safety?.score,
      previous: baselineData.safety?.score,
      threshold: 3,
      unit: '',
      higherIsWorse: false,
    }),
    changedNumber({
      key: 'avalanche',
      label: 'Avalanche danger',
      current: currentData.avalanche?.dangerLevel,
      previous: baselineData.avalanche?.dangerLevel,
      threshold: 1,
      unit: '',
      higherIsWorse: true,
    }),
    changedNumber({
      key: 'gust',
      label: 'Peak gust',
      current: currentData.weather?.windGust,
      previous: baselineData.weather?.windGust,
      threshold: 5,
      unit: ' mph',
      higherIsWorse: true,
    }),
    changedNumber({
      key: 'precip',
      label: 'Precipitation chance',
      current: currentData.weather?.precipChance,
      previous: baselineData.weather?.precipChance,
      threshold: 10,
      unit: '%',
      higherIsWorse: true,
    }),
    changedNumber({
      key: 'temperature',
      label: 'Temperature',
      current: currentData.weather?.temp,
      previous: baselineData.weather?.temp,
      threshold: 5,
      unit: '°F',
      higherIsWorse: null,
    }),
    changedNumber({
      key: 'alerts',
      label: 'Active weather alerts',
      current: currentData.alerts?.activeCount,
      previous: baselineData.alerts?.activeCount,
      threshold: 1,
      unit: '',
      higherIsWorse: true,
    }),
  ];

  const currentProblems = new Set((currentData.avalanche?.problems || []).map((problem) => problem.name).filter(Boolean));
  const previousProblems = new Set((baselineData.avalanche?.problems || []).map((problem) => problem.name).filter(Boolean));
  const addedProblems = [...currentProblems].filter((problem) => !previousProblems.has(problem));
  if (addedProblems.length > 0) {
    changes.push({
      key: 'avalanche-problems-added',
      label: 'Avalanche problems',
      summary: `New avalanche problem${addedProblems.length === 1 ? '' : 's'}: ${addedProblems.join(', ')}.`,
      tone: 'worse',
      magnitude: 2 + addedProblems.length,
    });
  }

  const ranked = changes
    .filter((change): change is ReportChange => Boolean(change))
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, 6);
  const worseCount = ranked.filter((change) => change.tone === 'worse').length;
  const betterCount = ranked.filter((change) => change.tone === 'better').length;
  const tone: ReportChangeTone = worseCount > betterCount ? 'worse' : betterCount > worseCount ? 'better' : 'neutral';
  const headline = ranked.length === 0
    ? 'No material forecast changes detected'
    : tone === 'worse'
      ? `${worseCount} condition${worseCount === 1 ? '' : 's'} moved in a less favorable direction`
      : tone === 'better'
        ? `${betterCount} condition${betterCount === 1 ? '' : 's'} moved in a more favorable direction`
        : 'The forecast changed, with mixed effects';

  return {
    baselineAt: baseline.savedAt,
    changes: ranked,
    headline,
    tone,
  };
}
