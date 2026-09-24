'use strict';

// Scores each hour of the travel window for storm, precipitation, wind and
// cold signals, so the report can name the hour that most needs attention.

const { formatTemperature, formatWind, normalizeUnits } = require('./display-format');
const { toFiniteOrNull } = require('./numbers');

const assessCriticalWindowPoint = (point, rawUnits) => {
  const units = normalizeUnits(rawUnits);
  const reasons = [];
  let score = 0;
  const condition = String(point?.condition || '').toLowerCase();
  // A missing reading is not a calm, dry or 0 °F one.
  const gust = toFiniteOrNull(point?.gust);
  const wind = toFiniteOrNull(point?.wind);
  const temp = toFiniteOrNull(point?.temp);
  const precipChance = toFiniteOrNull(point?.precipChance);

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
  if (precipChance !== null && precipChance >= 70) {
    score += 2;
    reasons.push(`precip ${Math.round(precipChance)}%`);
  } else if (precipChance !== null && precipChance >= 45) {
    score += 1;
    reasons.push(`precip ${Math.round(precipChance)}%`);
  }
  if (gust !== null && gust >= 45) {
    score += 4;
    reasons.push(`gusts ${formatWind(gust, units.wind)}`);
  } else if (gust !== null && gust >= 35) {
    score += 2;
    reasons.push(`gusts ${formatWind(gust, units.wind)}`);
  } else if (wind !== null && wind >= 25) {
    score += 1;
    reasons.push(`wind ${formatWind(wind, units.wind)}`);
  }
  if (temp !== null && temp <= 10) {
    score += 1;
    reasons.push(`cold ${formatTemperature(temp, units.temperature)}`);
  }

  const level = score >= 6 ? 'high' : score >= 3 ? 'watch' : 'stable';
  return { level, reasons, score };
};

/** Each travel-window reading with its assessment, and the first highest-scoring hour. */
const buildCriticalWindow = (trendWindow, units) => {
  const hours = (Array.isArray(trendWindow) ? trendWindow : []).map((point) => ({
    ...point,
    ...assessCriticalWindowPoint(point, units),
  }));
  const peak = hours.reduce((best, hour) => (!best || hour.score > best.score ? hour : best), null);
  return { hours, peak };
};

module.exports = {
  assessCriticalWindowPoint,
  buildCriticalWindow,
};
