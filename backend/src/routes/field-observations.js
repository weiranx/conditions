const { assertAIFeatureEnabled } = require('../utils/ai-client');
const { MAX_OBSERVATION_TEXT_LENGTH, extractObservations } = require('../utils/observation-extraction');
const { logger } = require('../utils/logger');
const { denyUnconfiguredAccountAccess } = require('../auth/account-access');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Reads what people saw out of a pasted trip report. The result is evidence the
// report shows next to the forecast; it never changes the decision or score.
const registerFieldObservationRoutes = ({
  app,
  askAI,
  ensureAccountAccess = denyUnconfiguredAccountAccess,
  ensureFeatureEnabled = () => assertAIFeatureEnabled('tripReports'),
}) => {
  app.post('/api/field-observations/extract', async (req, res) => {
    const { text, objective, date } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Paste a trip report or what you saw.' });
    }
    if (text.length > MAX_OBSERVATION_TEXT_LENGTH) {
      return res.status(413).json({ error: `Keep the text under ${MAX_OBSERVATION_TEXT_LENGTH.toLocaleString('en-US')} characters.` });
    }
    if (date !== undefined && date !== null && (typeof date !== 'string' || !DATE_PATTERN.test(date))) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD.' });
    }
    const lat = Number(objective?.lat);
    const lon = Number(objective?.lon);
    const elevationFt = Number(objective?.elevationFt);
    const place = {
      name: typeof objective?.name === 'string' ? objective.name : null,
      lat: Number.isFinite(lat) && lat >= -90 && lat <= 90 ? lat : null,
      lon: Number.isFinite(lon) && lon >= -180 && lon <= 180 ? lon : null,
      elevationFt: objective?.elevationFt == null || !Number.isFinite(elevationFt) ? null : elevationFt,
    };

    if (!(await ensureAccountAccess(req, res))) return;
    try {
      ensureFeatureEnabled();
    } catch (error) {
      return res.status(503).json({ error: error.message || 'AI features are unavailable' });
    }

    try {
      const observations = await extractObservations({
        text,
        objective: place,
        date: date || null,
        askAI,
        userId: req.accountUser.id,
      });
      return res.json({ observations, plannedDate: date || null, generatedAt: new Date().toISOString() });
    } catch (error) {
      logger.error({ err: error }, 'field-observations error');
      const statusCode = error?.statusCode || 503;
      return res.status(statusCode).json({ error: statusCode === 503 ? 'Could not read observations from that text right now.' : error.message });
    }
  });
};

module.exports = { registerFieldObservationRoutes };
