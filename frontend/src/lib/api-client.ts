const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || '';

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

function buildApiUrl(path: string): string {
  const normalizedBase = API_BASE.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return normalizedBase ? `${normalizedBase}${normalizedPath}` : normalizedPath;
}

function buildDevFallbackApiUrls(path: string): string[] {
  if (!import.meta.env.DEV || API_BASE) {
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

export async function fetchApi(path: string, init?: RequestInit): Promise<ApiFetchResult> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const attemptUrls = [buildApiUrl(normalizedPath), ...buildDevFallbackApiUrls(normalizedPath)];
  let lastError: unknown = null;
  let sawEmptyProxy500 = false;

  for (let index = 0; index < attemptUrls.length; index += 1) {
    const requestUrl = attemptUrls[index];
    try {
      const response = await fetch(requestUrl, init);
      const payload = await parseJsonFromResponse(response);
      const shouldRetryEmpty500 = index < attemptUrls.length - 1;
      if (shouldRetryEmpty500 && response.status === 500 && payload === null) {
        sawEmptyProxy500 = true;
        continue;
      }

      return {
        response,
        payload,
        requestId: response.headers.get('x-request-id'),
      };
    } catch (error) {
      lastError = error;
      if (index < attemptUrls.length - 1) {
        continue;
      }
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
