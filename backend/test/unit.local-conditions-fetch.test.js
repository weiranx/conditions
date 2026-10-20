'use strict';

const { createLocalConditionsService } = require('../src/utils/local-conditions-fetch');

const notFound = () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' });

const smokeResponse = () => ({
  ok: true,
  status: 200,
  json: async () => ({ hourly: { time: [new Date().toISOString().slice(0, 13) + ':00'], pm2_5: [4.2] } }),
});

// Every provider answers at once except the tide station list, which waits
// until the test releases it.
const stalledTides = () => {
  let release;
  const stalled = new Promise((resolve) => { release = resolve; });
  const fetchWithTimeout = jest.fn((url) => {
    if (url.includes('air-quality-api.open-meteo.com')) return Promise.resolve(smokeResponse());
    if (url.includes('tidesandcurrents')) return stalled.then(() => notFound());
    return Promise.resolve(notFound());
  });
  return { fetchWithTimeout, release: () => release() };
};

const request = (overrides = {}) => ({
  lat: 37.7749,
  lon: -122.4194,
  selectedDate: '2026-07-10',
  fetchOptions: {},
  ...overrides,
});

describe('local conditions request-path wait', () => {
  test('a source that has not answered by the wait is marked and the others are returned', async () => {
    const { fetchWithTimeout, release } = stalledTides();
    const { fetchLocalConditions } = createLocalConditionsService({ fetchWithTimeout, haversineKm: () => 0, requestTimeoutMs: 100 });

    const startedAt = Date.now();
    const partial = await fetchLocalConditions(request({ waitMs: 50 }));
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(partial.smoke).toEqual(expect.objectContaining({ available: true, currentPm25: 4.2 }));
    expect(partial.tides).toEqual({
      available: false,
      status: 'unavailable',
      pending: true,
      note: 'This source had not answered in time; it is loaded for the next report.',
    });
    expect(partial.streamflow).toEqual(expect.objectContaining({ available: false }));
    expect(partial.streamflow.pending).toBeUndefined();
    expect(partial.hasAnySignal).toBe(true);

    // The fetch carries on and the next report gets the whole answer from the cache.
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const callsBefore = fetchWithTimeout.mock.calls.length;
    const next = await fetchLocalConditions(request({ waitMs: 50 }));
    expect(fetchWithTimeout).toHaveBeenCalledTimes(callsBefore);
    expect(next.tides).toEqual({ available: false });
    expect(next.smoke).toEqual(partial.smoke);
  });

  test('a report that joins a fetch already running shows what that fetch has so far', async () => {
    const { fetchWithTimeout, release } = stalledTides();
    const { fetchLocalConditions } = createLocalConditionsService({ fetchWithTimeout, haversineKm: () => 0, requestTimeoutMs: 100 });

    const first = await fetchLocalConditions(request({ waitMs: 30 }));
    const second = await fetchLocalConditions(request({ waitMs: 30 }));
    expect(first.tides.pending).toBe(true);
    expect(second.tides.pending).toBe(true);
    expect(second.smoke.available).toBe(true);
    release();
  });

  test('a fast fetch returns the whole answer with nothing marked pending', async () => {
    const fetchWithTimeout = jest.fn(async (url) => (url.includes('air-quality-api.open-meteo.com') ? smokeResponse() : notFound()));
    const { fetchLocalConditions } = createLocalConditionsService({ fetchWithTimeout, haversineKm: () => 0, requestTimeoutMs: 100 });

    const result = await fetchLocalConditions(request());
    expect(result.smoke.available).toBe(true);
    for (const name of ['streamflow', 'smoke', 'tides', 'closures', 'weatherObservation', 'radar', 'access', 'wildfire']) {
      expect(result[name]?.pending).toBeUndefined();
    }
  });
});
