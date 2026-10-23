'use strict';

const { createCache } = require('../src/utils/cache');

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('clearing a cache with requests in flight', () => {
  test('a request started before clearing cannot refill the cache', async () => {
    const cache = createCache({ name: 'clear-pending', ttlMs: 60000 });
    const old = deferred();
    const waiting = cache.getOrFetch('weather', () => old.promise);
    cache.clear();
    old.resolve('old forecast');

    await expect(waiting).resolves.toBe('old forecast');
    expect(cache.has('weather')).toBe(false);
  });

  test.each(['resolve', 'reject'])('an old request that %ss cannot remove the replacement request', async (finish) => {
    const cache = createCache({ name: 'clear-replacement', ttlMs: 60000 });
    const old = deferred();
    const fresh = deferred();
    const oldRequest = cache.getOrFetch('weather', () => old.promise).catch(() => null);
    cache.clear();
    const fetchFresh = jest.fn(() => fresh.promise);
    const replacement = cache.getOrFetch('weather', fetchFresh);
    old[finish](finish === 'resolve' ? 'old forecast' : new Error('old request failed'));
    await oldRequest;

    const joined = cache.getOrFetch('weather', fetchFresh);
    await flush();
    expect(fetchFresh).toHaveBeenCalledTimes(1);
    fresh.resolve('fresh forecast');
    await expect(replacement).resolves.toBe('fresh forecast');
    await expect(joined).resolves.toBe('fresh forecast');
    expect(cache.get('weather').value).toBe('fresh forecast');
  });

  test.each(['foreground', 'background'])('a late %s fetch cannot overwrite a post-clear value', async (mode) => {
    jest.useFakeTimers({ now: 1000, doNotFake: ['setImmediate', 'nextTick'] });
    try {
      const cache = createCache({ name: 'clear-late', ttlMs: 1000, staleTtlMs: 5000 });
      const old = deferred();
      if (mode === 'background') {
        cache.set('weather', 'stale forecast');
        jest.setSystemTime(2500);
      }
      const waiting = cache.getOrFetch('weather', () => old.promise);
      await flush();
      cache.clear();
      await cache.getOrFetch('weather', async () => 'fresh forecast');
      old.resolve('old forecast');
      await waiting;
      await flush();

      expect(cache.get('weather').value).toBe('fresh forecast');
    } finally {
      jest.useRealTimers();
    }
  });
});
