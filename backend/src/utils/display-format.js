'use strict';

// Unit and clock formatting for text the backend writes for a person: decision
// messages, travel-window reasons and summaries. Report values stay in the
// backend's native units (°F, mph, ft, inches); only prose is localized, using
// the units the request asked for.

const FT_PER_METER = 3.28084;
const METER_PER_FOOT = 1 / FT_PER_METER;
const KPH_PER_MPH = 1.60934;
const KM_PER_MILE = 1.60934;
const MM_PER_INCH = 25.4;
const CM_PER_INCH = 2.54;

const DEFAULT_UNITS = Object.freeze({
  temperature: 'f',
  wind: 'mph',
  elevation: 'ft',
  timeStyle: 'ampm',
});

const normalizeUnits = (raw = {}) => ({
  temperature: raw?.temperature === 'c' ? 'c' : 'f',
  wind: raw?.wind === 'kph' ? 'kph' : 'mph',
  elevation: raw?.elevation === 'm' ? 'm' : 'ft',
  timeStyle: raw?.timeStyle === '24h' ? '24h' : 'ampm',
});

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const toNumberOrNaN = (value) => (typeof value === 'number' ? value : Number.NaN);

const convertTempF = (tempF, unit) => (Number.isFinite(tempF) && unit === 'c' ? (tempF - 32) * (5 / 9) : tempF);
const convertWindMph = (mph, unit) => (Number.isFinite(mph) && unit === 'kph' ? mph * KPH_PER_MPH : mph);
const convertElevationFt = (feet, unit) => (Number.isFinite(feet) && unit === 'm' ? feet * METER_PER_FOOT : feet);

const roundTo = (value, precision) => (precision > 0 ? value.toFixed(precision) : String(Math.round(value)));

const formatTemperature = (tempF, unit, options = {}) => {
  const value = toNumberOrNaN(tempF);
  if (!Number.isFinite(value)) return 'N/A';
  const rounded = roundTo(convertTempF(value, unit), options.precision ?? 0);
  return options.includeUnit === false ? `${rounded}°` : `${rounded}°${String(unit).toUpperCase()}`;
};

const formatWind = (windMph, unit, options = {}) => {
  const value = toNumberOrNaN(windMph);
  if (!Number.isFinite(value)) return 'N/A';
  const rounded = roundTo(convertWindMph(value, unit), options.precision ?? 0);
  return options.includeUnit === false ? rounded : `${rounded} ${unit}`;
};

const formatElevation = (elevationFt, unit, options = {}) => {
  const value = toNumberOrNaN(elevationFt);
  if (!Number.isFinite(value)) return 'N/A';
  const precision = options.precision ?? 0;
  const converted = convertElevationFt(value, unit);
  const rounded = precision > 0
    ? Number(converted.toFixed(precision)).toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision })
    : Math.round(converted).toLocaleString('en-US');
  return options.includeUnit === false ? rounded : `${rounded} ${unit}`;
};

const formatDistance = (distanceKm, elevationUnit) => {
  const value = toNumberOrNaN(distanceKm);
  if (!Number.isFinite(value)) return 'N/A';
  return elevationUnit === 'm' ? `${value.toFixed(1)} km` : `${(value / KM_PER_MILE).toFixed(1)} mi`;
};

const formatSnowDepth = (inches, elevationUnit) => {
  const value = toNumberOrNaN(inches);
  if (!Number.isFinite(value)) return 'N/A';
  return elevationUnit === 'm' ? `${Math.round(value * CM_PER_INCH)} cm` : `${Math.round(value)} in`;
};

const formatSwe = (inches, elevationUnit) => {
  const value = toNumberOrNaN(inches);
  if (!Number.isFinite(value)) return 'N/A';
  return elevationUnit === 'm' ? `${Math.round(value * MM_PER_INCH)} mm SWE` : `${value.toFixed(1)} in SWE`;
};

/** Rain in inches or millimetres, preferring the provider's own value for the unit. */
const formatRainAmount = (inches, millimeters, elevationUnit) => {
  const inValue = toNumberOrNaN(inches);
  const mmValue = toNumberOrNaN(millimeters);
  if (elevationUnit === 'm') {
    if (Number.isFinite(mmValue)) return `${Math.round(mmValue)} mm`;
    if (Number.isFinite(inValue)) return `${Math.round(inValue * MM_PER_INCH)} mm`;
    return 'N/A';
  }
  if (Number.isFinite(inValue)) return `${inValue.toFixed(2)} in`;
  if (Number.isFinite(mmValue)) return `${(mmValue / MM_PER_INCH).toFixed(2)} in`;
  return 'N/A';
};

