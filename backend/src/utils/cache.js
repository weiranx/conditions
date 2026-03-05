'use strict';

/**
 * In-memory cache with TTL, stale-while-revalidate, LRU eviction,
 * and in-flight request deduplication.
 */
function createCache({ name, ttlMs, staleTtlMs = 0, maxEntries = 500 }) {
  const store = new Map();
  const inflight = new Map();
  const stats = { hits: 0, misses: 0, staleHits: 0, evictions: 0 };

  function _evictOldest() {
    while (store.size > maxEntries) {
      const firstKey = store.keys().next().value;
      store.delete(firstKey);
      stats.evictions += 1;
    }
  }

  function _isDead(entry, now) {
    return now - entry.fetchedAt > ttlMs + staleTtlMs;
  }

  function _isStale(entry, now) {
    return now - entry.fetchedAt > ttlMs;
  }

  function get(key) {
    const entry = store.get(key);
    if (!entry) {
      stats.misses += 1;
      return null;
    }
    const now = Date.now();
    if (_isDead(entry, now)) {
      store.delete(key);
      stats.misses += 1;
      return null;
    }
    // Move to end for LRU
    store.delete(key);
    store.set(key, entry);
    if (_isStale(entry, now)) {
      stats.staleHits += 1;
      return { value: entry.value, stale: true };
    }
    stats.hits += 1;
    return { value: entry.value, stale: false };
  }

  function set(key, value) {
    store.delete(key);
    store.set(key, { value, fetchedAt: Date.now() });
    _evictOldest();
  }

  async function getOrFetch(key, fetchFn) {
    const cached = get(key);
    if (cached && !cached.stale) {
      return cached.value;
    }
    if (cached && cached.stale) {
      // Stale-while-revalidate: return stale, refresh in background
      if (!inflight.has(key)) {
        const bgPromise = Promise.resolve()
          .then(() => fetchFn())
          .then((val) => { set(key, val); })
          .catch(() => {})
          .finally(() => { inflight.delete(key); });
        inflight.set(key, bgPromise);
      }
      return cached.value;
    }
    // No entry or dead: fetch synchronously, deduplicate in-flight
    if (inflight.has(key)) {
      return inflight.get(key);
    }
    const promise = Promise.resolve()
      .then(() => fetchFn())
      .then((val) => {
        set(key, val);
        inflight.delete(key);
        return val;
      })
      .catch((err) => {
        inflight.delete(key);
        throw err;
      });
    inflight.set(key, promise);
    return promise;
  }

  function has(key) {
    return get(key) !== null;
  }

  function del(key) {
    return store.delete(key);
  }

  function clear() {
    store.clear();
    inflight.clear();
  }

  function size() {
    return store.size;
  }

  function prune() {
    const now = Date.now();
    let removed = 0;
    for (const [k, entry] of store) {
      if (_isDead(entry, now)) {
        store.delete(k);
        removed += 1;
      }
    }
    return removed;
  }

  function getStats() {
    return { name, size: store.size, ...stats };
  }

  return { get, set, getOrFetch, has, delete: del, clear, size, prune, stats: getStats };
}

const normalizeCoordKey = (lat, lon) =>
  `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;

const normalizeCoordDateKey = (lat, lon, date) =>
  `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}|${date}`;

const normalizeTextKey = (text) =>
  String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();

module.exports = { createCache, normalizeCoordKey, normalizeCoordDateKey, normalizeTextKey };
