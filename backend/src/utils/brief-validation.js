const HEADINGS = ['BIG PICTURE', 'WHY IT MATTERS', 'WATCH CLOSELY', 'DATA CONFIDENCE', 'COMFORT CHECK', 'BEST MOVE'];
const readPath = (report, path) => {
  if (typeof path !== 'string' || !/^[a-zA-Z0-9_.]+$/.test(path)) return undefined;
  return path.split('.').reduce((value, key) => value && Object.hasOwn(value, key) ? value[key] : undefined, report);
};
// A minus sign counts only when it starts a number, so "10-15 mph" and
// "7:00-9:00" read as ranges, not negative values.
const numbers = value => (String(value).match(/(?:(?<![\w.])-)?\d+(?:\.\d+)?/g) || []).map(Number);
// The values a cited number may be written as: itself, rounded, and, when the
// reader uses metric units, converted the way the prompt asks for.
const forms = (number, units) => {
  const values = [number, Math.round(number), Math.round(number * 10) / 10];
  const metric = [];
  if (units?.temperature === 'c') metric.push(((number - 32) * 5) / 9);
  if (units?.wind === 'kph') metric.push(number * 1.609344);
  if (units?.elevation === 'm') metric.push(number * 0.3048, number * 1.609344, number * 2.54);
  for (const value of metric) values.push(Math.round(value), Math.round(value * 10) / 10, Math.round(value / 10) * 10, Math.round(value / 100) * 100);
  return values;
};
const PERMISSIVE = /\b(?<!not |n't |never )(safe to|all clear|risk.free|guaranteed|no (?:risk|hazards))\b/i;
// Why a piece of AI text fails, or null when it passes: every citation must
// match the report, every number it states must come from a citation, and it
// may never read as more permissive than the backend's decision.
const claimProblem = (text, evidence, report, decisionLevel, units) => {
  if (typeof text !== 'string' || !text.trim()) return 'empty text';
  if (!Array.isArray(evidence) || !evidence.length) return 'no citations';
  const allowed = new Set();
  for (const claim of evidence) {
    if (!claim || typeof claim !== 'object') return 'malformed citation';
    const actual = readPath(report, claim.path);
    if (actual === undefined || actual === null || typeof actual === 'object') return `cited path ${claim.path} is not a value in the report`;
    if (actual !== claim.value) return `cited ${claim.path} as ${JSON.stringify(claim.value)} but the report has ${JSON.stringify(actual)}`;
    for (const number of numbers(actual)) for (const form of forms(number, units)) allowed.add(form);
  }
  const stray = numbers(text).filter(number => !allowed.has(number));
  if (stray.length) return `states ${stray.join(', ')} without citing a report field that holds it`;
  // Conservative fail-closed checks; citations are traceability, not semantic proof.
  if (PERMISSIVE.test(text)) return 'uses a permissive phrase (safe to, all clear, no risk)';
  if (decisionLevel === 'NO-GO' && /\b(proceed|go ahead|good to go|green light|recommend going)\b/i.test(text)) return 'encourages going on a NO-GO day';
  if (decisionLevel === 'CAUTION' && /\b(good to go|green light|go ahead as planned|no concerns)\b/i.test(text)) return 'reads as a go on a CAUTION day';
  if (decisionLevel === 'NO-GO' && /\bGO\b/.test(text.replace(/NO-GO/g, ''))) return 'names GO on a NO-GO day';
  return null;
};
const checkClaim = (text, evidence, report, decisionLevel, units) => !claimProblem(text, evidence, report, decisionLevel, units);
const CHAPTERS = ['forecast', 'timing', 'terrain', 'sources'];
const MAX_CHAPTER_LENGTH = 700;
// The AI's analysis of each report chapter. Each one is checked on its own and
// a chapter that fails is left out; it never fails the brief.
const validateChapters = (value, report, decisionLevel, units) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const chapters = {};
  for (const chapter of CHAPTERS) {
    const entry = value[chapter];
    if (!entry || typeof entry !== 'object' || typeof entry.text !== 'string') continue;
    const text = entry.text.replace(/\s+/g, ' ').trim();
    if (text.length > MAX_CHAPTER_LENGTH || !checkClaim(text, entry.evidence, report, decisionLevel, units)) continue;
    chapters[chapter] = { text, evidence: entry.evidence.map(({ path, value: cited }) => ({ path, value: cited })) };
  }
  return chapters;
};
const HERO_HEADLINE = { min: 8, max: 90 };
const MAX_HERO_REASON = 320;
// The report's opening headline and reason, written by AI. Both are checked
// together; a hero that fails is left out and the report keeps its own.
const validateHero = (value, report, decisionLevel, units) => {
  if (!value || typeof value !== 'object' || typeof value.headline !== 'string' || typeof value.reason !== 'string') return null;
  const headline = value.headline.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  const reason = value.reason.replace(/\s+/g, ' ').trim();
  if (headline.length < HERO_HEADLINE.min || headline.length > HERO_HEADLINE.max || !reason || reason.length > MAX_HERO_REASON) return null;
  const text = `${headline}. ${reason}`;
  // The badge beside it shows the checks' level; the hero may not name another one.
  if (decisionLevel !== 'NO-GO' && /\bNO-GO\b/i.test(text)) return null;
  if (!checkClaim(text, value.evidence, report, decisionLevel, units)) return null;
  return { headline, reason, evidence: value.evidence.map(({ path, value: cited }) => ({ path, value: cited })) };
};
const MAX_QUESTIONS = 3;
// Follow-up questions the reader can ask the report assistant. They are prompts,
// not claims, but a number in one would still read as a fact, so none may hold one.
const validateQuestions = (value) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const questions = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const question = item.replace(/\s+/g, ' ').trim();
    if (question.length < 8 || question.length > 120 || !question.endsWith('?') || /\d/.test(question)) continue;
    if (/\b(safe to|all clear|risk.free|guaranteed)\b/i.test(question)) continue;
    const key = question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    questions.push(question);
    if (questions.length === MAX_QUESTIONS) break;
  }
  return questions;
};
// The read must open with the picture and end with the move; the sections
// between them are kept one by one, so one bad sentence no longer costs the
// whole read.
const REQUIRED_HEADINGS = ['BIG PICTURE', 'BEST MOVE'];
const parseJson = (raw) => {
  const text = String(raw ?? '').trim();
  try { return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { /* fall through */ }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
};
/**
 * Checks an AI read. Returns the read, or null when it can't be used; either
 * way `options.problems` (when given) collects why each rejected part failed,
 * so a retry can tell the model what to fix.
 */
const validateBrief = (raw, report, decisionLevel, { units, problems = [] } = {}) => {
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== 'object') { problems.push('the answer was not valid JSON (it may have been cut off)'); return null; }
  if (!Array.isArray(parsed.sections)) { problems.push('the answer had no "sections" array'); return null; }
  const kept = [];
  for (const heading of HEADINGS) {
    const section = parsed.sections.find(item => item && typeof item.heading === 'string' && item.heading.trim().toUpperCase().replace(/:$/, '') === heading);
    if (!section) { problems.push(`${heading}: missing`); continue; }
    const text = typeof section.text === 'string' ? section.text.replace(/\s+/g, ' ').trim() : '';
    const problem = claimProblem(text, section.evidence, report, decisionLevel, units);
    if (problem) { problems.push(`${heading}: ${problem}`); continue; }
    kept.push({ heading, text, evidence: section.evidence.map(({ path, value: cited }) => ({ path, value: cited })) });
  }
  if (!REQUIRED_HEADINGS.every(heading => kept.some(section => section.heading === heading))) return null;
  return {
    narrative: kept.map(({ heading, text }) => `${heading}: ${text}`).join('\n'),
    evidence: kept.map(({ heading, evidence }) => ({ heading, evidence })),
    questions: validateQuestions(parsed.questions),
    chapters: validateChapters(parsed.chapters, report, decisionLevel, units),
    hero: validateHero(parsed.hero, report, decisionLevel, units),
  };
};
const deterministicBrief = (report, decisionLevel) => {
  const safety = report.safety || {};
  const insights = report.reportInsights?.items || [];
  const concerns = insights.filter(item => item.decisionRelevant);
  const reasons = [...(safety.evidenceReasons || []), ...(safety.confidenceReasons || [])];
  // Lead with what the evaluation itself says, in its words, before any stock line.
  const decision = report.evaluation?.decision || {};
  const verdict = report.evaluation?.verdict || {};
  const levelWord = decisionLevel === 'NO-GO' ? 'a no-go' : decisionLevel === 'GO' ? 'a go' : 'a go with caution';
  const lead = [
    typeof decision.headline === 'string' ? decision.headline : '',
    typeof verdict.reason === 'string' && verdict.reason !== decision.headline ? verdict.reason : '',
  ].filter(Boolean).join(' ');
  return [
    `BIG PICTURE: ${safety.assessmentStatus === 'insufficient_evidence'
      ? `The checks call this ${levelWord}, but there is insufficient evidence for a complete trip assessment.`
      : lead ? `The checks call this ${levelWord}. ${lead}` : `The checks call this ${levelWord}. Look over the checks below before committing.`}`,
    `WHY IT MATTERS: ${[(safety.explanations || []).slice(0, 2).join(' '), ...insights.slice(0, 2).map(item => item.meaning)].filter(Boolean).join(' ') || 'No supporting hazard explanations were supplied.'}`,
    `WATCH CLOSELY: ${concerns.slice(0, 2).map(item => `${item.title}. ${item.meaning}`).join(' ') || 'Recheck source validity and conditions across the entire planned travel window.'}`,
    `DATA CONFIDENCE: ${reasons.join(' ') || 'Evidence quality has not been independently calibrated against observations.'}`,
    'COMFORT CHECK: Weather comfort does not offset hazards or missing evidence.',
    `BEST MOVE: ${decisionLevel === 'NO-GO' ? 'Postpone or change the objective, timing, or day.' : concerns.slice(0, 2).map(item => item.action).join(' ') || 'Resolve failed checks and missing evidence before committing.'}`,
  ].join('\n');
};
module.exports = { validateBrief, validateQuestions, validateChapters, validateHero, deterministicBrief };
