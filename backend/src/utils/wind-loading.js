'use strict';

// Wind loading: how hard the travel window's wind moves snow onto lee slopes,
// which aspects it loads, and whether those aspects overlap the avalanche
// problems in the current bulletin.

const { formatClockForStyle, formatWind } = require('./display-format');
const {
  leewardAspectsFromWind,
  parseTerrainFromLocation,
  secondaryCrossLoadingAspects,
  windDirectionToDegrees,
} = require('./avalanche-terrain');
const { toFiniteOrNull } = require('./numbers');

const normalizeWindHintDirection = (value) => {
  if (!value) return null;
  const normalized = String(value).trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === 'VARIABLE') return 'VRB';
  if (normalized === 'VRB' || normalized === 'CALM') return normalized;
  return windDirectionToDegrees(normalized) === null ? null : normalized;
};

const windDirectionDeltaDegrees = (a, b) => {
  const aDeg = windDirectionToDegrees(a || null);
  const bDeg = windDirectionToDegrees(b || null);
  if (aDeg === null || bDeg === null) return null;
  const diff = Math.abs(aDeg - bDeg) % 360;
  return diff > 180 ? 360 - diff : diff;
};

const directional = (direction) => Boolean(direction) && direction !== 'CALM' && direction !== 'VRB';

