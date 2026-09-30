'use strict';

const { createSnowpackService } = require('../src/utils/snowpack');

const response = (payload) => ({
  ok: true,
  headers: { get: () => null },
  json: async () => payload,
});

// One station's daily readings, as the API holds them: a request gets the readings between its dates.
const readings = (values) => Object.fromEntries(Object.entries(values).map(([element, value]) => [element, [{ date: '2026-01-15', value }]]));
const CURRENT_READINGS = readings({ WTEQ: 12, SNWD: 48, PREC: 20, TOBS: 25 });
const stationData = (stationTriplet, elements, series, { beginDate, endDate }) => [{
  stationTriplet,
  data: elements.map((elementCode) => ({
    stationElement: { elementCode },
    values: (series[elementCode] || []).filter(({ date }) => (!beginDate || date >= beginDate) && (!endDate || date <= endDate)),
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
// The history is asked for as one week of each earlier year.
const isWeekRequest = (url) => isHistoryRequest(url) && requestedDays(url) === 7;
const isLongRequest = (url) => isHistoryRequest(url) && requestedDays(url) > 3000;
const dates = (url) => {
  const params = new URL(url).searchParams;
  return { beginDate: params.get('beginDate'), endDate: params.get('endDate') };
};

const createTestService = ({
  failDetailed = false,
  failNearbyBatch = false,
  cmr = async () => response({ feed: { entry: [] } }),
  stationCatalog = async () => response(stations),
  series = CURRENT_READINGS,
  failFirstAttempt = () => false,
} = {}) => {
  const requestedUrls = [];
  const failedOnce = new Set();
  const fetchWithTimeout = jest.fn(async (url) => {
    requestedUrls.push(url);
    if (url.includes('/stations?')) return stationCatalog();
    if (isStationDataRequest(url)) {
      if (failDetailed === 'current' && isCurrentRequest(url)) return { ok: false };
      if (failDetailed === 'history' && isHistoryRequest(url)) return { ok: false };
      if (failDetailed === true && (isCurrentRequest(url) || isHistoryRequest(url))) return { ok: false };
      if (failFirstAttempt(url) && !failedOnce.has(url)) {
        failedOnce.add(url);
        return { ok: false };
      }
      const params = new URL(url).searchParams;
      const triplets = params.get('stationTriplets').split(',');
      if (failNearbyBatch && triplets.length > 1) return { ok: false };
      const elements = params.get('elements').split(',');
      return response(triplets.flatMap((triplet) => stationData(triplet, elements, series, dates(url))));
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

  // The nearest station is asked for its current readings and ten weeks of history; the other two in one batch.
  expect(stationRequests).toHaveLength(12);
  expect(stationRequests.filter((url) => url.includes('ONE%3AXX%3ASNTL'))).toHaveLength(11);
  expect(stationRequests.filter(isCurrentRequest)).toHaveLength(1);
  expect(stationRequests.filter(isWeekRequest)).toHaveLength(10);
  expect(stationRequests.filter(isLongRequest)).toHaveLength(0);
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

test.each([
  ['current', 1, 10],
  ['history', 1, 20],
  [true, 1, 20],
])('snowpack keeps a short nearest-station fallback when the detailed requests fail (%s)', async (failDetailed, currentRequests, weekRequests) => {
  const { requestedUrls, service } = createTestService({ failDetailed });
  const result = await service.fetchSnowpackData(40, -111, '2026-01-15', {});
  const stationRequests = requestedUrls.filter(isStationDataRequest);
  const shortFallbacks = stationRequests.filter((url) => isNearbyBatch(url) && url.includes('stationTriplets=ONE%3AXX%3ASNTL&'));

  expect(stationRequests.filter(isCurrentRequest)).toHaveLength(currentRequests);
  // Every week is tried twice before the history is given up.
  expect(stationRequests.filter(isWeekRequest)).toHaveLength(weekRequests);
  expect(shortFallbacks).toHaveLength(1);
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

  // Current readings, ten weeks, the batch that failed and one request for each of the two stations in it.
  expect(stationRequests).toHaveLength(14);
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

  expect(nextDay).toEqual(tomorrow);
  expect(tomorrow.snotel.note).toMatch(/future/);
  expect(today.snotel.note).toBe('Nearest daily SNOTEL observation.');
  // A future date reads the latest observations, which is today's: all three share one station lookup.
  expect(requestedUrls.filter(isCurrentRequest)).toHaveLength(1);
  expect(requestedUrls.filter(isWeekRequest)).toHaveLength(10);
});

test('the history asks for one week of each of the last ten years, only snow water equivalent and depth', async () => {
  const { requestedUrls, service } = createTestService();
  await service.fetchSnowpackData(40, -111, '2026-01-15', {});
  const weeks = requestedUrls.filter(isHistoryRequest);
  const [current] = requestedUrls.filter(isCurrentRequest);

  expect(weeks.map(dates)).toEqual(Array.from({ length: 10 }, (_, index) => {
    const year = 2025 - index;
    return { beginDate: `${year}-01-08`, endDate: `${year}-01-15` };
  }));
  for (const week of weeks) {
    expect(new URL(week).searchParams.get('elements')).toBe('WTEQ,SNWD');
    expect(new URL(week).searchParams.get('stationTriplets')).toBe('ONE:XX:SNTL');
  }
  expect(requestedDays(current)).toBeLessThanOrEqual(31);
  expect(new URL(current).searchParams.get('endDate')).toBe('2026-01-15');
});

test('a leap day is compared with the last day of February in years that have none', async () => {
  jest.useFakeTimers({ now: Date.parse('2028-03-01T12:00:00Z'), doNotFake: ['setImmediate', 'nextTick'] });
  try {
    const current = Object.fromEntries(['WTEQ', 'SNWD', 'PREC', 'TOBS'].map((element) => [element, [{ date: '2028-02-28', value: 1 }]]));
    const { requestedUrls, service } = createTestService({ series: current });
    const { snotel } = await service.fetchSnowpackData(40, -111, '2028-02-29', {});

    expect(snotel.historical.monthDay).toBe('02-29');
    expect(requestedUrls.filter(isWeekRequest).map((url) => dates(url).endDate)).toEqual([
      '2027-02-28', '2026-02-28', '2025-02-28', '2024-02-29', '2023-02-28',
      '2022-02-28', '2021-02-28', '2020-02-29', '2019-02-28', '2018-02-28',
    ]);
  } finally {
    jest.useRealTimers();
  }
});

test('the comparison with earlier years is worked out from the weeks exactly as from the whole series', async () => {
  // 12 in of water and 48 in of snow on 2026-01-15. In nine of the ten earlier years the reading nearest at or
  // before that date was 10 in and 40 in; one year has nothing within a week before it. Readings after the date
  // or more than a week before it must not count.
  const wteq = [];
  const snwd = [];
  for (let year = 2016; year <= 2025; year += 1) {
    if (year === 2020) continue;
    const date = year === 2019 ? '2019-01-12' : `${year}-01-15`;
    wteq.push({ date, value: 10 }, { date: `${year}-01-20`, value: 99 }, { date: `${year}-01-01`, value: 99 });
    snwd.push({ date, value: 40 }, { date: `${year}-01-20`, value: 999 });
  }
  wteq.push({ date: '2026-01-15', value: 12 });
  snwd.push({ date: '2026-01-15', value: 48 });
  const { service } = createTestService({ series: { ...CURRENT_READINGS, WTEQ: wteq, SNWD: snwd } });
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
    swe: { currentIn: 12, averageIn: 10, status: 'above_average', percentOfAverage: 120, sampleCount: 9, maxOffsetDays: 3 },
    depth: { currentIn: 48, averageIn: 40, status: 'above_average', percentOfAverage: 120, sampleCount: 9, maxOffsetDays: 3 },
    overall: { metric: 'SWE', status: 'above_average', percentOfAverage: 120 },
    summary: 'Current SWE is above average for this date (120% of historical average).',
  });
});

test('a week that fails once is asked for again and the history stays whole', async () => {
  const { requestedUrls, service } = createTestService({
    failFirstAttempt: (url) => isWeekRequest(url) && dates(url).endDate === '2020-01-15',
  });
  const { snotel } = await service.fetchSnowpackData(40, -111, '2026-01-15', {});

  expect(requestedUrls.filter(isWeekRequest)).toHaveLength(11);
  expect(snotel).not.toBeNull();
  expect(snotel.stationTriplet).toBe('ONE:XX:SNTL');
});

test('a station with no snow readings in the last month still shows its latest ones', async () => {
  // Snow readings stopped in November; precipitation and temperature are still coming in.
  const { requestedUrls, service } = createTestService({
    series: {
      WTEQ: [{ date: '2025-11-01', value: 3 }],
      SNWD: [{ date: '2025-11-01', value: 9 }],
      PREC: [{ date: '2026-01-14', value: 21 }],
      TOBS: [{ date: '2026-01-14', value: 26 }],
    },
  });
  const { snotel } = await service.fetchSnowpackData(40, -111, '2026-01-15', {});

  // The slow request for the whole ten years is made, and only for a station like this.
  expect(requestedUrls.filter(isLongRequest)).toHaveLength(1);
  expect(snotel).toMatchObject({ snowDepthIn: 9, sweIn: 3, precipIn: 21, obsTempF: 26, observedDate: '2025-11-01' });
});

test('nearby objectives and concurrent reports share one lookup for the same station and date', async () => {
  const { requestedUrls, service } = createTestService();
  const [north, south] = await Promise.all([
    service.fetchSnowpackData(40.001, -111, '2026-01-15', {}),
    service.fetchSnowpackData(40.002, -111.001, '2026-01-15', {}),
  ]);
  const later = await service.fetchSnowpackData(40.003, -111.002, '2026-01-15', {});

  expect(requestedUrls.filter(isCurrentRequest)).toHaveLength(1);
  expect(requestedUrls.filter(isWeekRequest)).toHaveLength(10);
  expect(north.snotel.historical).toEqual(south.snotel.historical);
  expect(later.snotel).toMatchObject({ stationTriplet: 'ONE:XX:SNTL', sweIn: 12 });

  await service.fetchSnowpackData(40.004, -111.003, '2026-01-16', {});
  expect(requestedUrls.filter(isWeekRequest)).toHaveLength(20);
});

test('a station lookup that failed is not remembered', async () => {
  const { requestedUrls, service } = createTestService({ failDetailed: 'history' });
  expect((await service.fetchSnowpackData(40, -111, '2026-01-15', {})).snotel).toBeNull();
  expect((await service.fetchSnowpackData(40.5, -111, '2026-01-15', {})).snotel).toBeNull();
  // Each report asked again instead of reusing the failure.
  expect(requestedUrls.filter(isCurrentRequest)).toHaveLength(2);
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
