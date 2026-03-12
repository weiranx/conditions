import { parseOptionalFiniteNumber } from './core';

export type VisibilityRiskLevel = 'Unknown' | 'Minimal' | 'Low' | 'Moderate' | 'High' | 'Extreme';

export type VisibilityRiskEstimate = {
  score: number | null;
  level: VisibilityRiskLevel;
  summary: string;
  factors: string[];
  activeHours: number | null;
  windowHours: number | null;
  source: string;
};

export function visibilityRiskPillClass(level: VisibilityRiskLevel): 'go' | 'watch' | 'caution' | 'nogo' {
  if (level === 'Extreme') return 'nogo';
  if (level === 'High' || level === 'Moderate') return 'caution';
  if (level === 'Low') return 'watch';
  if (level === 'Unknown') return 'watch';
  return 'go';
}

export function normalizeVisibilityRiskLevel(levelValue: string | null | undefined, scoreValue: number | null): VisibilityRiskLevel {
  const normalized = String(levelValue || '').trim().toLowerCase();
  if (normalized === 'extreme') return 'Extreme';
  if (normalized === 'high') return 'High';
  if (normalized === 'moderate') return 'Moderate';
  if (normalized === 'low') return 'Low';
  if (normalized === 'minimal') return 'Minimal';
  if (normalized === 'unknown') return 'Unknown';
  if (!Number.isFinite(Number(scoreValue))) return 'Unknown';
  const score = Number(scoreValue);
  if (score >= 80) return 'Extreme';
  if (score >= 60) return 'High';
  if (score >= 40) return 'Moderate';
  if (score >= 20) return 'Low';
  return 'Minimal';
}

export function estimateVisibilityRiskFromPoint(input: {
  description: string;
  precipChance: number | null;
  wind: number | null;
  gust: number | null;
  humidity: number | null;
  cloudCover: number | null;
  isDaytime: boolean | null | undefined;
}): VisibilityRiskEstimate {
  const description = String(input.description || '').toLowerCase();
  const precipChance = parseOptionalFiniteNumber(input.precipChance);
  const wind = parseOptionalFiniteNumber(input.wind);
  const gust = parseOptionalFiniteNumber(input.gust);
  const humidity = parseOptionalFiniteNumber(input.humidity);
  const cloudCover = parseOptionalFiniteNumber(input.cloudCover);
  const isDaytime = typeof input.isDaytime === 'boolean' ? input.isDaytime : null;

  const factors: string[] = [];
  let score = 0;
  const addRisk = (points: number, reason: string) => {
    if (points <= 0 || !reason) return;
    score += points;
    factors.push(reason);
  };

  if (/whiteout|blizzard|snow squall/.test(description)) {
    addRisk(55, 'blizzard/whiteout signal');
  } else if (/heavy snow|blowing snow|snow showers/.test(description)) {
    addRisk(30, 'reduced-visibility weather signal');
  } else if (/\bsnow\b/.test(description)) {
    addRisk(10, 'snow signal');
  } else if (/fog|mist|haze|smoke/.test(description)) {
    addRisk(30, 'reduced-visibility weather signal');
  } else if (/rain|drizzle|showers/.test(description)) {
    addRisk(10, 'precipitation signal');
  }

  if (precipChance !== null && precipChance >= 80) addRisk(20, `precip ${Math.round(precipChance)}%`);
  else if (precipChance !== null && precipChance >= 60) addRisk(14, `precip ${Math.round(precipChance)}%`);
  else if (precipChance !== null && precipChance >= 40) addRisk(8, `precip ${Math.round(precipChance)}%`);

  const effectiveWind = Math.max(wind ?? 0, gust ?? 0);
  if (effectiveWind >= 45) addRisk(18, `wind/gust ${Math.round(effectiveWind)} mph`);
  else if (effectiveWind >= 35) addRisk(12, `wind/gust ${Math.round(effectiveWind)} mph`);
  else if (effectiveWind >= 25) addRisk(7, `wind/gust ${Math.round(effectiveWind)} mph`);

  if (humidity !== null && cloudCover !== null && humidity >= 92 && cloudCover >= 92) {
    addRisk(16, 'high humidity + overcast');
  } else if (cloudCover !== null && cloudCover >= 85) {
    addRisk(5, `cloud cover ${Math.round(cloudCover)}%`);
  }

  if (isDaytime === false) {
    addRisk(6, 'nighttime contrast reduction');
  }

  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  const level = normalizeVisibilityRiskLevel(null, bounded);
  const summary =
    level === 'Extreme'
      ? 'Whiteout is plausible. Terrain reading can collapse quickly.'
      : level === 'High'
        ? 'Poor visibility likely; route-finding will be harder.'
        : level === 'Moderate'
          ? 'Intermittent low-contrast conditions are possible.'
          : level === 'Low'
            ? 'Mostly workable visibility with occasional reductions.'
            : level === 'Minimal'
              ? 'No strong whiteout signal at this hour.'
              : 'Visibility signal unavailable.';

  return {
    score: bounded,
    level,
    summary,
    factors: factors.slice(0, 3),
    activeHours: null,
    windowHours: null,
    source: 'Derived from selected weather hour',
  };
}