/** Snowfall in inches or centimetres, preferring the provider's own value for the unit. */
const formatSnowfallAmount = (inches, centimeters, elevationUnit) => {
  const inValue = toNumberOrNaN(inches);
  const cmValue = toNumberOrNaN(centimeters);
  if (elevationUnit === 'm') {
    if (Number.isFinite(cmValue)) return `${cmValue.toFixed(1)} cm`;
    if (Number.isFinite(inValue)) return `${(inValue * CM_PER_INCH).toFixed(1)} cm`;
    return 'N/A';
  }
  if (Number.isFinite(inValue)) return `${inValue.toFixed(2)} in`;
  if (Number.isFinite(cmValue)) return `${(cmValue / CM_PER_INCH).toFixed(2)} in`;
  return 'N/A';
};

/** "3h 20m" / "45m". */
const formatDurationMinutes = (value) => {
  const total = Number(value);
  if (!Number.isFinite(total)) return 'N/A';
  const rounded = Math.max(0, Math.round(total));
  const hours = Math.floor(rounded / 60);
  return hours <= 0 ? `${rounded % 60}m` : `${hours}h ${rounded % 60}m`;
};

/**
 * Show "N km" in the viewer's distance unit, at the precision the text gave
 * ("about 8 km" becomes "about 5 mi", not "5.0 mi"), and drop a miles note
 * the text already carried, so "8 km (5 mi)" does not read "5 mi (5 mi)".
 */
const localizeDistanceText = (text, elevationUnit) =>
  String(text ?? '').replace(/(-?\d+(?:\.\d+)?)\s?km\b(?:\s*\(\s*-?\d+(?:\.\d+)?\s?mi\))?/gi, (_, value) => {
    const km = Number(value);
    if (!value.includes('.')) {
      return elevationUnit === 'm' ? `${Math.round(km)} km` : `${Math.round(km / KM_PER_MILE)} mi`;
    }
    return formatDistance(km, elevationUnit);
  });

/**
 * Localize imperial values inside text written by a provider or another
 * backend module ("gusts 35 mph", "20F", "depth ~14 in") to the viewer's units.
 */
const localizeUnitText = (text, rawUnits) => {
  const units = normalizeUnits(rawUnits);
  return localizeDistanceText(text, units.elevation)
    .replace(/SWE\s*~?\s*(-?\d+(?:\.\d+)?)\s?in\b/gi, (_, value) =>
      `SWE ~${formatSwe(Number(value), units.elevation).replace(/\s*SWE$/i, '')}`)
    .replace(/depth\s*~?\s*(-?\d+(?:\.\d+)?)\s?in\b/gi, (_, value) => `depth ~${formatSnowDepth(Number(value), units.elevation)}`)
    .replace(/(\d+(?:\.\d+)?)\s?in of new snow\b/gi, (_, value) => `${formatSnowDepth(Number(value), units.elevation)} of new snow`)
    .replace(/(\d+(?:\.\d+)?)\s?in of rain\b/gi, (match, value) =>
      units.elevation === 'm' ? `${Math.round(Number(value) * MM_PER_INCH)} mm of rain` : match)
    .replace(/(-?\d+(?:\.\d+)?)\s?ft\b/gi, (_, value) => formatElevation(Number(value), units.elevation))
    .replace(/(-?\d+(?:\.\d+)?)\s?mph\b/gi, (_, value) => formatWind(Number(value), units.wind))
    .replace(/(-?\d+(?:\.\d+)?)F\b/g, (_, value) => formatTemperature(Number(value), units.temperature));
};

// ── Clock times ──────────────────────────────────────────────────────────────

