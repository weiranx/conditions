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

const viirsGranule = {
  title: 'VNP10A1F.A2026015.h09v04.002',
  time_start: '2026-01-15T00:00:00.000Z',
  updated: '2026-01-16T03:00:00.000Z',
  links: [],
};

const createTestService = ({
  failDetailed = false,
  failNearbyBatch = false,
  cmr = async () => response({ feed: { entry: [] } }),
} = {}) => {
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
    if (url.includes('cmr.earthdata.nasa.gov')) return cmr();
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

test('snowpack attaches VIIRS metadata that arrives with the other sources', async () => {
  const { service } = createTestService({ cmr: async () => response({ feed: { entry: [viirsGranule] } }) });
  const result = await service.fetchSnowpackData(40, -111, '2026-01-15', {});

  expect(result.viirs).toMatchObject({ status: 'metadata_available', granuleId: viirsGranule.title });
});

test('snowpack does not wait for a slow VIIRS lookup and reuses it once it arrives', async () => {
  let releaseCmr;
  const { requestedUrls, service } = createTestService({
    cmr: () => new Promise((resolve) => {
      releaseCmr = () => resolve(response({ feed: { entry: [viirsGranule] } }));
    }),
  });

  const first = await service.fetchSnowpackData(40, -111, '2026-01-15', {});
  expect(first.snotel.stationTriplet).toBe('ONE:XX:SNTL');
  expect(first.viirs).toBeNull();

  releaseCmr();
  await new Promise((resolve) => setImmediate(resolve));
  const second = await service.fetchSnowpackData(40, -111, '2026-01-15', {});

  expect(second.viirs).toMatchObject({ granuleId: viirsGranule.title });
  expect(requestedUrls.filter((url) => url.includes('cmr.earthdata.nasa.gov'))).toHaveLength(1);
});

test('future report dates share one snowpack lookup', async () => {
  const { requestedUrls, service } = createTestService();
  const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

  const [tomorrow, nextDay] = await Promise.all([
    service.fetchSnowpackData(40, -111, day(1), {}),
    service.fetchSnowpackData(40, -111, day(2), {}),
  ]);
  const today = await service.fetchSnowpackData(40, -111, day(0), {});
  const detailedRequests = requestedUrls.filter((url) => url.includes('elements=WTEQ,SNWD,PREC,TOBS'));

  expect(nextDay).toEqual(tomorrow);
  expect(tomorrow.snotel.note).toMatch(/future/);
  expect(today.snotel.note).toBe('Nearest daily SNOTEL observation.');
  expect(detailedRequests).toHaveLength(2);
});
