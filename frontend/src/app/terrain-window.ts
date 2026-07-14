import type { AvalancheProblem, ElevationForecastBand, TravelWindowRow, UserPreferences } from './types';
import {
  ASPECT_ROSE_ORDER,
  parseTerrainFromLocation,
  type TerrainAspect,
  type TerrainElevationBand,
} from '../utils/avalanche';

export type TerrainWindowLevel = 'lower' | 'caution' | 'avoid' | 'unknown';

export interface TerrainWindowCell {
  level: TerrainWindowLevel;
  reasons: string[];
}

export interface TerrainWindowLane {
  id: string;
  elevationLabel: string;
  elevationFt: number;
  elevationBand: TerrainElevationBand;
  aspectLabel: string;
  aspects: TerrainAspect[];
  cells: TerrainWindowCell[];
}

export interface TerrainWindowModel {
  hours: TravelWindowRow[];
  lanes: TerrainWindowLane[];
  lowerRiskHourIndexes: number[];
  explanation: string;
}

const levelRank: Record<TerrainWindowLevel, number> = { lower: 0, unknown: 1, caution: 2, avoid: 3 };

const maxLevel = (left: TerrainWindowLevel, right: TerrainWindowLevel) => (
  levelRank[right] > levelRank[left] ? right : left
);

const elevationBandForIndex = (index: number, length: number): TerrainElevationBand => {
  if (index === 0) return 'lower';
  if (index === length - 1) return 'upper';
  return 'middle';
};

export function buildTerrainWindow({
  travelRows,
  elevationBands,
  avalancheProblems,
  avalancheRelevant,
  avalancheUnknown,
  avalancheDanger,
  leewardAspects,
  secondaryAspects,
  preferences,
}: {
  travelRows: TravelWindowRow[];
  elevationBands: ElevationForecastBand[];
  avalancheProblems: AvalancheProblem[];
  avalancheRelevant: boolean;
  avalancheUnknown: boolean;
  avalancheDanger: number | null;
  leewardAspects: string[];
  secondaryAspects: string[];
  preferences: UserPreferences;
}): TerrainWindowModel {
  const avalancheEnabled = avalancheRelevant
    || avalancheUnknown
    || avalancheProblems.length > 0
    || avalancheDanger !== null;
  const problemTerrain = avalancheProblems.map((problem) => ({
    name: problem.name || 'Avalanche problem',
    ...parseTerrainFromLocation(problem.location),
  }));
  const affectedAspects = new Set<TerrainAspect>();
  problemTerrain.forEach((problem) => problem.aspects.forEach((aspect) => affectedAspects.add(aspect)));
  [...leewardAspects, ...secondaryAspects].forEach((aspect) => {
    if (ASPECT_ROSE_ORDER.includes(aspect as TerrainAspect)) affectedAspects.add(aspect as TerrainAspect);
  });
  const primaryAspects = ASPECT_ROSE_ORDER.filter((aspect) => affectedAspects.has(aspect));
  const otherAspects = ASPECT_ROSE_ORDER.filter((aspect) => !affectedAspects.has(aspect));
  const aspectGroups = primaryAspects.length > 0
    ? [
        { label: `${primaryAspects.join(', ')} exposed`, aspects: primaryAspects },
        ...(otherAspects.length > 0 ? [{ label: `${otherAspects.join(', ')} other`, aspects: otherAspects }] : []),
      ]
    : [{ label: 'All aspects', aspects: ASPECT_ROSE_ORDER }];
  const sortedBands = elevationBands.slice().sort((a, b) => a.elevationFt - b.elevationFt);

  const lanes = sortedBands.flatMap((band, bandIndex) => {
    const elevationBand = elevationBandForIndex(bandIndex, sortedBands.length);
    return aspectGroups.map((group) => ({
      id: `${elevationBand}-${Math.round(band.elevationFt)}-${group.aspects.join('-')}`,
      elevationLabel: band.label,
      elevationFt: band.elevationFt,
      elevationBand,
      aspectLabel: group.label,
      aspects: group.aspects,
      cells: travelRows.map((hour) => {
        let level: TerrainWindowLevel = hour.pass ? 'lower' : 'caution';
        const reasons = hour.pass ? [] : [hour.reasonSummary || 'One or more travel thresholds are exceeded.'];
        if (hour.gust >= preferences.maxWindGustMph) {
          level = maxLevel(level, 'avoid');
          reasons.push('Gust exceeds your configured limit.');
        } else if (hour.gust >= preferences.maxWindGustMph * 0.7) {
          level = maxLevel(level, 'caution');
          reasons.push('Gust is approaching your configured limit.');
        }
        const overlapsLee = group.aspects.some((aspect) => leewardAspects.includes(aspect));
        const overlapsSecondary = group.aspects.some((aspect) => secondaryAspects.includes(aspect));
        if (overlapsLee && hour.gust >= preferences.maxWindGustMph * 0.55) {
          level = maxLevel(level, hour.gust >= preferences.maxWindGustMph ? 'avoid' : 'caution');
          reasons.push('Aspect overlaps the primary wind-loading direction.');
        } else if (overlapsSecondary && hour.gust >= preferences.maxWindGustMph * 0.7) {
          level = maxLevel(level, 'caution');
          reasons.push('Cross-loading is possible on this aspect group.');
        }
        const matchingProblems = problemTerrain.filter((problem) => (
          (problem.aspects.size === 0 || group.aspects.some((aspect) => problem.aspects.has(aspect)))
          && (problem.elevations.size === 0 || problem.elevations.has(elevationBand))
        ));
        if (avalancheRelevant && matchingProblems.length > 0) {
          level = maxLevel(level, Number(avalancheDanger) >= 3 ? 'avoid' : 'caution');
          reasons.push(`Active avalanche terrain: ${matchingProblems.map((problem) => problem.name).join(', ')}.`);
        } else if (avalancheUnknown) {
          level = maxLevel(level, 'unknown');
          reasons.push('Avalanche conditions are unrated for this terrain.');
        }
        return { level, reasons: Array.from(new Set(reasons)) };
      }),
    }));
  });

  const lowerRiskHourIndexes = travelRows.flatMap((_, hourIndex) => {
    const cells = lanes.map((lane) => lane.cells[hourIndex]).filter(Boolean);
    const lowerCount = cells.filter((cell) => cell.level === 'lower').length;
    return cells.length > 0 && lowerCount >= Math.ceil(cells.length / 2) ? [hourIndex] : [];
  });

  return {
    hours: travelRows,
    lanes,
    lowerRiskHourIndexes,
    explanation: avalancheEnabled
      ? 'Cells combine your hourly thresholds with forecast elevation estimates, active avalanche problem terrain, and wind-loading aspects.'
      : 'Cells combine your hourly thresholds with forecast elevation estimates and wind-exposure aspects.',
  };
}
