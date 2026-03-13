const { createCache } = require('../utils/cache');

const SYSTEM_PROMPT =
  'You are a backcountry conditions analyst. Write a 2-3 sentence actionable field brief. Be direct, specific, and focus on the most important decision factors. Do not use markdown formatting. IMPORTANT: Your recommendation MUST be consistent with the provided decision level — if the decision is NO-GO, do not suggest proceeding with caution; instead recommend postponing or choosing a safer objective. Only suggest proceeding when the decision level supports it.';

const aiBriefCache = createCache({ name: 'ai-brief', ttlMs: 60 * 60 * 1000, staleTtlMs: 60 * 60 * 1000, maxEntries: 200 });

function buildCacheKey({ score, primaryHazard, decisionLevel, factors, context }) {
  const topFactorNames = (factors || [])
    .slice(0, 3)
    .map((f) => f.hazard || f.name || '')
    .filter(Boolean)
    .join(',');
  const contextKey = typeof context === 'string' ? context.slice(0, 120) : '';
  return `${score}|${primaryHazard}|${decisionLevel}|${topFactorNames}|${contextKey}`;
}

const registerAiBriefRoute = ({ app, askClaude }) => {
  app.post('/api/ai-brief', async (req, res) => {
    const { score, confidence, primaryHazard, decisionLevel, factors, context } = req.body || {};

    if (score == null || !primaryHazard || !decisionLevel) {
      return res.status(400).json({ error: 'Missing required fields: score, primaryHazard, decisionLevel' });
    }

    const cacheKey = buildCacheKey({ score, primaryHazard, decisionLevel, factors, context });

    const cached = aiBriefCache.get(cacheKey);
    if (cached) {
      return res.json({ narrative: cached.value, cached: true });
    }

    const topFactorsText = (factors || [])
      .slice(0, 3)
      .map((f) => `${f.hazard || f.name}: ${f.impact > 0 ? '+' : ''}${f.impact} pts`)
      .join('; ');

    const userPrompt = [
      context || '',
      `Score: ${score}/100 (${confidence ?? '?'}% confidence). Primary hazard: ${primaryHazard}. Decision: ${decisionLevel}.`,
      topFactorsText ? `Top factors: ${topFactorsText}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const narrative = await askClaude(userPrompt, {
        model: 'claude-haiku-4-5-20251001',
        maxTokens: 200,
        system: SYSTEM_PROMPT,
      });

      aiBriefCache.set(cacheKey, narrative);
      return res.json({ narrative, cached: false });
    } catch (err) {
      const msg = err.message || 'AI service unavailable';
      return res.status(503).json({ error: msg });
    }
  });
};

module.exports = { registerAiBriefRoute };
