const { parseClockToMinutes, parseIsoTimeToMs } = require('./time');

const MINUTE = 60000;
const DAY_MINUTES = 1440;

const formatters = new Map();
const localMinuteFormatter = (timeZone) => {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }));
  }
  return formatters.get(timeZone);
};

/**
 * Sunrise and sunset at the objective, as instants. NOAA's hourly `isDaytime`
 * flag follows its fixed 6 AM-6 PM forecast periods, not the sun, so it can put
 * dark more than an hour late in winter. This uses the solar times instead.
 *
 * The solar times are for the report date; neighbouring days reuse them, which
 * is off by a minute or two per day. Returns null without solar times or the
 * objective's time zone, so callers can fall back to the forecast's flags.
 */
const buildSunClock = ({ solarData, timeZone } = {}) => {
  const sunrise = parseClockToMinutes(solarData?.sunrise);
  const sunset = parseClockToMinutes(solarData?.sunset);
  if (sunrise === null || sunset === null || sunset <= sunrise || typeof timeZone !== 'string' || !timeZone) return null;
  let formatter;
  try {
    formatter = localMinuteFormatter(timeZone);
  } catch {
    return null;
  }
  const minuteOfDay = (ms) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
    return (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  };
  const wrap = (minutes) => (((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES);
  // The next instant, from the minute of `ms` on, whose local clock reads
  // `targetMinute`. A daylight-saving change on the way shifts the clock, so
  // correct the candidate by however far its local time drifted.
  const nextClock = (ms, targetMinute) => {
    const candidate = Math.floor(ms / MINUTE) * MINUTE + wrap(targetMinute - minuteOfDay(ms)) * MINUTE;
    const drift = wrap(minuteOfDay(candidate) - targetMinute + DAY_MINUTES / 2) - DAY_MINUTES / 2;
    return candidate - drift * MINUTE;
  };
  return {
    sunriseMinute: sunrise,
    sunsetMinute: sunset,
    isDarkAt: (ms) => {
      const minute = minuteOfDay(ms);
      return minute < sunrise || minute >= sunset;
    },
    nextSunset: (ms) => nextClock(ms, sunset),
    nextSunrise: (ms) => nextClock(ms, sunrise),
  };
};

const windowBounds = (startIso, hours) => {
  const start = parseIsoTimeToMs(startIso);
  return start === null || !(hours > 0) ? null : { start, end: start + hours * 60 * MINUTE };
};

/** Whether any part of [start, start + hours) is after sunset or before sunrise; null when unknown. */
const windowIncludesDark = (sun, startIso, hours) => {
  const bounds = windowBounds(startIso, hours);
  if (!sun || !bounds) return null;
  return sun.isDarkAt(bounds.start) || sun.nextSunset(bounds.start) < bounds.end;
};

/** Whether any part of [start, start + hours) is between sunrise and sunset; null when unknown. */
const windowIncludesDaylight = (sun, startIso, hours) => {
  const bounds = windowBounds(startIso, hours);
  if (!sun || !bounds) return null;
  return !sun.isDarkAt(bounds.start) || sun.nextSunrise(bounds.start) < bounds.end;
};

module.exports = { buildSunClock, windowIncludesDark, windowIncludesDaylight };
