const { createElevationService } = require('../src/utils/geo');

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const usgsAnswer = (feet = 14393) => response({ value: feet });
const openMeteoAnswer = (meters = 4380) => response({ elevation: [meters] });
const USGS = { elevationFt: 14393, source: 'USGS 3DEP elevation service' };
const OPEN_METEO = { elevationFt: 14370, source: 'Open-Meteo elevation API' };
const NOTHING = { elevationFt: null, source: null };

function setup({ requestTimeoutMs = 9000 } = {}) {
  const services = { usgs: async () => usgsAnswer(), openMeteo: async () => openMeteoAnswer() };
  const fetchWithTimeout = jest.fn(async (url, _options, timeoutMs) => (String(url).includes('epqs.nationalmap.gov')
    ? services.usgs(timeoutMs)
    : services.openMeteo()));
  const service = createElevationService({ fetchWithTimeout, requestTimeoutMs });
  const calls = (host) => fetchWithTimeout.mock.calls.filter(([url]) => String(url).includes(host)).length;
  return { ...service, services, fetchWithTimeout, usgsCalls: () => calls('epqs.nationalmap.gov'), openMeteoCalls: () => calls('api.open-meteo.com') };
}
const timedOut = () => Promise.reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));

beforeEach(() => {
  jest.useFakeTimers({ now: Date.parse('2026-09-29T12:00:00Z'), doNotFake: ['setImmediate', 'nextTick'] });
});
afterEach(() => {
  jest.useRealTimers();
});

test('USGS gets 3.5 seconds, not the whole request timeout, and its answer is kept for the week', async () => {
  const { fetchObjectiveElevationFt, fetchWithTimeout, usgsCalls, openMeteoCalls } = setup();

  await expect(fetchObjectiveElevationFt(46.8523, -121.7603, { headers: {} })).resolves.toEqual(USGS);
  expect(fetchWithTimeout.mock.calls[0][2]).toBe(3500);
  expect(openMeteoCalls()).toBe(0);

  jest.setSystemTime(Date.now() + 6 * DAY);
  await expect(fetchObjectiveElevationFt(46.8523, -121.7603, { headers: {} })).resolves.toEqual(USGS);
  expect(usgsCalls()).toBe(1);
});

test('a request timeout shorter than that is respected', async () => {
  const { fetchObjectiveElevationFt, fetchWithTimeout } = setup({ requestTimeoutMs: 2000 });
  await fetchObjectiveElevationFt(46.8523, -121.7603, {});
  expect(fetchWithTimeout.mock.calls[0][2]).toBe(2000);
});

test('a slow USGS falls back to Open-Meteo, whose answer is remembered for minutes and not for a week', async () => {
  const { fetchObjectiveElevationFt, services, usgsCalls, openMeteoCalls } = setup();
  services.usgs = timedOut;

  await expect(fetchObjectiveElevationFt(46.8523, -121.7603, {})).resolves.toEqual(OPEN_METEO);
  await expect(fetchObjectiveElevationFt(46.8523, -121.7603, {})).resolves.toEqual(OPEN_METEO);
  expect([usgsCalls(), openMeteoCalls()]).toEqual([1, 1]);

  // Ten minutes on, USGS is back: the report gets its more exact value, which is then kept.
  jest.setSystemTime(Date.now() + 11 * MINUTE);
  services.usgs = async () => usgsAnswer();
  await expect(fetchObjectiveElevationFt(46.8523, -121.7603, {})).resolves.toEqual(USGS);
  jest.setSystemTime(Date.now() + 5 * DAY);
  await expect(fetchObjectiveElevationFt(46.8523, -121.7603, {})).resolves.toEqual(USGS);
  expect(usgsCalls()).toBe(2);
});

test('concurrent reports for one place share a single lookup, fallback or not', async () => {
  const { fetchObjectiveElevationFt, services, usgsCalls, openMeteoCalls } = setup();
  services.usgs = timedOut;

  const answers = await Promise.all([1, 2, 3].map(() => fetchObjectiveElevationFt(46.8523, -121.7603, {})));
  expect(answers).toEqual([OPEN_METEO, OPEN_METEO, OPEN_METEO]);
  expect([usgsCalls(), openMeteoCalls()]).toEqual([1, 1]);
});

