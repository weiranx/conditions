const dotenv = require('dotenv');

dotenv.config();

const parsePositiveInt = (rawValue, fallback) => {
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
};

const PORT = process.env.PORT || 3001;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEBUG_AVY = process.env.DEBUG_AVY === 'true';

const REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.REQUEST_TIMEOUT_MS, 9000);
const AVALANCHE_MAP_LAYER_TTL_MS = parsePositiveInt(process.env.AVALANCHE_MAP_LAYER_TTL_MS, 10 * 60 * 1000);
const SNOTEL_STATION_CACHE_TTL_MS = parsePositiveInt(process.env.SNOTEL_STATION_CACHE_TTL_MS, 12 * 60 * 60 * 1000);
const RATE_LIMIT_WINDOW_MS = parsePositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000);
const RATE_LIMIT_MAX_REQUESTS = parsePositiveInt(process.env.RATE_LIMIT_MAX_REQUESTS, 300);

const CORS_ALLOWLIST = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

module.exports = {
  PORT,
  IS_PRODUCTION,
  DEBUG_AVY,
  REQUEST_TIMEOUT_MS,
  AVALANCHE_MAP_LAYER_TTL_MS,
  SNOTEL_STATION_CACHE_TTL_MS,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  CORS_ALLOWLIST,
};
