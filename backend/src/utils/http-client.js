const nodeFetch = require('node-fetch');

const DEFAULT_FETCH_HEADERS = { 'User-Agent': 'BackcountryConditions/1.0 (+https://summitsafe.app; support@summitsafe.app)' };

const fetchImpl = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : nodeFetch;

const createFetchWithTimeout = (defaultTimeoutMs) => async (url, options = {}, timeoutMs = defaultTimeoutMs) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = {
  DEFAULT_FETCH_HEADERS,
  createFetchWithTimeout,
};
