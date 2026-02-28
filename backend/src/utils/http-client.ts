import nodeFetch from 'node-fetch';

export const DEFAULT_FETCH_HEADERS = { 'User-Agent': 'BackcountryConditions/1.0 (+https://summitsafe.app; support@summitsafe.app)' };

const fetchImpl = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : (nodeFetch as any);

export const createFetchWithTimeout = (defaultTimeoutMs: number) => async (url: string, options: any = {}, timeoutMs: number = defaultTimeoutMs): Promise<Response> => {
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
