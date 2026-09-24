'use strict';

// Terrain by elevation, aspect and hour: which slopes the plan's hours, the
// avalanche problems and wind loading reach, and the objective's elevation
// bands (and a target elevation) re-estimated for each planned hour.

const { ASPECT_ROSE_ORDER, parseTerrainFromLocation } = require('./avalanche-terrain');
const { computeFeelsLikeF } = require('./weather-normalizers');
const { toFiniteOrNull } = require('./numbers');

// The lapse-rate model the start-hour elevation bands use (visibility-risk.js).
const TEMP_LAPSE_F_PER_1000FT = 3.3;
const WIND_INCREASE_MPH_PER_1000FT = 2;
const GUST_INCREASE_MPH_PER_1000FT = 2.5;

const isNum = Number.isFinite;

/** Conditions `deltaFt` above (or below) the objective from its readings (°F, mph). */
const estimateAtElevation = (base, deltaFt) => {
  const deltaKft = deltaFt / 1000;
  const temp = Math.round(base.temp - deltaKft * TEMP_LAPSE_F_PER_1000FT);
  const windSpeed = Math.max(0, Math.round(base.wind + deltaKft * WIND_INCREASE_MPH_PER_1000FT));
  const windGust = isNum(base.gust)
    ? Math.max(windSpeed, Math.round(base.gust + deltaKft * GUST_INCREASE_MPH_PER_1000FT))
    : windSpeed;
  return { temp, feelsLike: computeFeelsLikeF(temp, windSpeed), windSpeed, windGust };
};

/** The elevation bands re-derived from another hour's objective readings. */
const rebaseElevationBands = (bands, base) => {
  if (!base || !isNum(base.temp) || !isNum(base.wind)) return bands;
  return bands.map((band) => ({ ...band, ...estimateAtElevation(base, band.deltaFromObjectiveFt) }));
};

// A planned hour's objective readings: approach hours carry them separately.
const objectiveBase = (row) => {
  const reading = row?.objectiveReading ?? row;
  return reading ? { temp: reading.temp, wind: reading.wind, gust: reading.gust } : null;
};

/**
 * The elevation bands for each planned hour (the first is the report's own,
 * from the start-hour forecast), and the estimate at a target elevation (the
 * objective's, without one) for each hour.
 */
const buildElevationByHour = (report, plannedRows, targetElevationFt) => {
  const bands = Array.isArray(report?.weather?.elevationForecast) ? report.weather.elevationForecast : [];
  const bandsByHour = plannedRows.map((row, index) => (index === 0 ? bands : rebaseElevationBands(bands, objectiveBase(row))));
  const weather = report?.weather || {};
  const objectiveFt = toFiniteOrNull(weather.elevation);
  const temp = toFiniteOrNull(weather.temp);
  const wind = toFiniteOrNull(weather.windSpeed);
  // Estimating from a missing elevation, temperature or wind would invent a
  // forecast at the target (0 ft, 0 °F, calm).
  // Without a target, the objective itself.
  const targetFt = isNum(targetElevationFt) && targetElevationFt >= 0 ? targetElevationFt : objectiveFt;
  let target = null;
  if (targetFt !== null && objectiveFt !== null && temp !== null && wind !== null) {
    const deltaFt = targetFt - objectiveFt;
    const atStart = estimateAtElevation({ temp, wind, gust: toFiniteOrNull(weather.windGust) ?? Number.NaN }, deltaFt);
    target = {
      elevationFt: Math.round(targetFt),
      deltaFt: Math.round(deltaFt),
      byHour: plannedRows.map((row, index) => {
        if (index === 0) return atStart;
        const base = objectiveBase(row);
        return base && isNum(base.temp) && isNum(base.wind) ? estimateAtElevation(base, deltaFt) : null;
      }),
    };
  }
  return { bandsByHour, target };
};

// ── Terrain window ───────────────────────────────────────────────────────────

const LEVEL_RANK = { lower: 0, unknown: 1, caution: 2, avoid: 3 };
const maxLevel = (left, right) => (LEVEL_RANK[right] > LEVEL_RANK[left] ? right : left);
const elevationBandForIndex = (index, length) => (index === 0 ? 'lower' : index === length - 1 ? 'upper' : 'middle');

/**
 * Lanes of elevation band × aspect group, one cell per planned hour, each a
 * level (lower, unknown, caution, avoid) with its reasons.
 */
