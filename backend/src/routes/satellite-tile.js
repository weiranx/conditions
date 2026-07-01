const { fetchSentinelTile } = require('../utils/sentinel-tiles');

const registerSatelliteTileRoute = ({ app, fetchWithTimeout, tileCache }) => {
  app.get('/api/satellite-tile/:z/:x/:y.png', async (req, res) => {
    const { z, x, y } = req.params;
    const cacheKey = `${z}/${x}/${y}`;

    try {
      const png = await tileCache.getOrFetch(cacheKey, () => fetchSentinelTile({ z, x, y, fetchWithTimeout }));
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      // Helmet's default Cross-Origin-Resource-Policy: same-origin blocks the browser
      // from rendering this as an <img> tile when the frontend is on a different origin
      // (e.g. Vercel frontend + separately hosted backend).
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      return res.status(200).send(png);
    } catch (error) {
      const statusCode = error?.statusCode || 500;
      return res.status(statusCode).json({
        error: 'Failed to load satellite tile.',
        details: error?.message || 'Unknown backend error.',
      });
    }
  });
};

module.exports = {
  registerSatelliteTileRoute,
};
