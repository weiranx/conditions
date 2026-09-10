import type { SafetyData, UserPreferences } from './types';
import { convertTempFToDisplayValue, convertWindMphToDisplayValue, parseOptionalFiniteNumber } from './core';
import { formatSignedDelta } from './weather-display';

type DayOverDayUnits = Pick<UserPreferences, 'temperatureUnit' | 'windSpeedUnit'>;

export function buildDayOverDayChanges(current: SafetyData, previous: SafetyData, preferences: DayOverDayUnits): string[] {
  const changes: string[] = [];
  const currentScore = parseOptionalFiniteNumber(current?.safety?.score);
  const previousScore = parseOptionalFiniteNumber(previous?.safety?.score);
  if (Number.isFinite(currentScore) && Number.isFinite(previousScore)) {
    const scoreDelta = currentScore - previousScore;
    if (Math.abs(scoreDelta) >= 1) {
      changes.push(`Safety score ${formatSignedDelta(scoreDelta)} (${Math.round(previousScore)} -> ${Math.round(currentScore)}).`);
    }
  }

  const currentDanger = parseOptionalFiniteNumber(current?.avalanche?.dangerLevel);
  const previousDanger = parseOptionalFiniteNumber(previous?.avalanche?.dangerLevel);
  if (Number.isFinite(currentDanger) && Number.isFinite(previousDanger) && currentDanger !== previousDanger) {
    changes.push(`Avalanche danger changed ${formatSignedDelta(currentDanger - previousDanger)} step(s).`);
  }

  const currentGust = parseOptionalFiniteNumber(current?.weather?.windGust);
  const previousGust = parseOptionalFiniteNumber(previous?.weather?.windGust);
  if (Number.isFinite(currentGust) && Number.isFinite(previousGust) && Math.abs(currentGust - previousGust) >= 3) {
    changes.push(
      `Wind gust changed ${formatSignedDelta(convertWindMphToDisplayValue(currentGust - previousGust, preferences.windSpeedUnit))} ${preferences.windSpeedUnit}.`,
    );
  }

  const currentFeels = (Number.isFinite(parseOptionalFiniteNumber(current?.weather?.feelsLike))
    ? parseOptionalFiniteNumber(current.weather.feelsLike) : parseOptionalFiniteNumber(current?.weather?.temp));
  const previousFeels = (Number.isFinite(parseOptionalFiniteNumber(previous?.weather?.feelsLike))
    ? parseOptionalFiniteNumber(previous.weather.feelsLike) : parseOptionalFiniteNumber(previous?.weather?.temp));
  if (Number.isFinite(currentFeels) && Number.isFinite(previousFeels) && Math.abs(currentFeels - previousFeels) >= 3) {
    const feelsDelta = convertTempFToDisplayValue(currentFeels, preferences.temperatureUnit) - convertTempFToDisplayValue(previousFeels, preferences.temperatureUnit);
    changes.push(`Feels-like changed ${formatSignedDelta(feelsDelta)}\u00B0${preferences.temperatureUnit.toUpperCase()}.`);
  }

  const currentPrecip = parseOptionalFiniteNumber(current?.weather?.precipChance);
  const previousPrecip = parseOptionalFiniteNumber(previous?.weather?.precipChance);
  if (Number.isFinite(currentPrecip) && Number.isFinite(previousPrecip) && Math.abs(currentPrecip - previousPrecip) >= 10) {
    changes.push(`Precip chance changed ${formatSignedDelta(currentPrecip - previousPrecip)}%.`);
  }

  const currentDesc = String(current?.weather?.description || '').trim();
  const previousDesc = String(previous?.weather?.description || '').trim();
  if (currentDesc && previousDesc && currentDesc.toLowerCase() !== previousDesc.toLowerCase()) {
    changes.push(`Weather changed from "${previousDesc}" to "${currentDesc}".`);
  }

  return changes.slice(0, 6);
}
