import dotenv from 'dotenv';

dotenv.config();

const parsePositiveInt = (rawValue: string | undefined, fallback: number): number => {
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
};

export const PORT = process.env.PORT || 3001;
export const IS_PRODUCTION = process.env.NODE_ENV === 'production';
export const DEBUG_AVY = process.env.DEBUG_AVY === 'true';

export const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.REQUEST_TIMEOUT_MS, 9000);
export const AVALANCHE_MAP_LAYER_TTL_MS = parsePositiveInt(process.env.AVALANCHE_MAP_LAYER_TTL_MS, 10 * 60 * 1000);
export const SNOTEL_STATION_CACHE_TTL_MS = parsePositiveInt(process.env.SNOTEL_STATION_CACHE_TTL_MS, 12 * 60 * 60 * 1000);
export const RATE_LIMIT_WINDOW_MS = parsePositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000);
export const RATE_LIMIT_MAX_REQUESTS = parsePositiveInt(process.env.RATE_LIMIT_MAX_REQUESTS, 300);

export const CORS_ALLOWLIST = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
