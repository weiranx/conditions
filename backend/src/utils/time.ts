export const parseIsoTimeToMs = (value: string | null | undefined): number | null => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const trimmed = value.trim();
  const withTimezone = /([zZ]|[+\-]\d{2}:\d{2})$/.test(trimmed);
  const parsed = Date.parse(withTimezone ? trimmed : `${trimmed}Z`);
  return Number.isFinite(parsed) ? parsed : null;
};

export const getIsoTimezoneSuffix = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = trimmed.match(/([+\-]\d{2}:\d{2}|Z)$/);
  return match ? match[1] : null;
};

export const parseIsoTimeToMsWithReference = (value: string | null | undefined, referenceIso: string | null | undefined): number | null => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const trimmed = value.trim();
  if (/([zZ]|[+\-]\d{2}:\d{2})$/.test(trimmed)) {
    return parseIsoTimeToMs(trimmed);
  }

  const refSuffix = getIsoTimezoneSuffix(referenceIso);
  if (refSuffix) {
    return parseIsoTimeToMs(`${trimmed}${refSuffix === 'Z' ? 'Z' : refSuffix}`);
  }

  return parseIsoTimeToMs(trimmed);
};

export const parseStartClock = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return `${match[1]}:${match[2]}`;
};

interface BuildPlannedStartIsoOptions {
  selectedDate: string | null | undefined;
  startClock: string | null | undefined;
  referenceIso: string | null | undefined;
}

export const buildPlannedStartIso = ({ selectedDate, startClock, referenceIso }: BuildPlannedStartIsoOptions): string | null => {
  if (typeof selectedDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate) || !startClock) {
    return referenceIso || null;
  }
  const tzSuffix = getIsoTimezoneSuffix(referenceIso) || 'Z';
  return `${selectedDate}T${startClock}:00${tzSuffix === 'Z' ? 'Z' : tzSuffix}`;
};

export const findClosestTimeIndex = (timeArray: (string | null | undefined)[] | null | undefined, targetTimeMs: number): number => {
  if (!Array.isArray(timeArray) || !timeArray.length) {
    return -1;
  }

  let bestIdx = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < timeArray.length; i += 1) {
    const currentMs = parseIsoTimeToMs(timeArray[i]);
    if (currentMs === null) {
      continue;
    }
    const distance = Math.abs(currentMs - targetTimeMs);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIdx = i;
    }
  }
  return bestIdx;
};

export const hourLabelFromIso = (input: string | number | Date, timeZone: string | null = null): string => {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const baseOptions: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
  try {
    const localized = date.toLocaleTimeString('en-US', timeZone ? { ...baseOptions, timeZone } : baseOptions);
    return localized.replace(':00 ', ' ');
  } catch {
    const fallback = date.toLocaleTimeString('en-US', baseOptions);
    return fallback.replace(':00 ', ' ');
  }
};

export const localHourFromIso = (input: string | null | undefined, timeZone: string | null = null): number | null => {
  if (typeof input !== 'string' || !input.trim()) {
    return null;
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      hourCycle: 'h23',
      ...(timeZone ? { timeZone } : {}),
    });
    const parts = formatter.formatToParts(date);
    const hourPart = parts.find((part) => part.type === 'hour');
    const hour = Number(hourPart?.value);
    return Number.isFinite(hour) ? hour : null;
  } catch {
    const hour = date.getHours();
    return Number.isFinite(hour) ? hour : null;
  }
};

export const dateKeyInTimeZone = (value: Date | string | number = new Date(), timeZone: string | null = null): string | null => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const formatWithZone = (zone: string | null): string | null => {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        ...(zone ? { timeZone: zone } : {}),
      });
      const parts = formatter.formatToParts(date);
      const year = parts.find((part) => part.type === 'year')?.value;
      const month = parts.find((part) => part.type === 'month')?.value;
      const day = parts.find((part) => part.type === 'day')?.value;
      if (!year || !month || !day) {
        return null;
      }
      // MM/DD/YYYY -> YYYY-MM-DD
      return `${year}-${month}-${day}`;
    } catch {
      return null;
    }
  };

  const normalizedTimeZone = typeof timeZone === 'string' ? timeZone.trim() : '';
  return formatWithZone(normalizedTimeZone || null) || formatWithZone('UTC') || date.toISOString().slice(0, 10);
};

