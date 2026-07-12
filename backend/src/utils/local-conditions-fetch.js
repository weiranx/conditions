/**
 * Fetchers for the Tier B local-conditions providers. Each fetcher resolves
 * to an object with `available: boolean`; none throw out of fetchLocalConditions
 * (failures are logged and reported as unavailable).
 */

const { logger } = require('./logger');
const { createCache, normalizeCoordDateKey } = require('./cache');
const {
  toFiniteOrNull,
  classifyFlowTrend,
  categorizePm25,
  summarizeTides,
  filterClosureAlerts,
  buildLocalConditions,
} = require('./local-conditions');
const { createEnvironmentalObservationService } = require('./environmental-observations');

const yyyymmdd = (dateLike) => {
  const d = dateLike ? new Date(dateLike) : new Date();
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10).replace(/-/g, '');
};

const createLocalConditionsService = ({
  fetchWithTimeout,
  haversineKm,
  requestTimeoutMs = 10000,
  npsApiKey = null,
  firmsMapKey = null,
  tideStationCache = null,
  npsParkCache = null,
} = {}) => {
  const environmentalObservations = createEnvironmentalObservationService({
    fetchWithTimeout,
    haversineKm,
    requestTimeoutMs,
    firmsMapKey,
  });
  const localConditionsCache = createCache({
    name: 'local-conditions',
    ttlMs: 5 * 60 * 1000,
    staleTtlMs: 10 * 60 * 1000,
    maxEntries: 300,
  });
  // ── USGS NWIS streamflow ────────────────────────────────────────────────
  const fetchStreamflow = async ({ lat, lon, fetchOptions }) => {
    const pad = 0.25;
    const west = (lon - pad).toFixed(6);
    const east = (lon + pad).toFixed(6);
    const south = (lat - pad).toFixed(6);
    const north = (lat + pad).toFixed(6);
    const url =
      `https://waterservices.usgs.gov/nwis/iv/?format=json` +
      `&bBox=${west},${south},${east},${north}` +
      `&parameterCd=00060,00065&siteStatus=active&period=P1D`;

    // USGS NWIS runs slower than the other providers; give it more headroom.
    const res = await fetchWithTimeout(url, fetchOptions, Math.max(requestTimeoutMs, 12000));
    if (!res.ok) throw new Error(`USGS NWIS failed ${res.status}`);
    const json = await res.json();
    const series = json?.value?.timeSeries || [];
    if (!series.length) return { available: false };

    // Group time series by site, tracking nearest site to the objective.
    const sites = new Map();
    for (const ts of series) {
      const info = ts?.sourceInfo || {};
      const siteId = info?.siteCode?.[0]?.value || null;
      if (!siteId) continue;
      const siteLat = toFiniteOrNull(info?.geoLocation?.geogLocation?.latitude);
      const siteLon = toFiniteOrNull(info?.geoLocation?.geogLocation?.longitude);
      if (siteLat === null || siteLon === null) continue;
      const paramCode = ts?.variable?.variableCode?.[0]?.value || '';
      const points = (ts?.values?.[0]?.value || [])
        .map((p) => ({ value: toFiniteOrNull(p?.value), dateTime: p?.dateTime || null }))
        .filter((p) => p.value !== null);
      if (!points.length) continue;

      if (!sites.has(siteId)) {
        sites.set(siteId, {
          siteId,
          siteName: info?.siteName || null,
          distanceKm: haversineKm(lat, lon, siteLat, siteLon),
          discharge: null,
          gageHeight: null,
        });
      }
      const entry = sites.get(siteId);
      if (paramCode === '00060') entry.discharge = points;
      else if (paramCode === '00065') entry.gageHeight = points;
    }

    const candidates = [...sites.values()].filter((s) => s.discharge || s.gageHeight);
    if (!candidates.length) return { available: false };
    candidates.sort((a, b) => a.distanceKm - b.distanceKm);
    const nearest = candidates[0];
    if (nearest.distanceKm > 50) return { available: false };

    const dischargeSeries = nearest.discharge || [];
    const gageSeries = nearest.gageHeight || [];
    const latest = (arr) => (arr.length ? arr[arr.length - 1] : null);
    const latestDischarge = latest(dischargeSeries);
    const latestGage = latest(gageSeries);
    const trendSeries = dischargeSeries.length >= 4 ? dischargeSeries : gageSeries;

    const result = {
      available: true,
      siteName: nearest.siteName,
      siteId: nearest.siteId,
      distanceKm: Math.round(nearest.distanceKm * 10) / 10,
      dischargeCfs: latestDischarge ? latestDischarge.value : null,
      gageHeightFt: latestGage ? latestGage.value : null,
      trend: classifyFlowTrend(trendSeries.map((p) => p.value)),
      observedTime: (latestDischarge || latestGage)?.dateTime || null,
      source: 'USGS NWIS',
    };

    // NWPS can add an official forecast or National Water Model guidance to the
    // same USGS identifier. A missing forecast is not a failure of the observed
    // gauge signal.
    try {
      const nwpsRes = await fetchWithTimeout(
        `https://api.water.noaa.gov/nwps/v1/gauges/${encodeURIComponent(nearest.siteId)}/stageflow`,
        fetchOptions,
        Math.max(requestTimeoutMs, 12000),
      );
      if (nwpsRes.ok) {
        const nwps = await nwpsRes.json();
        const forecast = nwps?.forecast || {};
        const rows = Array.isArray(forecast?.data)
          ? forecast.data.filter((row) => Number.isFinite(Number(row?.primary)) || Number.isFinite(Number(row?.secondary)))
          : [];
        if (rows.length) {
          const primaryIsFlow = /flow|discharge/i.test(String(forecast?.primaryName || ''));
          const secondaryIsFlow = /flow|discharge/i.test(String(forecast?.secondaryName || ''));
          const flowMultiplier = /kcfs/i.test(primaryIsFlow ? forecast?.primaryUnits : forecast?.secondaryUnits) ? 1000 : 1;
          const normalizedRows = rows.map((row) => ({
            validTime: row?.validTime || null,
            stageFt: primaryIsFlow ? Number(row?.secondary) : Number(row?.primary),
            flowCfs: (primaryIsFlow ? Number(row?.primary) : secondaryIsFlow ? Number(row?.secondary) : NaN) * flowMultiplier,
          }));
          const peak = normalizedRows.reduce((best, row) => {
            const candidate = Number.isFinite(row.flowCfs) ? row.flowCfs : Number.isFinite(row.stageFt) ? row.stageFt : -Infinity;
            const previous = best && (Number.isFinite(best.flowCfs) ? best.flowCfs : best.stageFt);
            return !best || candidate > previous ? row : best;
          }, null);
          result.forecast = {
            available: true,
            issuedTime: forecast?.issuedTime && !String(forecast.issuedTime).startsWith('0001-') ? forecast.issuedTime : null,
            peakTime: peak?.validTime || null,
            peakFlowCfs: Number.isFinite(peak?.flowCfs) ? Math.round(peak.flowCfs) : null,
            peakStageFt: Number.isFinite(peak?.stageFt) ? Math.round(peak.stageFt * 100) / 100 : null,
            pointCount: normalizedRows.length,
            source: 'NOAA National Water Prediction Service',
            note: 'Forecast applies to the selected gauge. Confirm that the gauge is on the route-crossed drainage.',
          };
          result.source = 'USGS NWIS observations + NOAA NWPS forecast';
        }
      }
    } catch (error) {
      logger.warn({ err: error, siteId: nearest.siteId }, 'NWPS stream forecast enrichment failed');
    }

    return result;
  };

  // ── Smoke / PM2.5 outlook (forward-looking) ─────────────────────────────
  const fetchSmokeOutlook = async ({ lat, lon, fetchOptions }) => {
    const url =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
      `&hourly=pm2_5,us_aqi&forecast_days=2&timezone=UTC`;
    const res = await fetchWithTimeout(url, fetchOptions, requestTimeoutMs);
    if (!res.ok) throw new Error(`Open-Meteo air-quality failed ${res.status}`);
    const json = await res.json();
    const times = json?.hourly?.time || [];
    const pm = json?.hourly?.pm2_5 || [];
    if (!times.length) return { available: false };

    const nowMs = Date.now();
    let startIdx = times.findIndex((t) => Date.parse(`${t}Z`) >= nowMs);
    if (startIdx < 0) startIdx = 0;

    const currentPm25 = toFiniteOrNull(pm[startIdx]);
    let peakPm25 = currentPm25;
    let peakIdx = startIdx;
    const horizon = Math.min(times.length, startIdx + 24);
    for (let i = startIdx; i < horizon; i += 1) {
      const value = toFiniteOrNull(pm[i]);
      if (value !== null && (peakPm25 === null || value > peakPm25)) {
        peakPm25 = value;
        peakIdx = i;
      }
    }
    if (currentPm25 === null && peakPm25 === null) return { available: false };

    return {
      available: true,
      currentPm25: currentPm25 !== null ? Math.round(currentPm25 * 10) / 10 : null,
      currentCategory: categorizePm25(currentPm25),
      peakPm25: peakPm25 !== null ? Math.round(peakPm25 * 10) / 10 : null,
      peakCategory: categorizePm25(peakPm25),
      peakTimeIso: times[peakIdx] ? `${times[peakIdx]}Z` : null,
      horizonHours: horizon - startIdx,
      source: 'Open-Meteo Air Quality (PM2.5 forecast)',
    };
  };

  // ── NOAA CO-OPS tides ───────────────────────────────────────────────────
  const loadTideStations = async (fetchOptions) => {
    const fetchStations = async () => {
      const res = await fetchWithTimeout(
        'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions',
        fetchOptions,
        requestTimeoutMs,
      );
      if (!res.ok) throw new Error(`CO-OPS station list failed ${res.status}`);
      const json = await res.json();
      return (json?.stations || [])
        .map((s) => ({ id: s?.id, name: s?.name, lat: toFiniteOrNull(s?.lat), lng: toFiniteOrNull(s?.lng) }))
        .filter((s) => s.id && s.lat !== null && s.lng !== null);
    };
    if (tideStationCache) return tideStationCache.getOrFetch('co-ops-stations', fetchStations);
    return fetchStations();
  };

  const fetchTides = async ({ lat, lon, selectedDate, fetchOptions }) => {
    const stations = await loadTideStations(fetchOptions);
    if (!stations.length) return { available: false };
    let nearest = null;
    for (const station of stations) {
      const distanceKm = haversineKm(lat, lon, station.lat, station.lng);
      if (!nearest || distanceKm < nearest.distanceKm) {
        nearest = { ...station, distanceKm };
      }
    }
    if (!nearest || nearest.distanceKm > 40) return { available: false };

    const begin = yyyymmdd(selectedDate) || yyyymmdd(new Date());
    const url =
      `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions` +
      `&application=BackcountryConditions&datum=MLLW&interval=hilo&units=english` +
      `&time_zone=lst_ldt&format=json&begin_date=${begin}&range=48&station=${nearest.id}`;
    const res = await fetchWithTimeout(url, fetchOptions, requestTimeoutMs);
    if (!res.ok) throw new Error(`CO-OPS predictions failed ${res.status}`);
    const json = await res.json();
    const summary = summarizeTides(json?.predictions || [], Date.now());
    if (!summary.nextHigh && !summary.nextLow) return { available: false };

    return {
      available: true,
      stationName: nearest.name,
      stationId: nearest.id,
      distanceKm: Math.round(nearest.distanceKm * 10) / 10,
      nextHigh: summary.nextHigh,
      nextLow: summary.nextLow,
      direction: summary.direction,
      source: 'NOAA CO-OPS',
    };
  };

  // ── NPS road / trailhead closures ───────────────────────────────────────
  const loadNpsParks = async (fetchOptions) => {
    const fetchParks = async () => {
      const res = await fetchWithTimeout(
        `https://developer.nps.gov/api/v1/parks?limit=500&fields=&api_key=${npsApiKey}`,
        fetchOptions,
        requestTimeoutMs,
      );
      if (!res.ok) throw new Error(`NPS parks failed ${res.status}`);
      const json = await res.json();
      return (json?.data || [])
        .map((p) => ({
          parkCode: p?.parkCode,
          fullName: p?.fullName,
          lat: toFiniteOrNull(p?.latitude),
          lon: toFiniteOrNull(p?.longitude),
        }))
        .filter((p) => p.parkCode && p.lat !== null && p.lon !== null);
    };
    if (npsParkCache) return npsParkCache.getOrFetch('nps-parks', fetchParks);
    return fetchParks();
  };

  const fetchClosures = async ({ lat, lon, fetchOptions }) => {
    if (!npsApiKey) {
      return { available: false, note: 'Set NPS_API_KEY to enable national-park closures and alerts.' };
    }
    const parks = await loadNpsParks(fetchOptions);
    if (!parks.length) return { available: false };
    let nearest = null;
    try {
      const boundaryParams = new URLSearchParams({
        f: 'json',
        geometry: `${lon},${lat}`,
        geometryType: 'esriGeometryPoint',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'UNIT_CODE,UNIT_NAME,PARKNAME',
        returnGeometry: 'false',
      });
      const boundaryRes = await fetchWithTimeout(
        `https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/NPS_Regional_and_Park_Boundary/FeatureServer/1/query?${boundaryParams.toString()}`,
        fetchOptions,
        requestTimeoutMs,
      );
      if (boundaryRes.ok) {
        const boundaryJson = await boundaryRes.json();
        const boundary = boundaryJson?.features?.[0]?.attributes || null;
        const unitCode = String(boundary?.UNIT_CODE || '').toLowerCase();
        if (unitCode) {
          const matchedPark = parks.find((park) => String(park.parkCode || '').toLowerCase() === unitCode);
          nearest = matchedPark
            ? { ...matchedPark, distanceKm: 0, matchedBy: 'boundary' }
            : { parkCode: unitCode, fullName: boundary?.UNIT_NAME || boundary?.PARKNAME || unitCode.toUpperCase(), distanceKm: 0, matchedBy: 'boundary' };
        }
      }
    } catch (error) {
      logger.warn({ err: error }, 'NPS boundary lookup failed; falling back to nearest park');
    }
    for (const park of parks) {
      const distanceKm = haversineKm(lat, lon, park.lat, park.lon);
      if (!nearest || (nearest.matchedBy !== 'boundary' && distanceKm < nearest.distanceKm)) {
        nearest = { ...park, distanceKm };
      }
    }
    if (!nearest || nearest.distanceKm > 80) return { available: false };

    const res = await fetchWithTimeout(
      `https://developer.nps.gov/api/v1/alerts?parkCode=${nearest.parkCode}&api_key=${npsApiKey}`,
      fetchOptions,
      requestTimeoutMs,
    );
    if (!res.ok) throw new Error(`NPS alerts failed ${res.status}`);
    const json = await res.json();
    const alerts = filterClosureAlerts(json?.data || []);

    return {
      available: true,
      parkName: nearest.fullName,
      parkCode: nearest.parkCode,
      distanceKm: Math.round(nearest.distanceKm * 10) / 10,
      alerts,
      alertCount: alerts.length,
      source: 'National Park Service',
      matchedBy: nearest.matchedBy || 'nearest_park_reference_point',
    };
  };

  const fetchLocalConditionsUncached = async ({ lat, lon, selectedDate, fetchOptions }) => {
    const [streamflow, smoke, tides, closures, weatherObservation, radar, access, wildfire] = await Promise.allSettled([
      fetchStreamflow({ lat, lon, fetchOptions }),
      fetchSmokeOutlook({ lat, lon, fetchOptions }),
      fetchTides({ lat, lon, selectedDate, fetchOptions }),
      fetchClosures({ lat, lon, fetchOptions }),
      environmentalObservations.fetchWeatherObservation({ lat, lon, fetchOptions }),
      environmentalObservations.fetchRadarNowcast({ lat, lon, fetchOptions }),
      environmentalObservations.fetchAccessStatus({ lat, lon, fetchOptions }),
      environmentalObservations.fetchWildfireActivity({ lat, lon, fetchOptions }),
    ]);

    // Do not turn a superseded report's aborted provider results into a fresh
    // all-unavailable cache entry for the next request.
    if (fetchOptions?.signal?.aborted) {
      throw fetchOptions.signal.reason || new Error('Local conditions request aborted');
    }

    const unwrap = (result, label) => {
      if (result.status === 'fulfilled') return result.value;
      logger.warn({ err: result.reason }, `${label} fetch failed`);
      return { available: false };
    };

    return buildLocalConditions({
      streamflow: unwrap(streamflow, 'Streamflow'),
      smoke: unwrap(smoke, 'Smoke outlook'),
      tides: unwrap(tides, 'Tides'),
      closures: closures.status === 'fulfilled' ? closures.value : { available: false },
      weatherObservation: unwrap(weatherObservation, 'Weather observation'),
      radar: unwrap(radar, 'Radar nowcast'),
      access: unwrap(access, 'Access status'),
      wildfire: unwrap(wildfire, 'Wildfire activity'),
    });
  };

  const fetchLocalConditions = ({ lat, lon, selectedDate, fetchOptions }) => {
    const cacheDate = selectedDate || new Date().toISOString().slice(0, 10);
    const cacheKey = normalizeCoordDateKey(lat, lon, cacheDate);
    return localConditionsCache.getOrFetch(cacheKey, () =>
      fetchLocalConditionsUncached({ lat, lon, selectedDate: cacheDate, fetchOptions }));
  };

  return { fetchLocalConditions, fetchStreamflow, fetchSmokeOutlook, fetchTides, fetchClosures };
};

module.exports = { createLocalConditionsService };
