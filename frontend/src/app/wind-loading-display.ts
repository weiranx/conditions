import type { SafetyData, TimeStyle, WeatherTrendPoint } from './types';
import {
  normalizeWindHintDirection,
  windDirectionDeltaDegrees,
  resolveDominantTrendWindDirection,
} from './wind-analysis';
import { formatClockForStyle } from './core';
import {
  leewardAspectsFromWind,
  parseTerrainFromLocation,
  secondaryCrossLoadingAspects,
} from '../utils/avalanche';

export interface WindLoadingDisplay {
  primaryWindDirection: string | null;
  resolvedWindDirection: string | null;
  resolvedWindDirectionSource: string;
  trendWindDirections: string[];
  directionalTrendWindDirections: string[];
  dominantTrendDirection: { direction: string | null; count: number; total: number; ratio: number };
  leewardAspectHints: string[];
  secondaryWindAspects: string[];
  aspectOverlapProblems: string[];
  windSpeedMph: number;
  windGustMph: number;
  calmOrVariableSignal: boolean;
  lightWindSignal: boolean;
  windTransportHours: number;
  activeTransportHours: number;
  severeTransportHours: number;
  trendDirectionalCoverageRatio: number | null;
  trendAgreementRatio: number | null;
  windLoadingLevel: 'Minimal' | 'Localized' | 'Active' | 'Severe';
  windLoadingConfidence: 'High' | 'Moderate' | 'Low';
  windLoadingPillClass: 'go' | 'watch' | 'caution' | 'nogo';
  windLoadingActiveWindowLabel: string;
  windLoadingActiveHoursDetail: string;
  windLoadingElevationFocus: string;
  windLoadingActionLine: string;
  windLoadingSummary: string;
  windLoadingNotes: string[];
  windLoadingHintsRelevant: boolean;
}

