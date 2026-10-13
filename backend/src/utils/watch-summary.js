'use strict';

// A short plain-language explanation of an Objective Watch change for the alert
// email and the watch history. The checker has already decided what changed;
// the model only explains those reasons from the data passed here, and any
// failure or doubtful answer leaves the alert exactly as it was without one.

const SUMMARY_MAX_CHARS = 600;
const SUMMARY_MIN_CHARS = 40;
const SUMMARY_MAX_TOKENS = 260;
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_HOURS = 24;
const MAX_ALERTS = 5;
const MAX_CHECKPOINTS = 10;

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const round = (value) => (finite(value) === null ? null : Math.round(value));
const shortText = (value, limit) => {
  const text = typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ').trim()
    : '';
  return text ? text.slice(0, limit) : null;
};

// Drops null, empty and empty-collection fields so the prompt carries only evidence.
const prune = (value) => {
  if (Array.isArray(value)) {
    const items = value.map(prune).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, prune(item)])
      .filter(([, item]) => item !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  if (value === null || value === undefined || value === '' || (typeof value === 'number' && !Number.isFinite(value))) {
    return undefined;
  }
  return value;
};

const plannedHours = (report) => {
  const rows = report?.evaluation?.travelWindow?.planned?.rows;
  if (!Array.isArray(rows)) return null;
  return rows.slice(0, MAX_HOURS).map((row) => ({
    time: shortText(row?.time, 8),
    tempF: round(row?.temp),
    feelsLikeF: round(row?.feelsLike),
    windMph: round(row?.wind),
    gustMph: round(row?.gust),
    precipChancePercent: round(row?.precipChance),
    withinLimits: typeof row?.pass === 'boolean' ? row.pass : null,
    failed: Array.isArray(row?.failedRuleLabels) ? row.failedRuleLabels.slice(0, 3).map((label) => shortText(label, 80)) : null,
  }));
};

const currentAlerts = (report) => {
  const alerts = report?.alerts?.alerts;
  if (!Array.isArray(alerts)) return null;
  return alerts.slice(0, MAX_ALERTS).map((alert) => ({
    event: shortText(alert?.event, 80),
    severity: shortText(alert?.severity, 30),
    headline: shortText(alert?.headline, 200),
  }));
};

const currentAvalanche = (report) => {
  const avalanche = report?.avalanche;
  if (!avalanche || typeof avalanche !== 'object' || avalanche.dangerUnknown === true) return null;
  return {
    dangerLevel: round(avalanche.dangerLevel),
    problems: Array.isArray(avalanche.problems)
      ? avalanche.problems.slice(0, 4).map((problem) => shortText(typeof problem === 'string' ? problem : problem?.name, 60))
      : null,
    bottomLine: shortText(avalanche.bottomLine, 300),
  };
};

/**
 * The evidence the model may use: the change's reasons and before/after
 * signals, the plan, and from the current report the decision, the planned
 * hours, the hour needing most attention, alerts and avalanche danger. Route
 * checkpoints, when the watch has a route, name the places and arrival times.
 * Start-time scenarios are included only when the report already carries them.
 */
const buildWatchSummaryContext = ({ title, plan, change, report, routeCheckpoints } = {}) => prune({
  objective: shortText(title, 160),
  plan: {
    date: shortText(plan?.forecastDate, 10),
    start: shortText(plan?.alpineStartTime, 5),
    travelWindowHours: finite(Number(plan?.travelWindowHours)),
  },
  units: { temperature: 'F', wind: 'mph', precipitation: 'percent chance' },
  changes: (Array.isArray(change?.reasons) ? change.reasons : []).map((reason) => ({
    direction: reason?.direction === 'better' ? 'better' : 'worse',
    what: shortText(reason?.label, 240),
  })),
  signalsBefore: change?.previous || null,
  signalsNow: change?.current || null,
  decision: report?.evaluation?.decision ? {
    level: shortText(report.evaluation.decision.level, 12),
    blockers: (report.evaluation.decision.blockers || []).slice(0, 4).map((item) => shortText(item, 200)),
    cautions: (report.evaluation.decision.cautions || []).slice(0, 4).map((item) => shortText(item, 200)),
  } : null,
  hourNeedingMostAttention: shortText(report?.evaluation?.criticalWindow?.peakTime, 8),
  plannedHours: plannedHours(report),
  startTimeScenarios: Array.isArray(report?.startTimeScenarios) ? report.startTimeScenarios.slice(0, 8) : null,
  alerts: currentAlerts(report),
  avalanche: currentAvalanche(report),
  routeCheckpoints: Array.isArray(routeCheckpoints) ? routeCheckpoints.slice(0, MAX_CHECKPOINTS) : null,
}) || {};

