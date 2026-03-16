import type { SafetyData, ElevationUnit } from './types';

// --- Fire Risk ---

export interface FireRiskDisplay {
  level: number;
  label: string;
  pillClass: 'go' | 'watch' | 'caution' | 'nogo';
  alerts: Array<{ event?: string; headline?: string; severity?: string }>;
}

export function buildFireRiskDisplay(safetyData: SafetyData | null): FireRiskDisplay {
  const level = Number(safetyData?.fireRisk?.level);
  const label = safetyData?.fireRisk?.label || 'Low';
  const pillClass = !Number.isFinite(level)
    ? 'caution' as const
    : level >= 4
      ? 'nogo' as const
      : level >= 3
        ? 'caution' as const
        : level >= 2
          ? 'watch' as const
          : 'go' as const;
  const alerts = safetyData?.fireRisk?.alertsConsidered || [];
  return { level, label, pillClass, alerts };
}

// --- Heat Risk ---

export interface HeatRiskDisplay {
  level: number;
  label: string;
  pillClass: 'go' | 'watch' | 'caution' | 'nogo';
  guidance: string;
  reasons: string[];
  metrics: Record<string, unknown>;
  lowerTerrainLabel: string | null;
}

export function buildHeatRiskDisplay(
  safetyData: SafetyData | null,
  formatElevationDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean }) => string,
): HeatRiskDisplay {
  const payloadLevel = Number(safetyData?.heatRisk?.level);
  let level: number;
  if (Number.isFinite(payloadLevel)) {
    level = Math.max(0, Math.min(4, Math.round(payloadLevel)));
  } else {
    const feelsLike = Number(safetyData?.weather.feelsLike ?? safetyData?.weather.temp);
    if (Number.isFinite(feelsLike) && feelsLike >= 100) level = 4;
    else if (Number.isFinite(feelsLike) && feelsLike >= 92) level = 3;
    else if (Number.isFinite(feelsLike) && feelsLike >= 84) level = 2;
    else if (Number.isFinite(feelsLike) && feelsLike >= 76) level = 1;
    else level = 0;
  }

  const label = safetyData?.heatRisk?.label || ['Low', 'Guarded', 'Elevated', 'High', 'Extreme'][level];
  const pillClass =
    level >= 4 ? 'nogo' as const
      : level >= 2 ? 'caution' as const
        : level >= 1 ? 'watch' as const
          : 'go' as const;

  const guidance =
    safetyData?.heatRisk?.guidance ||
    (level >= 4
      ? 'Extreme heat-stress risk. Avoid long exposed pushes during this window.'
      : level >= 3
        ? 'High heat-stress risk. Increase water, shorten pushes, and add cooling breaks.'
        : level >= 2
          ? 'Heat stress is possible. Use conservative pace and hydration.'
          : level >= 1
            ? 'Warm conditions possible; monitor hydration and pace.'
            : 'No notable heat signal from current forecast inputs.');

  const reasons = Array.isArray(safetyData?.heatRisk?.reasons) && safetyData!.heatRisk!.reasons!.length > 0
    ? safetyData!.heatRisk!.reasons!.slice(0, 4)
    : [];
  const metrics = safetyData?.heatRisk?.metrics || {};

  const lowerTerrainLabel = (() => {
    const lbl = String((metrics as Record<string, unknown>).lowerTerrainLabel || '').trim();
    const elevationFt = Number((metrics as Record<string, unknown>).lowerTerrainElevationFt);
    if (!lbl && !Number.isFinite(elevationFt)) return null;
    if (lbl && Number.isFinite(elevationFt)) return `${lbl} (${formatElevationDisplay(elevationFt)})`;
    return lbl || formatElevationDisplay(elevationFt);
  })();

  return { level, label, pillClass, guidance, reasons, metrics, lowerTerrainLabel };
}

// --- Terrain Condition ---

export interface TerrainConditionDisplay {
  summary: string;
  reasons: string[];
  confidence: 'high' | 'medium' | 'low' | null;
  impact: string | null;
  recommendedTravel: string | null;
  snowProfile: { label: string; summary: string; reasons: string[]; confidence: 'high' | 'medium' | 'low' | null } | null;
  pillClass: 'go' | 'watch' | 'caution' | 'nogo';
}

