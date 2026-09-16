const { createCache } = require('./cache');
const HOUR = 3600000;

// NBP is a fixed-width text bulletin, not whitespace-delimited: empty cells
// must retain their columns. Wind percentiles are supplied in knots.
const parseNbp = (block) => {
  const header = /NBM V([\d.]+) NBP GUIDANCE\s+(\d+)\/(\d+)\/(\d+)\s+(\d{2})(\d{2}) UTC/.exec(block);
  if (!header) return null;
  const issued = Date.UTC(+header[4], +header[2] - 1, +header[3], +header[5], +header[6]);
  const lines = new Map(block.split(/\r?\n/).map((line) => [line.slice(0, 7).trim(), line]));
  const hours = lines.get('FHR');
  if (!hours) return null;
  const points = [];
  for (let offset = 7; offset < hours.length; offset += 4) {
    const hour = hours.slice(offset, offset + 3).trim();
    if (!/^\d+$/.test(hour)) continue;
    const range = ['WSPP1', 'WSPP5', 'WSPP9'].map((key) => {
      const raw = (lines.get(key) || '').slice(offset, offset + 3).trim();
      return /^\d+$/.test(raw) && +raw < 999 ? +raw : null;
    });
    if (range.some((n) => n === null) || range[0] > range[1] || range[1] > range[2]) continue;
    points.push({ validTime: new Date(issued + +hour * HOUR).toISOString(), windMph: { p10: +(range[0] * 1.15077945).toFixed(1), p50: +(range[1] * 1.15077945).toFixed(1), p90: +(range[2] * 1.15077945).toFixed(1) } });
  }
  return { issuedTime: new Date(issued).toISOString(), modelVersion: header[1], points };
};
const createNbmService = ({ getBytes, now = Date.now }) => {
  const cache = createCache({ name: 'nbm-bulletins', ttlMs: 6 * HOUR, maxEntries: 2 });
  return async ({ stations, targetTimeIso, fetchOptions }) => {
    const target = Date.parse(targetTimeIso);
    const nearby = stations.filter((s) => s.distanceKm <= 50);
    if (!nearby.length) return { available: false, status: 'no_data', note: 'No NWS station within 50 km for matching NBM guidance.' };
    // Full probability cycles: 01, 07, 13, 19 UTC. Allow two hours for publication.
    const cycle = Math.floor((now() - 3 * HOUR) / (6 * HOUR)) * 6 * HOUR + HOUR;
    for (const issued of [cycle, cycle - 6 * HOUR]) {
      const date = new Date(issued).toISOString();
      const hour = date.slice(11, 13);
      const url = `https://noaa-nbm-grib2-pds.s3.amazonaws.com/blend.${date.slice(0, 10).replace(/-/g, '')}/${hour}/text/blend_nbptx.t${hour}z`;
      let blocks;
      try {
        blocks = await cache.getOrFetch(date, async () => {
          const text = (await getBytes(url, { fetchOptions, maxBytes: 45000000, timeoutMs: 15000 })).toString();
          const map = new Map();
          for (const block of text.split(/(?=^\s*\w+\s+NBM V)/m)) {
            const id = /^\s*(\w+)\s+NBM V/.exec(block)?.[1];
            if (id) map.set(id, block);
          }
          if (!map.size) throw new Error('Invalid NBM bulletin');
          return map;
        });
      } catch { fetchOptions?.signal?.throwIfAborted(); continue; }
      for (const station of nearby) {
        const data = parseNbp(blocks.get(station.id) || '');
        if (!data || Date.parse(data.issuedTime) !== issued) continue;
        // Show actual twelve-hourly forecast samples around the selected departure.
        // No interpolation into an hourly or whole-trip confidence estimate.
        const points = data.points.filter((p) => Math.abs(Date.parse(p.validTime) - target) <= 12 * HOUR);
        if (!points.length) continue;
        return { available: true, status: 'ok', ...data, points, station, sourceLink: url, note: 'Station wind-speed percentiles at the displayed forecast times. P10–P90 is the middle 80% of the model distribution, not a bound on possible winds. Nearby station terrain may differ from the objective; gusts and whole-trip coverage are not represented.' };
      }
      return { available: false, status: 'out_of_range', note: 'No matching nearby station probability samples for the selected time.' };
    }
    return { available: false, status: 'unavailable', note: 'Recent NBM probability bulletins could not be loaded.' };
  };
};
module.exports = { createNbmService, parseNbp };
