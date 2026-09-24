import {
  CM_PER_INCH,
  DATE_FMT,
  FT_PER_METER,
  KM_PER_MILE,
  KPH_PER_MPH,
  METER_PER_FOOT,
  MM_PER_INCH,
} from './constants';
import type {
  ActivityType,
  ElevationUnit,
  TemperatureUnit,
  ThemeMode,
  TimeStyle,
  WindSpeedUnit,
} from './types';

export function normalizeActivity(rawActivity: string | null): ActivityType {
  if (!rawActivity) {
    return 'backcountry';
  }

  const cleaned = rawActivity.trim().toLowerCase();
  if (cleaned === 'hiking' || cleaned === 'hike' || cleaned === 'mountain-hiking') return 'hiking';
  if (cleaned === 'scrambling' || cleaned === 'scramble' || cleaned === 'exposed-scrambling') return 'scrambling';
  if (cleaned === 'alpine-climbing' || cleaned === 'alpine_climbing' || cleaned === 'alpine') return 'alpine-climbing';
  if (cleaned === 'mountaineering' || cleaned === 'mountaineer' || cleaned === 'glacier') return 'mountaineering';
  if (cleaned === 'snow-climbing' || cleaned === 'snow_climbing' || cleaned === 'snow-climb') return 'snow-climbing';
  if (cleaned === 'ski-touring' || cleaned === 'ski_touring' || cleaned === 'ski-tour' || cleaned === 'skimo') return 'ski-touring';
  if (cleaned === 'trail-running' || cleaned === 'trail_running' || cleaned === 'trail-runner' || cleaned === 'trail_runner' || cleaned === 'runner' || cleaned === 'running') {
    return 'trail-running';
  }
  return 'backcountry';
}

export function formatDateInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function addDaysToIsoDate(dateStr: string, days: number): string {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) {
    return dateStr;
  }
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  return d.toISOString().slice(0, 10);
}

export function parseIsoToMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T00:00:00Z`
    : /([zZ]|[+-]\d{2}:\d{2})$/.test(trimmed)
      ? trimmed
      : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(trimmed)
        ? `${trimmed}Z`
        : trimmed;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

export function formatAgeFromNow(value: string | null | undefined): string {
  const ms = parseIsoToMs(value);
  if (ms === null) {
    return 'Unavailable';
  }
  const offsetMinutes = Math.round((Date.now() - ms) / 60000);
  const span = (totalMinutes: number) => {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours === 0 ? `${minutes}m` : minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  };
  // Some sources are stamped with the forecast hour they describe (air quality
  // and precipitation at the planned start), which can be hours ahead. That is
  // when the value applies, not how old it is.
  if (offsetMinutes < -5) {
    return `valid in ${span(-offsetMinutes)}`;
  }
  return `${span(Math.max(0, offsetMinutes))} ago`;
}

export function parseCoordinates(input: string): { lat: number; lon: number } | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const coordinateMatch =
    trimmed.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/) ||
    trimmed.match(/^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/);
  if (!coordinateMatch) return null;

  const lat = parseFloat(coordinateMatch[1]);
  const lon = parseFloat(coordinateMatch[2]);

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return null;
  }

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }

  return { lat, lon };
}

export function parseTimeInputMinutes(value: string): number | null {
  const trimmed = value.trim();
  const twentyFourHourMatch = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourHourMatch) {
    const hour = parseInt(twentyFourHourMatch[1], 10);
    const minute = parseInt(twentyFourHourMatch[2], 10);

    if (Number.isNaN(hour) || Number.isNaN(minute) || hour > 23 || minute > 59) {
      return null;
    }

    return hour * 60 + minute;
  }

  const amPmMatch = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!amPmMatch) {
    return null;
  }

  const hour12 = parseInt(amPmMatch[1], 10);
  const minute = parseInt(amPmMatch[2], 10);
  const meridiem = amPmMatch[3].toUpperCase();

  if (Number.isNaN(hour12) || Number.isNaN(minute) || hour12 < 1 || hour12 > 12 || minute > 59) {
    return null;
  }

  const hour24 = meridiem === 'PM' ? (hour12 % 12) + 12 : hour12 % 12;
  return hour24 * 60 + minute;
}

export function parseHourLabelToMinutes(label: string | undefined): number | null {
  if (!label) {
    return null;
  }
  const match = label.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
  if (!match) {
    return null;
  }
  const rawHour = Number(match[1]);
  const rawMinute = Number(match[2] || 0);
  if (!Number.isFinite(rawHour) || rawHour < 1 || rawHour > 12 || !Number.isFinite(rawMinute) || rawMinute < 0 || rawMinute > 59) {
    return null;
  }
  const meridiem = match[3].toUpperCase();
  const hour24 = rawHour % 12 + (meridiem === 'PM' ? 12 : 0);
  return hour24 * 60 + rawMinute;
}

export function minutesToTwentyFourHourClock(minutes: number): string {
  const clamped = Math.max(0, Math.min(1439, Math.round(minutes)));
  const hour24 = Math.floor(clamped / 60);
  const minute = clamped % 60;
  return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function formatClockAmPm(value: string | null | undefined): string {
  if (!value) {
    return 'N/A';
  }
  const minutes = parseTimeInputMinutes(value);
  if (minutes === null) {
    return value;
  }
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const ampm = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${ampm}`;
}

