const { assertAIFeatureEnabled } = require('../utils/ai-client');
const { isCalendarDate } = require('../utils/plan-context');
const { PLAN_TEXT_MAX_LENGTH, parsePlanSentence } = require('../utils/plan-parse');
const { logger } = require('../utils/logger');
const { denyUnconfiguredAccountAccess } = require('../auth/account-access');

const UNIT_VALUES = { temperature: ['f', 'c'], wind: ['mph', 'kph'], elevation: ['ft', 'm'] };

const readUnits = (units) => {
  const source = units && typeof units === 'object' && !Array.isArray(units) ? units : {};
  return Object.fromEntries(Object.entries(UNIT_VALUES).map(([name, values]) => [
    name,
    values.includes(source[name]) ? source[name] : values[0],
  ]));
};

/**
 * POST /api/plan-parse { text, today, units? }: a sentence describing a plan,
 * read into the plan form's fields. Nothing is searched or evaluated here; the
 * client puts the place through its search and the fields through its form.
 */
const registerPlanParseRoute = ({
  app,
  askAI,
  ensureAccountAccess = denyUnconfiguredAccountAccess,
  ensureFeatureEnabled = () => assertAIFeatureEnabled('planParse'),
}) => {
  app.post('/api/plan-parse', async (req, res) => {
    const { text, today, units } = req.body || {};
    const sentence = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
    if (!sentence || !isCalendarDate(today)) {
      return res.status(400).json({ error: 'Missing required fields: text, today (YYYY-MM-DD)' });
    }
    if (sentence.length > PLAN_TEXT_MAX_LENGTH) {
      return res.status(413).json({ error: `Describe the plan in ${PLAN_TEXT_MAX_LENGTH} characters or fewer.` });
    }
    if (!(await ensureAccountAccess(req, res))) return;
    try {
      ensureFeatureEnabled();
    } catch (error) {
      return res.status(503).json({ error: error.message || 'AI features are unavailable' });
    }

    try {
      const plan = await parsePlanSentence({
        text: sentence,
        today,
        units: readUnits(units),
        askAI,
        userId: req.accountUser.id,
      });
      return res.json(plan);
    } catch (error) {
      logger.error({ err: error }, 'plan-parse error');
      const statusCode = error?.statusCode || 503;
      return res.status(statusCode).json({ error: error?.message || 'AI service unavailable' });
    }
  });
};

module.exports = { registerPlanParseRoute };