const WATCH_SUMMARY_SYSTEM = [
  'You explain an automated backcountry conditions alert to the person who planned the trip.',
  'Write 2 or 3 short plain sentences, no markdown, no lists, no greeting.',
  'Say what changed, which hours or places along the route it affects, and one concrete adjustment that would help, such as an earlier start, if the data supports one.',
  'Use only facts and numbers that appear in the JSON you are given. Never invent thresholds, readings, times or places, and never say whether the trip is safe or change the decision.',
  'Write times exactly as they appear in the data (HH:MM). Suggest a different start only when the planned hours or start-time scenarios show the problem is limited to some hours; otherwise suggest reviewing the plan.',
].join(' ');

const buildWatchSummaryPrompt = (context) => `Alert data (JSON):\n${JSON.stringify(context)}\n\nExplain this change in 2-3 plain sentences.`;

/** Plain text: no markdown, one paragraph, capped at a sentence end when possible. */
const sanitizeWatchSummary = (text) => {
  if (typeof text !== 'string') return null;
  let cleaned = text
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+•]\s+|\d+[.)]\s+)/gmu, '')
    .replace(/(\*\*|__|\*|_|`|~~)(?=\S)([^\n]*?\S)\1/gu, '$2')
    .replace(/[*`#]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^(?:summary|explanation)\s*:\s*/iu, '');
  if (cleaned.length > SUMMARY_MAX_CHARS) {
    const cut = cleaned.slice(0, SUMMARY_MAX_CHARS);
    const sentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    cleaned = sentenceEnd >= SUMMARY_MIN_CHARS ? cut.slice(0, sentenceEnd + 1) : `${cut.slice(0, SUMMARY_MAX_CHARS - 1).trimEnd()}…`;
  }
  return cleaned || null;
};

// Every number the evidence contains, including 12-hour forms of HH:MM times.
const groundedNumbers = (context) => {
  const source = JSON.stringify(context);
  const numbers = new Set((source.match(/\d+(?:\.\d+)?/gu) || []).map((value) => String(Number(value))));
  for (const [, hours] of source.matchAll(/\b(\d{1,2}):\d{2}\b/gu)) {
    numbers.add(String(Number(hours) % 12 || 12));
  }
  return numbers;
};

const REFUSAL_PATTERN = /^(?:i'?m sorry|i cannot|i can't|as an ai|sorry)\b/iu;

/**
 * Null unless the text reads as a short explanation whose every number is
 * found in the evidence: a made-up reading or threshold drops the summary.
 */
const acceptWatchSummary = (text, context) => {
  const summary = sanitizeWatchSummary(text);
  if (!summary || summary.length < SUMMARY_MIN_CHARS || REFUSAL_PATTERN.test(summary) || /[{}]/u.test(summary)) return null;
  const known = groundedNumbers(context);
  const used = (summary.match(/\d+(?:\.\d+)?/gu) || []).map((value) => String(Number(value)));
  return used.every((value) => known.has(value)) ? summary : null;
};

const withTimeout = (promise, timeoutMs) => {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

/**
 * Returns summarize(input) -> Promise<string | null>. It never throws and
 * resolves within timeoutMs; null means send the alert without a summary.
 */
const createWatchSummarizer = ({
  askAI,
  isAvailable = () => false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  log = console,
} = {}) => async ({ title, plan, change, report, routeCheckpoints, userId } = {}) => {
  try {
    if (typeof askAI !== 'function' || !isAvailable('watchSummary')) return null;
    if (!Array.isArray(change?.reasons) || change.reasons.length === 0) return null;
    const context = buildWatchSummaryContext({ title, plan, change, report, routeCheckpoints });
    const request = Promise.resolve()
      .then(() => askAI(buildWatchSummaryPrompt(context), {
        system: WATCH_SUMMARY_SYSTEM,
        tier: 'fast',
        maxTokens: SUMMARY_MAX_TOKENS,
        feature: 'watch-summary',
        ...(userId ? { userId: String(userId) } : {}),
      }))
      .catch((error) => {
        log.warn?.({ err: error }, 'Objective Watch summary failed');
        return null;
      });
    const text = await withTimeout(request, timeoutMs);
    return text ? acceptWatchSummary(text, context) : null;
  } catch (error) {
    log.warn?.({ err: error }, 'Objective Watch summary failed');
    return null;
  }
};

module.exports = {
  SUMMARY_MAX_CHARS,
  WATCH_SUMMARY_SYSTEM,
  acceptWatchSummary,
  buildWatchSummaryContext,
  buildWatchSummaryPrompt,
  createWatchSummarizer,
  sanitizeWatchSummary,
};