const buildTerrainWindow = ({
  rows,
  elevationBands,
  avalancheProblems,
  avalancheRelevant,
  avalancheUnknown,
  avalancheDanger,
  leewardAspects,
  secondaryAspects,
  maxWindGustMph,
}) => {
  const avalancheEnabled = avalancheRelevant || avalancheUnknown || avalancheProblems.length > 0 || avalancheDanger !== null;
  const problemTerrain = avalancheProblems.map((problem) => ({
    name: problem?.name || 'Avalanche problem',
    ...parseTerrainFromLocation(problem?.location),
  }));
  const affectedAspects = new Set();
  problemTerrain.forEach((problem) => problem.aspects.forEach((aspect) => affectedAspects.add(aspect)));
  [...leewardAspects, ...secondaryAspects].forEach((aspect) => {
    if (ASPECT_ROSE_ORDER.includes(aspect)) affectedAspects.add(aspect);
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
      cells: rows.map((hour) => {
        let level = hour.pass ? 'lower' : 'caution';
        const reasons = hour.pass ? [] : [hour.reasonSummary || 'One or more travel thresholds are exceeded.'];
        // A missing gust is not calm, but it is no gust signal either.
        const gust = isNum(hour.gust) ? hour.gust : Number.NaN;
        if (gust >= maxWindGustMph) {
          level = maxLevel(level, 'avoid');
          reasons.push('Gust exceeds your configured limit.');
        } else if (gust >= maxWindGustMph * 0.7) {
          level = maxLevel(level, 'caution');
          reasons.push('Gust is approaching your configured limit.');
        }
        const overlapsLee = group.aspects.some((aspect) => leewardAspects.includes(aspect));
        const overlapsSecondary = group.aspects.some((aspect) => secondaryAspects.includes(aspect));
        if (overlapsLee && gust >= maxWindGustMph * 0.55) {
          level = maxLevel(level, gust >= maxWindGustMph ? 'avoid' : 'caution');
          reasons.push('Aspect overlaps the primary wind-loading direction.');
        } else if (overlapsSecondary && gust >= maxWindGustMph * 0.7) {
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

  const lowerRiskHourIndexes = rows.flatMap((_, hourIndex) => {
    const cells = lanes.map((lane) => lane.cells[hourIndex]).filter(Boolean);
    const lowerCount = cells.filter((cell) => cell.level === 'lower').length;
    return cells.length > 0 && lowerCount >= Math.ceil(cells.length / 2) ? [hourIndex] : [];
  });

  return {
    lanes,
    lowerRiskHourIndexes,
    explanation: avalancheEnabled
      ? 'Cells combine your hourly thresholds with forecast elevation estimates, active avalanche problem terrain, and wind-loading aspects.'
      : 'Cells combine your hourly thresholds with forecast elevation estimates and wind-exposure aspects.',
  };
};

/**
 * One terrain window per aspect, for drawing each slope on its own. The grouped
 * window puts every affected aspect in one lane, so a north avalanche problem
 * and a south lee slope would share a cell; here each aspect sees only the
 * problems and wind signals that reach it (or that name no aspect at all).
 */
const buildTerrainWindowByAspect = (input) => Object.fromEntries(ASPECT_ROSE_ORDER.map((aspect) => [aspect, buildTerrainWindow({
  ...input,
  avalancheProblems: input.avalancheProblems.filter((problem) => {
    const { aspects } = parseTerrainFromLocation(problem?.location);
    return aspects.size === 0 || aspects.has(aspect);
  }),
  leewardAspects: input.leewardAspects.filter((value) => value === aspect),
  secondaryAspects: input.secondaryAspects.filter((value) => value === aspect),
})]));

const featureEnabled = (report, key) => report?.featureFlags?.[key] !== false;

/**
 * The grouped terrain window for the planned hours, and each aspect's cells by
 * elevation. Avalanche
 * terrain and wind loading count only where the report shows them, and lee
 * aspects only when there is snow for the wind to move.
 */
const buildTerrainView = (report, { rows, avalanche, windLoading, limits }) => {
  const avalancheDetails = featureEnabled(report, 'avalancheDetails');
  const showWindLoading = featureEnabled(report, 'windLoadingDetails') && Boolean(windLoading?.applies);
  const input = {
    rows,
    elevationBands: Array.isArray(report?.weather?.elevationForecast) ? report.weather.elevationForecast : [],
    avalancheProblems: avalancheDetails && Array.isArray(report?.avalanche?.problems) ? report.avalanche.problems : [],
    avalancheRelevant: avalancheDetails && avalanche.relevant,
    avalancheUnknown: avalancheDetails && avalanche.unknown,
    avalancheDanger: avalancheDetails ? avalanche.overallLevel : null,
    leewardAspects: showWindLoading ? windLoading.leewardAspects : [],
    secondaryAspects: showWindLoading ? windLoading.secondaryAspects : [],
    maxWindGustMph: limits.maxWindGustMph,
  };
  // Each aspect keeps only its own lanes: its cells at each elevation.
  const byAspect = Object.fromEntries(Object.entries(buildTerrainWindowByAspect(input)).map(([aspect, view]) => [
    aspect,
    view.lanes.filter((lane) => lane.aspects.includes(aspect)).map((lane) => ({ elevationFt: lane.elevationFt, cells: lane.cells })),
  ]));
  return { grouped: buildTerrainWindow(input), byAspect };
};

module.exports = {
  estimateAtElevation,
  rebaseElevationBands,
  buildElevationByHour,
  buildTerrainWindow,
  buildTerrainWindowByAspect,
  buildTerrainView,
};