export const withExplicitTimezone = (value: string | null | undefined, timezoneHint: string = 'UTC'): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/([zZ]|[+\-]\d{2}:\d{2})$/.test(trimmed)) {
    return trimmed;
  }
  const isIsoWithoutZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(trimmed);
  if (!isIsoWithoutZone) {
    return trimmed;
  }
  const normalizedTz = String(timezoneHint || '').trim().toUpperCase();
  if (normalizedTz === 'UTC' || normalizedTz === 'GMT') {
    return `${trimmed}Z`;
  }
  return trimmed;
};

export const parseClockToMinutes = (value: string | null | undefined): number | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const twentyFourHourMatch = trimmed.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (twentyFourHourMatch) {
    return Number(twentyFourHourMatch[1]) * 60 + Number(twentyFourHourMatch[2]);
  }

  const twelveHourMatch = trimmed.match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?\s*([AP]M)$/i);
  if (!twelveHourMatch) {
    return null;
  }

  const hourRaw = Number(twelveHourMatch[1]);
  const minute = Number(twelveHourMatch[2]);
  if (!Number.isFinite(hourRaw) || hourRaw < 1 || hourRaw > 12) {
    return null;
  }

  const meridiem = String(twelveHourMatch[4] || '').toUpperCase();
  const hour = (hourRaw % 12) + (meridiem === 'PM' ? 12 : 0);
  return hour * 60 + minute;
};

export const formatMinutesToClock = (totalMinutes: number): string => {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export const parseIsoClockMinutes = (isoValue: string | null | undefined): number | null => {
  if (typeof isoValue !== 'string') {
    return null;
  }
  const match = isoValue.trim().match(/T(\d{2}):(\d{2})/);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
};

export const findFirstTimeIndexAtOrAfter = (timeArray: (string | null | undefined)[] | null | undefined, targetTimeMs: number): number => {
  if (!Array.isArray(timeArray) || !timeArray.length || !Number.isFinite(targetTimeMs)) {
    return -1;
  }
  let bestIdx = -1;
  let bestMs = Number.POSITIVE_INFINITY;
  for (let idx = 0; idx < timeArray.length; idx += 1) {
    const sampleMs = parseIsoTimeToMs(timeArray[idx]);
    if (sampleMs === null || sampleMs < targetTimeMs) {
      continue;
    }
    if (sampleMs < bestMs) {
      bestMs = sampleMs;
      bestIdx = idx;
    }
  }
  return bestIdx;
};

export const normalizeUtcIsoTimestamp = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const parsedMs = parseIsoTimeToMs(value);
  if (parsedMs === null) {
    return value;
  }
  return new Date(parsedMs).toISOString();
};

export interface TemperatureContext24h {
  windowHours: number;
  timezone: string | null;
  minTempF: number;
  maxTempF: number;
  overnightLowF: number | null;
  daytimeHighF: number | null;
}

interface BuildTemperatureContext24hOptions {
  points: { timeIso: string | null | undefined; tempF: number | null | undefined; isDaytime?: boolean | null | undefined }[];
  timeZone?: string | null;
  windowHours?: number;
}

export const buildTemperatureContext24h = ({ points, timeZone = null, windowHours = 24 }: BuildTemperatureContext24hOptions): TemperatureContext24h | null => {
  const normalizedWindow = Math.max(1, Math.round(Number(windowHours) || 24));
  const sourcePoints = Array.isArray(points) ? points.slice(0, normalizedWindow) : [];
  const validPoints = sourcePoints.filter((point) => Number.isFinite(Number(point?.tempF)));
  if (!validPoints.length) {
    return null;
  }

  const temps = validPoints.map((point) => Number(point.tempF));
  const dayTemps: number[] = [];
  const nightTemps: number[] = [];

  validPoints.forEach((point) => {
    let isDaytime = typeof point?.isDaytime === 'boolean' ? point.isDaytime : null;
    if (isDaytime === null) {
      const localHour = localHourFromIso(point?.timeIso, timeZone);
      if (Number.isFinite(localHour)) {
        isDaytime = (localHour as number) >= 6 && (localHour as number) < 18;
      }
    }
    if (isDaytime === true) {
      dayTemps.push(Number(point.tempF));
    } else if (isDaytime === false) {
      nightTemps.push(Number(point.tempF));
    }
  });

  return {
    windowHours: normalizedWindow,
    timezone: timeZone || null,
    minTempF: Math.min(...temps),
    maxTempF: Math.max(...temps),
    overnightLowF: nightTemps.length ? Math.min(...nightTemps) : null,
    daytimeHighF: dayTemps.length ? Math.max(...dayTemps) : null,
  };
};
