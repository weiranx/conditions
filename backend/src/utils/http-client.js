const nodeFetch = require('node-fetch');

const DEFAULT_FETCH_HEADERS = { 'User-Agent': 'BackcountryConditions/1.0 (+https://backcountryconditions.app; support@backcountryconditions.app)' };

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
        require('./logger').logger.warn({ breaker: name, failures }, 'Circuit breaker opened');
      }
    },
    get name() { return name; },
  };
};

/**
 * Wraps an async operation with circuit-breaker bookkeeping: skips the call outright
 * (fast-fail) while the breaker is open, and records success/failure on each attempt
 * so chronically-flaky upstreams (NOAA, avalanche.org) stop being hammered with
 * doomed requests once they're clearly down.
 */
const withCircuitBreaker = async (breaker, fn) => {
  if (breaker.isOpen) {
    throw new Error(`${breaker.name} circuit breaker open; skipping request until it cools down`);
  }
  try {
    const result = await fn();
    breaker.recordSuccess();
    return result;
  } catch (error) {
    breaker.recordFailure();
    throw error;
  }
};

module.exports = {
  DEFAULT_FETCH_HEADERS,
  createFetchWithTimeout,
  createCircuitBreaker,
  withCircuitBreaker,
};
