const { parseIsoTimeToMs, findClosestTimeIndex, clampTravelWindowHours, normalizeUtcIsoTimestamp } = require('./time');

const INCHES_PER_MM = 0.0393701;
const INCHES_PER_CM = 0.393701;
const RAINFALL_CACHE_TTL_MS = 30 * 60 * 1000;

const mmToInches = (valueMm) => {
  const numeric = Number(valueMm);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Number((numeric * INCHES_PER_MM).toFixed(2));
};

const cmToInches = (valueCm) => {
  const numeric = Number(valueCm);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Number((numeric * INCHES_PER_CM).toFixed(2));
};

const buildPrecipitationSummaryForAi = (rainfallData) => {
  const totals = rainfallData?.totals || {};
  const rain24hIn = Number(totals.rainPast24hIn ?? totals.past24hIn);
  const snow24hIn = Number(totals.snowPast24hIn);
  const summaryParts = [];

  if (Number.isFinite(rain24hIn)) {
    summaryParts.push(`rain (24h) ${rain24hIn.toFixed(2)} in`);
  }
  if (Number.isFinite(snow24hIn)) {
    summaryParts.push(`snowfall (24h) ${snow24hIn.toFixed(2)} in`);
  }
  if (!summaryParts.length) {
    return 'Recent rain/snow accumulation unavailable.';
  }
  return `Recent ${summaryParts.join(', ')}.`;
};

const sumRollingAccumulation = (timeArray, valuesArray, anchorMs, lookbackHours) => {
  if (!Array.isArray(timeArray) || !Array.isArray(valuesArray) || !Number.isFinite(anchorMs)) {
    return null;
  }

  const lowerBoundMs = anchorMs - lookbackHours * 60 * 60 * 1000;
  let total = 0;
  let windowSampleCount = 0;

  for (let idx = 0; idx < timeArray.length; idx += 1) {
    const sampleMs = parseIsoTimeToMs(timeArray[idx]);
    if (sampleMs === null || sampleMs > anchorMs || sampleMs <= lowerBoundMs) {
      continue;
    }
    windowSampleCount += 1;
    const value = Number(valuesArray[idx]);
    if (!Number.isFinite(value) || value < 0) {
      continue;
    }
    total += value;
  }

  return windowSampleCount > 0 ? Number(total.toFixed(1)) : null;
};

const seriesHasFiniteValues = (series) => Array.isArray(series) && series.some((value) => Number.isFinite(Number(value)) && Number(value) >= 0);

const sumForwardAccumulation = (timeArray, valuesArray, startMs, windowHours) => {
  if (!Array.isArray(timeArray) || !Array.isArray(valuesArray) || !Number.isFinite(startMs) || !Number.isFinite(windowHours) || windowHours <= 0) {
    return null;
  }

  const upperBoundMs = startMs + windowHours * 60 * 60 * 1000;
  let total = 0;
  let windowSampleCount = 0;

  for (let idx = 0; idx < timeArray.length; idx += 1) {
    const sampleMs = parseIsoTimeToMs(timeArray[idx]);
    if (sampleMs === null || sampleMs < startMs || sampleMs >= upperBoundMs) {
      continue;
    }
    windowSampleCount += 1;
    const value = Number(valuesArray[idx]);
    if (!Number.isFinite(value) || value < 0) {
      continue;
    }
    total += value;
  }

  return windowSampleCount > 0 ? Number(total.toFixed(1)) : null;
};

const findFirstTimeIndexAtOrAfter = (timeArray, targetTimeMs) => {
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

const createUnavailableRainfallData = (status = 'unavailable') => ({
  source: 'Open-Meteo Precipitation History',
  status,
  mode: 'observed_recent',
  issuedTime: null,
  anchorTime: null,
  timezone: null,
  expected: {
    status: 'unavailable',
    travelWindowHours: null,
    startTime: null,
    endTime: null,
    rainWindowMm: null,
    rainWindowIn: null,
    snowWindowCm: null,
    snowWindowIn: null,
    note: null,
  },
  totals: {
    rainPast12hMm: null,
    rainPast24hMm: null,
    rainPast48hMm: null,
    rainPast12hIn: null,
    rainPast24hIn: null,
    rainPast48hIn: null,
    snowPast12hCm: null,
    snowPast24hCm: null,
    snowPast48hCm: null,
    snowPast12hIn: null,
    snowPast24hIn: null,
    snowPast48hIn: null,
    // Legacy aliases retained for compatibility with older clients.
    past12hMm: null,
    past24hMm: null,
    past48hMm: null,
    past12hIn: null,
    past24hIn: null,
    past48hIn: null,
  },
  note: null,
  link: null,
});

const buildOpenMeteoRainfallApiUrl = (host, lat, lon) => {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: 'UTC',
    past_days: '3',
    // Keep this at/above the planner horizon so selected future start times still get precip totals.
    forecast_days: '8',
    hourly: 'precipitation,rain,snowfall',
  });
  return `https://${host}/v1/forecast?${params.toString()}`;
};