export function buildWindLoadingDisplay(
  safetyData: SafetyData | null,
  trendWindow: WeatherTrendPoint[],
  avalancheRelevant: boolean,
  formatWindDisplayFn: (value: number | null | undefined) => string,
  timeStyle: TimeStyle,
): WindLoadingDisplay {
  const primaryWindDirection = normalizeWindHintDirection(safetyData?.weather.windDirection || null);
  const windTrendRows = Array.isArray(trendWindow) ? trendWindow : [];
  const trendWindDirections = windTrendRows
    .map((point) => normalizeWindHintDirection(point?.windDirection || null))
    .filter((entry): entry is string => Boolean(entry));
  const directionalTrendWindDirections = trendWindDirections.filter((entry) => entry !== 'CALM' && entry !== 'VRB');
  const dominantTrendDirection = resolveDominantTrendWindDirection(windTrendRows);
  const resolvedWindDirection =
    primaryWindDirection && primaryWindDirection !== 'CALM' && primaryWindDirection !== 'VRB'
      ? primaryWindDirection
      : dominantTrendDirection.direction;
  const resolvedWindDirectionSource =
    primaryWindDirection && primaryWindDirection !== 'CALM' && primaryWindDirection !== 'VRB'
      ? 'Selected start hour'
      : dominantTrendDirection.direction
        ? `Trend consensus (${dominantTrendDirection.count}/${dominantTrendDirection.total}h)`
        : 'Unavailable';
  const leewardAspectHints = resolvedWindDirection ? leewardAspectsFromWind(resolvedWindDirection) : [];
  const secondaryWindAspects = resolvedWindDirection ? secondaryCrossLoadingAspects(resolvedWindDirection) : [];
  const leewardAspectSet = new Set(leewardAspectHints);
  const aspectOverlapProblems = (safetyData?.avalanche?.problems ?? [])
    .filter(p => {
      if (!p.location) return false;
      const { aspects } = parseTerrainFromLocation(p.location);
      return [...aspects].some(a => leewardAspectSet.has(a));
    })
    .map(p => p.name ?? 'Unknown Problem');
  const windSpeedMph = Number(safetyData?.weather.windSpeed);
  const windGustMph = Number(safetyData?.weather.windGust);
  const calmOrVariableSignal = primaryWindDirection === 'CALM' || primaryWindDirection === 'VRB';
  const lightWindSignal =
    Number.isFinite(windSpeedMph) &&
    Number.isFinite(windGustMph) &&
    windSpeedMph <= 5 &&
    windGustMph <= 10;
  const windTransportHours = windTrendRows.filter((point) => {
    const trendWind = Number(point?.wind);
    const trendGust = Number(point?.gust);
    return (Number.isFinite(trendWind) && trendWind >= 12) || (Number.isFinite(trendGust) && trendGust >= 18);
  }).length;
  const activeTransportHours = windTrendRows.filter((point) => {
    const trendWind = Number(point?.wind);
    const trendGust = Number(point?.gust);
    return (Number.isFinite(trendWind) && trendWind >= 18) || (Number.isFinite(trendGust) && trendGust >= 28);
  }).length;
  const activeTransportSpans = (() => {
    if (windTrendRows.length === 0) {
      return [] as Array<{ startIdx: number; endIdx: number; length: number }>;
    }
    const spans: Array<{ startIdx: number; endIdx: number; length: number }> = [];
    let startIdx: number | null = null;
    windTrendRows.forEach((point, idx) => {
      const trendWind = Number(point?.wind);
      const trendGust = Number(point?.gust);
      const isActive =
        (Number.isFinite(trendWind) && trendWind >= 18) ||
        (Number.isFinite(trendGust) && trendGust >= 28);
      if (isActive && startIdx === null) {
        startIdx = idx;
      }
      const isEnd = idx === windTrendRows.length - 1;
      if (startIdx !== null && (!isActive || isEnd)) {
        const endIdx = isActive && isEnd ? idx : idx - 1;
        if (endIdx >= startIdx) {
          spans.push({ startIdx, endIdx, length: endIdx - startIdx + 1 });
        }
        startIdx = null;
      }
    });
    return spans;
  })();
  const activeTransportHourLabels = activeTransportSpans.map((span) => {
    const startLabel = formatClockForStyle(windTrendRows[span.startIdx]?.time || '', timeStyle);
    const endLabel = formatClockForStyle(windTrendRows[span.endIdx]?.time || '', timeStyle);
    return span.length <= 1 || span.startIdx === span.endIdx ? startLabel : `${startLabel}–${endLabel}`;
  });
  const windLoadingActiveHoursDetail =
    windTrendRows.length === 0
      ? 'No trend hours available'
      : activeTransportHourLabels.length > 0
        ? activeTransportHourLabels.join(' • ')
        : 'No active hours in selected window';
  const severeTransportHours = windTrendRows.filter((point) => {
    const trendWind = Number(point?.wind);
    const trendGust = Number(point?.gust);
    return (Number.isFinite(trendWind) && trendWind >= 25) || (Number.isFinite(trendGust) && trendGust >= 38);
  }).length;
  const trendDirectionalCoverageRatio =
    trendWindDirections.length > 0 ? directionalTrendWindDirections.length / trendWindDirections.length : null;
  const trendAgreementRatio =
    resolvedWindDirection && directionalTrendWindDirections.length > 0
      ? directionalTrendWindDirections.filter((direction) => {
          const delta = windDirectionDeltaDegrees(direction, resolvedWindDirection);
          return delta !== null && delta <= 45;
        }).length / directionalTrendWindDirections.length
      : null;
  const windLoadingLevel: 'Minimal' | 'Localized' | 'Active' | 'Severe' = (() => {
    if (!safetyData || calmOrVariableSignal || lightWindSignal) {
      return 'Minimal';
    }
    if (
      (Number.isFinite(windSpeedMph) && windSpeedMph >= 28) ||
      (Number.isFinite(windGustMph) && windGustMph >= 40) ||
      severeTransportHours >= 2
    ) {
      return 'Severe';
    }
    if (
      (Number.isFinite(windSpeedMph) && windSpeedMph >= 20) ||
      (Number.isFinite(windGustMph) && windGustMph >= 30) ||
      activeTransportHours >= 2
    ) {
      return 'Active';
    }
    if (
      (Number.isFinite(windSpeedMph) && windSpeedMph >= 12) ||
      (Number.isFinite(windGustMph) && windGustMph >= 18) ||
      windTransportHours >= 1
    ) {
      return 'Localized';
    }
    return 'Minimal';
  })();
  const windLoadingConfidence: 'High' | 'Moderate' | 'Low' = (() => {
    if (!safetyData || windLoadingLevel === 'Minimal' || !resolvedWindDirection) {
      return 'Low';
    }
    if (
      trendAgreementRatio !== null &&
      trendAgreementRatio >= 0.7 &&
      trendDirectionalCoverageRatio !== null &&
      trendDirectionalCoverageRatio >= 0.5 &&
      ((Number.isFinite(windSpeedMph) && windSpeedMph >= 14) || (Number.isFinite(windGustMph) && windGustMph >= 22))
    ) {
      return 'High';
    }
    if (
      (trendAgreementRatio !== null && trendAgreementRatio >= 0.45) ||
      (dominantTrendDirection.ratio >= 0.35 && dominantTrendDirection.total >= 3) ||
      (Number.isFinite(windSpeedMph) && windSpeedMph >= 10) ||
      (Number.isFinite(windGustMph) && windGustMph >= 16)
    ) {
      return 'Moderate';
    }
    return 'Low';
  })();
  const windLoadingPillClass: 'go' | 'watch' | 'caution' | 'nogo' =
    !safetyData
      ? 'caution'
      : windLoadingLevel === 'Minimal'
        ? 'go'
        : windLoadingLevel === 'Severe'
          ? 'nogo'
          : windLoadingLevel === 'Active'
            ? windLoadingConfidence === 'High'
              ? 'nogo'
              : 'caution'
            : 'watch';
  const windLoadingActiveWindowLabel =
    windTrendRows.length > 0
      ? `${activeTransportHours}/${windTrendRows.length} h active`
      : 'N/A';
  const windLoadingElevationFocus =
    !safetyData
      ? 'Load forecast to see terrain focus.'
      : windLoadingLevel === 'Severe'
        ? 'Above and near treeline are primary hazard zones. Expect rapid slab growth on lee ridges, rollovers, and gully walls.'
        : windLoadingLevel === 'Active'
          ? 'Focus near and above treeline, plus connected terrain below loaded start zones.'
          : windLoadingLevel === 'Localized'
            ? 'Loading likely stays localized around exposed ridges, terrain breaks, and cross-loaded gully features.'
            : 'Wind transport is limited; drift pockets can still form near ridgelines.';
  const windLoadingActionLine =
    !safetyData
      ? ''
      : windLoadingLevel === 'Severe'
        ? 'Route action: avoid lee convexities and cross-loaded start zones; use sheltered, lower-angle terrain.'
        : windLoadingLevel === 'Active'
          ? 'Route action: keep ridgeline exposure short and avoid terrain traps beneath lee start zones.'
          : windLoadingLevel === 'Localized'
            ? 'Route action: probe small test slopes and watch for drifted pillows before committing to steeper terrain.'
            : 'Route action: wind loading is a secondary hazard, but still check for isolated drifts near ridges.';
  const windLoadingSummary =
    !safetyData
      ? 'Wind loading hints unavailable until a forecast is loaded.'
      : calmOrVariableSignal
        ? `Winds are ${primaryWindDirection === 'CALM' ? 'calm' : 'variable'}. Broad loading is unlikely, but localized drifts can still form around terrain breaks.`
        : lightWindSignal
          ? 'Winds are light at the selected start window. Broad loading is less likely, but small drift pockets can still form.'
          : resolvedWindDirection
            ? `${windLoadingLevel} transport signal: wind from ${resolvedWindDirection} at ${formatWindDisplayFn(
                safetyData.weather.windSpeed,
              )} (gust ${formatWindDisplayFn(safetyData.weather.windGust)}). Primary lee aspects: ${leewardAspectHints.join(', ') || 'unknown'}.`
            : `${windLoadingLevel} transport signal, but direction is uncertain. Infer loading from field clues (fresh cornices, drift pillows, textured snow).`;
  const windLoadingNotes = safetyData
    ? [
        `Direction source: ${resolvedWindDirectionSource}.`,
        trendWindDirections.length > 0 && trendDirectionalCoverageRatio !== null
          ? `Directional coverage: ${Math.round(trendDirectionalCoverageRatio * 100)}% of trend hours reported usable direction.`
          : 'Directional coverage: not enough trend direction data.',
        directionalTrendWindDirections.length > 0 && trendAgreementRatio !== null
          ? `Trend agreement: ${Math.round(trendAgreementRatio * 100)}% of ${directionalTrendWindDirections.length} nearby hour(s) align within 45 degrees.`
          : 'Trend agreement: not enough directional trend data.',
        windTrendRows.length > 0
          ? `Active loading window: ${activeTransportHours}/${windTrendRows.length} hour(s) show active wind-transport signal (${windLoadingActiveHoursDetail}).`
          : null,
        secondaryWindAspects.length > 0 && Number.isFinite(windGustMph) && windGustMph >= 20
          ? `Secondary cross-loading possible on ${secondaryWindAspects.join(', ')} aspects.`
          : null,
        !resolvedWindDirection && Number.isFinite(windSpeedMph) && windSpeedMph >= 10
          ? 'Stronger winds with missing direction: treat all lee start zones as suspect until confirmed in the field.'
          : null,
        windLoadingLevel === 'Severe'
          ? 'Field cues: rapid cornice growth, hollow slab feel, and fresh drifts extending farther below ridges.'
          : windLoadingLevel === 'Active'
            ? 'Field cues: fresh drift pillows, shooting cracks, and wind-textured snow near lee features.'
            : windLoadingLevel === 'Localized'
              ? 'Field cues: isolated drift pockets near gully walls, sub-ridges, and convex terrain breaks.'
              : null,
      ].filter((entry): entry is string => Boolean(entry))
    : [];
  const windLoadingHintsRelevant = avalancheRelevant || Boolean(resolvedWindDirection);

  // Note: aspectOverlapProblems and decision mutation are handled by the caller

  return {
    primaryWindDirection,
    resolvedWindDirection,
    resolvedWindDirectionSource,
    trendWindDirections,
    directionalTrendWindDirections,
    dominantTrendDirection,
    leewardAspectHints,
    secondaryWindAspects,
    aspectOverlapProblems,
    windSpeedMph,
    windGustMph,
    calmOrVariableSignal,
    lightWindSignal,
    windTransportHours,
    activeTransportHours,
    severeTransportHours,
    trendDirectionalCoverageRatio,
    trendAgreementRatio,
    windLoadingLevel,
    windLoadingConfidence,
    windLoadingPillClass,
    windLoadingActiveWindowLabel,
    windLoadingActiveHoursDetail,
    windLoadingElevationFocus,
    windLoadingActionLine,
    windLoadingSummary,
    windLoadingNotes,
    windLoadingHintsRelevant,
  };
}
