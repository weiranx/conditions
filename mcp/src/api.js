export class ApiError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}

const DEFAULT_MAX_BYTES = 2_000_000;

/**
 * The answer in an AI SDK UI message stream (server-sent events): its text,
 * follow-up suggestions, and the error the stream reported, if any.
 */
export function readUiMessageStream(body) {
  let text = '', error = null, followUpSuggestions = [];
  for (const line of body.split(/\r?\n/u)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let event;
    try { event = JSON.parse(payload); } catch { continue; }
    if (event?.type === 'text-delta' && typeof event.delta === 'string') text += event.delta;
    else if (event?.type === 'error') error = typeof event.errorText === 'string' ? event.errorText : 'The assistant stream failed.';
    else if (event?.type === 'data-followUpSuggestions' && Array.isArray(event.data?.suggestions)) followUpSuggestions = event.data.suggestions.filter(item => typeof item === 'string');
  }
  return { text: text.trim(), error, followUpSuggestions };
}

export function createApi({ baseUrl, session = '', accessToken = '', fetchImpl = fetch, timeoutMs = 30000 }) {
  const base = new URL(baseUrl);
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
      (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) {
    throw new Error('CONDITIONS_API_URL must be an HTTPS origin (HTTP loopback is allowed for development).');
  }
  if (/[\s;,\r\n]/u.test(session)) throw new Error('Invalid Conditions session format.');
  const hasAccount = Boolean(session || accessToken);

  async function request(method, path, { query = {}, body, account = false, headers = {}, maxBytes = DEFAULT_MAX_BYTES, timeout = timeoutMs, uiMessageStream = false } = {}) {
    if (account && !hasAccount) throw new ApiError('ACCOUNT_NOT_CONFIGURED', 'Connect your Conditions account to use this tool.');
    const url = new URL(path, base);
    if (url.origin !== base.origin || !path.startsWith('/api/')) throw new Error('Invalid API path');
    for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
    try {
      const response = await fetchImpl(url, {
        method,
        headers: {
          Accept: uiMessageStream ? 'text/event-stream, application/json' : 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : session ? { Cookie: `bc_session=${session}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error', signal: AbortSignal.timeout(timeout),
      });
      const reader = response.body.getReader();
      const chunks = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > maxBytes) { await reader.cancel(); throw new ApiError('RESPONSE_TOO_LARGE', `Response exceeded ${Math.round(maxBytes / 1_000_000)} MB; request a smaller result.`); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      const text = Buffer.concat(chunks).toString();
      // A successful stream is events; failures before it starts are JSON.
      if (uiMessageStream && response.ok) return readUiMessageStream(text);
      let data;
      try { data = JSON.parse(text); }
      catch { throw new ApiError('INVALID_RESPONSE', 'Conditions returned a non-JSON response.'); }
      if (!response.ok) {
        const messages = { 401: 'Conditions session expired or is invalid. Sign in again.', 403: 'Your Conditions account cannot access this feature.', 429: 'Conditions rate or account usage limit reached; try later.' };
        const details = { httpStatus: response.status };
        if (data.availableRange?.start && data.availableRange?.end) details.availableRange = { start: data.availableRange.start, end: data.availableRange.end };
        // Usage codes and feature-disabled reasons help the caller explain the failure.
        if (typeof data.code === 'string' && /^[A-Z0-9_]{1,64}$/u.test(data.code)) details.reason = data.code;
        throw new ApiError(`HTTP_${response.status}`, messages[response.status] || 'Conditions could not complete this request. Check the inputs or retry later.', details);
      }
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('UPSTREAM_UNAVAILABLE', 'Conditions timed out or could not be reached. No result was returned.');
    }
  }

  return {
    hasAccount,
    get: (path, query = {}, account = false, options = {}) => request('GET', path, { ...options, query, account }),
    post: (path, body, account = false, options = {}) => request('POST', path, { ...options, body, account }),
  };
}
