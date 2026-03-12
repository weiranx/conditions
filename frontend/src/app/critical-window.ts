import type { CriticalRiskLevel, WeatherTrendPoint } from './types';

export function assessCriticalWindowPoint(point: WeatherTrendPoint): { level: CriticalRiskLevel; reasons: string[]; score: number } {
  const reasons: string[] = [];
  let score = 0;
  const condition = String(point.condition || '').toLowerCase();
  const gust = Number(point.gust);
  const wind = Number(point.wind);
  const temp = Number(point.temp);
  const precipChance = Number(point.precipChance);

  if (/thunder|storm|lightning|hail|blizzard/.test(condition)) {
    score += 4;
    reasons.push('convective storm signal');
  }
  if (/snow|sleet|freezing|ice|wintry/.test(condition)) {
    score += 2;
    reasons.push('winter precip signal');
  } else if (/rain|shower/.test(condition)) {
    score += 1;
    reasons.push('precipitation signal');
  }
  if (Number.isFinite(precipChance) && precipChance >= 70) {
    score += 2;
    reasons.push(`precip ${Math.round(precipChance)}%`);
  } else if (Number.isFinite(precipChance) && precipChance >= 45) {
    score += 1;
    reasons.push(`precip ${Math.round(precipChance)}%`);
  }

  if (Number.isFinite(gust) && gust >= 45) {
    score += 4;
    reasons.push(`gusts ${Math.round(gust)} mph`);
  } else if (Number.isFinite(gust) && gust >= 35) {
    score += 2;
    reasons.push(`gusts ${Math.round(gust)} mph`);
  } else if (Number.isFinite(wind) && wind >= 25) {
    score += 1;
    reasons.push(`wind ${Math.round(wind)} mph`);
  }

  if (Number.isFinite(temp) && temp <= 10) {
    score += 1;
    reasons.push(`cold ${Math.round(temp)}F`);
  }

  if (score >= 6) {
    return { level: 'high', reasons, score };
  }
  if (score >= 3) {
    return { level: 'watch', reasons, score };
  }
  return { level: 'stable', reasons, score };
}

export function criticalRiskLevelText(level: CriticalRiskLevel): string {
  if (level === 'high') return 'High Risk';
  if (level === 'watch') return 'Watch';
  return 'Stable';
}
