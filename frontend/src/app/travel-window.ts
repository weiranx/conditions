import type {
  TimeStyle,
  TravelWindowInsights,
  TravelWindowRow,
  TravelWindowSpan,
  UserPreferences,
  WeatherTrendPoint,
} from './types';
import {
  convertWindMphToDisplayValue,
  formatClockForStyle,
  formatTemperatureForUnit,
} from './core';
import { computeFeelsLikeF } from './planner-helpers';

export interface TravelWindowContext {
  snowDepthIn?: number | null;
}

export function buildTravelWindowRows(trend: WeatherTrendPoint[], preferences: UserPreferences, context?: TravelWindowContext): TravelWindowRow[] {
  const maxGust = preferences.maxWindGustMph;
  const maxPrecip = preferences.maxPrecipChance;
  const minFeelsLike = preferences.minFeelsLikeF;
  const maxFeelsLike = preferences.maxFeelsLikeF;

  return trend.map((point) => {
    const gust = Number.isFinite(Number(point.gust)) ? Number(point.gust) : 0;
    const wind = Number.isFinite(Number(point.wind)) ? Number(point.wind) : 0;
    const temp = Number.isFinite(Number(point.temp)) ? Number(point.temp) : 0;
    const feelsLike = computeFeelsLikeF(temp, wind);
    const precipChance = Number.isFinite(Number(point.precipChance)) ? Number(point.precipChance) : 0;
    const failedRules: string[] = [];
    const failedRuleLabels: string[] = [];
    const displayGust = Math.round(convertWindMphToDisplayValue(gust, preferences.windSpeedUnit));
    const displayMaxGust = Math.round(convertWindMphToDisplayValue(maxGust, preferences.windSpeedUnit));
    const displayFeelsLike = formatTemperatureForUnit(feelsLike, preferences.temperatureUnit);
    const displayMinFeelsLike = formatTemperatureForUnit(minFeelsLike, preferences.temperatureUnit);
    const displayMaxFeelsLike = formatTemperatureForUnit(maxFeelsLike, preferences.temperatureUnit);

    if (gust > maxGust) {
      failedRules.push(`gust ${displayGust}>${displayMaxGust} ${preferences.windSpeedUnit}`);
      failedRuleLabels.push('Gust above limit');
    }
    if (precipChance > maxPrecip) {
      failedRules.push(`precip ${Math.round(precipChance)}%>${maxPrecip}%`);
      failedRuleLabels.push('Precip above limit');
    }
    if (feelsLike < minFeelsLike) {
      failedRules.push(`feels ${displayFeelsLike}<${displayMinFeelsLike}`);
      failedRuleLabels.push('Feels-like below limit');
    }
    if (feelsLike > maxFeelsLike) {
      failedRules.push(`feels ${displayFeelsLike}>${displayMaxFeelsLike}`);
      failedRuleLabels.push('Heat above limit');
    }
    const condLower = String(point.condition || '').toLowerCase();
    const lightningRisk = /thunder|lightning/.test(condLower);
    if (/thunder|lightning|hail|blizzard/.test(condLower)) {
      failedRules.push(`condition: ${point.condition}`);
      failedRuleLabels.push('Severe weather risk');
    }

    const snowDepth = context?.snowDepthIn;
    if (Number.isFinite(snowDepth) && (snowDepth as number) >= 12) {
      failedRules.push(`snow depth ${Math.round(snowDepth as number)}in`);
      failedRuleLabels.push('Deep snow / postholing risk');
    }

    return {
      time: point.time,
      pass: failedRules.length === 0,
      condition: String(point.condition || '').trim() || 'Unknown',
      reasonSummary: failedRules.length === 0 ? 'Meets thresholds' : failedRules.join(' \u2022 '),
      failedRules,
      failedRuleLabels,
      temp,
      feelsLike,
      wind,
      gust,
      precipChance,
      lightningRisk,
    };
  });
}

export function deriveTravelWindowSpans(rows: TravelWindowRow[]): TravelWindowSpan[] {
  const spans: TravelWindowSpan[] = [];
  let startIndex = -1;

  rows.forEach((row, idx) => {
    if (row.pass && startIndex === -1) {
      startIndex = idx;
    }
    const spanEnded = startIndex !== -1 && (!row.pass || idx === rows.length - 1);
    if (!spanEnded) {
      return;
    }
    const endIndex = row.pass ? idx : idx - 1;
    const length = endIndex - startIndex + 1;
    if (length > 0) {
      spans.push({ start: rows[startIndex].time, end: rows[endIndex].time, length });
    }
    startIndex = -1;
  });

  return spans;
}

