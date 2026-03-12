import type { SafetyData, UserPreferences } from './types';
import { convertTempFToDisplayValue, convertWindMphToDisplayValue } from './core';
import { formatSignedDelta } from './weather-display';

export function buildDayOverDayChanges(current: SafetyData, previous: SafetyData, preferences: UserPreferences): string[] {
  const changes: string[] = [];
  const currentScore = Number(current?.safety?.score);
  const previousScore = Number(previous?.safety?.score);
  if (Number.isFinite(currentScore) && Number.isFinite(previousScore)) {
    const scoreDelta = currentScore - previousScore;
    if (Math.abs(scoreDelta) >= 1) {
      changes.push(`Safety score ${formatSignedDelta(scoreDelta)} (${Math.round(previousScore)} -> ${Math.round(currentScore)}).`);
    }
  }

  const currentDanger = Number(current?.avalanche?.dangerLevel);
  const previousDanger = Number(previous?.avalanche?.dangerLevel);
  if (Number.isFinite(currentDanger) && Number.isFinite(previousDanger) && currentDanger !== previousDanger) {
    changes.push(`Avalanche danger changed ${formatSignedDelta(currentDanger - previousDanger)} level(s).`);
  }

  const currentGust = Number(current?.weather?.windGust);
  const previousGust = Number(previous?.weather?.windGust);
  if (Number.isFinite(currentGust) && Number.isFinite(previousGust) && Math.abs(currentGust - previousGust) >= 3) {
    changes.push(
      `Wind gust changed ${formatSignedDelta(convertWindMphToDisplayValue(currentGust - previousGust, preferences.windSpeedUnit))} ${preferences.windSpeedUnit}.`,
    );
  }

  const currentFeels = Number(current?.weather?.feelsLike ?? current?.weather?.temp);
  const previousFeels = Number(previous?.weather?.feelsLike ?? previous?.weather?.temp);
  if (Number.isFinite(currentFeels) && Number.isFinite(previousFeels) && Math.abs(currentFeels - previousFeels) >= 3) {
    const feelsDelta = convertTempFToDisplayValue(currentFeels, preferences.temperatureUnit) - convertTempFToDisplayValue(previousFeels, preferences.temperatureUnit);
    changes.push(`Feels-like changed ${formatSignedDelta(feelsDelta)}\u00B0${preferences.temperatureUnit.toUpperCase()}.`);
  }

  const currentPrecip = Number(current?.weather?.precipChance);
  const previousPrecip = Number(previous?.weather?.precipChance);
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