export function formatClockForStyle(value: string | null | undefined, style: TimeStyle): string {
  let minutes = parseTimeInputMinutes(value || '');
  if (minutes === null) {
    minutes = parseHourLabelToMinutes(value || '');
  }
  if (minutes === null) {
    minutes = parseSolarClockMinutes(value || undefined);
  }
  if (minutes === null) {
    return value || 'N/A';
  }
  if (style === '24h') {
    return minutesToTwentyFourHourClock(minutes);
  }
  return formatClockAmPm(minutesToTwentyFourHourClock(minutes));
}

/*
 * Display units. The API always returns °F, mph, ft, miles/km and inches; the
 * report converts at display time with the formatters below, never by hand:
 *
 *   quantity       imperial      metric        formatter
 *   temperature    °F  whole     °C  whole     formatTemperatureForUnit
 *   wind           mph whole     km/h whole    formatWindForUnit
 *   elevation      ft  whole     m   whole     formatElevationForUnit
 *   distance       mi  0.1       km  0.1       formatDistanceForElevationUnit
 *   rain           in  0.01      mm  0.1       formatRainAmountForElevationUnit
 *   snowfall       in  0.1       cm  0.1       formatSnowfallAmountForElevationUnit
 *   snow depth     in  whole*    cm  whole*    formatSnowDepthForElevationUnit
 *   SWE            in  0.1       mm  whole     formatSweForElevationUnit
 *
 * (*0.1 below 1.) Distance and precipitation follow the elevation setting ("ft · mi" or
 * "m · km"). Sentences written by the API go through localizeUnitText.
 */
export function convertTempFToDisplayValue(tempF: number, unit: TemperatureUnit): number {
  if (!Number.isFinite(tempF)) {
    return tempF;
  }
  if (unit === 'c') {
    return (tempF - 32) * (5 / 9);
  }
  return tempF;
}

export function convertDisplayTempToF(value: number, unit: TemperatureUnit): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  if (unit === 'c') {
    return value * (9 / 5) + 32;
  }
  return value;
}

/** "mph" or "km/h": the label shown after a wind speed. */
export function windSpeedUnitLabel(unit: WindSpeedUnit): string {
  return unit === 'kph' ? 'km/h' : 'mph';
}

export function convertWindMphToDisplayValue(mph: number, unit: WindSpeedUnit): number {
  if (!Number.isFinite(mph)) {
    return mph;
  }
  if (unit === 'kph') {
    return mph * KPH_PER_MPH;
  }
  return mph;
}

