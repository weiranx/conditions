'use strict';

const { logger } = require('./logger');

const SH_TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const SH_PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';
const SH_CATALOG_URL = 'https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search';

const TILE_SIZE = 256;
const EARTH_CIRCUMFERENCE_M = 40075016.6855785;
const ORIGIN_SHIFT = EARTH_CIRCUMFERENCE_M / 2;
const LOOKBACK_DAYS = 30;

// Native Sentinel-2 resolution (10m/px) stops adding detail well below street-level
// zoom; capping here bounds both tile-request volume and Sentinel Hub processing-unit spend.
const MIN_ZOOM = 2;
const MAX_ZOOM = 15;

// Standard Sentinel Hub "true color" script (gain 2.5 brings raw L2A reflectance
// into a visible range); dataMask feeds the alpha channel so no-data pixels are transparent.
const TRUE_COLOR_EVALSCRIPT = `
//VERSION=3
function setup() {
  return {
    input: ["B02", "B03", "B04", "dataMask"],
    output: { bands: 4 }
  };
}
function evaluatePixel(sample) {
  return [2.5 * sample.B04, 2.5 * sample.B03, 2.5 * sample.B02, sample.dataMask];
}
`;

let cachedToken = null; // { accessToken, expiresAt }

const fetchAccessToken = async (fetchWithTimeout) => {
  const clientId = process.env.SENTINEL_HUB_CLIENT_ID;
  const clientSecret = process.env.SENTINEL_HUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    const err = new Error('Sentinel Hub is not configured (missing SENTINEL_HUB_CLIENT_ID/SENTINEL_HUB_CLIENT_SECRET)');
    err.statusCode = 501;
    throw err;
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetchWithTimeout(SH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }, 10000);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logger.warn({ status: res.status, text: text.slice(0, 300) }, 'Sentinel Hub auth failed');
    throw new Error(`Sentinel Hub auth failed: ${res.status}`);
  }
  const json = await res.json();
  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + Math.max(json.expires_in - 60, 30) * 1000,
  };
};

const getAccessToken = async (fetchWithTimeout) => {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }
  cachedToken = await fetchAccessToken(fetchWithTimeout);
  return cachedToken.accessToken;
};

// Slippy-map tile x/y/z -> bbox in meters (EPSG:3857), matching Leaflet's tiling scheme.
const tileToBbox3857 = (z, x, y) => {
  const tileSizeAtZoom = EARTH_CIRCUMFERENCE_M / 2 ** z;
  const minX = x * tileSizeAtZoom - ORIGIN_SHIFT;
  const maxX = (x + 1) * tileSizeAtZoom - ORIGIN_SHIFT;
  const maxY = ORIGIN_SHIFT - y * tileSizeAtZoom;
  const minY = ORIGIN_SHIFT - (y + 1) * tileSizeAtZoom;
  return [minX, minY, maxX, maxY];
};

const mercatorToLonLat = (x, y) => [
  (x / ORIGIN_SHIFT) * 180,
  (Math.atan(Math.sinh((y / ORIGIN_SHIFT) * Math.PI)) * 180) / Math.PI,
];

const bbox3857To4326 = ([minX, minY, maxX, maxY]) => {
  const [minLon, minLat] = mercatorToLonLat(minX, minY);
  const [maxLon, maxLat] = mercatorToLonLat(maxX, maxY);
  return [minLon, minLat, maxLon, maxLat];
};

