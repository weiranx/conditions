export class ApiError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}

export function createApi({ baseUrl, session = '', fetchImpl = fetch, timeoutMs = 30000 }) {
  const base = new URL(baseUrl);
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
      (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) {
    throw new Error('CONDITIONS_API_URL must be an HTTPS origin (HTTP loopback is allowed for development).');
  }
  if (/[\s;,\r\n]/u.test(session)) throw new Error('Invalid Conditions session format.');
  return {
    hasAccount: Boolean(session),
    async get(path, query = {}, account = false) {
      if (account && !session) throw new ApiError('ACCOUNT_NOT_CONFIGURED', 'Configure a Conditions account session to read private reports.');
      const url = new URL(path, base);
      if (url.origin !== base.origin || !path.startsWith('/api/')) throw new Error('Invalid API path');
      for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
      try {
        const response = await fetchImpl(url, {
          headers: { Accept: 'application/json', ...(session ? { Cookie: `bc_session=${session}` } : {}) },
          redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        });
        const reader = response.body.getReader();
        const chunks = []; let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 2_000_000) { await reader.cancel(); throw new ApiError('RESPONSE_TOO_LARGE', 'Response exceeded 2 MB; request a smaller result.'); }
            chunks.push(Buffer.from(value));
          }
        } finally { reader.releaseLock(); }
        let data;
        try { data = JSON.parse(Buffer.concat(chunks).toString()); }
        catch { throw new ApiError('INVALID_RESPONSE', 'Conditions returned a non-JSON response.'); }
        if (!response.ok) {
          const messages = { 401: 'Conditions session expired or is invalid. Sign in again.', 403: 'Your Conditions account cannot access this feature.', 429: 'Conditions rate or account usage limit reached; try later.' };
          const details = { httpStatus: response.status };
          if (data.availableRange?.start && data.availableRange?.end) details.availableRange = { start: data.availableRange.start, end: data.availableRange.end };
          throw new ApiError(`HTTP_${response.status}`, messages[response.status] || 'Conditions could not complete this request. Check the inputs or retry later.', details);
        }
        return data;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError('UPSTREAM_UNAVAILABLE', 'Conditions timed out or could not be reached. No report was returned.');
      }
    },
  };
}