export function convertDisplayWindToMph(value: number, unit: WindSpeedUnit): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  if (unit === 'kph') {
    return value / KPH_PER_MPH;
  }
  return value;
}

export function convertElevationFeetToDisplayValue(feet: number, unit: ElevationUnit): number {
  if (!Number.isFinite(feet)) {
    return feet;
  }
  if (unit === 'm') {
    return feet * METER_PER_FOOT;
  }
  return feet;
}

export function convertDisplayElevationToFeet(value: number, unit: ElevationUnit): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  if (unit === 'm') {
    return value * FT_PER_METER;
  }
  return value;
}

export function formatTemperatureForUnit(
  tempF: number | null | undefined,
  unit: TemperatureUnit,
  options?: { includeUnit?: boolean; precision?: number },
): string {
  const numericValue = typeof tempF === 'number' ? tempF : Number.NaN;
  if (!Number.isFinite(numericValue)) {
    return 'N/A';
  }
  const precision = options?.precision ?? 0;
  const value = convertTempFToDisplayValue(numericValue, unit);
  const rounded = precision > 0 ? value.toFixed(precision) : String(Math.round(value));
  if (options?.includeUnit === false) {
    return `${rounded}°`;
  }
  return `${rounded}°${unit.toUpperCase()}`;
}

export function formatWindForUnit(
  windMph: number | null | undefined,
  unit: WindSpeedUnit,
  options?: { includeUnit?: boolean; precision?: number },
): string {
  const numericValue = typeof windMph === 'number' ? windMph : Number.NaN;
  if (!Number.isFinite(numericValue)) {
    return 'N/A';
  }
  const precision = options?.precision ?? 0;
  const value = convertWindMphToDisplayValue(numericValue, unit);
  const rounded = precision > 0 ? value.toFixed(precision) : String(Math.round(value));
  if (options?.includeUnit === false) {
    return rounded;
  }
  return `${rounded} ${windSpeedUnitLabel(unit)}`;
}

export function formatElevationForUnit(
  elevationFt: number | null | undefined,
  unit: ElevationUnit,
  options?: { includeUnit?: boolean; precision?: number },
): string {
  const numericValue = typeof elevationFt === 'number' ? elevationFt : Number.NaN;
  if (!Number.isFinite(numericValue)) {
    return 'N/A';
  }
  const precision = options?.precision ?? 0;
  const value = convertElevationFeetToDisplayValue(numericValue, unit);
  const rounded =
    precision > 0
      ? Number(value.toFixed(precision)).toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision })
      : Math.round(value).toLocaleString();
  if (options?.includeUnit === false) {
    return rounded;
  }
  return `${rounded} ${unit}`;
}

export function formatElevationDeltaForUnit(deltaFt: number | null | undefined, unit: ElevationUnit): string {
  const numericValue = typeof deltaFt === 'number' ? deltaFt : Number.NaN;
  if (!Number.isFinite(numericValue)) {
    return 'N/A';
  }
  const value = convertElevationFeetToDisplayValue(numericValue, unit);
  const rounded = Math.round(value);
  if (rounded === 0) {
    return 'objective';
  }
  return `${rounded > 0 ? '+' : '-'}${Math.abs(rounded).toLocaleString()} ${unit}`;
}

export function formatDistanceForElevationUnit(distanceKm: number | null | undefined, elevationUnit: ElevationUnit): string {
  const numericValue = typeof distanceKm === 'number' ? distanceKm : Number.NaN;
  if (!Number.isFinite(numericValue)) {
    return 'N/A';
  }
  if (elevationUnit === 'm') {
    return `${numericValue.toFixed(1)} km`;
  }
  return `${(numericValue / KM_PER_MILE).toFixed(1)} mi`;
}

/**
 * Show "N km" in the viewer's distance unit, at the precision the text gave
 * ("about 8 km" becomes "about 5 mi", not "5.0 mi"), and drop a miles note
 * the text already carried, so "8 km (5 mi)" does not read "5 mi (5 mi)".
 */
