const API_BASE = import.meta.env.DEV && import.meta.env.VITE_MOCK_API === 'true' ? '' : (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || '';

function normalizeApiBase(rawBase: string): string | null {
  const trimmed = rawBase.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return null;
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

const DEV_BACKEND_FALLBACK_BASES = (() => {
  const candidates = [
    (import.meta.env.VITE_DEV_BACKEND_URL as string | undefined) || '',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
  ];
  const unique = new Set<string>();
  candidates.forEach((candidate) => {
    const normalized = normalizeApiBase(candidate);
    if (normalized) {
      unique.add(normalized);
    }
  });
  return Array.from(unique);
})();

export function buildApiUrl(path: string): string {
  const normalizedBase = API_BASE.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (import.meta.env.DEV && import.meta.env.VITE_MOCK_API === 'true') {
    const scenario = new URLSearchParams(window.location.search).get('mock_scenario') || sessionStorage.getItem('summitsafe:mock:scenario');
    if (scenario) return `${normalizedPath}${normalizedPath.includes('?') ? '&' : '?'}mock_scenario=${encodeURIComponent(scenario)}`;
  }
  return normalizedBase ? `${normalizedBase}${normalizedPath}` : normalizedPath;
}

function buildDevFallbackApiUrls(path: string): string[] {
  if (!import.meta.env.DEV || API_BASE || import.meta.env.VITE_MOCK_API === 'true') {
    return [];
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return DEV_BACKEND_FALLBACK_BASES.map((base) => `${base}${normalizedPath}`);
}

async function parseJsonFromResponse(response: Response): Promise<unknown | null> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface ApiFetchResult {
  response: Response;
  payload: unknown | null;
  requestId: string | null;
}

const RETRYABLE_STATUS_CODES = new Set([408, 429, 502, 503]);
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [1000, 2000];

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status);
}

function createAbortError(signal?: AbortSignal | null): DOMException {
  return signal?.reason instanceof DOMException
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

function isAbortError(error: unknown, signal?: AbortSignal | null): boolean {
  return Boolean(signal?.aborted) || (error instanceof DOMException && error.name === 'AbortError');
}

function delay(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError(signal));
      return;
    }

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);
    const handleAbort = () => {
      clearTimeout(timeoutId);
      reject(createAbortError(signal));
    };
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

export async function fetchApi(path: string, init?: RequestInit): Promise<ApiFetchResult> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const attemptUrls = [buildApiUrl(normalizedPath), ...buildDevFallbackApiUrls(normalizedPath)];
  let lastError: unknown = null;
  let sawEmptyProxy500 = false;

  for (let index = 0; index < attemptUrls.length; index += 1) {
    if (init?.signal?.aborted) {
      throw createAbortError(init.signal);
    }
    const requestUrl = attemptUrls[index];

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const response = await fetch(requestUrl, {
          credentials: 'include',
          ...init,
        });
        const payload = await parseJsonFromResponse(response);
        const shouldRetryEmpty500 = index < attemptUrls.length - 1;
        if (shouldRetryEmpty500 && response.status === 500 && payload === null) {
          sawEmptyProxy500 = true;
          break;
        }

        if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
          await delay(RETRY_DELAYS_MS[attempt], init?.signal);
          continue;
        }

        return {
          response,
          payload,
          requestId: response.headers.get('x-request-id'),
        };
      } catch (error) {
        if (isAbortError(error, init?.signal)) {
          throw error;
        }
        lastError = error;
        if (attempt < MAX_RETRIES) {
          await delay(RETRY_DELAYS_MS[attempt], init?.signal);
          continue;
        }
        break;
      }
    }

    if (sawEmptyProxy500 && index < attemptUrls.length - 1) {
      continue;
    }
    if (lastError && index < attemptUrls.length - 1) {
      continue;
    }
  }

  if (import.meta.env.DEV && (sawEmptyProxy500 || lastError)) {
    throw new Error('Unable to reach backend API. Start it with: cd backend && npm run dev');
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('API request failed');
}

export type StreamEvent = { type?: string; [key: string]: unknown };

/**
 * A request whose server may stream NDJSON progress lines: each line but the last
 * goes to onEvent, and the final "result" (or "error") line is the payload. A
 * plain JSON response, as from an older server, an error status or the mock,
 * is returned as is.
 */
export async function fetchApiStream(path: string, init: RequestInit, onEvent: (event: StreamEvent) => void): Promise<{ ok: boolean; status: number; payload: unknown }> {
  const response = await fetch(buildApiUrl(path), {
    credentials: 'include',
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Accept: 'application/x-ndjson, application/json' },
  });
  if (!(response.headers.get('content-type') || '').includes('application/x-ndjson') || !response.body) {
    return { ok: response.ok, status: response.status, payload: await parseJsonFromResponse(response) };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let last: StreamEvent | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    let event: StreamEvent;
    try {
      event = JSON.parse(line) as StreamEvent;
    } catch {
      return;
    }
    if (event.type === 'result' || event.type === 'error') last = event;
    else onEvent(event);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach(handle);
  }
  handle(buffer + decoder.decode());
  const final = last as StreamEvent | null;
  if (final?.type === 'result') return { ok: true, status: 200, payload: final.payload };
  // A stream that ends without a result was cut off.
  return { ok: false, status: Number(final?.status) || 502, payload: { error: final?.error || 'The route analysis stopped before it finished.' } };
}

export interface AiBriefRequest {
  decisionLevel: string;
  report: unknown;
  // Backend report values are imperial (°F, mph, ft, in); this tells the AI which
  // units to render its narrative in so it matches what the user sees on screen.
  units: { temperature: 'f' | 'c'; wind: 'mph' | 'kph'; elevation: 'ft' | 'm' };
}

export interface AiBriefResponse {
  narrative: string;
  cached: boolean;
}

export async function fetchAiBrief(data: AiBriefRequest): Promise<AiBriefResponse> {
  const { response, payload } = await fetchApi('/api/ai-brief', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const msg = readApiErrorMessage(payload, 'AI brief unavailable');
    throw new Error(msg);
  }
  return payload as AiBriefResponse;
}

export interface SnowVisionResponse {
  analysis: string;
  zoom: number;
  image: string | null;
  generatedAt: string;
}

export async function fetchSnowVisionAnalysis(
  lat: number,
  lon: number,
  snowpack?: unknown,
  units?: { elevation: 'ft' | 'm' },
): Promise<SnowVisionResponse> {
  const { response, payload } = await fetchApi('/api/snow-vision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lon, snowpack: snowpack ?? null, units: units ?? null }),
  });
  if (!response.ok) {
    const msg = readApiErrorMessage(payload, 'Satellite snow analysis unavailable');
    throw new Error(msg);
  }
  return payload as SnowVisionResponse;
}

export function readApiErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (typeof record.details === 'string' && record.details.trim()) {
      return record.details;
    }
    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error;
    }
  }
  return fallback;
}

/** Re-check a loaded report against the current plan; no upstream requests or report usage. */
export async function fetchPlanEvaluation(report: unknown, plan: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  const { response, payload } = await fetchApi('/api/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report, plan }),
    signal,
  });
  if (!response.ok) {
    throw new Error(readApiErrorMessage(payload, `Plan evaluation failed (${response.status})`));
  }
  return (payload as { evaluation?: unknown } | null)?.evaluation ?? null;
}
