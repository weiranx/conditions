const { createCache } = require('../utils/cache');
const { describeUnitsInstruction } = require('../utils/units-instruction');
const { logger } = require('../utils/logger');

const SYSTEM_PROMPT =
  "You are a friendly, experienced backcountry conditions analyst. You will be given the full raw backcountry safety report as JSON (weather, avalanche, alerts, air quality, snowpack, fire/heat risk, terrain surface, atmosphere, safety score and scoring factors, plus a separate weather-comfort pleasantness score) plus the app's computed decision level. Read the JSON directly and turn it into a quick, useful field briefing rather than a long essay or a list of raw fields. Use plain, calm language that feels like advice from a knowledgeable trip partner. Be direct and specific — reference actual values from the JSON rather than vague language. Return exactly these four labeled sections, each on its own line, with no other introduction or closing: BIG PICTURE: 1-2 sentences naming the dominant hazard and overall pattern. WATCH CLOSELY: 1-2 sentences explaining the most important secondary or time-sensitive condition (for example wind loading, freezing level, or thunderstorm timing). COMFORT CHECK: 1 concise sentence describing what the weather is likely to feel like; keep this clearly separate from safety. BEST MOVE: 1 concise, concrete recommendation. Use 5-7 sentences total. Plain text only: no markdown, bullets, numbered lists, '#' characters, or bold/italic asterisks. IMPORTANT: Pleasantness is comfort-only and MUST NOT offset a hazard or change the recommendation. The BEST MOVE recommendation MUST be consistent with the provided decision level — if the decision is NO-GO, recommend postponing or choosing a safer objective, never proceeding with caution. Only suggest proceeding when the decision level supports it.";

const AI_BRIEF_PROMPT_VERSION = '2';

const aiBriefCache = createCache({ name: 'ai-brief', ttlMs: 60 * 60 * 1000, staleTtlMs: 60 * 60 * 1000, maxEntries: 200 });

// Bounds the raw report JSON before it's used as a cache key or interpolated into the
// AI prompt, so an unusually large payload can't blow up prompt size or cache memory.
const MAX_REPORT_LENGTH = 12000;

const registerAiBriefRoute = ({ app, askAI }) => {
  app.post('/api/ai-brief', async (req, res) => {
    const { report, decisionLevel, units } = req.body || {};

    if (!report || typeof report !== 'object' || !decisionLevel) {
      return res.status(400).json({ error: 'Missing required fields: report, decisionLevel' });
    }

    const reportJson = JSON.stringify(report).slice(0, MAX_REPORT_LENGTH);
    const cacheKey = `${AI_BRIEF_PROMPT_VERSION}|${decisionLevel}|${JSON.stringify(units || {})}|${reportJson}`;

    try {
      const userPrompt = `${describeUnitsInstruction(units)}\n\nDecision level: ${decisionLevel}\n\nFull report data (JSON):\n${reportJson}`;

      const narrative = await aiBriefCache.getOrFetch(cacheKey, async () => {
        return askAI(userPrompt, {
          maxTokens: 4096,
          system: SYSTEM_PROMPT,
          feature: 'report-brief',
        });
      });

      return res.json({ narrative });
    } catch (err) {
      logger.error({ err }, 'ai-brief error');
      const msg = err.message || 'AI service unavailable';
      return res.status(503).json({ error: msg });
    }
  });
};

module.exports = { registerAiBriefRoute };