export function formatTravelWindowSpan(span: TravelWindowSpan, timeStyle: TimeStyle): string {
  const start = formatClockForStyle(span.start, timeStyle);
  const end = formatClockForStyle(span.end, timeStyle);
  if (span.length <= 1) {
    return `${start} only`;
  }
  return `${start} to ${end}`;
}

export function buildTravelWindowInsights(rows: TravelWindowRow[], timeStyle: TimeStyle = 'ampm'): TravelWindowInsights {
  const computeConditionTrend = () => {
    if (rows.length === 0) {
      return {
        conditionTrendLabel: 'Unavailable',
        conditionTrendSummary: 'No hourly weather condition labels available in this travel window.',
      };
    }

    const startCondition = rows[0].condition;
    const endCondition = rows[rows.length - 1].condition;
    const normalizedCounts = new Map<string, { label: string; count: number }>();
    rows.forEach((row) => {
      const label = String(row.condition || '').trim() || 'Unknown';
      const key = label.toLowerCase();
      const existing = normalizedCounts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        normalizedCounts.set(key, { label, count: 1 });
      }
    });

    const dominant = Array.from(normalizedCounts.values()).sort((a, b) => (b.count === a.count ? a.label.localeCompare(b.label) : b.count - a.count))[0];
    const transitioned = startCondition.toLowerCase() !== endCondition.toLowerCase();

    if (!transitioned) {
      return {
        conditionTrendLabel: 'Stable conditions',
        conditionTrendSummary: `${startCondition} remains the primary condition (${dominant.count}/${rows.length}h).`,
      };
    }

    return {
      conditionTrendLabel: `${startCondition} \u2192 ${endCondition}`,
      conditionTrendSummary: `Conditions shift across the window; most frequent: ${dominant.label} (${dominant.count}/${rows.length}h).`,
    };
  };

  const computeTravelTrend = () => {
    if (rows.length < 2) {
      return {
        trendDirection: 'steady' as const,
        trendStrength: 'slight' as const,
        trendDelta: 0,
        trendLabel: 'Steady',
        trendSummary: 'Not enough hourly rows to classify improving vs worsening trend.',
      };
    }

    const riskScores = rows.map((row) => {
      if (row.pass) {
        return 0;
      }
      let score = Math.max(1, row.failedRuleLabels.length);
      row.failedRuleLabels.forEach((label) => {
        const normalized = String(label || '').toLowerCase();
        if (normalized.includes('gust') || normalized.includes('wind')) score += 1.1;
        if (normalized.includes('precip')) score += 1.0;
        if (normalized.includes('feels-like') || normalized.includes('cold')) score += 0.8;
        if (normalized.includes('heat')) score += 1.0;
        if (normalized.includes('snow') || normalized.includes('posthol')) score += 0.8;
        if (normalized.includes('lightning') || normalized.includes('severe')) score += 1.5;
      });
      return score;
    });

    const segmentHours = Math.max(2, Math.min(6, Math.floor(rows.length / 3) || 2));
    const startSlice = riskScores.slice(0, segmentHours);
    const endSlice = riskScores.slice(-segmentHours);
    const avg = (values: number[]) => (values.length ? values.reduce((acc, value) => acc + value, 0) / values.length : 0);
    const startAvg = avg(startSlice);
    const endAvg = avg(endSlice);
    const delta = endAvg - startAvg;
    const absDelta = Math.abs(delta);
    const strength: TravelWindowInsights['trendStrength'] = absDelta >= 2 ? 'strong' : absDelta >= 1.1 ? 'moderate' : 'slight';

    if (delta >= 0.6) {
      return {
        trendDirection: 'worsening' as const,
        trendStrength: strength,
        trendDelta: delta,
        trendLabel: `Worsening (${strength})`,
        trendSummary: `Risk trend worsens from first ${segmentHours}h to last ${segmentHours}h.`,
      };
    }
    if (delta <= -0.6) {
      return {
        trendDirection: 'improving' as const,
        trendStrength: strength,
        trendDelta: delta,
        trendLabel: `Improving (${strength})`,
        trendSummary: `Risk trend improves from first ${segmentHours}h to last ${segmentHours}h.`,
      };
    }
    return {
      trendDirection: 'steady' as const,
      trendStrength: strength,
      trendDelta: delta,
      trendLabel: 'Steady',
      trendSummary: `Risk trend is mostly steady across first/last ${segmentHours}h segments.`,
    };
  };

  const trend = computeTravelTrend();
  const conditionTrend = computeConditionTrend();

  if (rows.length === 0) {
    return {
      passHours: 0,
      failHours: 0,
      bestWindow: null,
      nextCleanWindow: null,
      topFailureLabels: [],
      trendDirection: trend.trendDirection,
      trendStrength: trend.trendStrength,
      trendDelta: trend.trendDelta,
      trendLabel: trend.trendLabel,
      trendSummary: trend.trendSummary,
      conditionTrendLabel: conditionTrend.conditionTrendLabel,
      conditionTrendSummary: conditionTrend.conditionTrendSummary,
      summary: 'No hourly trend data available for travel-window analysis.',
    };
  }

  const passHours = rows.filter((row) => row.pass).length;
  const failHours = rows.length - passHours;
  const spans = deriveTravelWindowSpans(rows);
  const bestWindow =
    spans.length > 0
      ? spans.slice().sort((a, b) => (b.length === a.length ? a.start.localeCompare(b.start) : b.length - a.length))[0]
      : null;
  const nextCleanWindow = spans.length > 0 ? spans[0] : null;

  const failureCounts = new Map<string, number>();
  rows
    .filter((row) => !row.pass)
    .forEach((row) => {
      row.failedRuleLabels.forEach((label) => {
        failureCounts.set(label, (failureCounts.get(label) || 0) + 1);
      });
    });

  const topFailureLabels = Array.from(failureCounts.entries())
    .sort((a, b) => (b[1] === a[1] ? a[0].localeCompare(b[0]) : b[1] - a[1]))
    .slice(0, 3)
    .map(([label, count]) => `${label} (${count}h)`);

  if (passHours === 0) {
    return {
      passHours,
      failHours,
      bestWindow,
      nextCleanWindow,
      topFailureLabels,
      trendDirection: trend.trendDirection,
      trendStrength: trend.trendStrength,
      trendDelta: trend.trendDelta,
      trendLabel: trend.trendLabel,
      trendSummary: trend.trendSummary,
      conditionTrendLabel: conditionTrend.conditionTrendLabel,
      conditionTrendSummary: conditionTrend.conditionTrendSummary,
      summary: `No clean travel window in the next ${rows.length} hours under current thresholds. ${trend.trendSummary}`,
    };
  }

  if (!bestWindow) {
    return {
      passHours,
      failHours,
      bestWindow,
      nextCleanWindow,
      topFailureLabels,
      trendDirection: trend.trendDirection,
      trendStrength: trend.trendStrength,
      trendDelta: trend.trendDelta,
      trendLabel: trend.trendLabel,
      trendSummary: trend.trendSummary,
      conditionTrendLabel: conditionTrend.conditionTrendLabel,
      conditionTrendSummary: conditionTrend.conditionTrendSummary,
      summary: `Passing ${passHours}/${rows.length} hours. ${trend.trendSummary}`,
    };
  }

  const spanLabel = formatTravelWindowSpan(bestWindow, timeStyle);
  const baseSummary = `Passing ${passHours}/${rows.length} hours. Best continuous window: ${spanLabel} (${bestWindow.length}h).`;
  if (nextCleanWindow && nextCleanWindow.start !== rows[0].time) {
    return {
      passHours,
      failHours,
      bestWindow,
      nextCleanWindow,
      topFailureLabels,
      trendDirection: trend.trendDirection,
      trendStrength: trend.trendStrength,
      trendDelta: trend.trendDelta,
      trendLabel: trend.trendLabel,
      trendSummary: trend.trendSummary,
      conditionTrendLabel: conditionTrend.conditionTrendLabel,
      conditionTrendSummary: conditionTrend.conditionTrendSummary,
      summary: `${baseSummary} First clean hour starts at ${formatClockForStyle(nextCleanWindow.start, timeStyle)}. ${trend.trendSummary}`,
    };
  }

  return {
    passHours,
    failHours,
    bestWindow,
    nextCleanWindow,
    topFailureLabels,
    trendDirection: trend.trendDirection,
    trendStrength: trend.trendStrength,
    trendDelta: trend.trendDelta,
    trendLabel: trend.trendLabel,
    trendSummary: trend.trendSummary,
    conditionTrendLabel: conditionTrend.conditionTrendLabel,
    conditionTrendSummary: conditionTrend.conditionTrendSummary,
    summary: `${baseSummary} ${trend.trendSummary}`,
  };
}

export function buildTrendWindowFromStart(trend: WeatherTrendPoint[], _startTime: string, windowSize = 12): WeatherTrendPoint[] {
  if (!Array.isArray(trend) || trend.length === 0) {
    return [];
  }
  // Backend trend is already aligned to the selected start time. Re-slicing by clock labels
  // can mis-handle midnight rollovers and locale-specific hour labels.
  return trend.slice(0, windowSize);
}
