const nodeFetch = require('node-fetch');

const DEFAULT_FETCH_HEADERS = { 'User-Agent': 'BackcountryConditions/1.0 (+https://summitsafe.app; support@summitsafe.app)' };

const fetchImpl = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : nodeFetch;

const createFetchWithTimeout = (defaultTimeoutMs) => async (url, options = {}, timeoutMs = defaultTimeoutMs) => {
  const controller = new AbortController();
  const upstreamSignal = options?.signal;
  const abortFromUpstream = () => {
    controller.abort(upstreamSignal?.reason);
  };
  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      abortFromUpstream();
    } else {
      upstreamSignal.addEventListener('abort', abortFromUpstream, { once: true });
    }
  }
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    if (upstreamSignal) {
      upstreamSignal.removeEventListener('abort', abortFromUpstream);
    }
  }
};

const createCircuitBreaker = ({ name, failureThreshold = 5, resetTimeMs = 60000 }) => {
  let failures = 0;
  let lastFailureAt = 0;
  let open = false;

  return {
    get isOpen() {
      if (open && Date.now() - lastFailureAt > resetTimeMs) {
        open = false;
        failures = 0;
      }
      return open;
    },
    recordSuccess() {
      failures = 0;
      open = false;
    },
    recordFailure() {
      failures += 1;
      lastFailureAt = Date.now();
      if (failures >= failureThreshold) {
        open = true;
        console.warn(`[circuit-breaker] ${name} opened after ${failures} consecutive failures`);
      }
    },
    get name() { return name; },
  };
};

module.exports = {
  DEFAULT_FETCH_HEADERS,
  createFetchWithTimeout,
  createCircuitBreaker,
};
