'use strict';

const { createSnowpackService } = require('../src/utils/snowpack');

const response = (payload) => ({
  ok: true,
  headers: { get: () => null },
  json: async () => payload,
});

const stationData = (stationTriplet) => [{
  stationTriplet,
  data: [
    {
      stationElement: { elementCode: 'WTEQ' },
      values: [{ date: '2026-01-15', value: 12 }],
    },
    {
      stationElement: { elementCode: 'SNWD' },
      values: [{ date: '2026-01-15', value: 48 }],
    },
    {
      stationElement: { elementCode: 'PREC' },
      values: [{ date: '2026-01-15', value: 20 }],
    },
    {
      stationElement: { elementCode: 'TOBS' },
      values: [{ date: '2026-01-15', value: 25 }],
    },
  ],
}];

const stations = [
  { stationTriplet: 'ONE:XX:SNTL', stationId: '1', networkCode: 'SNTL', name: 'One', latitude: 40, longitude: -111, elevation: 9000 },
  { stationTriplet: 'TWO:XX:SNTL', stationId: '2', networkCode: 'SNTL', name: 'Two', latitude: 40.1, longitude: -111, elevation: 8500 },
  { stationTriplet: 'THREE:XX:SNTL', stationId: '3', networkCode: 'SNTL', name: 'Three', latitude: 40.2, longitude: -111, elevation: 8000 },
];

const createTestService = ({ failDetailed = false, failNearbyBatch = false } = {}) => {
  const requestedUrls = [];
  const fetchWithTimeout = jest.fn(async (url) => {
    requestedUrls.push(url);
    if (url.includes('/stations?')) return response(stations);
    if (url.includes('/data?stationTriplets=')) {
      if (failDetailed && url.includes('elements=WTEQ,SNWD,PREC,TOBS')) return { ok: false };
      const triplets = new URL(url).searchParams.get('stationTriplets').split(',');
      if (failNearbyBatch && triplets.length > 1) return { ok: false };
      return response(triplets.flatMap(stationData));
    }
    if (url.includes('/NOHRSC_Snow_Analysis/')) {
      return response({
        results: [
          { layerId: 3, attributes: { 'Service Pixel Value': 0.5 } },
          { layerId: 7, attributes: { 'Service Pixel Value': 100 } },
        ],
      });
    }
    if (url.includes('cmr.earthdata.nasa.gov')) return response({ feed: { entry: [] } });
    return response({});
  });
  const service = createSnowpackService({
    fetchWithTimeout,
    formatIsoDateUtc: (date) => date.toISOString().slice(0, 10),
    shiftIsoDateUtc: (isoDate, days) => {
      const date = new Date(`${isoDate}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    },
    haversineKm: (_lat, _lon, stationLat) => Math.abs(stationLat - 40) * 100,
  });
  return { requestedUrls, service };
};

test('snowpack reuses and batches SNOTEL data for nearby consensus', async () => {
  const { requestedUrls, service } = createTestService();
  const result = await service.fetchSnowpackData(40, -111, '2026-01-15', {});
  const stationRequests = requestedUrls.filter((url) => url.includes('/data?stationTriplets='));

  expect(stationRequests).toHaveLength(2);
  expect(stationRequests.filter((url) => url.includes('ONE%3AXX%3ASNTL'))).toHaveLength(1);
  expect(stationRequests.some((url) => (
    url.includes('TWO%3AXX%3ASNTL%2CTHREE%3AXX%3ASNTL')
  ))).toBe(true);
  expect(result.snotel.stationTriplet).toBe('ONE:XX:SNTL');
  expect(result.snotelStations.map((station) => station.stationTriplet)).toEqual([
    'ONE:XX:SNTL',
    'TWO:XX:SNTL',
    'THREE:XX:SNTL',
  ]);
});

test('snowpack keeps a short nearest-station fallback when the detailed request fails', async () => {
  const { requestedUrls, service } = createTestService({ failDetailed: true });
  const result = await service.fetchSnowpackData(40, -111, '2026-01-15', {});
  const stationRequests = requestedUrls.filter((url) => url.includes('/data?stationTriplets='));

  expect(stationRequests).toHaveLength(3);
  expect(stationRequests.filter((url) => url.includes('ONE%3AXX%3ASNTL'))).toHaveLength(2);
  expect(result.snotel).toBeNull();
  expect(result.snotelStations.map((station) => station.stationTriplet)).toEqual([
    'ONE:XX:SNTL',
    'TWO:XX:SNTL',
    'THREE:XX:SNTL',
  ]);
});

test('snowpack falls back to individual nearby requests when a batch fails', async () => {
  const { requestedUrls, service } = createTestService({ failNearbyBatch: true });
  const result = await service.fetchSnowpackData(40, -111, '2026-01-15', {});
  const stationRequests = requestedUrls.filter((url) => url.includes('/data?stationTriplets='));

  expect(stationRequests).toHaveLength(4);
  expect(result.snotelStations.map((station) => station.stationTriplet)).toEqual([
    'ONE:XX:SNTL',
    'TWO:XX:SNTL',
    'THREE:XX:SNTL',
  ]);
});
