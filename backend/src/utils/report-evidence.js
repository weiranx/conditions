const { parseIsoTimeToMs } = require('./time');
const HOUR = 3600000;

// A forecast row is an interval, never proof that an entire requested hour exists.
// Split at every boundary and select one row per segment to avoid double counting.
const selectForecastIntervals = (rows, startIso, hours) => {
  const start = parseIsoTimeToMs(startIso);
  if (start === null) return [];
  const end = start + hours * HOUR;
  const entries = (Array.isArray(rows) ? rows : []).map((row) => {
    const from = parseIsoTimeToMs(row?.timeIso);
    const explicitEnd = parseIsoTimeToMs(row?.endTimeIso);
    // Hourly providers can omit an end, but an invalid supplied end cannot
    // establish coverage by silently becoming a full hour.
    const hasExplicitEnd = row?.endTimeIso !== null && row?.endTimeIso !== undefined;
    return { row, from, to: hasExplicitEnd ? explicitEnd : (from === null ? null : from + HOUR) };
  }).filter(({ from, to }) => from !== null && to !== null && to > from && from < end && to > start)
    .sort((a, b) => b.from - a.from);
  const bounds = [...new Set([start, end, ...entries.flatMap(({ from, to }) => [Math.max(start, from), Math.min(end, to)])])].sort((a, b) => a - b);
  const result = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const entry = entries.find(({ from, to }) => from <= bounds[i] && to >= bounds[i + 1]);
    if (entry) result.push({ ...entry.row, hours: (bounds[i + 1] - bounds[i]) / HOUR });
  }
  return result;
};

// Convert provider local-clock timestamps using the objective's IANA zone.
// Invalid/nonexistent local times are discarded; repeated DST hours deduplicate
// conservatively unless the provider supplies explicit offsets.
const zonedForecastIso = (value, timezone) => {
  if (typeof value !== 'string' || /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !timezone) return value;
  const naive = Date.parse(`${value}Z`);
  if (!Number.isFinite(naive)) return null;
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const localMs = instant => {
      const p = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
      return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    };
    let instant = naive;
    for (let i = 0; i < 3; i += 1) instant += naive - localMs(instant);
    if (localMs(instant) !== naive) return null;
    const offset = Math.round((naive - instant) / 60000);
    const suffix = `${offset < 0 ? '-' : '+'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`;
    return `${value.length === 16 ? value + ':00' : value}${suffix}`;
  } catch { return null; }
};

const weatherProvider = (weather) => {
  const primary = weather?.sourceDetails?.primary;
  if (/open.?meteo/i.test(primary || '') || weather?.dataSource === 'open-meteo-fallback') return 'Open-Meteo';
  if (/noaa|nws/i.test(primary || '') || weather?.dataSource === 'noaa') return 'NOAA/NWS';
  return primary || 'Weather provider unspecified';
};

module.exports = { selectForecastIntervals, weatherProvider, zonedForecastIso };
