const { createCache } = require('../src/utils/cache');
const { fetchSolarDay } = require('../src/utils/solar');

describe('fetchSolarDay', () => {
  test('reads dawn, sunrise and sunset once per point and date', async () => {
    const solarCache = createCache({ name: 'solar-test', ttlMs: 60_000 });
    let calls = 0;
    const fetchWithTimeout = async () => {
      calls += 1;
      return { ok: true, json: async () => ({ status: 'OK', results: { dawn: '6:31:02 AM', sunrise: '7:01:40 AM', sunset: '6:48:10 PM', dusk: '7:18:00 PM', day_length: '11:46:30' } }) };
    };
    const args = { lat: 46.85, lon: -121.76, date: '2026-10-01', solarCache, fetchWithTimeout };
    const day = await fetchSolarDay(args);
    expect(day).toEqual({ sunrise: '7:01:40 AM', sunset: '6:48:10 PM', dayLength: '11:46:30', dawn: '6:31:02 AM', dusk: '7:18:00 PM' });
    await fetchSolarDay(args);
    expect(calls).toBe(1);
  });

  test('a failed service is an error for the caller', async () => {
    const solarCache = createCache({ name: 'solar-test-fail', ttlMs: 60_000 });
    await expect(fetchSolarDay({ lat: 1, lon: 2, date: '2026-10-01', solarCache, fetchWithTimeout: async () => ({ ok: false, status: 503 }) }))
      .rejects.toThrow('Solar API returned 503');
  });
});
