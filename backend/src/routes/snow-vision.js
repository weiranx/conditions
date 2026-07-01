const { createCache } = require('../utils/cache');
const { fetchSentinelTile } = require('../utils/sentinel-tiles');

// z13 tiles cover ~5km per side at Sentinel-2's ~10m/px native resolution — wide
// enough to see a route's approach/summit block without losing too much detail.
const SNOW_VISION_ZOOM = 13;

const SYSTEM_PROMPT = [
  'You are a backcountry conditions analyst reviewing a Sentinel-2 satellite true-color image',
  '(roughly 10m/pixel, a cloud-free mosaic from the least-cloudy pass in the last 30 days,',
  'centered on the requested coordinates and covering about 5x5 km).',
  'In 2-4 sentences, describe snow coverage relevant to backcountry travel: rough percent coverage,',
  'how patchy/continuous it is, and any obvious bare or rocky terrain. Be direct and concrete.',
  'This resolution cannot resolve small features like cornices, crevasses, or thin ice —',
  'do not speculate about them. Do not use markdown.',
].join(' ');

const lonLatToTile = (lon, lat, zoom) => {
  const latRad = (lat * Math.PI) / 180;
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return {
    x: Math.min(Math.max(x, 0), n - 1),
    y: Math.min(Math.max(y, 0), n - 1),
  };
};

const snowVisionCache = createCache({ name: 'snow-vision', ttlMs: 12 * 60 * 60 * 1000, staleTtlMs: 24 * 60 * 60 * 1000, maxEntries: 300 });

const registerSnowVisionRoute = ({ app, fetchWithTimeout, askClaudeVision }) => {
  app.get('/api/snow-vision', async (req, res) => {
    const { lat, lon } = req.query;
    const parsedLat = Number(lat);
    const parsedLon = Number(lon);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLon) || parsedLat < -90 || parsedLat > 90 || parsedLon < -180 || parsedLon > 180) {
      return res.status(400).json({ error: 'Latitude/longitude must be valid decimal coordinates.' });
    }

    const { x, y } = lonLatToTile(parsedLon, parsedLat, SNOW_VISION_ZOOM);
    // Keying by tile (not raw lat/lon) means nearby requests within the same ~5km tile
    // share one Sentinel Hub fetch + one vision call instead of paying for both per-request.
    const cacheKey = `${SNOW_VISION_ZOOM}/${x}/${y}`;

    try {
      const result = await snowVisionCache.getOrFetch(cacheKey, async () => {
        const png = await fetchSentinelTile({ z: SNOW_VISION_ZOOM, x, y, fetchWithTimeout });
        const analysis = await askClaudeVision(
          png.toString('base64'),
          'Analyze the snow conditions visible in this satellite image.',
          { model: 'claude-sonnet-5', maxTokens: 250, system: SYSTEM_PROMPT },
        );
        return { analysis, zoom: SNOW_VISION_ZOOM };
      });

      return res.json({ ...result, generatedAt: new Date().toISOString() });
    } catch (error) {
      const statusCode = error?.statusCode || 503;
      return res.status(statusCode).json({ error: error?.message || 'Failed to analyze satellite imagery.' });
    }
  });
};

module.exports = {
  registerSnowVisionRoute,
};