export function buildTerrainConditionDisplay(safetyData: SafetyData | null): TerrainConditionDisplay {
  const upstreamTerrain = safetyData?.terrainCondition;
  const snowProfile = upstreamTerrain?.snowProfile
    ? {
        label: upstreamTerrain.snowProfile.label || 'Snow profile unavailable',
        summary: upstreamTerrain.snowProfile.summary || '',
        reasons: Array.isArray(upstreamTerrain.snowProfile.reasons) ? upstreamTerrain.snowProfile.reasons.slice(0, 4) : [],
        confidence: upstreamTerrain.snowProfile.confidence || null,
      }
    : null;

  let details: Omit<TerrainConditionDisplay, 'pillClass'>;
  if (safetyData && upstreamTerrain && (upstreamTerrain.summary || (Array.isArray(upstreamTerrain.reasons) && upstreamTerrain.reasons.length > 0))) {
    details = {
      summary: upstreamTerrain.summary || 'Surface classification is based on weather, precipitation totals, trend, and snowpack observations.',
      reasons: Array.isArray(upstreamTerrain.reasons) ? upstreamTerrain.reasons.slice(0, 6) : [],
      confidence: upstreamTerrain.confidence || null,
      impact: upstreamTerrain.impact || null,
      recommendedTravel: upstreamTerrain.recommendedTravel || null,
      snowProfile,
    };
  } else if (safetyData) {
    details = {
      summary: 'Surface classification is based on weather description, precip probability, rolling rain/snow totals, temperature trend, and available snowpack observations.',
      reasons: [],
      confidence: null,
      impact: null,
      recommendedTravel: null,
      snowProfile,
    };
  } else {
    details = {
      summary: 'Surface classification unavailable until a forecast is loaded.',
      reasons: [],
      confidence: null,
      impact: null,
      recommendedTravel: null,
      snowProfile: null,
    };
  }

  // Pill class
  const terrainCode = String(safetyData?.terrainCondition?.code || '').toLowerCase();
  let pillClass: 'go' | 'watch' | 'caution' | 'nogo';
  if (terrainCode === 'dry_firm') {
    pillClass = 'go';
  } else if (terrainCode === 'weather_unavailable') {
    pillClass = 'watch';
  } else if (['snow_ice', 'snow_fresh_powder', 'snow_mixed', 'spring_snow', 'wet_snow', 'wet_muddy', 'cold_slick', 'dry_loose'].includes(terrainCode)) {
    pillClass = 'caution';
  } else if (terrainCode) {
    pillClass = 'watch';
  } else {
    const normalized = String(safetyData?.terrainCondition?.label || safetyData?.trail || '').toLowerCase();
    if (!normalized) {
      pillClass = 'caution';
    } else if (/weather unavailable|partially unavailable|unknown/.test(normalized)) {
      pillClass = 'watch';
    } else if (/snow|icy|wet|muddy|slick/.test(normalized)) {
      pillClass = 'caution';
    } else {
      pillClass = 'go';
    }
  }

  return { ...details, pillClass };
}

// --- Snowpack Display ---

export interface SnowpackDisplayState {
  snotelSweDisplay: string;
  snotelDepthDisplay: string;
  nohrscSweDisplay: string;
  nohrscDepthDisplay: string;
  cdecSweDisplay: string;
  cdecDepthDisplay: string;
  cdecDistanceDisplay: string;
  snotelDistanceDisplay: string;
  pillClass: 'go' | 'watch' | 'caution';
  statusLabel: string;
  historicalPillClass: 'go' | 'watch' | 'caution';
  historicalStatusLabel: string;
  historicalComparisonLine: string;
  takeaways: string[];
  observationContext: string;
  metricAvailable: boolean;
  depthSignalValues: number[];
  sweSignalValues: number[];
  hasSignal: boolean;
}

