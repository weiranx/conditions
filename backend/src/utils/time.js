const parseIsoTimeToMs = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const trimmed = value.trim();
  const withTimezone = /([zZ]|[+\-]\d{2}:\d{2})$/.test(trimmed);
  const parsed = Date.parse(withTimezone ? trimmed : `${trimmed}Z`);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseIsoTimeToMsWithReference = (value, referenceIso) => {
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

const parseStartClock = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return `${match[1]}:${match[2]}`;
};

const getIsoTimezoneSuffix = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = trimmed.match(/([+\-]\d{2}:\d{2}|Z)$/);
  return match ? match[1] : null;
};

const buildPlannedStartIso = ({ selectedDate, startClock, referenceIso }) => {
  if (typeof selectedDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate) || !startClock) {
    return referenceIso || null;
  }
  const tzSuffix = getIsoTimezoneSuffix(referenceIso) || 'Z';
  return `${selectedDate}T${startClock}:00${tzSuffix === 'Z' ? 'Z' : tzSuffix}`;
};

const findClosestTimeIndex = (timeArray, targetTimeMs) => {
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

const withExplicitTimezone = (value, timezoneHint = 'UTC') => {
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

const parseClockToMinutes = (value) => {
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

const formatMinutesToClock = (totalMinutes) => {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const parseIsoClockMinutes = (isoValue) => {
  if (typeof isoValue !== 'string') {
    return null;
  }
  const match = isoValue.trim().match(/T(\d{2}):(\d{2})/);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
};

const clampTravelWindowHours = (rawValue, fallback = 12) => {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(1, Math.min(24, Math.round(numeric)));
};

const normalizeUtcIsoTimestamp = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const parsedMs = parseIsoTimeToMs(value);
  if (parsedMs === null) {
    return value;
  }
  return new Date(parsedMs).toISOString();
};

module.exports = {
  parseIsoTimeToMs,
  parseIsoTimeToMsWithReference,
  parseStartClock,
  buildPlannedStartIso,
  findClosestTimeIndex,
  withExplicitTimezone,
  parseClockToMinutes,
  formatMinutesToClock,
  parseIsoClockMinutes,
  clampTravelWindowHours,
  normalizeUtcIsoTimestamp,
};
