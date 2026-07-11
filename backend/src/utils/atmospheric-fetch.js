/**
 * Fetches atmospheric signals not present in the core weather pipeline:
 *   - UV index + daily UV max (Open-Meteo)
 *   - Freezing level height (Open-Meteo)
 *   - Thunderstorm probability + snow level (NOAA/NWS gridpoint)
 *
 * Every signal degrades to null independently; a failed provider never throws
 * out of fetchAtmosphericSignals.
 */

const { FT_PER_METER } = require('./geo');
const { logger } = require('./logger');
const { createCache, normalizeCoordKey } = require('./cache');

const toFiniteOrNull = (value) => {
  // Open-Meteo emits null for missing hours; Number(null) would coerce to 0.
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const parseClockToMinutes = (clock) => {
  const m = String(clock || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

/**
 * Resolve a NWS gridpoint time-series value at (or nearest before) the target
 * time. Gridpoint values are { validTime: "<ISO>/<duration>", value }.
 */
const resolveGridpointValueAt = (layer, targetMs) => {
  const values = Array.isArray(layer?.values) ? layer.values : [];
  if (!values.length) return null;
  let best = null;
  let bestDelta = Infinity;
  for (const entry of values) {
    const startIso = String(entry?.validTime || '').split('/')[0];
    const startMs = Date.parse(startIso);
    if (!Number.isFinite(startMs)) continue;
    const numeric = toFiniteOrNull(entry?.value);
    if (numeric === null) continue;
    const delta = Math.abs(startMs - targetMs);
    // Prefer the closest hour; on ties the earliest wins (deterministic).
    if (delta < bestDelta) {
      bestDelta = delta;
      best = numeric;
    }
  }
  return best;
};

const createAtmosphericService = ({ fetchWithTimeout, requestTimeoutMs = 10000 } = {}) => {
  const openMeteoAtmospherePayloadCache = createCache({
    name: 'open-meteo-atmosphere-payload',
    ttlMs: 15 * 60 * 1000,
    staleTtlMs: 15 * 60 * 1000,
    maxEntries: 300,
  });
  const noaaGridpointPayloadCache = createCache({
    name: 'noaa-gridpoint-payload',
    ttlMs: 20 * 60 * 1000,
    staleTtlMs: 25 * 60 * 1000,
    maxEntries: 100,
  });

  const fetchOpenMeteoAtmosphere = async ({ lat, lon, selectedDate, startClock, fetchOptions }) => {
    const cacheKey = normalizeCoordKey(lat, lon);
    const payload = await openMeteoAtmospherePayloadCache.getOrFetch(cacheKey, async () => {
      const params = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lon),
        timezone: 'auto',
        forecast_days: '16',
        hourly: 'uv_index,freezing_level_height',
        daily: 'uv_index_max',
      });
      const hosts = ['api.open-meteo.com', 'customer-api.open-meteo.com'];
      let nextPayload = null;
      let lastError = null;
      for (const host of hosts) {
        try {
          const res = await fetchWithTimeout(
            `https://${host}/v1/forecast?${params.toString()}`,
            fetchOptions,
            Math.max(requestTimeoutMs, 10000),
          );
          if (!res.ok) throw new Error(`Open-Meteo atmosphere failed ${res.status}`);
          const candidatePayload = await res.json();
          const candidateTimes = Array.isArray(candidatePayload?.hourly?.time)
            ? candidatePayload.hourly.time
            : [];
          if (!candidateTimes.length) {
            throw new Error('Open-Meteo atmosphere missing hourly time series');
          }
          nextPayload = candidatePayload;
          break;
        } catch (err) {
          if (fetchOptions?.signal?.aborted) {
            throw err;
          }
          lastError = err;
        }
      }
      if (!nextPayload) throw lastError || new Error('Open-Meteo atmosphere failed');
      return nextPayload;
    });

    const times = Array.isArray(payload?.hourly?.time) ? payload.hourly.time : [];
    if (!times.length) throw new Error('Open-Meteo atmosphere missing hourly time series');

    const dayIndexes = times
      .map((t, idx) => ({ t: String(t), idx }))
      .filter((e) => e.t.slice(0, 10) === selectedDate)
      .map((e) => e.idx);
    let index = dayIndexes.length ? dayIndexes[0] : 0;
    const targetMinutes = parseClockToMinutes(startClock);
    if (targetMinutes !== null && dayIndexes.length) {
      const match = dayIndexes.find((idx) => {
        const m = String(times[idx]).match(/T(\d{2}):(\d{2})/);
        if (!m) return false;
        return Number(m[1]) * 60 + Number(m[2]) >= targetMinutes;
      });
      index = Number.isInteger(match) ? match : dayIndexes[dayIndexes.length - 1];
    }

    const uvSeries = Array.isArray(payload?.hourly?.uv_index) ? payload.hourly.uv_index : [];
    const freezeSeries = Array.isArray(payload?.hourly?.freezing_level_height)
      ? payload.hourly.freezing_level_height
      : [];
    const uvMaxDays = Array.isArray(payload?.daily?.time) ? payload.daily.time : [];
    const uvMaxSeries = Array.isArray(payload?.daily?.uv_index_max) ? payload.daily.uv_index_max : [];
    const dayMaxIdx = uvMaxDays.findIndex((d) => String(d).slice(0, 10) === selectedDate);

    const freezingMeters = toFiniteOrNull(freezeSeries[index]);

    return {
      uvIndex: toFiniteOrNull(uvSeries[index]),
      uvIndexMax: dayMaxIdx >= 0 ? toFiniteOrNull(uvMaxSeries[dayMaxIdx]) : null,
      freezingLevelFt: freezingMeters !== null ? Math.round(freezingMeters * FT_PER_METER) : null,
      uvSource: 'Open-Meteo',
      freezingLevelSource: 'Open-Meteo',
    };
  };

  const fetchNoaaGridpointAtmosphere = async ({ gridDataUrl, targetTimeIso, fetchOptions }) => {
    if (!gridDataUrl) return {};
    const json = await noaaGridpointPayloadCache.getOrFetch(gridDataUrl, async () => {
      const res = await fetchWithTimeout(gridDataUrl, fetchOptions, requestTimeoutMs);
      if (!res.ok) throw new Error(`NOAA gridpoint failed ${res.status}`);
      const payload = await res.json();
      if (!payload?.properties || typeof payload.properties !== 'object') {
        throw new Error('NOAA gridpoint response missing properties');
      }
      return payload;
    });
    const props = json?.properties || {};
    const targetMs = Date.parse(targetTimeIso) || Date.now();

    const thunder = resolveGridpointValueAt(props.probabilityOfThunder, targetMs);
    const snowMeters = resolveGridpointValueAt(props.snowLevel, targetMs);

    return {
      thunderProbability: toFiniteOrNull(thunder),
      snowLevelFt: snowMeters !== null ? Math.round(snowMeters * FT_PER_METER) : null,
      thunderSource: 'NOAA gridpoint',
      snowLevelSource: 'NOAA gridpoint',
    };
  };

  /**
   * Fetch all atmospheric signals in parallel. Never throws — returns whatever
   * succeeded, with the rest left null.
   */
  const fetchAtmosphericSignals = async ({
    lat,
    lon,
    selectedDate,
    startClock,
    gridDataUrl,
    targetTimeIso,
    fetchOptions,
  }) => {
    const [openMeteo, gridpoint] = await Promise.allSettled([
      fetchOpenMeteoAtmosphere({ lat, lon, selectedDate, startClock, fetchOptions }),
      fetchNoaaGridpointAtmosphere({ gridDataUrl, targetTimeIso, fetchOptions }),
    ]);

    const result = { date: targetTimeIso || (selectedDate ? `${selectedDate}T12:00:00Z` : null) };

    if (openMeteo.status === 'fulfilled') {
      Object.assign(result, openMeteo.value);
    } else {
      logger.warn({ err: openMeteo.reason }, 'Open-Meteo atmosphere fetch failed');
    }
    if (gridpoint.status === 'fulfilled') {
      Object.assign(result, gridpoint.value);
    } else {
      logger.warn({ err: gridpoint.reason }, 'NOAA gridpoint atmosphere fetch failed');
    }

    return result;
  };

  return { fetchAtmosphericSignals, resolveGridpointValueAt };
};

module.exports = { createAtmosphericService };
