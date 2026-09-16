const { createCache } = require('./cache');
const { haversineKm } = require('./geo');
const { toFiniteOrNull } = require('./local-conditions');
const { createEvidenceFetcher } = require('./evidence-fetch');
const { createNbmService } = require('./nbm-guidance');
const { createHrrrSmokeService } = require('./hrrr-smoke');
const HOUR = 3600000;
const SOURCES = {
  synoptic: { source: 'Synoptic Weather', kind: 'observation', sourceLink: 'https://synopticdata.com/data-viewer/' },
  nbm: { source: 'NOAA National Blend of Models', kind: 'probabilistic_forecast', sourceLink: 'https://vlab.noaa.gov/web/mdl/nbm-text-products' },
  discussion: { source: 'NWS Area Forecast Discussion', kind: 'regional_context', sourceLink: 'https://www.weather.gov/' },
  hrrrSmoke: { source: 'NOAA HRRR-Smoke', kind: 'modeled_forecast', sourceLink: 'https://rapidrefresh.noaa.gov/hrrr/HRRRsmoke/' },
};
const parseSynoptic = (data, { lat, lon, elevationFt, now = Date.now() }) => {
  const variables = { air_temp: ['temperatureF', 'F'], wind_speed: ['windMph', 'Miles/hour'], wind_gust: ['gustMph', 'Miles/hour'] };
  return (data.STATION || []).flatMap((s) => {
    const latitude = toFiniteOrNull(s.LATITUDE), longitude = toFiniteOrNull(s.LONGITUDE);
    if (latitude === null || longitude === null || s.STATUS !== 'ACTIVE' || s.RESTRICTED === true) return [];
    const distanceKm = haversineKm(lat, lon, latitude, longitude);
    if (distanceKm > 50) return [];
    const readings = {};
    for (const [variable, [key, unit]] of Object.entries(variables)) {
      const reportedUnit = String(data.UNITS?.[variable] || '').toLowerCase();
      const allowedUnits = unit === 'F' ? ['f', 'fahrenheit'] : ['miles/hour', 'mph'];
      if (!allowedUnits.includes(reportedUnit)) continue;
      const values = Object.entries(s.OBSERVATIONS || {}).filter(([name]) => name.startsWith(`${variable}_value_`)).map(([, reading]) => reading).filter((reading) => {
        const time = Date.parse(reading?.date_time);
        return toFiniteOrNull(reading?.value) !== null && typeof reading.value !== 'boolean' && Number.isFinite(time) && now - time <= 2 * HOUR && time <= now + 300000 && !(Array.isArray(reading.qc) && reading.qc.length);
      }).sort((a, b) => Date.parse(b.date_time) - Date.parse(a.date_time));
      if (values.length) readings[key] = { value: +Number(values[0].value).toFixed(1), observedTime: values[0].date_time };
    }
    if (!Object.keys(readings).length) return [];
    // Synoptic station metadata elevation is feet (separate from sensor units).
    const stationElevation = toFiniteOrNull(s.ELEVATION);
    return [{ id: String(s.STID), name: String(s.NAME || s.STID), latitude, longitude, elevationFt: stationElevation,
      elevationDifferenceFt: Number.isFinite(elevationFt) && stationElevation !== null ? Math.round(stationElevation - elevationFt) : null,
      distanceKm: +distanceKm.toFixed(1), readings }];
  }).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 3);
};
const createSupplementalEvidenceService = ({ fetchWithTimeout, synopticToken, now = Date.now }) => {
  const getBytes = createEvidenceFetcher(fetchWithTimeout);
  const json = async (url, fetchOptions) => JSON.parse((await getBytes(url, { fetchOptions })).toString());
  const metadata = createCache({ name: 'evidence-nws-metadata', ttlMs: 24 * HOUR, maxEntries: 200 });
  const current = createCache({ name: 'evidence-current', ttlMs: 5 * 60000, maxEntries: 200 });
  const nbm = createNbmService({ getBytes, now });
  const smoke = createHrrrSmokeService({ getBytes, now });
  const point = (lat, lon, options) => metadata.getOrFetch(`point:${lat.toFixed(4)},${lon.toFixed(4)}`, () => json(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, options));
  const stations = async (lat, lon, options) => {
    const p = await point(lat, lon, options);
    const url = p.properties?.observationStations;
    if (!/^https:\/\/api\.weather\.gov\/gridpoints\/[A-Z]{3}\/\d+,\d+\/stations$/.test(url || '')) throw new Error('Invalid station list');
    const data = await metadata.getOrFetch(url, () => json(url, options));
    return (data.features || []).flatMap((f) => {
      const c = f.geometry?.coordinates, p = f.properties;
      if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || !/^\w+$/.test(p?.stationIdentifier || '')) return [];
      const elevation = toFiniteOrNull(p.elevation?.value);
      return [{ id: p.stationIdentifier, name: p.name, latitude: c[1], longitude: c[0], distanceKm: +haversineKm(lat, lon, c[1], c[0]).toFixed(1), elevationFt: elevation === null ? null : Math.round(elevation * 3.28084) }];
    }).sort((a, b) => a.distanceKm - b.distanceKm);
  };
  const discussion = async ({ lat, lon, fetchOptions }) => {
    const p = await point(lat, lon, fetchOptions);
    const office = p.properties?.gridId;
    if (!/^[A-Z]{3}$/.test(office || '')) throw new Error('NWS office unavailable');
    const product = await current.getOrFetch(`afd:${office}`, async () => {
      const list = await json(`https://api.weather.gov/products/types/AFD/locations/${office}`, fetchOptions);
      const latest = (list['@graph'] || []).filter((p) => /^[a-f\d-]{36}$/i.test(p.id || '') && Date.parse(p.issuanceTime) <= now() + 300000).sort((a, b) => Date.parse(b.issuanceTime) - Date.parse(a.issuanceTime))[0];
      if (!latest) throw new Error('No AFD product');
      return json(`https://api.weather.gov/products/${latest.id}`, fetchOptions);
    });
    const issued = Date.parse(product.issuanceTime);
    if (!Number.isFinite(issued) || now() - issued > 24 * HOUR || product.productCode !== 'AFD' || !product.productText?.trim()) return { available: false, status: 'no_data', note: 'No regional forecast discussion issued within the last 24 hours.' };
    return { available: true, status: 'ok', office, issuedTime: product.issuanceTime, text: product.productText.slice(0, 30000), sourceLink: `https://forecast.weather.gov/product.php?site=NWS&issuedby=${office}&product=AFD&format=CI&version=1&glossary=1`, note: 'Forecaster discussion for the entire office region. Read its stated time periods and locations; it is not a forecast at the objective.' };
  };
  const synoptic = async (args) => {
    if (!synopticToken) return { available: false, status: 'not_configured', note: 'Synoptic observations are not configured.' };
    const { lat, lon, fetchOptions } = args;
    const data = await current.getOrFetch(`synoptic:${lat.toFixed(4)},${lon.toFixed(4)}`, async () => {
      const params = new URLSearchParams({ token: synopticToken, radius: `${lat},${lon},31`, limit: '15', within: '120', vars: 'air_temp,wind_speed,wind_gust', units: 'english,speed|mph', obtimezone: 'UTC', status: 'active', qc: 'on', qc_remove_data: 'on', qc_flags: 'on', qc_checks: 'synopticlabs' });
      return json(`https://api.synopticdata.com/v2/stations/latest?${params}`, fetchOptions);
    });
    if (data.SUMMARY?.RESPONSE_CODE !== 1) return { available: false, status: data.SUMMARY?.RESPONSE_CODE === 2 ? 'no_data' : 'unavailable', note: 'No usable station observations were returned.' };
    const matches = parseSynoptic(data, { ...args, now: now() });
    return { available: matches.length > 0, status: matches.length ? 'ok' : 'no_data', stations: matches, note: 'Quality-controlled readings from the last 2 hours. Distance and elevation do not establish equivalent terrain or exposure; these are current observations, not conditions on a future trip.' };
  };
  return async (args) => {
    const flags = args.featureFlags || {};
    const controller = new AbortController();
    const upstream = args.fetchOptions?.signal;
    const abort = () => controller.abort();
    upstream?.addEventListener('abort', abort, { once: true });
    if (upstream?.aborted) abort();
    const timer = setTimeout(abort, 25000);
    args = { ...args, fetchOptions: { ...args.fetchOptions, signal: controller.signal } };
    const definitions = {
      synoptic: [flags.fieldObservations !== false, () => synoptic(args)],
      nbm: [flags.weatherContextDetails !== false, async () => nbm({ ...args, stations: await stations(args.lat, args.lon, args.fetchOptions) })],
      discussion: [flags.weatherContextDetails !== false, () => discussion(args)],
      hrrrSmoke: [flags.airQualityDetails !== false, () => smoke(args)],
    };
    const entries = await Promise.all(Object.entries(definitions).filter(([, [enabled]]) => enabled).map(async ([key, [, run]]) => {
      let value;
      try { value = await run(); }
      catch { value = { available: false, status: 'unavailable', note: 'This source could not be loaded. No absence of hazard is implied.' }; }
      return [key, { ...SOURCES[key], ...value, checkedTime: new Date(now()).toISOString() }];
    }));
    clearTimeout(timer);
    upstream?.removeEventListener('abort', abort);
    upstream?.throwIfAborted();
    return Object.fromEntries(entries);
  };
};
module.exports = { createSupplementalEvidenceService, parseSynoptic };