export function buildSnowpackDisplayState(
  safetyData: SafetyData | null,
  formatSweForElevationUnit: (value: number | null | undefined, unit: ElevationUnit) => string,
  formatSnowDepthForElevationUnit: (value: number | null | undefined, unit: ElevationUnit) => string,
  formatDistanceForElevationUnit: (value: number | null | undefined, unit: ElevationUnit) => string,
  formatForecastPeriodLabel: (isoString?: string | null, timeZone?: string | null) => string,
  formatIsoDateLabel: (isoDate: string) => string,
  elevationUnit: ElevationUnit,
  snowpackInsights: { agreement: { tone: string }; representativeness: { tone: string }; freshness: { tone: string } } | null,
  snowfall24hIn: number,
  snowfall24hDisplay: string,
  rainfall24hIn: number,
  rainfall24hDisplay: string,
): SnowpackDisplayState {
  const snotelSweDisplay = formatSweForElevationUnit(Number(safetyData?.snowpack?.snotel?.sweIn), elevationUnit);
  const snotelDepthDisplay = formatSnowDepthForElevationUnit(Number(safetyData?.snowpack?.snotel?.snowDepthIn), elevationUnit);
  const nohrscSweDisplay = formatSweForElevationUnit(Number(safetyData?.snowpack?.nohrsc?.sweIn), elevationUnit);
  const nohrscDepthDisplay = formatSnowDepthForElevationUnit(Number(safetyData?.snowpack?.nohrsc?.snowDepthIn), elevationUnit);
  const cdecSweDisplay = formatSweForElevationUnit(Number(safetyData?.snowpack?.cdec?.sweIn), elevationUnit);
  const cdecDepthDisplay = formatSnowDepthForElevationUnit(Number(safetyData?.snowpack?.cdec?.snowDepthIn), elevationUnit);
  const cdecDistanceDisplay = formatDistanceForElevationUnit(Number(safetyData?.snowpack?.cdec?.distanceKm), elevationUnit);
  const snotelDistanceDisplay = formatDistanceForElevationUnit(Number(safetyData?.snowpack?.snotel?.distanceKm), elevationUnit);

  const snotelDepthIn = Number(safetyData?.snowpack?.snotel?.snowDepthIn);
  const nohrscDepthIn = Number(safetyData?.snowpack?.nohrsc?.snowDepthIn);
  const cdecDepthIn = Number(safetyData?.snowpack?.cdec?.snowDepthIn);
  const snotelSweIn = Number(safetyData?.snowpack?.snotel?.sweIn);
  const nohrscSweIn = Number(safetyData?.snowpack?.nohrsc?.sweIn);
  const cdecSweIn = Number(safetyData?.snowpack?.cdec?.sweIn);

  const metricAvailable =
    Number.isFinite(snotelDepthIn) || Number.isFinite(nohrscDepthIn) || Number.isFinite(cdecDepthIn) ||
    Number.isFinite(snotelSweIn) || Number.isFinite(nohrscSweIn) || Number.isFinite(cdecSweIn);

  const maxSnowDepthSignalIn = Math.max(
    Number.isFinite(snotelDepthIn) ? snotelDepthIn : 0,
    Number.isFinite(nohrscDepthIn) ? nohrscDepthIn : 0,
    Number.isFinite(cdecDepthIn) ? cdecDepthIn : 0,
  );
  const maxSnowSweSignalIn = Math.max(
    Number.isFinite(snotelSweIn) ? snotelSweIn : 0,
    Number.isFinite(nohrscSweIn) ? nohrscSweIn : 0,
    Number.isFinite(cdecSweIn) ? cdecSweIn : 0,
  );
  const lowBroadSnowSignal = metricAvailable && maxSnowDepthSignalIn <= 1 && maxSnowSweSignalIn <= 0.2;

  const pillClass = lowBroadSnowSignal
    ? 'go' as const
    : safetyData?.snowpack?.status === 'ok'
      ? 'go' as const
      : safetyData?.snowpack?.status === 'partial'
        ? 'watch' as const
        : 'caution' as const;
  const statusLabel = lowBroadSnowSignal ? 'Low snow signal' : String(safetyData?.snowpack?.status || 'unavailable').toUpperCase();

  // Historical
  const snowpackHistorical = safetyData?.snowpack?.historical || null;
  const histStatus = String(snowpackHistorical?.overall?.status || 'unknown').toLowerCase();
  const historicalPillClass =
    histStatus === 'above_average' ? 'caution' as const
      : histStatus === 'below_average' ? 'watch' as const
        : histStatus === 'at_average' ? 'go' as const
          : 'watch' as const;
  const historicalStatusLabel =
    histStatus === 'above_average' ? 'Above average'
      : histStatus === 'below_average' ? 'Below average'
        : histStatus === 'at_average' ? 'At average'
          : 'Comparison unavailable';

  const targetDateLabel = snowpackHistorical?.targetDate ? formatIsoDateLabel(snowpackHistorical.targetDate) : null;
  const metricLabel = String(snowpackHistorical?.overall?.metric || '').trim();
  const percent = typeof snowpackHistorical?.overall?.percentOfAverage === 'number' && Number.isFinite(snowpackHistorical.overall.percentOfAverage)
    ? snowpackHistorical.overall.percentOfAverage : null;
  const histSweCurrentDisplay = formatSweForElevationUnit(Number(snowpackHistorical?.swe?.currentIn ?? NaN), elevationUnit);
  const histSweAverageDisplay = formatSweForElevationUnit(Number(snowpackHistorical?.swe?.averageIn ?? NaN), elevationUnit);
  const histDepthCurrentDisplay = formatSnowDepthForElevationUnit(Number(snowpackHistorical?.depth?.currentIn ?? NaN), elevationUnit);
  const histDepthAverageDisplay = formatSnowDepthForElevationUnit(Number(snowpackHistorical?.depth?.averageIn ?? NaN), elevationUnit);

  const historicalComparisonLine = (() => {
    if (!snowpackHistorical) return 'Historical average unavailable for this selected date.';
    const metLine =
      metricLabel.toUpperCase() === 'SWE'
        ? `SWE ${histSweCurrentDisplay} vs avg ${histSweAverageDisplay}`
        : metricLabel.toLowerCase() === 'snow depth'
          ? `Depth ${histDepthCurrentDisplay} vs avg ${histDepthAverageDisplay}`
          : null;
    const percentLine = Number.isFinite(percent) ? `${percent}% of average` : null;
    const parts = [metLine, percentLine, targetDateLabel ? `for ${targetDateLabel}` : null].filter(Boolean);
    return parts.length > 0 ? parts.join(' • ') : 'Historical average unavailable for this selected date.';
  })();

  // Takeaways
  const takeaways: string[] = (() => {
    if (!safetyData) return [];
    const notes: string[] = [];
    if (!metricAvailable) {
      notes.push('No reliable snowpack metrics returned. Keep uncertainty high and verify terrain conditions directly.');
      return notes;
    }
    if (lowBroadSnowSignal) {
      notes.push('Broad snow signal is minimal. Non-snow travel is more likely, but shaded gullies and icy pockets can persist.');
    } else if (maxSnowDepthSignalIn >= 24 || maxSnowSweSignalIn >= 8) {
      notes.push('Substantial snowpack signal exists. Assume avalanche terrain remains consequential at and above treeline.');
    } else {
      notes.push('Measurable snowpack is present. Expect mixed coverage and elevation-dependent conditions.');
    }
    if (Number.isFinite(snowfall24hIn) && snowfall24hIn >= 4) {
      notes.push(`Recent snowfall is meaningful (${snowfall24hDisplay} in 24h). Treat prior tracks and old assumptions as stale.`);
    } else if (Number.isFinite(rainfall24hIn) && rainfall24hIn >= 0.5 && maxSnowDepthSignalIn >= 4) {
      notes.push(`Rain-on-snow signal (${rainfall24hDisplay} rain in 24h) can rapidly weaken surface conditions.`);
    }
    if (snowpackInsights?.agreement.tone === 'warn') {
      notes.push('SNOTEL and NOHRSC disagree strongly. Plan for localized variability and confirm conditions as you move.');
    } else if (snowpackInsights?.representativeness.tone === 'warn') {
      notes.push('Nearest SNOTEL may not represent your objective well due to distance/elevation mismatch.');
    } else if (snowpackInsights?.freshness.tone === 'warn') {
      notes.push('Snowpack timestamps are stale. Re-check center products before departure.');
    }
    return notes.slice(0, 3);
  })();

  // Observation context
  const observationContext = safetyData
    ? (() => {
        const parts = [
          safetyData.snowpack?.snotel?.observedDate ? `SNOTEL obs ${safetyData.snowpack.snotel.observedDate}` : null,
          safetyData.snowpack?.nohrsc?.sampledTime
            ? `NOHRSC sample ${formatForecastPeriodLabel(safetyData.snowpack.nohrsc.sampledTime, safetyData.weather.timezone || null)}`
            : null,
        ].filter(Boolean) as string[];
        if (parts.length === 0) return 'Using latest available snowpack observations.';
        return `Using observations: ${parts.join(' • ')}`;
      })()
    : '';

  const depthSignalValues = [
    Number(safetyData?.snowpack?.snotel?.snowDepthIn),
    Number(safetyData?.snowpack?.nohrsc?.snowDepthIn),
  ].filter((value) => Number.isFinite(value) && value > 0);
  const sweSignalValues = [
    Number(safetyData?.snowpack?.snotel?.sweIn),
    Number(safetyData?.snowpack?.nohrsc?.sweIn),
  ].filter((value) => Number.isFinite(value) && value > 0);
  const hasSignal = depthSignalValues.length > 0 || sweSignalValues.length > 0;

  return {
    snotelSweDisplay, snotelDepthDisplay,
    nohrscSweDisplay, nohrscDepthDisplay,
    cdecSweDisplay, cdecDepthDisplay,
    cdecDistanceDisplay, snotelDistanceDisplay,
    pillClass, statusLabel,
    historicalPillClass, historicalStatusLabel, historicalComparisonLine,
    takeaways, observationContext,
    metricAvailable, depthSignalValues, sweSignalValues, hasSignal,
  };
}
