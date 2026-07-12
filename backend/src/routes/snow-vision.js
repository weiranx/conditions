const { createCache } = require('../utils/cache');
const { assertAIFeatureEnabled } = require('../utils/ai-client');
const { assertFeatureEnabled } = require('../utils/feature-flags');
const { fetchSentinelTile } = require('../utils/sentinel-tiles');
const { logger } = require('../utils/logger');

// z13 tiles cover ~5km per side at Sentinel-2's ~10m/px native resolution — wide
// enough to see a route's approach/summit block without losing too much detail.
const SNOW_VISION_ZOOM = 13;

const SYSTEM_PROMPT = [
  'You are a backcountry conditions analyst reviewing a Sentinel-2 satellite true-color image',
  '(roughly 10m/pixel, a cloud-free mosaic from the least-cloudy pass in the last 30 days,',
  'centered on the requested coordinates and covering about 5x5 km).',
  'You may also be given raw ground-station snowpack data (SNOTEL/CDEC/NOHRSC snow depth and SWE readings,',
  'and a comparison to the historical average for this date) as JSON.',
  'Turn the evidence into a quick, friendly briefing for a backcountry traveler. In 4-6 sentences, describe snow coverage: rough percent coverage,',
  'how patchy/continuous it is, and any obvious bare or rocky terrain — then cross-reference that with',
  'the ground-station data if provided, noting whether the visual coverage and the measured depth/SWE agree,',
  'and what the historical comparison implies about how the snowpack got here. If ground-station data is absent',
  'or from a station far from the imaged area, say so and rely on the image alone.',
  'Be direct and concrete. This resolution cannot resolve small features like cornices, crevasses, or thin ice —',
  'do not speculate about them. Return exactly these three labeled sections, each on its own line, with no other introduction or closing:',
  'SNOW COVERAGE: 1-2 sentences describing what is visibly snow-covered, patchy, bare, or rocky.',
  'GROUND CHECK: 1-2 sentences cross-referencing station measurements and imagery freshness, including uncertainty or missing data.',
  'TRAVEL TAKEAWAY: 1 concise sentence explaining the practical planning implication without inventing small-scale hazards.',
  'Plain text only: no markdown, bullets, numbered lists, "#" characters, or bold/italic asterisks.',
].join(' ');

const SNOW_VISION_PROMPT_VERSION = '2';

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

// Bounds the raw snowpack JSON before it's interpolated into the vision prompt or used
// as part of the cache key.
const MAX_SNOWPACK_LENGTH = 4000;

const snowVisionCache = createCache({ name: 'snow-vision', ttlMs: 12 * 60 * 60 * 1000, staleTtlMs: 24 * 60 * 60 * 1000, maxEntries: 300 });

const registerSnowVisionRoute = ({
  app,
  fetchWithTimeout,
  askAIVision,
  ensureFeatureEnabled = () => {
    assertFeatureEnabled('satelliteImagery');
    assertAIFeatureEnabled('snowVision');
  },
}) => {
  app.post('/api/snow-vision', async (req, res) => {
    const { lat, lon, snowpack, units } = req.body || {};
    const parsedLat = Number(lat);
    const parsedLon = Number(lon);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLon) || parsedLat < -90 || parsedLat > 90 || parsedLon < -180 || parsedLon > 180) {
      return res.status(400).json({ error: 'Latitude/longitude must be valid decimal coordinates.' });
    }
    try {
      ensureFeatureEnabled();
    } catch (error) {
      return res.status(503).json({ error: error.message || 'AI features are unavailable' });
    }

    const { x, y } = lonLatToTile(parsedLon, parsedLat, SNOW_VISION_ZOOM);
    const snowpackJson = snowpack && typeof snowpack === 'object' ? JSON.stringify(snowpack).slice(0, MAX_SNOWPACK_LENGTH) : '';
    const metric = units?.elevation === 'm';
    // Keying by tile (not raw lat/lon) means nearby requests within the same ~5km tile
    // share one Sentinel Hub fetch. The snowpack payload and unit preference are appended
    // to the key so a changed ground-station reading or unit switch busts the cache.
    const cacheKey = `${SNOW_VISION_PROMPT_VERSION}|${SNOW_VISION_ZOOM}/${x}/${y}|${metric ? 'm' : 'ft'}|${snowpackJson}`;

    try {
      const result = await snowVisionCache.getOrFetch(cacheKey, async () => {
        const tile = await fetchSentinelTile({ z: SNOW_VISION_ZOOM, x, y, fetchWithTimeout });
        const png = tile?.buffer || tile;
        const base64 = png.toString('base64');
        const depthUnit = metric ? 'centimeters (cm)' : 'inches (in)';
        const promptText = snowpackJson
          ? `Analyze the snow conditions visible in this satellite image. Imagery metadata: ${JSON.stringify(tile?.metadata || {})}. Use the acquisition time to discuss freshness and do not describe the image as current when it is old. Ground-station/snow-cover context (JSON):\n${snowpackJson}\n\nThe snow depth and SWE values in that JSON are in inches. In your response, convert every depth/SWE value you mention to ${depthUnit} and do not mix unit systems.`
          : `Analyze the snow conditions visible in this satellite image. Imagery metadata: ${JSON.stringify(tile?.metadata || {})}. Use the acquisition time to discuss freshness and do not describe the image as current when it is old.`;
        const analysis = await askAIVision(
          base64,
          promptText,
          { maxTokens: 4096, system: SYSTEM_PROMPT, feature: 'snow-vision' },
        );
        // Return the same tile shown to the AI so the UI can display exactly what was
        // analyzed, alongside a note pointing users at the app's live satellite basemap.
        return { analysis, zoom: SNOW_VISION_ZOOM, image: `data:image/png;base64,${base64}`, imagery: tile?.metadata || null };
      });

      return res.json({ ...result, generatedAt: new Date().toISOString() });
    } catch (error) {
      logger.error({ err: error }, 'snow-vision error');
      const statusCode = error?.statusCode || 503;
      return res.status(statusCode).json({ error: error?.message || 'Failed to analyze satellite imagery.' });
    }
  });
};

module.exports = {
  registerSnowVisionRoute,
};
