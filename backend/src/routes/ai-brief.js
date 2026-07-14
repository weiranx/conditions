const { createCache } = require('../utils/cache');
const { assertAIFeatureEnabled } = require('../utils/ai-client');
const { describeUnitsInstruction } = require('../utils/units-instruction');
const { getFeatureFlags } = require('../utils/feature-flags');
const {
  getDisabledScoreFeatureLabels,
  getScoreFeatureSnapshot,
  reportMatchesScoreFeatures,
  sanitizeReportForFeatureFlags,
} = require('../utils/report-feature-filter');
const { logger } = require('../utils/logger');
const { denyUnconfiguredAccountAccess } = require('../auth/account-access');

const SYSTEM_PROMPT =
  "You are a friendly, experienced backcountry conditions analyst. You will be given a feature-filtered backcountry safety report as JSON plus the app's computed decision level. Read only the enabled report domains and turn them into a decision-ready field briefing, not a compressed recap or a list of raw fields. Product domains listed as disabled were intentionally excluded: do not mention them, infer them from other data, recommend domain-specific gear for them, or advise the user to check their sources. Explain what the enabled values mean for this specific plan: where and when exposure grows, how hazards may interact, what evidence drives the decision, and what concrete changes would reduce risk. Prioritize consequential signals and omit domains that add no planning value. Reference actual values, times, elevations, aspects, alert names, and source freshness when available. Never invent a route, terrain feature, threshold, or condition that is not supported by the report. Use plain, calm language that feels like advice from a knowledgeable trip partner. Return exactly these six labeled sections, each on its own line, with no other introduction or closing: BIG PICTURE: 2-3 sentences naming the dominant hazards, the overall trajectory through the selected travel window, and why the computed decision level fits. WHY IT MATTERS: 2-3 sentences connecting the most important actual values and scoring factors to practical consequences rather than merely repeating them. WATCH CLOSELY: 2-3 sentences identifying the most important time, elevation, aspect, or weather thresholds to monitor and what change would make the plan worse. DATA CONFIDENCE: 1-2 sentences naming stale, missing, modeled, conflicting, or especially strong evidence and what should be verified before departure. COMFORT CHECK: 1-2 sentences describing what the weather is likely to feel like; keep this clearly separate from safety. BEST MOVE: 2-3 sentences giving specific, condition-linked actions such as timing, terrain choice, turnaround triggers, verification steps, or essential gear. Aim for 10-15 substantive sentences when the report supports them; never pad a sparse report or repeat the same point. Plain text only: no markdown, bullets, numbered lists, '#' characters, or bold/italic asterisks. IMPORTANT: Pleasantness is comfort-only and MUST NOT offset a hazard or change the recommendation. The BEST MOVE recommendation MUST be consistent with the provided decision level — if the decision is NO-GO, recommend postponing or choosing a lower-risk objective, never proceeding with caution. Only suggest proceeding when the decision level supports it.";

const AI_BRIEF_PROMPT_VERSION = '4';
const AI_BRIEF_MAX_TOKENS = 8192;

const aiBriefCache = createCache({ name: 'ai-brief', ttlMs: 60 * 60 * 1000, staleTtlMs: 60 * 60 * 1000, maxEntries: 200 });

// Bounds the raw report JSON before it's used as a cache key or interpolated into the
// AI prompt, so an unusually large payload can't blow up prompt size or cache memory.
const MAX_REPORT_LENGTH = 12000;

const registerAiBriefRoute = ({
  app,
  askAI,
  ensureAccountAccess = denyUnconfiguredAccountAccess,
  ensureFeatureEnabled = () => assertAIFeatureEnabled('aiBrief'),
  getProductFeatureFlags = getFeatureFlags,
}) => {
  app.post('/api/ai-brief', async (req, res) => {
    const { report, decisionLevel, units } = req.body || {};

    if (!report || typeof report !== 'object' || !decisionLevel) {
      return res.status(400).json({ error: 'Missing required fields: report, decisionLevel' });
    }
    if (!(await ensureAccountAccess(req, res))) return;

    try {
      ensureFeatureEnabled();
      const featureFlags = getProductFeatureFlags();
      if (!reportMatchesScoreFeatures(report, featureFlags)) {
        return res.status(409).json({
          error: 'Risk feature settings changed. Generate a new report before creating an AI brief.',
          code: 'REPORT_REGENERATION_REQUIRED',
        });
      }
      const filteredReport = sanitizeReportForFeatureFlags(report, featureFlags);
      const disabledDomains = getDisabledScoreFeatureLabels(featureFlags);
      const featureSnapshot = getScoreFeatureSnapshot(featureFlags);
      const reportJson = JSON.stringify(filteredReport).slice(0, MAX_REPORT_LENGTH);
      const cacheKey = `${AI_BRIEF_PROMPT_VERSION}|${decisionLevel}|${JSON.stringify(units || {})}|${JSON.stringify(featureSnapshot)}|${reportJson}`;
      const featureInstruction = disabledDomains.length
        ? `Disabled product domains: ${disabledDomains.join(', ')}. Do not mention, infer, or recommend checks or gear for these domains.`
        : 'All scored product domains are enabled.';
      const userPrompt = `${describeUnitsInstruction(units)}\n\n${featureInstruction}\n\nDecision level: ${decisionLevel}\n\nFeature-filtered report data (JSON):\n${reportJson}`;

      const narrative = await aiBriefCache.getOrFetch(cacheKey, async () => {
        return askAI(userPrompt, {
          maxTokens: AI_BRIEF_MAX_TOKENS,
          system: SYSTEM_PROMPT,
          feature: 'report-brief',
          userId: req.accountUser.id,
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

module.exports = {
  AI_BRIEF_MAX_TOKENS,
  SYSTEM_PROMPT,
  registerAiBriefRoute,
};