/** The most common usable wind direction across the trend. */
const resolveDominantTrendWindDirection = (trend) => {
  const directions = (Array.isArray(trend) ? trend : [])
    .map((row) => normalizeWindHintDirection(row?.windDirection))
    .filter(directional);
  if (directions.length === 0) return { direction: null, count: 0, total: 0, ratio: 0 };
  const counts = new Map();
  directions.forEach((direction) => counts.set(direction, (counts.get(direction) || 0) + 1));
  const [direction, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { direction, count, total: directions.length, ratio: count / directions.length };
};

/** A measured snowpack at any station or the grid: there is snow for the wind to move. */
const hasSnowpackSignal = (snowpack) => [
  snowpack?.snotel?.snowDepthIn, snowpack?.nohrsc?.snowDepthIn, snowpack?.cdec?.snowDepthIn,
  snowpack?.snotel?.sweIn, snowpack?.nohrsc?.sweIn, snowpack?.cdec?.sweIn,
].some((value) => {
  const numeric = toFiniteOrNull(value);
  return numeric !== null && numeric > 0;
});

const LEVEL_TEXT = {
  Severe: {
    elevationFocus: 'Above and near treeline are primary hazard zones. Expect rapid slab growth on lee ridges, rollovers, and gully walls.',
    action: 'Route action: stay off lee convexities and cross-loaded start zones; use sheltered, lower-angle terrain and turn around if fresh slabs or shooting cracks appear.',
    fieldCues: 'Field cues: rapid cornice growth, hollow slab feel, and fresh drifts extending farther below ridges.',
  },
  Active: {
    elevationFocus: 'Focus near and above treeline, plus connected terrain below loaded start zones.',
    action: 'Route action: minimize ridgeline exposure, stay out of terrain traps below lee start zones, and retreat if active drifting or cracking appears.',
    fieldCues: 'Field cues: fresh drift pillows, shooting cracks, and wind-textured snow near lee features.',
  },
  Localized: {
    elevationFocus: 'Loading likely stays localized around exposed ridges, terrain breaks, and cross-loaded gully features.',
    action: 'Route action: check small, low-consequence features for stiff drifted snow before steeper terrain; avoid any pillow that cracks or sounds hollow.',
    fieldCues: 'Field cues: isolated drift pockets near gully walls, sub-ridges, and convex terrain breaks.',
  },
  Minimal: {
    elevationFocus: 'Wind transport is limited; drift pockets can still form near ridgelines.',
    action: 'Route action: broad wind loading is unlikely, but still check for isolated stiff drifts near ridges and terrain breaks.',
    fieldCues: null,
  },
};

/**
 * @param {object} report
 * @param {object[]} trendWindow the travel window's hourly readings
 * @param {{ units: object }} context
 */
const buildWindLoading = (report, trendWindow, { units }) => {
  const weather = report?.weather || {};
  const rows = Array.isArray(trendWindow) ? trendWindow : [];
  const speedOf = (point) => toFiniteOrNull(point?.wind);
  const gustOf = (point) => toFiniteOrNull(point?.gust);
  const transportAt = (point, windMin, gustMin) => {
    const wind = speedOf(point);
    const gust = gustOf(point);
    return (wind !== null && wind >= windMin) || (gust !== null && gust >= gustMin);
  };

  const primaryWindDirection = normalizeWindHintDirection(weather.windDirection || null);
  const trendWindDirections = rows.map((point) => normalizeWindHintDirection(point?.windDirection || null)).filter(Boolean);
  const directionalTrendWindDirections = trendWindDirections.filter(directional);
  const dominant = resolveDominantTrendWindDirection(rows);
  const primaryDirectional = directional(primaryWindDirection);
  const resolvedWindDirection = primaryDirectional ? primaryWindDirection : dominant.direction;
  const directionSource = primaryDirectional
    ? 'Selected start hour'
    : dominant.direction ? `Trend consensus (${dominant.count}/${dominant.total}h)` : 'Unavailable';
  const leewardAspects = resolvedWindDirection ? leewardAspectsFromWind(resolvedWindDirection) : [];
  const secondaryAspects = resolvedWindDirection ? secondaryCrossLoadingAspects(resolvedWindDirection) : [];
  const leewardSet = new Set(leewardAspects);
  const aspectOverlapProblems = (report?.avalanche?.problems || [])
    .filter((problem) => problem?.location && [...parseTerrainFromLocation(problem.location).aspects].some((aspect) => leewardSet.has(aspect)))
    .map((problem) => problem.name ?? 'Unknown Problem');

  const windSpeedMph = toFiniteOrNull(weather.windSpeed);
  const windGustMph = toFiniteOrNull(weather.windGust);
  const calmOrVariable = primaryWindDirection === 'CALM' || primaryWindDirection === 'VRB';
  const lightWind = windSpeedMph !== null && windGustMph !== null && windSpeedMph <= 5 && windGustMph <= 10;
  const transportHours = rows.filter((point) => transportAt(point, 12, 18)).length;
  const activeHours = rows.filter((point) => transportAt(point, 18, 28)).length;
  const severeHours = rows.filter((point) => transportAt(point, 25, 38)).length;

  const activeSpans = [];
  let spanStart = null;
  rows.forEach((point, index) => {
    const active = transportAt(point, 18, 28);
    if (active && spanStart === null) spanStart = index;
    const isEnd = index === rows.length - 1;
    if (spanStart !== null && (!active || isEnd)) {
      const spanEnd = active && isEnd ? index : index - 1;
      if (spanEnd >= spanStart) activeSpans.push({ start: spanStart, end: spanEnd });
      spanStart = null;
    }
  });
  const clock = (index) => formatClockForStyle(rows[index]?.time || '', units.timeStyle);
  const activeHourLabels = activeSpans.map(({ start, end }) => (start === end ? clock(start) : `${clock(start)}–${clock(end)}`));
  const activeHoursDetail = rows.length === 0
    ? 'No trend hours available'
    : activeHourLabels.length > 0 ? activeHourLabels.join(' • ') : 'No active hours in selected window';

  const directionalCoverageRatio = trendWindDirections.length > 0
    ? directionalTrendWindDirections.length / trendWindDirections.length
    : null;
  const agreementRatio = resolvedWindDirection && directionalTrendWindDirections.length > 0
    ? directionalTrendWindDirections.filter((direction) => {
      const delta = windDirectionDeltaDegrees(direction, resolvedWindDirection);
      return delta !== null && delta <= 45;
    }).length / directionalTrendWindDirections.length
    : null;
  const atLeast = (value, min) => value !== null && value >= min;

  let level = 'Minimal';
  if (!calmOrVariable && !lightWind) {
    if (atLeast(windSpeedMph, 28) || atLeast(windGustMph, 40) || severeHours >= 2) level = 'Severe';
    else if (atLeast(windSpeedMph, 20) || atLeast(windGustMph, 30) || activeHours >= 2) level = 'Active';
    else if (atLeast(windSpeedMph, 12) || atLeast(windGustMph, 18) || transportHours >= 1) level = 'Localized';
  }

  let confidence = 'Low';
  if (level !== 'Minimal' && resolvedWindDirection) {
    if (agreementRatio !== null && agreementRatio >= 0.7
      && directionalCoverageRatio !== null && directionalCoverageRatio >= 0.5
      && (atLeast(windSpeedMph, 14) || atLeast(windGustMph, 22))) {
      confidence = 'High';
    } else if ((agreementRatio !== null && agreementRatio >= 0.45)
      || (dominant.ratio >= 0.35 && dominant.total >= 3)
      || atLeast(windSpeedMph, 10)
      || atLeast(windGustMph, 16)) {
      confidence = 'Moderate';
    }
  }

  const tone = level === 'Minimal'
    ? 'go'
    : level === 'Severe' ? 'nogo' : level === 'Active' ? (confidence === 'High' ? 'nogo' : 'caution') : 'watch';
  const wind = (value) => formatWind(value, units.wind);
  const summary = calmOrVariable
    ? `Winds are ${primaryWindDirection === 'CALM' ? 'calm' : 'variable'}. Broad loading is unlikely, but localized drifts can still form around terrain breaks.`
    : lightWind
      ? 'Winds are light at the selected start window. Broad loading is less likely, but small drift pockets can still form.'
      : resolvedWindDirection
        ? `${level} transport signal: wind from ${resolvedWindDirection} at ${wind(weather.windSpeed)} (gust ${wind(weather.windGust)}). Primary lee aspects: ${leewardAspects.join(', ') || 'unknown'}.`
        : `${level} transport signal, but direction is uncertain. Infer loading from field clues (fresh cornices, drift pillows, textured snow).`;
  const notes = [
    `Direction source: ${directionSource}.`,
    trendWindDirections.length > 0 && directionalCoverageRatio !== null
      ? `Directional coverage: ${Math.round(directionalCoverageRatio * 100)}% of trend hours reported usable direction.`
      : 'Directional coverage: not enough trend direction data.',
    directionalTrendWindDirections.length > 0 && agreementRatio !== null
      ? `Trend agreement: ${Math.round(agreementRatio * 100)}% of ${directionalTrendWindDirections.length} nearby ${directionalTrendWindDirections.length === 1 ? 'hour aligns' : 'hours align'} within 45 degrees.`
      : 'Trend agreement: not enough directional trend data.',
    rows.length > 0
      ? `Active loading window: active wind transport in ${activeHours} of ${rows.length} ${rows.length === 1 ? 'hour' : 'hours'} (${activeHoursDetail}).`
      : null,
    secondaryAspects.length > 0 && atLeast(windGustMph, 20)
      ? `Secondary cross-loading possible on ${secondaryAspects.join(', ')} aspects.`
      : null,
    !resolvedWindDirection && atLeast(windSpeedMph, 10)
      ? 'Stronger winds with missing direction: treat all lee start zones as suspect until confirmed in the field.'
      : null,
    LEVEL_TEXT[level].fieldCues,
  ].filter(Boolean);
  // Wind loading is an avalanche mechanism: it matters only with snow to move.
  const applies = Boolean(report?.avalanche && report.avalanche.relevant !== false) || hasSnowpackSignal(report?.snowpack);

  return {
    primaryWindDirection,
    resolvedWindDirection,
    directionSource,
    trendWindDirections,
    leewardAspects,
    secondaryAspects,
    aspectOverlapProblems,
    calmOrVariable,
    lightWind,
    transportHours,
    activeHours,
    severeHours,
    agreementRatio,
    level,
    confidence,
    tone,
    activeWindowLabel: rows.length > 0 ? `${activeHours}/${rows.length} h active` : 'N/A',
    activeHoursDetail,
    elevationFocus: LEVEL_TEXT[level].elevationFocus,
    actionLine: LEVEL_TEXT[level].action,
    summary,
    notes,
    applies,
    hintsRelevant: applies && Boolean(resolvedWindDirection),
  };
};

/** The caution a decision gains when the wind loads the bulletin's problem aspects. */
const windLoadingOverlapCaution = (windLoading) => (windLoading?.aspectOverlapProblems?.length
  ? `Wind loading aligns with active avalanche problem aspects (${windLoading.aspectOverlapProblems.join(', ')}). Current winds may be actively building slabs on these aspects.`
  : null);

module.exports = {
  normalizeWindHintDirection,
  windDirectionDeltaDegrees,
  resolveDominantTrendWindDirection,
  hasSnowpackSignal,
  buildWindLoading,
  windLoadingOverlapCaution,
};