const buildOpenMeteoRainfallArchiveApiUrl = (host, lat, lon, startDate, endDate) => {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: 'UTC',
    start_date: startDate,
    end_date: endDate,
    hourly: 'precipitation,rain,snowfall',
  });
  return `https://${host}/v1/archive?${params.toString()}`;
};

const buildOpenMeteoRainfallSourceLink = (lat, lon) => buildOpenMeteoRainfallApiUrl('api.open-meteo.com', lat, lon);

const buildRainfallZeroFallback = ({ lat, lon, targetForecastTimeIso, travelWindowHours, reason }) => {
  const expectedWindowHours = clampTravelWindowHours(travelWindowHours, 12);
  const normalizedTargetTime = normalizeUtcIsoTimestamp(targetForecastTimeIso);
  const fallbackAnchorTime = normalizedTargetTime || new Date().toISOString();
  const fallbackAnchorMs = parseIsoTimeToMs(fallbackAnchorTime) ?? Date.now();
  const fallbackEndTime = new Date(fallbackAnchorMs + expectedWindowHours * 60 * 60 * 1000).toISOString();
  const fallbackReason = typeof reason === 'string' && reason.trim() ? reason.trim() : 'upstream precipitation feed unavailable';
  // If targetForecastTimeIso was null/invalid, we can't determine intent (past vs future).
  const fallbackMode = !normalizedTargetTime
    ? 'unknown'
    : fallbackAnchorMs > Date.now() + 60 * 60 * 1000
    ? 'projected_for_selected_start'
    : 'observed_recent';

  return {
    source: 'Open-Meteo Precipitation Fallback (zeroed totals)',
    status: 'partial',
    mode: fallbackMode,
    issuedTime: fallbackAnchorTime,
    anchorTime: fallbackAnchorTime,
    timezone: 'UTC',
    fallbackMode: 'zeroed_totals',
    expected: {
      status: 'no_data',
      travelWindowHours: expectedWindowHours,
      startTime: fallbackAnchorTime,
      endTime: fallbackEndTime,
      rainWindowMm: null,
      rainWindowIn: null,
      snowWindowCm: null,
      snowWindowIn: null,
      note: `Expected precipitation unavailable for the next ${expectedWindowHours}h because upstream feed data was unavailable.`,
    },
    totals: {
      rainPast12hMm: null,
      rainPast24hMm: null,
      rainPast48hMm: null,
      rainPast12hIn: null,
      rainPast24hIn: null,
      rainPast48hIn: null,
      snowPast12hCm: null,
      snowPast24hCm: null,
      snowPast48hCm: null,
      snowPast12hIn: null,
      snowPast24hIn: null,
      snowPast48hIn: null,
      // Legacy aliases retained for compatibility with older clients.
      past12hMm: null,
      past24hMm: null,
      past48hMm: null,
      past12hIn: null,
      past24hIn: null,
      past48hIn: null,
    },
    note: `Precipitation totals are on conservative zero fallback because upstream data could not be fetched (${fallbackReason}). Verify upstream before relying on this window.`,
    link: buildOpenMeteoRainfallSourceLink(lat, lon),
  };
};

