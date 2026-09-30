'use strict';

const { createSnowpackService } = require('../src/utils/snowpack');

const response = (payload) => ({
  ok: true,
  headers: { get: () => null },
  json: async () => payload,
});

const ELEMENT_VALUES = { WTEQ: 12, SNWD: 48, PREC: 20, TOBS: 25 };
// The API answers with the elements that were asked for.
const stationData = (stationTriplet, elements = Object.keys(ELEMENT_VALUES)) => [{
  stationTriplet,
  data: elements.map((elementCode) => ({
    stationElement: { elementCode },
    values: [{ date: '2026-01-15', value: ELEMENT_VALUES[elementCode] }],
  })),
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

const isCurrentRequest = (url) => url.includes('elements=WTEQ,SNWD,PREC,TOBS');
const isHistoryRequest = (url) => url.includes('elements=WTEQ,SNWD&');
const isNearbyBatch = (url) => url.includes('elements=WTEQ,SNWD,TOBS');
const isStationDataRequest = (url) => url.includes('/data?stationTriplets=');
const requestedDays = (url) => {
  const params = new URL(url).searchParams;
  return Math.round((Date.parse(params.get('endDate')) - Date.parse(params.get('beginDate'))) / 86400000);
};

const createTestService = ({
  failDetailed = false,
  failNearbyBatch = false,
  cmr = async () => response({ feed: { entry: [] } }),
  stationCatalog = async () => response(stations),
  history = null,
} = {}) => {
  const requestedUrls = [];
  const fetchWithTimeout = jest.fn(async (url) => {
    requestedUrls.push(url);
    if (url.includes('/stations?')) return stationCatalog();
    if (isStationDataRequest(url)) {
      if (failDetailed === 'current' && isCurrentRequest(url)) return { ok: false };
      if (failDetailed === 'history' && isHistoryRequest(url)) return { ok: false };
      if (failDetailed === true && (isCurrentRequest(url) || isHistoryRequest(url))) return { ok: false };
      const params = new URL(url).searchParams;
      const triplets = params.get('stationTriplets').split(',');
      if (failNearbyBatch && triplets.length > 1) return { ok: false };
      const elements = params.get('elements').split(',');
      if (history && isHistoryRequest(url)) return response(history(triplets[0], elements));
      return response(triplets.flatMap((triplet) => stationData(triplet, elements)));
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
  return { requestedUrls, service, fetchWithTimeout };
};

test('snowpack reuses and batches SNOTEL data for nearby consensus', async () => {
  const { requestedUrls, service } = createTestService();
  const result = await service.fetchSnowpackData(40, -111, '2026-01-15', {});
  const stationRequests = requestedUrls.filter(isStationDataRequest);

  // The nearest station is asked for its current readings and its history; the other two in one batch.
  expect(stationRequests).toHaveLength(3);
  expect(stationRequests.filter((url) => url.includes('ONE%3AXX%3ASNTL'))).toHaveLength(2);
  expect(stationRequests.filter(isCurrentRequest)).toHaveLength(1);
  expect(stationRequests.filter(isHistoryRequest)).toHaveLength(1);
  expect(stationRequests.some((url) => (
    isNearbyBatch(url) && url.includes('TWO%3AXX%3ASNTL%2CTHREE%3AXX%3ASNTL')
  ))).toBe(true);
  expect(result.snotel.stationTriplet).toBe('ONE:XX:SNTL');
  expect(result.snotelStations.map((station) => station.stationTriplet)).toEqual([
    'ONE:XX:SNTL',
    'TWO:XX:SNTL',
    'THREE:XX:SNTL',
  ]);
});

test.each(['current', 'history', true])('snowpack keeps a short nearest-station fallback when the detailed request fails (%s)', async (failDetailed) => {
  const { requestedUrls, service } = createTestService({ failDetailed });
  const result = await service.fetchSnowpackData(40, -111, '2026-01-15', {});
  const stationRequests = requestedUrls.filter(isStationDataRequest);

  // Current readings, history, the short fallback for the nearest station, and the nearby batch.
  expect(stationRequests).toHaveLength(4);
  expect(stationRequests.filter((url) => url.includes('ONE%3AXX%3ASNTL'))).toHaveLength(3);
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
  const stationRequests = requestedUrls.filter(isStationDataRequest);

  expect(stationRequests).toHaveLength(5);
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
  const detailedRequests = requestedUrls.filter(isCurrentRequest);

  expect(nextDay).toEqual(tomorrow);
  expect(tomorrow.snotel.note).toMatch(/future/);
  expect(today.snotel.note).toBe('Nearest daily SNOTEL observation.');
  // A future date reads the latest observations, which is today's: all three share one station lookup.
  expect(detailedRequests).toHaveLength(1);
  expect(requestedUrls.filter(isHistoryRequest)).toHaveLength(1);
});

test('the history asks only for snow water equivalent and depth over ten years, the current readings for a month', async () => {
  const { requestedUrls, service } = createTestService();
  await service.fetchSnowpackData(40, -111, '2026-01-15', {});
  const [current] = requestedUrls.filter(isCurrentRequest);
  const [history] = requestedUrls.filter(isHistoryRequest);

  expect(requestedDays(current)).toBeLessThanOrEqual(31);
  expect(requestedDays(history)).toBeGreaterThan(3600);
  expect(history).not.toMatch(/PREC|TOBS/);
  // Both end on the report date, for the one nearest station.
  expect(new URL(current).searchParams.get('endDate')).toBe('2026-01-15');
  expect(new URL(history).searchParams.get('endDate')).toBe('2026-01-15');
  expect(new URL(history).searchParams.get('stationTriplets')).toBe('ONE:XX:SNTL');
});

test('the comparison with earlier years is the same as when one request carried everything', async () => {
  // 12 in of water and 48 in of snow on 2026-01-15; the ten earlier years averaged 10 in and 40 in.
  const history = (stationTriplet, elements) => [{
    stationTriplet,
    data: elements.map((elementCode) => ({
      stationElement: { elementCode },
      values: [
        ...Array.from({ length: 10 }, (_, index) => ({ date: `${2016 + index}-01-15`, value: elementCode === 'WTEQ' ? 10 : 40 })),
        { date: '2026-01-15', value: elementCode === 'WTEQ' ? 12 : 48 },
      ],
    })),
  }];
  const { service } = createTestService({ history });
  const { snotel } = await service.fetchSnowpackData(40, -111, '2026-01-15', {});

  expect(snotel).toMatchObject({
    stationTriplet: 'ONE:XX:SNTL',
    snowDepthIn: 48,
    sweIn: 12,
    precipIn: 20,
    obsTempF: 25,
    observedDate: '2026-01-15',
    distanceKm: 0,
  });
  expect(snotel.historical).toEqual({
    targetDate: '2026-01-15',
    monthDay: '01-15',
    lookbackYears: 10,
    source: 'NRCS AWDB / SNOTEL daily history',
    stationTriplet: 'ONE:XX:SNTL',
    stationName: 'One',
    swe: { currentIn: 12, averageIn: 10, status: 'above_average', percentOfAverage: 120, sampleCount: 10, maxOffsetDays: 0 },
    depth: { currentIn: 48, averageIn: 40, status: 'above_average', percentOfAverage: 120, sampleCount: 10, maxOffsetDays: 0 },
    overall: { metric: 'SWE', status: 'above_average', percentOfAverage: 120 },
    summary: 'Current SWE is above average for this date (120% of historical average).',
  });
});

test('nearby objectives and concurrent reports share one lookup for the same station and date', async () => {
  const { requestedUrls, service } = createTestService();
  const [north, south] = await Promise.all([
    service.fetchSnowpackData(40.001, -111, '2026-01-15', {}),
    service.fetchSnowpackData(40.002, -111.001, '2026-01-15', {}),
  ]);
  const later = await service.fetchSnowpackData(40.003, -111.002, '2026-01-15', {});

  expect(requestedUrls.filter(isCurrentRequest)).toHaveLength(1);
  expect(requestedUrls.filter(isHistoryRequest)).toHaveLength(1);
  expect(north.snotel.historical).toEqual(south.snotel.historical);
  expect(later.snotel).toMatchObject({ stationTriplet: 'ONE:XX:SNTL', sweIn: 12 });

  await service.fetchSnowpackData(40.004, -111.003, '2026-01-16', {});
  expect(requestedUrls.filter(isHistoryRequest)).toHaveLength(2);
});

test('a station lookup that failed is not remembered', async () => {
  const { requestedUrls, service } = createTestService({ failDetailed: 'history' });
  expect((await service.fetchSnowpackData(40, -111, '2026-01-15', {})).snotel).toBeNull();
  expect((await service.fetchSnowpackData(40.5, -111, '2026-01-15', {})).snotel).toBeNull();
  // Each report asked again instead of reusing the failure.
  expect(requestedUrls.filter(isHistoryRequest)).toHaveLength(2);
});

test('the bundled station catalog answers the first reports without waiting for the USDA server', async () => {
  const { requestedUrls, service } = createTestService({ stationCatalog: () => new Promise(() => {}) });
  service.seedSnotelStations();
  const result = await service.fetchSnowpackData(40, -111, '2026-01-15', {});

  expect(requestedUrls.some((url) => url.includes('/stations?'))).toBe(false);
  expect(result.snotel).toMatchObject({ status: 'ok' });
  expect(result.snotel.stationTriplet).toMatch(/:(SNTL|SNTLT|MSNT)$/);
  expect(result.snotelStations.length).toBeGreaterThan(0);
});

test('prewarming swaps the live catalog in for the bundled one, and never an empty answer', async () => {
  const live = createTestService();
  live.service.seedSnotelStations();
  await live.service.prewarmSnotelStations({});
  expect((await live.service.fetchSnowpackData(40, -111, '2026-01-15', {})).snotel.stationTriplet).toBe('ONE:XX:SNTL');

  for (const stationCatalog of [async () => response([]), async () => ({ ok: false, status: 503 }), async () => { throw new Error('offline'); }]) {
    const broken = createTestService({ stationCatalog });
    broken.service.seedSnotelStations();
    await broken.service.prewarmSnotelStations({});
    const result = await broken.service.fetchSnowpackData(40, -111, '2026-01-15', {});
    expect(result.snotel.stationTriplet).not.toBe('ONE:XX:SNTL');
    expect(result.snotel.status).toBe('ok');
  }
});

test('without a bundled catalog the first report loads it, and an empty answer is not remembered', async () => {
  let catalog = [];
  const { service, requestedUrls } = createTestService({ stationCatalog: async () => response(catalog) });
  const first = await service.fetchSnowpackData(40, -111, '2026-01-15', {});
  expect(first.snotel).toBeNull();

  catalog = stations;
  const second = await service.fetchSnowpackData(40.5, -111, '2026-01-15', {});
  expect(second.snotel.stationTriplet).toBe('ONE:XX:SNTL');
  expect(requestedUrls.filter((url) => url.includes('/stations?'))).toHaveLength(2);
});
