const { buildPlanContext } = require('../utils/plan-context');
const { evaluatePlan } = require('../utils/plan-evaluation');

// A report's trend covers at most a day or two of hours; anything far longer is not a report.
const MAX_TREND_ROWS = 500;

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * POST /api/evaluate { report, plan } → { evaluation }
 *
 * Re-checks a report already on the client against a plan: new limits or
 * units, another approach, or a saved report opened under other settings.
 * Pure — no upstream requests and no report usage.
 */
const registerEvaluateRoute = ({ app }) => {
  app.post('/api/evaluate', (req, res) => {
    const { report, plan = {} } = req.body || {};
    if (!isRecord(report) || !isRecord(report.weather) || !isRecord(report.safety)) {
      return res.status(400).json({ error: 'A report with weather and safety sections is required.' });
    }
    if (!isRecord(plan)) {
      return res.status(400).json({ error: 'plan must be an object of plan parameters.' });
    }
    if (Array.isArray(report.weather.trend) && report.weather.trend.length > MAX_TREND_ROWS) {
      return res.status(413).json({ error: 'Report trend is too long to evaluate.' });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ evaluation: evaluatePlan(report, buildPlanContext(plan, report)) });
  });
};

module.exports = { registerEvaluateRoute };
