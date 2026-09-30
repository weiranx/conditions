const { createCache } = require('./cache');
const HOUR = 3600000;
// NBM publishes a full probability bulletin every six hours.
const CYCLE_MS = 6 * HOUR;
// A bulletin is about 35 MB. Downloads that nobody is waiting on get a long timeout, and one that failed is not
// retried by every report that arrives while the source is down or the cycle is not published yet.
const BACKGROUND_TIMEOUT_MS = 60000;
const BACKGROUND_RETRY_MS = 5 * 60000;

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

// parseNbp reads the header and these four rows of a station's block, nothing else.
const NBP_ROWS = new Set(['FHR', 'WSPP1', 'WSPP5', 'WSPP9']);

/**
 * Keeps only what parseNbp reads. The bulletin covers every NBM station, and a block that is a slice of the
 * downloaded text keeps the whole 35 MB text alive; the reduced block is a few hundred bytes.
 */
const reduceNbpBlock = (block) => {
  const rows = new Map();
  let header = null;
  for (const line of block.split(/\r?\n/)) {
    if (header === null) {
      if (line.trim()) header = line;
    } else {
      const key = line.slice(0, 7).trim();
      // As in parseNbp, a repeated row is replaced by its last occurrence.
      if (NBP_ROWS.has(key)) rows.set(key, line);
    }
  }
  return header === null ? '' : [header, ...rows.values()].join('\n');
};

// A report or a caller that gives up on waiting must not keep waiting for a download it does not own.
const untilAborted = (promise, signal) => {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('Aborted'));
      return;
    }
    const abort = () => reject(signal.reason ?? new Error('Aborted'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
};

const createNbmService = ({ getBytes, now = Date.now }) => {
  // A cycle stays useful as the fallback for the whole of the next one, so a report is never left
  // waiting on the download of a new bulletin while the previous one is in memory.
  const cache = createCache({ name: 'nbm-bulletins', ttlMs: 2 * CYCLE_MS, maxEntries: 2 });
  const lastBackgroundAttempt = new Map();

  // Full probability cycles: 01, 07, 13, 19 UTC. Allow two hours for publication.
  const describeCycle = (issued) => {
    const date = new Date(issued).toISOString();
    const hour = date.slice(11, 13);
    return { issued, date, url: `https://noaa-nbm-grib2-pds.s3.amazonaws.com/blend.${date.slice(0, 10).replace(/-/g, '')}/${hour}/text/blend_nbptx.t${hour}z` };
  };
  const newestCycle = () => describeCycle(Math.floor((now() - 3 * HOUR) / CYCLE_MS) * CYCLE_MS + HOUR);

  const download = async (cycle, options) => {
    const text = (await getBytes(cycle.url, { ...options, maxBytes: 45000000 })).toString();
    const blocks = new Map();
    for (const block of text.split(/(?=^\s*\w+\s+NBM V)/m)) {
      const id = /^\s*(\w+)\s+NBM V/.exec(block)?.[1];
      if (id) blocks.set(id, reduceNbpBlock(block));
    }
    if (!blocks.size) throw new Error('Invalid NBM bulletin');
    return blocks;
  };
  // A report that needs the bulletin now, under its own signal and deadline.
  const load = (cycle, fetchOptions) => cache.getOrFetch(cycle.date, () => download(cycle, { fetchOptions, timeoutMs: 15000 }));
  // Nobody waits on this download, so it belongs to no report: no request signal, a long deadline.
  const loadInBackground = (cycle, fetchOptions) => cache.getOrFetch(
    cycle.date,
    () => download(cycle, { fetchOptions: { headers: fetchOptions?.headers }, timeoutMs: BACKGROUND_TIMEOUT_MS }),
  );
  const refreshInBackground = (cycle, fetchOptions) => {
    const last = lastBackgroundAttempt.get(cycle.date);
    if (cache.has(cycle.date) || (last !== undefined && now() - last < BACKGROUND_RETRY_MS)) return;
    lastBackgroundAttempt.set(cycle.date, now());
    if (lastBackgroundAttempt.size > 8) lastBackgroundAttempt.delete(lastBackgroundAttempt.keys().next().value);
    loadInBackground(cycle, fetchOptions).catch(() => {});
  };

  // Loads the newest bulletin before the first report needs it, or the previous one if that is not published yet.
  const prewarm = async ({ fetchOptions } = {}) => {
    const newest = newestCycle();
    for (const cycle of [newest, describeCycle(newest.issued - CYCLE_MS)]) {
      try {
        await loadInBackground(cycle, fetchOptions);
        return;
      } catch {
        // Try the previous cycle; a report will try again when it needs one.
      }
    }
  };

  const service = async ({ stations, targetTimeIso, fetchOptions }) => {
    const target = Date.parse(targetTimeIso);
    const nearby = stations.filter((s) => s.distanceKm <= 50);
    if (!nearby.length) return { available: false, status: 'no_data', note: 'No NWS station within 50 km for matching NBM guidance.' };
    const newest = newestCycle();
    const previous = describeCycle(newest.issued - CYCLE_MS);
    let cycles = [newest, previous];
    if (!cache.has(newest.date) && cache.has(previous.date)) {
      // The new bulletin is a large download. Answer from the previous cycle, which the bulletin states, and
      // fetch the new one for the reports that follow.
      refreshInBackground(newest, fetchOptions);
      cycles = [previous];
    }
    for (const cycle of cycles) {
      let blocks;
      try {
        blocks = await untilAborted(load(cycle, fetchOptions), fetchOptions?.signal);
      } catch { fetchOptions?.signal?.throwIfAborted(); continue; }
      for (const station of nearby) {
        const data = parseNbp(blocks.get(station.id) || '');
        if (!data || Date.parse(data.issuedTime) !== cycle.issued) continue;
        // Show actual twelve-hourly forecast samples around the selected departure.
        // No interpolation into an hourly or whole-trip confidence estimate.
        const points = data.points.filter((p) => Math.abs(Date.parse(p.validTime) - target) <= 12 * HOUR);
        if (!points.length) continue;
        return { available: true, status: 'ok', ...data, points, station, sourceLink: cycle.url, note: 'Station wind-speed percentiles at the displayed forecast times. P10–P90 is the middle 80% of the model distribution, not a bound on possible winds. Nearby station terrain may differ from the objective; gusts and whole-trip coverage are not represented.' };
      }
      return { available: false, status: 'out_of_range', note: 'No matching nearby station probability samples for the selected time.' };
    }
    return { available: false, status: 'unavailable', note: 'Recent NBM probability bulletins could not be loaded.' };
  };
  service.prewarm = prewarm;
  return service;
};
module.exports = { createNbmService, parseNbp, reduceNbpBlock };
