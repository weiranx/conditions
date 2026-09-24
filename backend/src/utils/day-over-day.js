'use strict';

// What changed from the day before, for the same objective, start and window.

const { convertTempF, convertWindMph, normalizeUnits } = require('./display-format');
const { toFiniteOrNull } = require('./numbers');

const oneDecimal = (value) => Number(value.toFixed(1));

/** A score change as the report shows scores: one decimal, signed, "0" when unchanged. */
const formatScoreDelta = (delta) => {
  const rounded = oneDecimal(delta);
  return rounded === 0 ? '0' : `${rounded > 0 ? '+' : ''}${rounded}`;
};

/** "+3" / "-2" / "0": whole numbers, signed. */
const formatSignedDelta = (value) => {
  const rounded = Math.round(value);
  if (rounded === 0) return '0';
  return `${rounded > 0 ? '+' : ''}${rounded}`;
};

/**
 * Scores compare only when both days were scored: a report without enough
 * evidence shows no score, so a change in points would be meaningless.
 */
const scoresComparable = (current, previous) =>
  current?.safety?.assessmentStatus !== 'insufficient_evidence'
  && previous?.safety?.assessmentStatus !== 'insufficient_evidence'
  && toFiniteOrNull(current?.safety?.score) !== null
  && toFiniteOrNull(previous?.safety?.score) !== null;

const feelsLikeOf = (report) => toFiniteOrNull(report?.weather?.feelsLike) ?? toFiniteOrNull(report?.weather?.temp);

const buildDayOverDayChanges = (current, previous, rawUnits) => {
  const units = normalizeUnits(rawUnits);
  const changes = [];
  if (scoresComparable(current, previous)) {
    const currentScore = toFiniteOrNull(current.safety.score);
    const previousScore = toFiniteOrNull(previous.safety.score);
    const delta = currentScore - previousScore;
    if (Math.abs(delta) >= 1) {
      changes.push(`Safety score ${formatScoreDelta(delta)} (${oneDecimal(previousScore)} -> ${oneDecimal(currentScore)}).`);
    }
  }
  const currentDanger = toFiniteOrNull(current?.avalanche?.dangerLevel);
  const previousDanger = toFiniteOrNull(previous?.avalanche?.dangerLevel);
  if (currentDanger !== null && previousDanger !== null && currentDanger !== previousDanger) {
    const levels = Math.abs(currentDanger - previousDanger);
    changes.push(`Avalanche danger ${currentDanger > previousDanger ? 'rose' : 'fell'} ${levels} ${levels === 1 ? 'level' : 'levels'}.`);
  }
  const currentGust = toFiniteOrNull(current?.weather?.windGust);
  const previousGust = toFiniteOrNull(previous?.weather?.windGust);
  if (currentGust !== null && previousGust !== null && Math.abs(currentGust - previousGust) >= 3) {
    changes.push(`Wind gust changed ${formatSignedDelta(convertWindMph(currentGust - previousGust, units.wind))} ${units.wind}.`);
  }
  const currentFeels = feelsLikeOf(current);
  const previousFeels = feelsLikeOf(previous);
  if (currentFeels !== null && previousFeels !== null && Math.abs(currentFeels - previousFeels) >= 3) {
    const delta = convertTempF(currentFeels, units.temperature) - convertTempF(previousFeels, units.temperature);
    changes.push(`Feels-like changed ${formatSignedDelta(delta)}°${units.temperature.toUpperCase()}.`);
  }
  const currentPrecip = toFiniteOrNull(current?.weather?.precipChance);
  const previousPrecip = toFiniteOrNull(previous?.weather?.precipChance);
  if (currentPrecip !== null && previousPrecip !== null && Math.abs(currentPrecip - previousPrecip) >= 10) {
    changes.push(`Precip chance changed ${formatSignedDelta(currentPrecip - previousPrecip)}%.`);
  }
  const currentDesc = String(current?.weather?.description || '').trim();
  const previousDesc = String(previous?.weather?.description || '').trim();
  if (currentDesc && previousDesc && currentDesc.toLowerCase() !== previousDesc.toLowerCase()) {
    changes.push(`Weather changed from "${previousDesc}" to "${currentDesc}".`);
  }
  return changes.slice(0, 6);
};

/** The comparison shown under "Change from the prior day"; null when the prior day has no score. */
const buildDayOverDay = ({ current, previous, previousDate, startTime, travelWindowHours, units }) => {
  const previousScore = toFiniteOrNull(previous?.safety?.score);
  const currentScore = toFiniteOrNull(current?.safety?.score);
  if (previousScore === null || currentScore === null) return null;
  const delta = Number((currentScore - previousScore).toFixed(1));
  return {
    previousDate,
    startTime,
    travelWindowHours,
    previousScore,
    delta,
    deltaLabel: formatScoreDelta(delta),
    scoreComparable: scoresComparable(current, previous),
    changes: buildDayOverDayChanges(current, previous, units),
  };
};

module.exports = {
  formatScoreDelta,
  formatSignedDelta,
  scoresComparable,
  buildDayOverDayChanges,
  buildDayOverDay,
};
