const HEADINGS = ['BIG PICTURE', 'WHY IT MATTERS', 'WATCH CLOSELY', 'DATA CONFIDENCE', 'COMFORT CHECK', 'BEST MOVE'];
const readPath = (report, path) => {
  if (typeof path !== 'string' || !/^[a-zA-Z0-9_.]+$/.test(path)) return undefined;
  return path.split('.').reduce((value, key) => value && Object.hasOwn(value, key) ? value[key] : undefined, report);
};
const numbers = value => (String(value).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
// A piece of AI text passes only when every citation matches the report, every
// number it states comes from a citation, and it never reads as more permissive
// than the backend's decision.
const checkClaim = (text, evidence, report, decisionLevel) => {
  if (typeof text !== 'string' || !text.trim() || !Array.isArray(evidence) || !evidence.length) return false;
  const allowed = [];
  for (const claim of evidence) {
    if (!claim || typeof claim !== 'object') return false;
    const actual = readPath(report, claim.path);
    if (actual === undefined || actual === null || typeof actual === 'object' || actual !== claim.value) return false;
    allowed.push(...numbers(actual));
  }
  // All quantities must be quoted in source units; conversions are done by the UI.
  if (numbers(text).some(number => !allowed.includes(number))) return false;
  // Conservative fail-closed checks; citations are traceability, not semantic proof.
  if (/\b(safe to|all clear|risk.free|guaranteed|no (?:risk|hazards))\b/i.test(text)) return false;
  if (decisionLevel !== 'GO' && /\b(proceed|go ahead|good to go|green light|recommend going)\b/i.test(text)) return false;
  if (decisionLevel === 'NO-GO' && /\bGO\b/.test(text.replace(/NO-GO/g, ''))) return false;
  return true;
};
const CHAPTERS = ['forecast', 'timing', 'terrain', 'sources'];
const MAX_CHAPTER_LENGTH = 700;
// The AI's analysis of each report chapter. Each one is checked on its own and
// a chapter that fails is left out; it never fails the brief.
const validateChapters = (value, report, decisionLevel) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const chapters = {};
  for (const chapter of CHAPTERS) {
    const entry = value[chapter];
    if (!entry || typeof entry !== 'object' || typeof entry.text !== 'string') continue;
    const text = entry.text.replace(/\s+/g, ' ').trim();
    if (text.length > MAX_CHAPTER_LENGTH || !checkClaim(text, entry.evidence, report, decisionLevel)) continue;
    chapters[chapter] = { text, evidence: entry.evidence.map(({ path, value: cited }) => ({ path, value: cited })) };
  }
  return chapters;
};
const HERO_HEADLINE = { min: 8, max: 90 };
const MAX_HERO_REASON = 320;
// The report's opening headline and reason, written by AI. Both are checked
// together; a hero that fails is left out and the report keeps its own.
const validateHero = (value, report, decisionLevel) => {
  if (!value || typeof value !== 'object' || typeof value.headline !== 'string' || typeof value.reason !== 'string') return null;
  const headline = value.headline.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  const reason = value.reason.replace(/\s+/g, ' ').trim();
  if (headline.length < HERO_HEADLINE.min || headline.length > HERO_HEADLINE.max || !reason || reason.length > MAX_HERO_REASON) return null;
  const text = `${headline}. ${reason}`;
  // The badge beside it shows the checks' level; the hero may not name another one.
  if (decisionLevel !== 'NO-GO' && /\bNO-GO\b/i.test(text)) return null;
  if (!checkClaim(text, value.evidence, report, decisionLevel)) return null;
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
const validateBrief = (raw, report, decisionLevel) => {
  let parsed;
  try { parsed = JSON.parse(String(raw).replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return null; }
  if (!Array.isArray(parsed.sections) || parsed.sections.length !== HEADINGS.length) return null;
  const lines = [];
  for (let i = 0; i < HEADINGS.length; i += 1) {
    const section = parsed.sections[i];
    if (section.heading !== HEADINGS[i] || typeof section.text !== 'string' || !section.text.trim() || !Array.isArray(section.evidence) || !section.evidence.length) return null;
    if (!checkClaim(section.text, section.evidence, report, decisionLevel)) return null;
    lines.push(`${section.heading}: ${section.text.trim()}`);
  }
  return {
    narrative: lines.join('\n'),
    evidence: parsed.sections.map(({ heading, evidence }) => ({ heading, evidence })),
    questions: validateQuestions(parsed.questions),
    chapters: validateChapters(parsed.chapters, report, decisionLevel),
    hero: validateHero(parsed.hero, report, decisionLevel),
  };
};
const deterministicBrief = (report, decisionLevel) => {
  const safety = report.safety || {};
  const insights = report.reportInsights?.items || [];
  const concerns = insights.filter(item => item.decisionRelevant);
  const reasons = [...(safety.evidenceReasons || []), ...(safety.confidenceReasons || [])];
  return [
    `BIG PICTURE: Computed decision: ${decisionLevel}. ${safety.assessmentStatus === 'insufficient_evidence' ? 'Insufficient evidence for a complete trip assessment.' : 'Review the report checks before committing.'}`,
    `WHY IT MATTERS: ${[(safety.explanations || []).slice(0, 2).join(' '), ...insights.slice(0, 2).map(item => item.meaning)].filter(Boolean).join(' ') || 'No supporting hazard explanations were supplied.'}`,
    `WATCH CLOSELY: ${concerns.slice(0, 2).map(item => `${item.title}. ${item.meaning}`).join(' ') || 'Recheck source validity and conditions across the entire planned travel window.'}`,
    `DATA CONFIDENCE: ${reasons.join(' ') || 'Evidence quality has not been independently calibrated against observations.'}`,
    'COMFORT CHECK: Weather comfort does not offset hazards or missing evidence.',
    `BEST MOVE: ${decisionLevel === 'NO-GO' ? 'Postpone or change the objective, timing, or day.' : concerns.slice(0, 2).map(item => item.action).join(' ') || 'Resolve failed checks and missing evidence before committing.'}`,
  ].join('\n');
};
module.exports = { validateBrief, validateQuestions, validateChapters, validateHero, deterministicBrief };
