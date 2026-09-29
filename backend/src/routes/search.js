const { createCache, normalizeTextKey } = require('../utils/cache');
const { logger } = require('../utils/logger');
const { describePoint } = require('../utils/point-place');
const { attachFallbackImages } = require('../utils/objective-image');
const { fetchSolarDay } = require('../utils/solar');
const { attachWhere, describeWhere, matchCatalogPeaks, parseSearchBias, popularCatalogPeaks, rankPlaceResults } = require('../utils/place-search');

const nominatimSearchCache = createCache({ name: 'nominatim-search', ttlMs: 24 * 60 * 60 * 1000, staleTtlMs: 6 * 24 * 60 * 60 * 1000, maxEntries: 300 });

const MAX_RESULTS = 8;

const parsePoint = (query) => {
  const lat = Number(query.lat);
  const lon = Number(query.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
};

const registerSearchRoutes = ({ app, fetchWithTimeout, defaultFetchHeaders, peaks, fetchElevationFt, solarCache, photoRegions = [] }) => {
  const withPlaces = (results) => attachWhere(attachFallbackImages(results, photoRegions), photoRegions);
  // A route or trip can cross boundaries: `points` are every place it goes.
  app.post('/api/where', (req, res) => {
    const { name, points } = req.body || {};
    res.json({ where: describeWhere({ name: typeof name === 'string' ? name : '', points }, photoRegions) });
  });

  // Dawn, sunrise and sunset on the planned day, so the start can be chosen against the light.
  app.get('/api/search/daylight', async (req, res) => {
    const point = parsePoint(req.query);
    const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : null;
    if (!point || !date) return res.status(400).json({ error: 'lat, lon and date (YYYY-MM-DD) are required.' });
    if (!solarCache) return res.json({ dawn: null, sunrise: null, sunset: null });
    try {
      const day = await fetchSolarDay({ ...point, date, solarCache, fetchWithTimeout, fetchOptions: { headers: defaultFetchHeaders } });
      return res.json({ dawn: day.dawn, sunrise: day.sunrise, sunset: day.sunset });
    } catch (error) {
      logger.warn({ err: error, ...point, date }, 'Daylight lookup failed');
      return res.json({ dawn: null, sunrise: null, sunset: null });
    }
  });

  // A point chosen on the map: what to call it and how high it is.
  app.get('/api/search/point', async (req, res) => {
    const point = parsePoint(req.query);
    if (!point) return res.status(400).json({ error: 'lat and lon must be valid coordinates.' });
    const { lat, lon } = point;
    try {
      return res.json(await describePoint({ lat, lon, peaks, fetchWithTimeout, fetchHeaders: defaultFetchHeaders, fetchElevationFt }));
    } catch (error) {
      logger.warn({ err: error, lat, lon }, 'Point lookup failed');
      return res.json({ name: null, elevationFt: null });
    }
  });

  app.get('/api/search', async (req, res) => {
    const { q, near } = req.query;
    const query = typeof q === 'string' ? q.trim().slice(0, 120) : '';

    if (!query) {
      return res.json(withPlaces(popularCatalogPeaks(peaks, 5)));
    }

    const localMatches = matchCatalogPeaks(peaks, query);

    if (query.length < 3) return res.json(withPlaces(localMatches.slice(0, MAX_RESULTS)));

    try {
      const fetchOptions = { headers: defaultFetchHeaders };
      const bias = parseSearchBias(near);
      // Separate components: query text could otherwise spell out another query's bias.
      const searchCacheKey = JSON.stringify([normalizeTextKey(query), bias ? bias.key : null]);
      const apiResults = await nominatimSearchCache.getOrFetch(searchCacheKey, async () => {
        // More candidates than we show: businesses are dropped and outdoor features re-ranked first.
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=us&limit=12&addressdetails=1&extratags=1&dedupe=1&accept-language=en${bias ? `&viewbox=${bias.viewbox}` : ''}`;
        const response = await fetchWithTimeout(url, fetchOptions);
        if (!response.ok) {
          throw new Error(`Nominatim request failed with status ${response.status}`);
        }
        return rankPlaceResults(await response.json(), { biased: Boolean(bias) });
      });

      const combined = [...localMatches, ...apiResults];
      const uniqueResults = combined
        .filter((value, index, array) => array.findIndex((entry) => entry.name === value.name) === index)
        .slice(0, MAX_RESULTS);

      return res.json(withPlaces(uniqueResults));
    } catch (error) {
      logger.warn({ err: error, query }, 'Nominatim search failed; serving local catalog matches only');
      return res.json(withPlaces(localMatches.slice(0, MAX_RESULTS)));
    }
  });
};

module.exports = {
  registerSearchRoutes,
};