const findBestAcquisition = async ({ token, bbox3857, fetchWithTimeout }) => {
  const now = new Date();
  const from = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const response = await fetchWithTimeout(SH_CATALOG_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bbox: bbox3857To4326(bbox3857),
      datetime: `${from.toISOString()}/${now.toISOString()}`,
      collections: ['sentinel-2-l2a'],
      limit: 50,
      filter: { op: '<=', args: [{ property: 'eo:cloud_cover' }, 60] },
    }),
  }, 12000);
  if (!response.ok) return null;
  const payload = await response.json();
  const candidates = (payload?.features || []).map((feature) => ({
    id: feature?.id || null,
    acquiredAt: feature?.properties?.datetime || feature?.properties?.start_datetime || null,
    cloudCover: Number.isFinite(Number(feature?.properties?.['eo:cloud_cover']))
      ? Number(feature.properties['eo:cloud_cover'])
      : null,
  })).filter((candidate) => candidate.acquiredAt && Number.isFinite(Date.parse(candidate.acquiredAt)));
  if (!candidates.length) return null;
  candidates.sort((a, b) => Date.parse(b.acquiredAt) - Date.parse(a.acquiredAt));
  const newestTime = Date.parse(candidates[0].acquiredAt);
  const recent = candidates.filter((candidate) => newestTime - Date.parse(candidate.acquiredAt) <= 3 * 24 * 60 * 60 * 1000);
  return recent.sort((a, b) => (a.cloudCover ?? 100) - (b.cloudCover ?? 100))[0] || candidates[0];
};

const fetchSentinelTile = async ({ z, x, y, fetchWithTimeout }) => {
  const zoom = Number(z);
  const tileX = Number(x);
  const tileY = Number(y);
  if (!Number.isInteger(zoom) || !Number.isInteger(tileX) || !Number.isInteger(tileY) || zoom < MIN_ZOOM || zoom > MAX_ZOOM) {
    const err = new Error('Invalid or out-of-range tile coordinates');
    err.statusCode = 400;
    throw err;
  }

  const token = await getAccessToken(fetchWithTimeout);
  const bbox = tileToBbox3857(zoom, tileX, tileY);
  const now = new Date();
  const from = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  let acquisition = null;
  try {
    acquisition = await findBestAcquisition({ token, bbox3857: bbox, fetchWithTimeout });
  } catch (error) {
    logger.warn({ err: error, z: zoom, x: tileX, y: tileY }, 'Sentinel catalog lookup failed; using bounded mosaic fallback');
  }
  const acquisitionMs = acquisition?.acquiredAt ? Date.parse(acquisition.acquiredAt) : NaN;
  const processFrom = Number.isFinite(acquisitionMs) ? new Date(acquisitionMs - 5 * 60 * 1000) : from;
  const processTo = Number.isFinite(acquisitionMs) ? new Date(acquisitionMs + 5 * 60 * 1000) : now;

  const requestBody = {
    input: {
      bounds: {
        bbox,
        properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/3857' },
      },
      data: [{
        type: 'sentinel-2-l2a',
        dataFilter: {
          timeRange: { from: processFrom.toISOString(), to: processTo.toISOString() },
          maxCloudCoverage: 60,
          mosaickingOrder: acquisition ? 'mostRecent' : 'leastCC',
        },
      }],
    },
    output: {
      width: TILE_SIZE,
      height: TILE_SIZE,
      responses: [{ identifier: 'default', format: { type: 'image/png' } }],
    },
    evalscript: TRUE_COLOR_EVALSCRIPT,
  };

  const res = await fetchWithTimeout(SH_PROCESS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'image/png',
    },
    body: JSON.stringify(requestBody),
  }, 15000);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logger.warn({ status: res.status, text: text.slice(0, 300), z: zoom, x: tileX, y: tileY }, 'Sentinel Hub tile request failed');
    // A stale/rejected token surfaces as 401/403; drop it so the next request re-authenticates.
    if (res.status === 401 || res.status === 403) {
      cachedToken = null;
    }
    const err = new Error(`Sentinel Hub process request failed: ${res.status}`);
    err.statusCode = 502;
    throw err;
  }

  const arrayBuffer = await res.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    metadata: {
      acquiredAt: acquisition?.acquiredAt || null,
      cloudCover: acquisition?.cloudCover ?? null,
      acquisitionId: acquisition?.id || null,
      lookbackDays: LOOKBACK_DAYS,
      selection: acquisition ? 'recent_low_cloud_acquisition' : 'least_cloudy_mosaic_fallback',
      source: 'Copernicus Sentinel-2 L2A via Sentinel Hub',
    },
  };
};

module.exports = {
  fetchSentinelTile,
  tileToBbox3857,
  MIN_ZOOM,
  MAX_ZOOM,
  bbox3857To4326,
  findBestAcquisition,
};