const createPrecipitationService = ({ fetchWithTimeout, requestTimeoutMs }) => {
  const rainfallPayloadCache = new Map();

  const fetchRecentRainfallData = async (lat, lon, targetForecastTimeIso, travelWindowHours, fetchOptions) => {
    const rainfallCacheKey = `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
    const apiUrls = [
      buildOpenMeteoRainfallApiUrl('api.open-meteo.com', lat, lon),
      buildOpenMeteoRainfallApiUrl('customer-api.open-meteo.com', lat, lon),
    ];

    let rainfallJson = null;
    let usingCachedPayload = false;
    let usingStaleCachedPayload = false;
    let usingArchivePayload = false;
    let lastError = null;

    for (const apiUrl of apiUrls) {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const response = await fetchWithTimeout(apiUrl, fetchOptions, Math.max(requestTimeoutMs, 12000));
          if (!response.ok) {
            throw new Error(`Open-Meteo rainfall request failed with status ${response.status}`);
          }
          rainfallJson = await response.json();
          rainfallPayloadCache.set(rainfallCacheKey, {
            fetchedAt: Date.now(),
            payload: rainfallJson,
          });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (rainfallJson) {
        break;
      }
    }

    if (!rainfallJson) {
      const cachedEntry = rainfallPayloadCache.get(rainfallCacheKey);
      const hasCachedPayload = Boolean(cachedEntry && cachedEntry.payload);
      const cachedFresh = hasCachedPayload && Date.now() - Number(cachedEntry.fetchedAt || 0) <= RAINFALL_CACHE_TTL_MS;
      if (cachedFresh) {
        rainfallJson = cachedEntry.payload;
        usingCachedPayload = true;
      } else {
        const staleCachedPayload = hasCachedPayload ? cachedEntry.payload : null;
        const archiveEndDate = new Date().toISOString().slice(0, 10);
        const archiveStartDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const archiveApiUrl = buildOpenMeteoRainfallArchiveApiUrl('archive-api.open-meteo.com', lat, lon, archiveStartDate, archiveEndDate);
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          try {
            const archiveResponse = await fetchWithTimeout(archiveApiUrl, fetchOptions, Math.max(requestTimeoutMs, 12000));
            if (!archiveResponse.ok) {
              throw new Error(`Open-Meteo rainfall archive request failed with status ${archiveResponse.status}`);
            }
            rainfallJson = await archiveResponse.json();
            rainfallPayloadCache.set(rainfallCacheKey, { fetchedAt: Date.now(), payload: rainfallJson });
            usingArchivePayload = true;
            lastError = null;
            break;
          } catch (archiveError) {
            lastError = archiveError;
          }
        }

        if (!rainfallJson) {
          if (staleCachedPayload) {
            rainfallJson = staleCachedPayload;
            usingCachedPayload = true;
            usingStaleCachedPayload = true;
          } else {
            return buildRainfallZeroFallback({
              lat,
              lon,
              targetForecastTimeIso,
              travelWindowHours,
              reason: lastError?.message || 'Open-Meteo rainfall request failed',
            });
          }
        }
      }
    }

    const hourly = rainfallJson?.hourly || {};
    const timeArray = Array.isArray(hourly?.time) ? hourly.time : [];
    const precipArray = Array.isArray(hourly?.precipitation) ? hourly.precipitation : [];
    const rainArray = Array.isArray(hourly?.rain) ? hourly.rain : [];
    const snowfallArray = Array.isArray(hourly?.snowfall) ? hourly.snowfall : [];
    if (!timeArray.length || (!precipArray.length && !rainArray.length && !snowfallArray.length)) {
      return buildRainfallZeroFallback({
        lat,
        lon,
        targetForecastTimeIso,
        travelWindowHours,
        reason: 'timeseries missing from upstream payload',
      });
    }

    const targetTimeMs = parseIsoTimeToMs(targetForecastTimeIso) ?? Date.now();
    const anchorIdx = findClosestTimeIndex(timeArray, targetTimeMs);
    if (anchorIdx < 0) {
      return buildRainfallZeroFallback({
        lat,
        lon,
        targetForecastTimeIso,
        travelWindowHours,
        reason: 'timeseries did not include parsable timestamps',
      });
    }

    const anchorTime = normalizeUtcIsoTimestamp(timeArray[anchorIdx] || null);
    const anchorMs = parseIsoTimeToMs(anchorTime) ?? targetTimeMs;
    const rainSeries = seriesHasFiniteValues(rainArray)
      ? rainArray
      : seriesHasFiniteValues(precipArray)
        ? precipArray
        : rainArray.length
          ? rainArray
          : precipArray;
    const rainPast12hMm = sumRollingAccumulation(timeArray, rainSeries, anchorMs, 12);
    const rainPast24hMm = sumRollingAccumulation(timeArray, rainSeries, anchorMs, 24);
    const rainPast48hMm = sumRollingAccumulation(timeArray, rainSeries, anchorMs, 48);
    const snowPast12hCm = sumRollingAccumulation(timeArray, snowfallArray, anchorMs, 12);
    const snowPast24hCm = sumRollingAccumulation(timeArray, snowfallArray, anchorMs, 24);
    const snowPast48hCm = sumRollingAccumulation(timeArray, snowfallArray, anchorMs, 48);
    const expectedWindowHours = clampTravelWindowHours(travelWindowHours, 12);
    // Archive data is historical only — it has no timestamps beyond today, so searching
    // for a future start time will always return -1. Skip the lookup and mark as unavailable.
    const archiveFutureTarget = usingArchivePayload && targetTimeMs > Date.now() + 60 * 60 * 1000;
    const expectedStartIdx = archiveFutureTarget ? -1 : findFirstTimeIndexAtOrAfter(timeArray, targetTimeMs);
    const expectedStartTime = expectedStartIdx >= 0 ? normalizeUtcIsoTimestamp(timeArray[expectedStartIdx]) : null;
    const expectedStartMs = parseIsoTimeToMs(expectedStartTime);
    const rainWindowMm = expectedStartMs === null ? null : sumForwardAccumulation(timeArray, rainSeries, expectedStartMs, expectedWindowHours);
    const snowWindowCm = expectedStartMs === null ? null : sumForwardAccumulation(timeArray, snowfallArray, expectedStartMs, expectedWindowHours);
    const expectedEndMs = expectedStartMs === null ? null : expectedStartMs + expectedWindowHours * 60 * 60 * 1000;
    const expectedEndTime = expectedEndMs === null ? null : new Date(expectedEndMs).toISOString();
    const expectedHasAnyTotals = [rainWindowMm, snowWindowCm].some((value) => Number.isFinite(value));
    const mode = targetTimeMs > Date.now() + 60 * 60 * 1000 ? 'projected_for_selected_start' : 'observed_recent';
    const hasAnyTotals = [
      rainPast12hMm,
      rainPast24hMm,
      rainPast48hMm,
      snowPast12hCm,
      snowPast24hCm,
      snowPast48hCm,
    ].some((value) => Number.isFinite(value));
    const hasAnyPrecipSignal = hasAnyTotals || expectedHasAnyTotals;

    return {
      source: usingArchivePayload
        ? 'Open-Meteo Archive Precipitation (Rain + Snowfall)'
        : usingStaleCachedPayload
        ? 'Open-Meteo Precipitation History (Rain + Snowfall, stale cached fallback)'
        : usingCachedPayload
        ? 'Open-Meteo Precipitation History (Rain + Snowfall, cached fallback)'
        : 'Open-Meteo Precipitation History (Rain + Snowfall)',
      status: hasAnyPrecipSignal ? 'ok' : 'no_data',
      mode,
      issuedTime: anchorTime,
      anchorTime,
      timezone: rainfallJson?.timezone || 'UTC',
      expected: {
        status: expectedHasAnyTotals ? 'ok' : 'no_data',
        travelWindowHours: expectedWindowHours,
        startTime: expectedStartTime,
        endTime: expectedEndTime,
        rainWindowMm,
        rainWindowIn: mmToInches(rainWindowMm),
        snowWindowCm,
        snowWindowIn: cmToInches(snowWindowCm),
        note: expectedHasAnyTotals
          ? `Expected precipitation totals for the next ${expectedWindowHours}h from selected start time.`
          : archiveFutureTarget
          ? `Archive data is historical only and cannot forecast precipitation for a future start time.`
          : `Expected precipitation totals unavailable for the next ${expectedWindowHours}h from selected start time.`,
      },
      totals: {
        rainPast12hMm,
        rainPast24hMm,
        rainPast48hMm,
        rainPast12hIn: mmToInches(rainPast12hMm),
        rainPast24hIn: mmToInches(rainPast24hMm),
        rainPast48hIn: mmToInches(rainPast48hMm),
        snowPast12hCm,
        snowPast24hCm,
        snowPast48hCm,
        snowPast12hIn: cmToInches(snowPast12hCm),
        snowPast24hIn: cmToInches(snowPast24hCm),
        snowPast48hIn: cmToInches(snowPast48hCm),
        // Legacy aliases retained for compatibility with older clients.
        past12hMm: rainPast12hMm,
        past24hMm: rainPast24hMm,
        past48hMm: rainPast48hMm,
        past12hIn: mmToInches(rainPast12hMm),
        past24hIn: mmToInches(rainPast24hMm),
        past48hIn: mmToInches(rainPast48hMm),
      },
      note:
        hasAnyPrecipSignal
          ? mode === 'projected_for_selected_start'
            ? 'Rolling rain and snowfall totals are anchored to selected start time and can include forecast hours.'
            : 'Rolling rain and snowfall totals are based on recent hours prior to the selected period.'
          : 'Precipitation timeseries exists but rolling totals were not computable for this anchor window.',
      link: buildOpenMeteoRainfallSourceLink(lat, lon),
    };
  };

  return { fetchRecentRainfallData };
};

module.exports = {
  mmToInches,
  cmToInches,
  buildPrecipitationSummaryForAi,
  createUnavailableRainfallData,
  createPrecipitationService,
};
