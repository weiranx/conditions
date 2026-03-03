const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map();

const SYSTEM_PROMPT =
  'You are a backcountry conditions analyst. Write a 2-3 sentence actionable field brief. Be direct, specific, and focus on the most important decision factors. Do not use markdown formatting.';

function buildCacheKey({ score, primaryHazard, decisionLevel, factors }) {
  const topFactorNames = (factors || [])
    .slice(0, 3)
    .map((f) => f.hazard || f.name || '')
    .filter(Boolean)
    .join(',');
  return `${score}|${primaryHazard}|${decisionLevel}|${topFactorNames}`;
}

function pruneCache() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.ts > CACHE_TTL_MS) cache.delete(key);
  }
}

const registerAiBriefRoute = ({ app, askClaude }) => {
  app.post('/api/ai-brief', async (req, res) => {
    const { score, confidence, primaryHazard, decisionLevel, factors, context } = req.body || {};

    if (score == null || !primaryHazard || !decisionLevel) {
      return res.status(400).json({ error: 'Missing required fields: score, primaryHazard, decisionLevel' });
    }

    const cacheKey = buildCacheKey({ score, primaryHazard, decisionLevel, factors });

    pruneCache();
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json({ narrative: cached.narrative, cached: true });
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

      cache.set(cacheKey, { narrative, ts: Date.now() });
      return res.json({ narrative, cached: false });
    } catch (err) {
      const msg = err.message || 'AI service unavailable';
      const status = msg.includes('ANTHROPIC_API_KEY') ? 503 : 503;
      return res.status(status).json({ error: msg });
    }
  });
};

module.exports = { registerAiBriefRoute };