export function localizeDistanceText(text: string, elevationUnit: ElevationUnit): string {
  return text.replace(/(-?\d+(?:\.\d+)?)\s?km\b(?!\/)(?:\s*\(\s*-?\d+(?:\.\d+)?\s?mi\))?/gi, (_, value: string) => {
    const km = Number(value);
    if (!value.includes('.')) {
      return elevationUnit === 'm' ? `${Math.round(km)} km` : `${Math.round(km / KM_PER_MILE)} mi`;
    }
    return formatDistanceForElevationUnit(km, elevationUnit);
  });
}

export interface DisplayUnits {
  temperatureUnit: TemperatureUnit;
  windSpeedUnit: WindSpeedUnit;
  elevationUnit: ElevationUnit;
}

// A number as the API writes it: "-4", "0.25", "13,775".
const TEXT_NUMBER = String.raw`-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?`;
// "20–35", "20-35", "20 to 35".
const TEXT_RANGE_SEPARATOR = String.raw`\s?[–—]\s?|-|\s+to\s+`;

/**
 * Rewrite each "<number> <unit>" or "<low>–<high> <unit>" in text with
 * `format`, which returns null to keep a match as written. A number inside a
 * word or a hyphenated name ("P10", "per-1,000 ft") is never matched.
 */
function replaceQuantities(
  text: string,
  unit: string,
  format: (value: number, context: { before: string; after: string }) => string | null,
  followedBy = '',
): string {
  const pattern = new RegExp(
    String.raw`(^|[^\w.,-])(${TEXT_NUMBER})(?:(${TEXT_RANGE_SEPARATOR})(${TEXT_NUMBER}))?\s?(?:${unit})(?!\w)${followedBy}`,
    'gi',
  );
  return text.replace(pattern, (match: string, prefix: string, first: string, separator: string | undefined, second: string | undefined, offset: number) => {
    const before = text.slice(0, offset + prefix.length);
    const after = text.slice(offset + match.length);
    const high = format(Number((second ?? first).replace(/,/g, '')), { before, after });
    if (high === null) return match;
    if (second === undefined) return `${prefix}${high}`;
    const low = format(Number(first.replace(/,/g, '')), { before, after });
    // "20–35°F" keeps one unit: drop it from the low end.
    return low === null ? match : `${prefix}${low.replace(/\s?[^\d\s]+$/, '')}${separator}${high}`;
  });
}

type PrecipKind = 'rain' | 'snowfall' | 'depth' | 'swe';

function precipKind(word: string): PrecipKind {
  const lower = word.toLowerCase();
  if (lower === 'swe' || lower.startsWith('water')) return 'swe';
  if (lower === 'depth' || lower === 'deep' || lower === 'snowpack') return 'depth';
  if (lower.startsWith('snow') || lower === 'powder') return 'snowfall';
  return 'rain';
}

const PRECIP_WORD = String.raw`SWE|water equivalent|depth|deep|snowpack|snowfall|snow|powder|rainfall|rain|precip\w*|QPE`;

/**
 * Put the unit words the API writes into the viewer's units: "28F", "24°F",
 * "20–35°F", "25 mph", "13,775 ft", "8 km", "5 mi", and rain and snow amounts
 * in inches ("0.25 in of rain", "depth 40 in, SWE 12 in"). Values already in
 * the viewer's units are re-rounded to the same precision as the formatters.
 */