/** "07:30" or "7:30 AM" → minutes after midnight. */
const parseTimeInputMinutes = (value) => {
  const trimmed = String(value ?? '').trim();
  const twentyFourHour = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourHour) {
    const hour = parseInt(twentyFourHour[1], 10);
    const minute = parseInt(twentyFourHour[2], 10);
    if (Number.isNaN(hour) || Number.isNaN(minute) || hour > 23 || minute > 59) return null;
    return hour * 60 + minute;
  }
  const amPm = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!amPm) return null;
  const hour12 = parseInt(amPm[1], 10);
  const minute = parseInt(amPm[2], 10);
  if (Number.isNaN(hour12) || Number.isNaN(minute) || hour12 < 1 || hour12 > 12 || minute > 59) return null;
  const hour24 = amPm[3].toUpperCase() === 'PM' ? (hour12 % 12) + 12 : hour12 % 12;
  return hour24 * 60 + minute;
};

/** "6 AM" or "6:30 PM" → minutes after midnight. */
const parseHourLabelToMinutes = (label) => {
  if (!label) return null;
  const match = String(label).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
  if (!match) return null;
  const rawHour = Number(match[1]);
  const rawMinute = Number(match[2] || 0);
  if (!Number.isFinite(rawHour) || rawHour < 1 || rawHour > 12 || !Number.isFinite(rawMinute) || rawMinute < 0 || rawMinute > 59) {
    return null;
  }
  const hour24 = (rawHour % 12) + (match[3].toUpperCase() === 'PM' ? 12 : 0);
  return hour24 * 60 + rawMinute;
};

/** "6:30 AM" or "6:30:12 AM" (sunrise/sunset) → minutes after midnight. */
const parseSolarClockMinutes = (value) => {
  if (!value) return null;
  const match = String(value).match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const meridiem = match[3].toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return hour * 60 + minute;
};

/** A trend reading's clock: "07:00" or "7 AM". */
const clockMinutes = (value) => parseTimeInputMinutes(value) ?? parseHourLabelToMinutes(value);

/** Minutes after midnight → "HH:MM", clamped to the same day. */
const minutesToTwentyFourHourClock = (minutes) => {
  const clamped = Math.max(0, Math.min(1439, Math.round(minutes)));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
};

const formatClockAmPm = (value) => {
  if (!value) return 'N/A';
  const minutes = parseTimeInputMinutes(value);
  if (minutes === null) return value;
  const hour24 = Math.floor(minutes / 60);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minutes % 60).padStart(2, '0')} ${hour24 >= 12 ? 'PM' : 'AM'}`;
};

const formatClockForStyle = (value, style) => {
  const minutes = parseTimeInputMinutes(value || '')
    ?? parseHourLabelToMinutes(value || '')
    ?? parseSolarClockMinutes(value || undefined);
  if (minutes === null) return value || 'N/A';
  const clock = minutesToTwentyFourHourClock(minutes);
  return style === '24h' ? clock : formatClockAmPm(clock);
};

/** The date and 24-hour time an instant reads as in a time zone (UTC when none is known). */
const dateTimeInputsFor = (instant, timeZone) => {
  const iso = instant.toISOString();
  const fallback = { date: iso.slice(0, 10), time: iso.slice(11, 16) };
  if (!timeZone) return fallback;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    }).formatToParts(instant);
    const part = Object.fromEntries(parts.filter((entry) => entry.type !== 'literal').map((entry) => [entry.type, entry.value]));
    if (part.year && part.month && part.day && part.hour && part.minute) {
      const hour = ((Math.round(Number(part.hour)) % 24) + 24) % 24;
      const minute = Math.max(0, Math.min(59, Math.round(Number(part.minute))));
      if (Number.isFinite(hour) && Number.isFinite(minute)) {
        return {
          date: `${part.year}-${part.month}-${part.day}`,
          time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        };
      }
    }
  } catch {
    // An unknown zone reads the instant in UTC.
  }
  return fallback;
};

module.exports = {
  DEFAULT_UNITS,
  FT_PER_METER,
  KM_PER_MILE,
  KPH_PER_MPH,
  MM_PER_INCH,
  CM_PER_INCH,
  normalizeUnits,
  isFiniteNumber,
  convertTempF,
  convertWindMph,
  convertElevationFt,
  formatTemperature,
  formatWind,
  formatElevation,
  formatDistance,
  formatSnowDepth,
  formatSwe,
  formatRainAmount,
  formatSnowfallAmount,
  formatDurationMinutes,
  localizeDistanceText,
  localizeUnitText,
  parseTimeInputMinutes,
  parseHourLabelToMinutes,
  parseSolarClockMinutes,
  clockMinutes,
  minutesToTwentyFourHourClock,
  formatClockAmPm,
  formatClockForStyle,
  dateTimeInputsFor,
};
