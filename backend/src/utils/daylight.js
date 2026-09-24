const { parseClockToMinutes, parseIsoTimeToMs } = require('./time');

const MINUTE = 60000;
const DAY = 24 * 60 * MINUTE;

const formatters = new Map();
const localPartsFormatter = (timeZone) => {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }));
  }
  return formatters.get(timeZone);
};

// The objective's local calendar date and minute of the day for an instant.
const localParts = (formatter, ms) => {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
};

const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

// The instant the local clock reads `minute` on local `date`: start from the
// same wall time in UTC and correct by the zone's offset until it settles.
const zonedInstant = (formatter, date, minute) => {
  const wall = Date.parse(`${date}T00:00:00Z`) + minute * MINUTE;
  let instant = wall;
  for (let i = 0; i < 3; i += 1) {
    const local = localParts(formatter, instant);
    instant += wall - (Date.parse(`${local.date}T00:00:00Z`) + local.minute * MINUTE);
  }
  return instant;
};

/**
 * Sunrise and sunset at the objective, as instants. NOAA's hourly `isDaytime`
 * flag follows its fixed 6 AM-6 PM forecast periods, not the sun, so it can put
 * dark more than an hour late in winter. This uses the solar times instead.
 *
 * The solar times are local clock times for the report date, the local date of
 * `anchorIso`. Neighbouring days repeat those instants a whole day apart: the
 * sun moves only a minute or two a day, and unlike the wall clock it does not
 * jump an hour at a daylight-saving change. Far north in summer the sun sets
 * after midnight, so a sunset clock earlier than sunrise ends the day's
 * daylight on the next calendar day. Returns null without usable solar times,
 * the objective's time zone, or an anchor, so callers can fall back to the
 * forecast's flags.
 */
const buildSunClock = ({ solarData, timeZone, anchorIso } = {}) => {
  const sunrise = parseClockToMinutes(solarData?.sunrise);
  const sunset = parseClockToMinutes(solarData?.sunset);
  const anchor = parseIsoTimeToMs(anchorIso);
  if (sunrise === null || sunset === null || sunrise === sunset || anchor === null) return null;
  if (typeof timeZone !== 'string' || !timeZone) return null;
  let formatter;
  try {
    formatter = localPartsFormatter(timeZone);
  } catch {
    return null;
  }
  const { date } = localParts(formatter, anchor);
  const firstSunrise = zonedInstant(formatter, date, sunrise);
  const firstSunset = zonedInstant(formatter, sunset > sunrise ? date : addDays(date, 1), sunset);
  const atOrAfter = (first, ms) => first + Math.ceil((ms - first) / DAY) * DAY;
  const atOrBefore = (first, ms) => first + Math.floor((ms - first) / DAY) * DAY;
  return {
    // Dark when the most recent sun event was a sunset.
    isDarkAt: (ms) => atOrBefore(firstSunset, ms) > atOrBefore(firstSunrise, ms),
    nextSunset: (ms) => atOrAfter(firstSunset, ms),
    nextSunrise: (ms) => atOrAfter(firstSunrise, ms),
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
