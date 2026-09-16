const { parseSynoptic, createSupplementalEvidenceService } = require('../src/utils/supplemental-evidence');
const { parseNbp } = require('../src/utils/nbm-guidance');
const { smokeRanges, normalizeSmoke, createHrrrSmokeService } = require('../src/utils/hrrr-smoke');
const { createEvidenceFetcher } = require('../src/utils/evidence-fetch');
const { buildAirNowUrl, parseAirNowObservations } = require('../src/utils/airnow-observations');
const { createUsgsWaterService } = require('../src/utils/usgs-water');
const { haversineKm } = require('../src/utils/geo');
const { sanitizeReportForFeatureFlags } = require('../src/utils/report-feature-filter');
const now = Date.parse('2026-09-16T21:00:00Z');
const fresh = '2026-09-16T20:50:00Z';
const location = { lat: 32.7, lon: -117.2, now };
const jsonResponse = (value) => ({ ok: true, json: async () => value });

test('Synoptic rejects stale, missing, flagged and unsupported-unit readings while retaining zero', () => {
  const data = { UNITS: { air_temp: 'Fahrenheit', wind_speed: 'Miles/hour', wind_gust: 'Miles/hour' }, STATION: [{
    STID: 'TEST', NAME: 'Test ridge', STATUS: 'ACTIVE', LATITUDE: '32.7', LONGITUDE: '-117.2', ELEVATION: '5000',
    OBSERVATIONS: { air_temp_value_1: { value: null, date_time: fresh }, air_temp_value_2: { value: 30, date_time: fresh, qc: ['range'] }, wind_speed_value_1: { value: 0, date_time: fresh }, wind_gust_value_1: { value: 50, date_time: '2026-09-16T15:00:00Z' } },
  }] };
  const result = parseSynoptic(data, { ...location, elevationFt: 6000 });
  expect(result).toHaveLength(1);
  expect(result[0].readings).toEqual({ windMph: { value: 0, observedTime: fresh } });
  expect(result[0].elevationDifferenceFt).toBe(-1000);
  data.UNITS.wind_speed = 'm/s';
  expect(parseSynoptic(data, location)).toEqual([]);
});

test('NBP preserves fixed columns, genuine calm, valid times and ordered percentiles', () => {
  const block = ' KSAN    NBM V5.0 NBP GUIDANCE    9/16/2026  1900 UTC\n FHR    17| 29  41\n WSPP1   0|      3\n WSPP5   2|  9   2\n WSPP9   4| 10   5';
  const result = parseNbp(block);
  expect(result.issuedTime).toBe('2026-09-16T19:00:00.000Z');
  expect(result.points).toEqual([{ validTime: '2026-09-17T12:00:00.000Z', windMph: { p10: 0, p50: 2.3, p90: 4.6 } }]);
});

const decoded = () => [0, 1].map((parameter) => ({ value: parameter ? 0.000002 : 0.000000005, units: 'unknown', centre: 'kwbc', discipline: 0, category: 20, parameter, surfaceType: parameter ? 200 : 103, level: parameter ? 0 : 8, distanceKm: 2, latitude: 32.7, longitude: 242.8, validDate: 20260916, validClock: 2100 }));
test('HRRR validates parameter, time, distance and unit identity before converting smoke', () => {
  const rows = decoded();
  expect(normalizeSmoke(rows, '2026-09-16T21:00:00Z')).toMatchObject({ nearSurfaceUgM3: 5, columnMgM2: 2, gridDistanceKm: 2 });
  rows[0].value = 0;
  expect(normalizeSmoke(rows, '2026-09-16T21:00:00Z').nearSurfaceUgM3).toBe(0);
  expect(() => normalizeSmoke(rows, '2026-09-17T21:00:00Z')).toThrow();
  rows[0].category = 0;
  expect(() => normalizeSmoke(rows, '2026-09-16T21:00:00Z')).toThrow();
  rows[0] = { ...decoded()[0], distanceKm: 11 };
  expect(() => normalizeSmoke(rows, '2026-09-16T21:00:00Z')).toThrow();
});
test('HRRR requests only bounded messages and refuses a missing column field', () => {
  expect(smokeRanges('1:0:d=2026091618:MASSDEN:8 m above ground:3 hour fcst:\n2:12:d=x:OTHER:\n3:20:d=x:COLMD:entire atmosphere (considered as a single layer):3 hour fcst:\n4:40:d=x:OTHER:')).toEqual(['bytes=0-11', 'bytes=20-39']);
  expect(() => smokeRanges('1:0:d=x:MASSDEN:8 m above ground:\n2:12:d=x:OTHER:')).toThrow();
});
test('HRRR does no network work for an unsupported region or forecast horizon', async () => {
  const getBytes = jest.fn();
  const service = createHrrrSmokeService({ getBytes, now: () => now });
  expect((await service({ lat: 60, lon: -150, targetTimeIso: fresh })).status).toBe('out_of_range');
  expect((await service({ lat: 32, lon: -117, targetTimeIso: '2026-09-25T12:00:00Z' })).status).toBe('out_of_range');
  expect(getBytes).not.toHaveBeenCalled();
});
test('bounded fetch rejects ignored ranges, mismatched ranges and oversized bodies', async () => {
  const ignored = createEvidenceFetcher(async () => new Response('payload'));
  await expect(ignored('https://example.test', { range: 'bytes=0-6' })).rejects.toThrow('HTTP 200');
  const wrong = createEvidenceFetcher(async () => new Response('payload', { status: 206, headers: { 'content-range': 'bytes 1-7/100' } }));
  await expect(wrong('https://example.test', { range: 'bytes=0-6' })).rejects.toThrow('byte range');
  await expect(ignored('https://example.test', { maxBytes: 2 })).rejects.toThrow('too large');
});

