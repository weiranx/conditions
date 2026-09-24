import type { SafetyData, TimeStyle } from './types';
import { minutesToTwentyFourHourClock, parseSolarClockMinutes } from './core';

export type TemperatureBand = 'freezing' | 'cold' | 'warm' | 'hot';

export interface TemperatureBandDisplay {
  key: TemperatureBand;
  label: string;
}

/** Classify the API's canonical Fahrenheit temperature for display. */
export function getTemperatureBand(tempF: number | null | undefined): TemperatureBandDisplay | null {
  if (!Number.isFinite(Number(tempF))) return null;
  const value = Number(tempF);
  if (value <= 32) return { key: 'freezing', label: 'Freezing' };
  if (value < 50) return { key: 'cold', label: 'Cold' };
  if (value < 80) return { key: 'warm', label: 'Warm' };
  return { key: 'hot', label: 'Hot' };
}

export function inferWeatherSourceLabel(weather: SafetyData['weather'] | null | undefined): string {
  const primary = String(weather?.sourceDetails?.primary || '').trim();
  if (primary === 'NOAA') return 'NOAA / Weather.gov';
  if (primary === 'Open-Meteo') return 'Open-Meteo';
  if (primary) return primary;

  const link = String(weather?.forecastLink || '').toLowerCase();
  if (link.includes('weather.gov')) return 'NOAA / Weather.gov';
  if (link.includes('open-meteo.com')) return 'Open-Meteo';
  return 'Source not provided';
}

export function formatSignedDelta(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) {
    return '0';
  }
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}

export function formatClockShort(value: string | undefined | null, style: TimeStyle = 'ampm'): string {
  const minutes = parseSolarClockMinutes(value || undefined);
  if (minutes === null) {
    return value || 'N/A';
  }
  if (style === '24h') {
    return minutesToTwentyFourHourClock(minutes);
  }
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const ampm = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${ampm}`;
}