export function localizeUnitText(text: string, units: DisplayUnits): string {
  const { temperatureUnit, windSpeedUnit, elevationUnit } = units;
  let out = localizeDistanceText(text, elevationUnit);

  if (elevationUnit === 'm') {
    out = replaceQuantities(out, 'mi|miles?', (miles) => {
      const km = miles * KM_PER_MILE;
      return Number.isInteger(miles) ? `${Math.round(km)} km` : formatDistanceForElevationUnit(km, 'm');
    });
  }

  // Inches are only rain or snow amounts: the word before or after the amount
  // says which, and a bare "3 in the" is a preposition, not a unit.
  out = replaceQuantities(out, 'inches|in', (inches, { before, after }) => {
    const next = new RegExp(String.raw`^\s*(?:of\s+)?(?:new\s+|fresh\s+)?(${PRECIP_WORD})\b`, 'i').exec(after);
    const sentence = before.split(/[.!?;]\s/).pop() || '';
    const previous = [...sentence.matchAll(new RegExp(String.raw`\b(${PRECIP_WORD})\b`, 'gi'))].pop();
    const word = next?.[1] ?? previous?.[1];
    if (!word) return null;
    switch (precipKind(word)) {
      case 'swe': return formatSweForElevationUnit(inches, elevationUnit).replace(/\s*SWE$/, '');
      case 'depth': return formatSnowDepthForElevationUnit(inches, elevationUnit);
      case 'snowfall': return formatSnowfallAmountForElevationUnit(inches, null, elevationUnit);
      default: return formatRainAmountForElevationUnit(inches, null, elevationUnit);
    }
  }, String.raw`(?=\s*(?:$|[.,;:()•/]|in\s+\d|(?:of|and|or|on|at|over|depth|deep|SWE)\b))`);

  // "per 1,000 ft" names a rate, and stays as written.
  out = replaceQuantities(out, 'ft|feet', (feet, { before }) =>
    /\bper\s$/i.test(before) ? null : formatElevationForUnit(feet, elevationUnit));

  out = replaceQuantities(out, 'mph', (mph) => formatWindForUnit(mph, windSpeedUnit));

  return replaceQuantities(out, String.raw`°\s?F|F`, (tempF, { before, after }) => {
    // A difference ("a 20F swing", "8°F warmer") scales without the 32° offset.
    const isDifference = /\b(?:swing|spread|adds(?: up to)?|by)\s*\(?\s*$/i.test(before)
      || /^\s+(?:warmer|colder|cooler)\b/i.test(after);
    if (!isDifference) return formatTemperatureForUnit(tempF, temperatureUnit);
    const delta = temperatureUnit === 'c' ? tempF * (5 / 9) : tempF;
    return `${Math.round(delta)}°${temperatureUnit.toUpperCase()}`;
  });
}

export function formatRainAmountForElevationUnit(
  inches: number | null | undefined,
  millimeters: number | null | undefined,
  elevationUnit: ElevationUnit,
): string {
  const inValue = typeof inches === 'number' ? inches : Number.NaN;
  const mmValue = typeof millimeters === 'number' ? millimeters : Number.NaN;
  if (elevationUnit === 'm') {
    if (Number.isFinite(mmValue)) {
      return `${mmValue.toFixed(1)} mm`;
    }
    if (Number.isFinite(inValue)) {
      return `${(inValue * MM_PER_INCH).toFixed(1)} mm`;
    }
    return 'N/A';
  }
  if (Number.isFinite(inValue)) {
    return `${inValue.toFixed(2)} in`;
  }
  if (Number.isFinite(mmValue)) {
    return `${(mmValue / MM_PER_INCH).toFixed(2)} in`;
  }
  return 'N/A';
}

export function formatSnowfallAmountForElevationUnit(
  inches: number | null | undefined,
  centimeters: number | null | undefined,
  elevationUnit: ElevationUnit,
): string {
  const inValue = typeof inches === 'number' ? inches : Number.NaN;
  const cmValue = typeof centimeters === 'number' ? centimeters : Number.NaN;
  if (elevationUnit === 'm') {
    if (Number.isFinite(cmValue)) {
      return `${cmValue.toFixed(1)} cm`;
    }
    if (Number.isFinite(inValue)) {
      return `${(inValue * CM_PER_INCH).toFixed(1)} cm`;
    }
    return 'N/A';
  }
  if (Number.isFinite(inValue)) {
    return `${inValue.toFixed(1)} in`;
  }
  if (Number.isFinite(cmValue)) {
    return `${(cmValue / CM_PER_INCH).toFixed(1)} in`;
  }
  return 'N/A';
}

/** A measured reading. null, undefined and NaN are missing data, never 0. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function parseOptionalFiniteNumber(value: unknown): number {
  if (value === null || value === undefined) {
    return Number.NaN;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return Number.NaN;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function formatSnowDepthForElevationUnit(
  inches: number | null | undefined,
  elevationUnit: ElevationUnit,
): string {
  const inValue = typeof inches === 'number' ? inches : Number.NaN;
  if (!Number.isFinite(inValue)) {
    return 'N/A';
  }
  const value = elevationUnit === 'm' ? inValue * CM_PER_INCH : inValue;
  // A trace of snow reads "0.4 in", not "0 in".
  const shown = value > 0 && value < 1 ? value.toFixed(1) : String(Math.round(value));
  return `${shown} ${elevationUnit === 'm' ? 'cm' : 'in'}`;
}

export function formatSweForElevationUnit(
  inches: number | null | undefined,
  elevationUnit: ElevationUnit,
): string {
  const inValue = typeof inches === 'number' ? inches : Number.NaN;
  if (!Number.isFinite(inValue)) {
    return 'N/A';
  }
  if (elevationUnit === 'm') {
    return `${Math.round(inValue * MM_PER_INCH)} mm SWE`;
  }
  return `${inValue.toFixed(1)} in SWE`;
}

export function parseSolarClockMinutes(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (!match) {
    return null;
  }

  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const meridiem = match[3].toUpperCase();

  if (meridiem === 'PM' && hour < 12) {
    hour += 12;
  }
  if (meridiem === 'AM' && hour === 12) {
    hour = 0;
  }

  return hour * 60 + minute;
}

export function formatMinutesRelativeToSunset(deltaMinutes: number, requiredBuffer: number): string {
  const abs = Math.abs(deltaMinutes);
  const relation = deltaMinutes >= 0 ? 'before sunset' : 'after sunset';
  const bufferStatus = deltaMinutes >= requiredBuffer ? 'meets daylight buffer' : 'below daylight buffer';
  return `${abs} min ${relation} (${bufferStatus})`;
}

export function normalizeForecastDate(rawDate: string | null, todayDate: string, maxForecastDate: string): string {
  if (!rawDate || !DATE_FMT.test(rawDate)) {
    return todayDate;
  }
  if (rawDate < todayDate) {
    return todayDate;
  }
  if (rawDate > maxForecastDate) {
    return maxForecastDate;
  }
  return rawDate;
}

export function isValidLatLon(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

export function normalizeTimeOrFallback(rawTime: string | null, fallback: string): string {
  if (!rawTime) {
    return fallback;
  }
  const parsedMinutes = parseTimeInputMinutes(rawTime);
  return parsedMinutes !== null ? minutesToTwentyFourHourClock(parsedMinutes) : fallback;
}

export function normalizeThemeMode(rawTheme: string | null | undefined): ThemeMode {
  if (rawTheme === 'light' || rawTheme === 'dark' || rawTheme === 'system') {
    return rawTheme;
  }
  return 'system';
}

export function normalizeTemperatureUnit(rawUnit: string | null | undefined): TemperatureUnit {
  return rawUnit === 'c' ? 'c' : 'f';
}

export function normalizeElevationUnit(rawUnit: string | null | undefined): ElevationUnit {
  return rawUnit === 'm' ? 'm' : 'ft';
}

export function normalizeWindSpeedUnit(rawUnit: string | null | undefined): WindSpeedUnit {
  return rawUnit === 'kph' ? 'kph' : 'mph';
}

export function normalizeTimeStyle(rawStyle: string | null | undefined): TimeStyle {
  return rawStyle === '24h' ? '24h' : 'ampm';
}

