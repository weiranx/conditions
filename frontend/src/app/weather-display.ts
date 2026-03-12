import type { SafetyData, TimeStyle } from './types';
import { minutesToTwentyFourHourClock, parseSolarClockMinutes } from './core';

export function weatherConditionEmoji(description: string | undefined, isDaytime?: boolean | null): string {
  const text = String(description || '').toLowerCase();
  if (/thunder|lightning|storm|hail/.test(text)) return '\u26C8\uFE0F';
  if (/snow|blizzard|sleet|wintry|freezing/.test(text)) return '\u2744\uFE0F';
  if (/rain|shower|drizzle/.test(text)) return '\uD83C\uDF27\uFE0F';
  if (/fog|smoke|haze|mist/.test(text)) return '\uD83C\uDF2B\uFE0F';
  if (/wind|breezy|gust/.test(text)) return '\uD83D\uDCA8';
  if (/overcast|cloud/.test(text)) return '\u2601\uFE0F';
  if (/clear|sunny/.test(text)) return isDaytime ? '\u2600\uFE0F' : '\uD83C\uDF19';
  return '\uD83C\uDF24\uFE0F';
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

export function formatDurationMinutes(value: number | null | undefined): string {
  const total = Number(value);
  if (!Number.isFinite(total)) {
    return 'N/A';
  }
  const rounded = Math.max(0, Math.round(total));
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (hours <= 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}