test('after three failures in a row USGS is left alone for a minute', async () => {
  const { fetchObjectiveElevationFt, services, usgsCalls, openMeteoCalls } = setup();
  services.usgs = timedOut;

  for (const lon of [-121.1, -121.2, -121.3, -121.4, -121.5]) {
    await expect(fetchObjectiveElevationFt(46.8, lon, {})).resolves.toEqual(OPEN_METEO);
  }
  expect(usgsCalls()).toBe(3);
  expect(openMeteoCalls()).toBe(5);

  jest.setSystemTime(Date.now() + 61 * 1000);
  services.usgs = async () => usgsAnswer();
  await expect(fetchObjectiveElevationFt(46.8, -121.6, {})).resolves.toEqual(USGS);
  expect(usgsCalls()).toBe(4);
});

test('a server error counts against USGS, a plain refusal does not', async () => {
  const errors = setup();
  errors.services.usgs = async () => response({}, 503);
  for (const lon of [-121.1, -121.2, -121.3, -121.4]) await errors.fetchObjectiveElevationFt(46.8, lon, {});
  expect(errors.usgsCalls()).toBe(3);

  const refusals = setup();
  refusals.services.usgs = async () => response({}, 404);
  for (const lon of [-121.1, -121.2, -121.3, -121.4]) await refusals.fetchObjectiveElevationFt(46.8, lon, {});
  expect(refusals.usgsCalls()).toBe(4);
});

test('a report cancelled by its own client is not held against USGS', async () => {
  const { fetchObjectiveElevationFt, services, usgsCalls } = setup();
  const controller = new AbortController();
  controller.abort(new Error('Client disconnected'));
  services.usgs = timedOut;

  for (const lon of [-121.1, -121.2, -121.3, -121.4]) {
    await expect(fetchObjectiveElevationFt(46.8, lon, { signal: controller.signal })).resolves.toEqual(OPEN_METEO);
  }
  // Every lookup still asked USGS: four cancellations in a row did not open the breaker.
  expect(usgsCalls()).toBe(4);
});

test('an unusable USGS reading falls back without counting as an outage', async () => {
  const { fetchObjectiveElevationFt, services, usgsCalls } = setup();
  services.usgs = async () => response({ value: null });
  for (const lon of [-121.1, -121.2, -121.3, -121.4]) {
    await expect(fetchObjectiveElevationFt(46.8, lon, {})).resolves.toEqual(OPEN_METEO);
  }
  expect(usgsCalls()).toBe(4);
});

test('no answer from anyone is asked for again in minutes, not remembered for a week', async () => {
  const { fetchObjectiveElevationFt, services, usgsCalls, openMeteoCalls } = setup();
  services.usgs = timedOut;
  services.openMeteo = async () => { throw new Error('offline'); };

  await expect(fetchObjectiveElevationFt(46.8523, -121.7603, {})).resolves.toEqual(NOTHING);
  await expect(fetchObjectiveElevationFt(46.8523, -121.7603, {})).resolves.toEqual(NOTHING);
  expect([usgsCalls(), openMeteoCalls()]).toEqual([1, 1]);

  jest.setSystemTime(Date.now() + 11 * MINUTE);
  services.openMeteo = async () => openMeteoAnswer();
  await expect(fetchObjectiveElevationFt(46.8523, -121.7603, {})).resolves.toEqual(OPEN_METEO);
});

test('a week-old USGS value is kept while a refresh can only produce the coarser fallback', async () => {
  const { fetchObjectiveElevationFt, services, elevationCache } = setup();
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const key = '46.8523,-121.7603';
  await fetchObjectiveElevationFt(46.8523, -121.7603, {});

  jest.setSystemTime(Date.now() + 8 * DAY);
  services.usgs = timedOut;
  await expect(fetchObjectiveElevationFt(46.8523, -121.7603, {})).resolves.toEqual(USGS);
  await flush();
  await expect(fetchObjectiveElevationFt(46.8523, -121.7603, {})).resolves.toEqual(USGS);
  await flush();
  expect(elevationCache.get(key)).toMatchObject({ stale: true, value: USGS });

  // Once USGS answers again the refresh replaces it.
  services.usgs = async () => usgsAnswer(14400);
  await expect(fetchObjectiveElevationFt(46.8523, -121.7603, {})).resolves.toEqual(USGS);
  await flush();
  expect(elevationCache.get(key)).toMatchObject({ stale: false, value: { elevationFt: 14400, source: USGS.source } });
});
