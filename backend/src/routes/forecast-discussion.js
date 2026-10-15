const { chatGPTCacheKey } = require('../auth/chatgpt');
const { assertAIFeatureEnabled } = require('../utils/ai-client');
const { createCache } = require('../utils/cache');
const { DISCUSSION_PROMPT_VERSION, buildDiscussionContext, summarizeDiscussion } = require('../utils/discussion-summary');
const { logger } = require('../utils/logger');
const { denyUnconfiguredAccountAccess } = require('../auth/account-access');

// The context holds the discussion and the plan, so a hit is the same input.
const summaryCache = createCache({ name: 'forecast-discussion-summary', ttlMs: 6 * 60 * 60 * 1000, maxEntries: 200 });
const MAX_CONTEXT_LENGTH = 60000;
// The fast tier's 8 s budget is short for a long discussion; this still answers
// before nginx's 30 s read timeout on /api/.
const PROVIDER_TIMEOUT_MS = 20000;

// An AI reading of the report's NWS Area Forecast Discussion for this plan.
// It is regional context; it never changes the report's decision or score.
const registerForecastDiscussionRoute = ({
  app,
  askAI,
  ensureAccountAccess = denyUnconfiguredAccountAccess,
  ensureFeatureEnabled = () => assertAIFeatureEnabled('aiBrief'),
}) => {
  app.post('/api/forecast-discussion/summary', async (req, res) => {
    const { report, objectiveName, units } = req.body || {};
    if (!report || typeof report !== 'object' || Array.isArray(report)) {
      return res.status(400).json({ error: 'Missing required field: report' });
    }
    const context = buildDiscussionContext(report, { objectiveName });
    if (!context) return res.status(422).json({ error: 'This report has no forecast discussion to summarize.' });
    const contextJson = JSON.stringify(context);
    if (contextJson.length > MAX_CONTEXT_LENGTH) return res.status(413).json({ error: 'The forecast discussion is too long to summarize.' });

    if (!(await ensureAccountAccess(req, res))) return;
    try {
      ensureFeatureEnabled();
    } catch (error) {
      return res.status(503).json({ error: error.message || 'AI features are unavailable' });
    }

    const safeUnits = units && typeof units === 'object' && !Array.isArray(units)
      ? { temperature: units.temperature === 'c' ? 'c' : 'f', wind: units.wind === 'kph' ? 'kph' : 'mph', elevation: units.elevation === 'm' ? 'm' : 'ft' }
      : {};
    const cacheKey = chatGPTCacheKey(`${DISCUSSION_PROMPT_VERSION}|${JSON.stringify(safeUnits)}|${contextJson}`);
    try {
      const result = await summaryCache.getOrFetch(cacheKey, async () => {
        const started = Date.now();
        const answer = await summarizeDiscussion({ context, units: safeUnits, askAI, userId: req.accountUser.id, timeoutMs: PROVIDER_TIMEOUT_MS });
        logger.info({ seconds: Math.round((Date.now() - started) / 100) / 10, attempts: answer.attempts, validated: !answer.failed }, 'forecast-discussion: answered');
        // A failed answer is thrown so the cache keeps nothing and the next request asks again.
        if (answer.failed) throw Object.assign(new Error('The AI summary did not pass its fact checks.'), { problems: answer.problems });
        return {
          summary: answer.summary,
          forObjective: answer.forObjective,
          watch: answer.watch,
          forecasterConfidence: answer.forecasterConfidence,
          coversTripDate: context.discussion.coversTripDate,
          office: context.discussion.office || null,
          issuedTime: context.discussion.issuedTime || null,
          generatedAt: new Date().toISOString(),
        };
      });
      return res.json(result);
    } catch (error) {
      logger.warn({ err: error, problems: error?.problems?.slice(0, 8) }, 'forecast-discussion summary error');
      return res.status(503).json({ error: 'Could not summarize the forecast discussion right now.' });
    }
  });
};

module.exports = { registerForecastDiscussionRoute };