test('AirNow uses the monitoring-site API and latest fresh AQI, never concentration as AQI', () => {
  const url = new URL(buildAirNowUrl({ ...location, apiKey: 'test-token' }));
  expect(url.pathname).toBe('/aq/data/');
  expect(url.searchParams.get('startDate')).toBe('2026-09-16T18');
  const row = { Latitude: 32.7, Longitude: -117.2, Parameter: 'PM2.5', Value: 99, AQI: 0, UTC: '2026-09-16T20:00', SiteName: 'Monitor' };
  const results = parseAirNowObservations([{ ...row, UTC: '2026-09-16T19:00', AQI: 90 }, row, { ...row, Parameter: 'OZONE', AQI: null }, { ...row, UTC: '2026-09-16T10:00', AQI: 200 }, { ...row, Latitude: 40, AQI: 300 }], location);
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ aqi: 0, observedTime: '2026-09-16T20:00Z' });
});

const gauge = (id, code, value, time = fresh, units = code === '00060' ? 'ft3/s' : 'ft') => ({ geometry: { coordinates: [-117.2, 32.7] }, properties: { monitoring_location_id: id, parameter_code: code, value, time, unit_of_measure: units } });
test('modern USGS adapter filters stale/null/unsupported data, retains zero, fetches matching history', async () => {
  const fetchWithTimeout = jest.fn(async (url) => {
    const u = new URL(url);
    if (u.pathname.includes('/latest-continuous/')) return jsonResponse({ features: u.searchParams.get('parameter_code') === '00060' ? [gauge('USGS-old', '00060', 100, '2026-09-16T10:00:00Z'), gauge('USGS-null', '00060', null), gauge('USGS-units', '00060', 20, fresh, 'm3/s'), gauge('USGS-123', '00060', 0)] : [gauge('USGS-123', '00065', 1.2)] });
    if (u.pathname.includes('/monitoring-locations/')) return jsonResponse({ properties: { monitoring_location_name: 'Test Creek' } });
    return jsonResponse({ features: [3, 2, 1, 0].map((value, i) => gauge('USGS-123', '00060', value, `2026-09-16T${17 + i}:00:00Z`)) });
  });
  const result = await createUsgsWaterService({ fetchWithTimeout, haversineKm, apiKey: 'test', now: () => now })(location);
  expect(result).toMatchObject({ available: true, siteId: '123', siteName: 'Test Creek', dischargeCfs: 0, gageHeightFt: 1.2, trend: 'falling' });
  expect(fetchWithTimeout.mock.calls.every(([url]) => !url.includes('waterservices'))).toBe(true);
  expect(fetchWithTimeout.mock.calls[0][1].headers['X-Api-Key']).toBe('test');
});
test('truncated gauge searches do not claim the selected gauge is nearest', async () => {
  const service = createUsgsWaterService({ fetchWithTimeout: async () => jsonResponse({ links: [{ rel: 'next' }], features: [gauge('USGS-1', '00060', 2)] }), haversineKm, now: () => now });
  expect(await service(location)).toMatchObject({ available: false, status: 'incomplete' });
});
test('feature switches suppress requests and remove supplementary data from saved report inputs', async () => {
  const featureFlags = { fieldObservations: false, weatherContextDetails: false, airQualityDetails: false };
  const fetchWithTimeout = jest.fn();
  const service = createSupplementalEvidenceService({ fetchWithTimeout });
  expect(await service({ ...location, featureFlags })).toEqual({});
  expect(fetchWithTimeout).not.toHaveBeenCalled();
  const filtered = sanitizeReportForFeatureFlags({ supplementalEvidence: { synoptic: {}, nbm: {}, discussion: {}, hrrrSmoke: {} } }, featureFlags);
  expect(filtered.supplementalEvidence).toEqual({});
});

test('NWS discussion preserves regional prose and rejects an expired product', async () => {
  let issuanceTime = fresh;
  const fetchWithTimeout = jest.fn(async (url) => new Response(JSON.stringify(
    url.includes('/points/') ? { properties: { gridId: 'SGX' } }
      : url.includes('/types/') ? { '@graph': [{ id: '12345678-1234-1234-1234-123456789012', issuanceTime: fresh }] }
        : { productCode: 'AFD', issuanceTime, productText: 'Regional winds increase tomorrow.' }
  )));
  const args = { ...location, featureFlags: { fieldObservations: false, airQualityDetails: false }, targetTimeIso: fresh };
  const first = await createSupplementalEvidenceService({ fetchWithTimeout, now: () => now })(args);
  expect(first.discussion).toMatchObject({ available: true, kind: 'regional_context', office: 'SGX', text: 'Regional winds increase tomorrow.' });
  expect(first.nbm.available).toBe(false); // Failed station lookup does not hide AFD.
  issuanceTime = '2026-09-14T12:00:00Z';
  const expired = await createSupplementalEvidenceService({ fetchWithTimeout, now: () => now })(args);
  expect(expired.discussion).toMatchObject({ available: false, status: 'no_data' });
});

test('source failures never expose credential-bearing fetch errors', async () => {
  const service = createSupplementalEvidenceService({ synopticToken: 'private-token', fetchWithTimeout: async () => { throw new Error('https://api.synopticdata.com/?token=private-token'); } });
  const result = await service({ ...location, targetTimeIso: fresh, featureFlags: { weatherContextDetails: false, airQualityDetails: false } });
  expect(result.synoptic).toMatchObject({ available: false, status: 'unavailable' });
  expect(JSON.stringify(result)).not.toContain('private-token');
});
