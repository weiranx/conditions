const { createCache, normalizeTextKey } = require('../utils/cache');
const { logger } = require('../utils/logger');
const { matchCatalogPeaks, parseSearchBias, popularCatalogPeaks, rankPlaceResults } = require('../utils/place-search');

const nominatimSearchCache = createCache({ name: 'nominatim-search', ttlMs: 24 * 60 * 60 * 1000, staleTtlMs: 6 * 24 * 60 * 60 * 1000, maxEntries: 300 });

const MAX_RESULTS = 8;

const registerSearchRoutes = ({ app, fetchWithTimeout, defaultFetchHeaders, peaks }) => {
  app.get('/api/search', async (req, res) => {
    const { q, near } = req.query;
    const query = typeof q === 'string' ? q.trim().slice(0, 120) : '';

    if (!query) {
      return res.json(popularCatalogPeaks(peaks, 5));
    }

    const localMatches = matchCatalogPeaks(peaks, query);

    if (query.length < 3) return res.json(localMatches.slice(0, MAX_RESULTS));

    try {
      const fetchOptions = { headers: defaultFetchHeaders };
      const bias = parseSearchBias(near);
      const searchCacheKey = bias ? `${normalizeTextKey(query)}@${bias.key}` : normalizeTextKey(query);
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

      return res.json(uniqueResults);
    } catch (error) {
      logger.warn({ err: error, query }, 'Nominatim search failed; serving local catalog matches only');
      return res.json(localMatches.slice(0, MAX_RESULTS));
    }
  });
};

module.exports = {
  registerSearchRoutes,
};
