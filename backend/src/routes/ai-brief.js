const { createCache } = require('../utils/cache');

const SYSTEM_PROMPT =
  "You are a backcountry conditions analyst. You will be given the full raw backcountry safety report as JSON (weather, avalanche, alerts, air quality, snowpack, fire/heat risk, terrain surface, atmosphere, safety score and scoring factors) plus the app's computed decision level. Read the JSON directly and write a thorough field analysis, 5-8 sentences, synthesizing the data into a coherent picture rather than restating fields as a list. Cover: the dominant hazard driving the score, how secondary factors compound or offset it, any time-sensitive conditions (e.g. wind loading, freezing level, thunderstorm timing) worth noting, and a concrete, specific recommendation. Be direct and specific — reference actual values from the JSON rather than vague language. Do not use markdown formatting or headers; write in flowing prose. IMPORTANT: Your recommendation MUST be consistent with the provided decision level — if the decision is NO-GO, do not suggest proceeding with caution; instead recommend postponing or choosing a safer objective. Only suggest proceeding when the decision level supports it.";

const aiBriefCache = createCache({ name: 'ai-brief', ttlMs: 60 * 60 * 1000, staleTtlMs: 60 * 60 * 1000, maxEntries: 200 });

// Bounds the raw report JSON before it's used as a cache key or interpolated into the
// Claude prompt, so an unusually large payload can't blow up prompt size or cache memory.
const MAX_REPORT_LENGTH = 12000;

const registerAiBriefRoute = ({ app, askClaude }) => {
  app.post('/api/ai-brief', async (req, res) => {
    const { report, decisionLevel } = req.body || {};

    if (!report || typeof report !== 'object' || !decisionLevel) {
      return res.status(400).json({ error: 'Missing required fields: report, decisionLevel' });
    }

    const reportJson = JSON.stringify(report).slice(0, MAX_REPORT_LENGTH);
    const cacheKey = `${decisionLevel}|${reportJson}`;

    try {
      const userPrompt = `Decision level: ${decisionLevel}\n\nFull report data (JSON):\n${reportJson}`;

      const narrative = await aiBriefCache.getOrFetch(cacheKey, async () => {
        return askClaude(userPrompt, {
          model: 'claude-haiku-4-5-20251001',
          maxTokens: 450,
          system: SYSTEM_PROMPT,
        });
      });

      return res.json({ narrative });
    } catch (err) {
      const msg = err.message || 'AI service unavailable';
      return res.status(503).json({ error: msg });
    }
  });
};

module.exports = { registerAiBriefRoute };
