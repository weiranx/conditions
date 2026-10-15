const HEADINGS = ['BIG PICTURE', 'WHY IT MATTERS', 'WATCH CLOSELY', 'DATA CONFIDENCE', 'COMFORT CHECK', 'BEST MOVE'];
// A minus sign counts only when it starts a number, so "10-15 mph" and
// "7:00-9:00" read as ranges, not negative values.
// Thousands separators are read as part of the number: "13,026 ft" is 13026.
const withoutSeparators = value => String(value).replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
const numbers = value => (withoutSeparators(value).match(/(?:(?<![\w.])-)?\d+(?:\.\d+)?/g) || []).map(Number);
// What a cited number measures, so it is converted only the way that kind of
// value is: from the unit written beside it in a string ("25°F", "12 mph"),
// otherwise from the field's name. Anything else is never converted.
const UNIT_KIND = [
  [/^(?:°\s*f|f)$/i, 'temperature'],
  [/^mph$/i, 'wind'],
  [/^(?:ft|feet|foot)$/i, 'elevation'],
  [/^(?:mi|miles?)$/i, 'distance'],
  [/^(?:in|inch|inches|")$/i, 'depth'],
];
const kindOfPath = (path) => {
  const key = String(path).split('.').filter(part => !/^\d+$/.test(part)).pop()?.toLowerCase() || '';
  if (/temp|feelslike|dewpoint|windchill|heatindex|apparent/.test(key)) return 'temperature';
  if (/wind|gust/.test(key)) return 'wind';
  if (/elev|altitude|snowline|freezing|ft$|feet/.test(key)) return 'elevation';
  if (/distance|miles|mi$/.test(key)) return 'distance';
  if (/depth|swe|snowfall|inches|accum|precipin|^in$/.test(key)) return 'depth';
  return null;
};
const citedNumbers = (path, value) => {
  if (typeof value !== 'string') return numbers(value).map(number => ({ number, kind: kindOfPath(path) }));
  const found = [];
  const pattern = /((?:(?<![\w.])-)?\d+(?:\.\d+)?)\s*(°\s*F|F\b|mph\b|ft\b|feet\b|foot\b|mi\b|miles?\b|in\b|inch(?:es)?\b|")?/gi;
  for (const match of withoutSeparators(value).matchAll(pattern)) {
    const unit = match[2] && UNIT_KIND.find(([test]) => test.test(match[2].replace(/\s+/g, '')));
    found.push({ number: Number(match[1]), kind: unit ? unit[1] : null });
  }
  return found;
};
const CONVERSIONS = {
  temperature: { unit: 'temperature', metric: 'c', to: n => ((n - 32) * 5) / 9 },
  wind: { unit: 'wind', metric: 'kph', to: n => n * 1.609344 },
  elevation: { unit: 'elevation', metric: 'm', to: n => n * 0.3048, coarse: true },
  distance: { unit: 'elevation', metric: 'm', to: n => n * 1.609344 },
  depth: { unit: 'elevation', metric: 'm', to: n => n * 2.54 },
};
// The values a cited number may be written as: itself, rounded, and, when the
// reader uses metric units, converted the way the prompt asks for that kind.
const forms = (number, kind, units) => {
  const values = [number, Math.round(number), Math.round(number * 10) / 10];
  // Elevations are spoken of to the nearest ten or hundred feet.
  if (kind === 'elevation') values.push(Math.round(number / 10) * 10, Math.round(number / 100) * 100);
  const conversion = kind && CONVERSIONS[kind];
  if (conversion && units?.[conversion.unit] === conversion.metric) {
    const value = conversion.to(number);
    values.push(Math.round(value), Math.round(value * 10) / 10);
    if (conversion.coarse) values.push(Math.round(value / 10) * 10, Math.round(value / 100) * 100);
  }
  return values;
};
const PERMISSIVE = /\b(?<!not |n't |never )(safe to|all clear|risk.free|guaranteed|no (?:risk|hazards))\b/i;
const isScalar = value => value !== null && value !== undefined && typeof value !== 'object';
// Every path in the report and its value, built once per report. Lists are
// indexed with ".0" so a citation can name one item.
const pathIndexes = new WeakMap();
const pathIndex = (report) => {
  if (!report || typeof report !== 'object') return new Map();
  if (pathIndexes.has(report)) return pathIndexes.get(report);
  const index = new Map();
  const walk = (value, path, depth) => {
    if (path) index.set(path, value);
    if (!value || typeof value !== 'object' || depth > 12) return;
    for (const [key, item] of Object.entries(value)) walk(item, path ? `${path}.${key}` : key, depth + 1);
  };
  walk(report, '', 0);
  pathIndexes.set(report, index);
  return index;
};
const sameValue = (actual, cited) => {
  if (actual === cited) return true;
  if (typeof actual === 'number' && typeof cited === 'string' && cited.trim() !== '') return Number(cited) === actual;
  if (typeof actual === 'string' && typeof cited === 'string') return actual.replace(/\s+/g, ' ').trim() === cited.replace(/\s+/g, ' ').trim();
  return false;
};
// Finds what a citation points at. Models often shorten a path
// ("decisionSummary.actionLine" for "evaluation.decisionSummary.actionLine"),
// write list items as "[0]", or cite a list by one of its items; each still
// counts when the value matches the report exactly. A path that names nothing
// is unresolved; one that names a different value is a misquote.
const resolveClaim = (claim, report) => {
  if (!claim || typeof claim !== 'object' || typeof claim.path !== 'string') return { malformed: true };
  const path = claim.path.trim().replace(/\[(\d+)\]/g, '.$1').replace(/^report\./, '').replace(/^\.+|\.+$/g, '');
  if (!/^[a-zA-Z0-9_.]+$/.test(path)) return { unresolved: claim.path };
  const index = pathIndex(report);
  const candidates = index.has(path) ? [path] : [...index.keys()].filter(key => key.endsWith(`.${path}`));
  for (const candidate of candidates) {
    const actual = index.get(candidate);
    if (isScalar(actual) && sameValue(actual, claim.value)) return { path: candidate, value: actual };
    if (Array.isArray(actual) && isScalar(claim.value)) {
      const item = actual.findIndex(entry => isScalar(entry) && sameValue(entry, claim.value));
      if (item >= 0) return { path: `${candidate}.${item}`, value: actual[item] };
    }
  }
  const misquoted = candidates.find(candidate => isScalar(index.get(candidate)));
  if (misquoted) return { misquote: `cited ${claim.path} as ${JSON.stringify(claim.value)} but the report has ${JSON.stringify(index.get(misquoted))}` };
  return { unresolved: claim.path };
};
// Every number the report holds, in each form a citation of it may be written.
const reportNumberSets = new WeakMap();
const reportNumbers = (report, units) => {
  if (!report || typeof report !== 'object') return new Set();
  const key = JSON.stringify(units || {});
  const byUnits = reportNumberSets.get(report) || new Map();
  reportNumberSets.set(report, byUnits);
  if (!byUnits.has(key)) {
    const all = new Set();
    for (const [path, value] of pathIndex(report)) {
      if (typeof value !== 'number' && typeof value !== 'string') continue;
      for (const { number, kind } of citedNumbers(path, value)) for (const form of forms(number, kind, units)) all.add(form);
    }
    byUnits.set(key, all);
  }
  return byUnits.get(key);
};
// Checks a piece of AI text and returns why it fails (or null) with its
// citations resolved to full report paths. Every citation that resolves must
// match the report; at least one must resolve. Every number it states must be
// a value in the report, cited or not: the citations are traceability, while a
// number the report doesn't hold at all is invented. It may never read as more
// permissive than the backend's decision.
const checkText = (text, evidence, report, decisionLevel, units) => {
  const fail = problem => ({ problem, evidence: [] });
  if (typeof text !== 'string' || !text.trim()) return fail('empty text');
  if (!Array.isArray(evidence) || !evidence.length) return fail('no citations');
  const claims = [];
  const unresolved = [];
  for (const claim of evidence) {
    const resolved = resolveClaim(claim, report);
    if (resolved.misquote) return fail(resolved.misquote);
    if (resolved.unresolved) unresolved.push(resolved.unresolved);
    else if (!resolved.malformed && !claims.some(kept => kept.path === resolved.path)) claims.push(resolved);
  }
  if (!claims.length) return fail(unresolved.length ? `cited path ${unresolved[0]} is not a value in the report` : 'malformed citation');
  const allowed = new Set();
  for (const { path, value } of claims) for (const { number, kind } of citedNumbers(path, value)) for (const form of forms(number, kind, units)) allowed.add(form);
  const inReport = reportNumbers(report, units);
  const stray = numbers(text).filter(number => !allowed.has(number) && !inReport.has(number));
  if (stray.length) return fail(`states ${stray.join(', ')}, which is not a number in the report`);
  // Conservative fail-closed checks; citations are traceability, not semantic proof.
  if (PERMISSIVE.test(text)) return fail('uses a permissive phrase (safe to, all clear, no risk)');
  if (decisionLevel === 'NO-GO' && /\b(proceed|go ahead|good to go|green light|recommend going)\b/i.test(text)) return fail('encourages going on a NO-GO day');
  if (decisionLevel === 'CAUTION' && /\b(good to go|green light|go ahead as planned|no concerns)\b/i.test(text)) return fail('reads as a go on a CAUTION day');
  if (decisionLevel === 'NO-GO' && /\bGO\b/.test(text.replace(/NO-GO/g, ''))) return fail('names GO on a NO-GO day');
  return { problem: null, evidence: claims };
};
const CHAPTERS = ['forecast', 'timing', 'terrain', 'sources'];
const MAX_CHAPTER_LENGTH = 700;
// The AI's analysis of each report chapter. Each one is checked on its own and
// a chapter that fails is left out; it never fails the brief.
const validateChapters = (value, report, decisionLevel, units, problems = []) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const chapters = {};
  for (const chapter of CHAPTERS) {
    const entry = value[chapter];
    if (!entry || typeof entry !== 'object' || typeof entry.text !== 'string') continue;
    const text = entry.text.replace(/\s+/g, ' ').trim();
    const { problem, evidence } = text.length > MAX_CHAPTER_LENGTH ? { problem: `longer than ${MAX_CHAPTER_LENGTH} characters` } : checkText(text, entry.evidence, report, decisionLevel, units);
    if (problem) { problems.push(`${chapter} chapter: ${problem}`); continue; }
    chapters[chapter] = { text, evidence };
  }
  return chapters;
};
const HERO_HEADLINE = { min: 8, max: 90 };
const MAX_HERO_REASON = 320;
const MAX_HERO_NOTE = 280;
// The report's opening headline and reason, written by AI. Both are checked
// together; a hero that fails is left out and the report keeps its own.
const validateHero = (value, report, decisionLevel, units, problems = []) => {
  const fail = (problem) => { problems.push(`OPENING: ${problem}`); return null; };
  if (!value || typeof value !== 'object' || typeof value.headline !== 'string' || typeof value.reason !== 'string') return fail('missing or without a headline and reason');
  const headline = value.headline.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  const reason = value.reason.replace(/\s+/g, ' ').trim();
  if (headline.length < HERO_HEADLINE.min || headline.length > HERO_HEADLINE.max) return fail(`headline is ${headline.length} characters (${HERO_HEADLINE.min}-${HERO_HEADLINE.max} allowed)`);
  if (!reason || reason.length > MAX_HERO_REASON) return fail(`reason is ${reason.length} characters (1-${MAX_HERO_REASON} allowed)`);
  const text = `${headline}. ${reason}`;
  // The badge beside it shows the checks' level; the hero may not name another one.
  const named = [
    ...(/\bNO-GO\b/i.test(text) ? ['NO-GO'] : []),
    ...(/\bGO\b/.test(text.replace(/NO-GO/gi, '')) ? ['GO'] : []),
    ...(/\bCAUTION\b/.test(text) ? ['CAUTION'] : []),
  ];
  if (named.some(level => level !== decisionLevel)) return fail(`names ${named.join(', ')} beside a ${decisionLevel} badge`);
  const checked = checkText(text, value.evidence, report, decisionLevel, units);
  if (checked.problem) return fail(checked.problem);
  const hero = { headline, reason, evidence: checked.evidence };
  // An optional note on the hours judged below the objective; it is checked on its own and dropped alone.
  if (value.note && typeof value.note === 'object' && typeof value.note.text === 'string') {
    const note = value.note.text.replace(/\s+/g, ' ').trim();
    const { problem, evidence } = note.length > MAX_HERO_NOTE ? { problem: `longer than ${MAX_HERO_NOTE} characters` } : checkText(note, value.note.evidence, report, decisionLevel, units);
    if (problem) problems.push(`OPENING note: ${problem}`);
    else hero.note = { text: note, evidence };
  }
  return hero;
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
  if (!parsed || typeof parsed !== 'object') {
    const text = String(raw ?? '').trim();
    problems.push(`the answer was not valid JSON (${text.length} characters, ending "${text.slice(-60)}"; it may have been cut off)`);
    return null;
  }
  if (!Array.isArray(parsed.sections)) { problems.push('the answer had no "sections" array'); return null; }
  const kept = [];
  for (const heading of HEADINGS) {
    const section = parsed.sections.find(item => item && typeof item.heading === 'string' && item.heading.trim().toUpperCase().replace(/:$/, '') === heading);
    if (!section) { problems.push(`${heading}: missing`); continue; }
    const text = typeof section.text === 'string' ? section.text.replace(/\s+/g, ' ').trim() : '';
    const { problem, evidence } = checkText(text, section.evidence, report, decisionLevel, units);
    if (problem) { problems.push(`${heading}: ${problem}`); continue; }
    kept.push({ heading, text, evidence });
  }
  if (!REQUIRED_HEADINGS.every(heading => kept.some(section => section.heading === heading))) return null;
  return {
    narrative: kept.map(({ heading, text }) => `${heading}: ${text}`).join('\n'),
    evidence: kept.map(({ heading, evidence }) => ({ heading, evidence })),
    questions: validateQuestions(parsed.questions),
    chapters: validateChapters(parsed.chapters, report, decisionLevel, units, problems),
    hero: validateHero(parsed.hero, report, decisionLevel, units, problems),
  };
};
/**
 * Checks the report's AI opening written on its own, ahead of the full read:
 * the same hero checks, from an answer that holds only `hero`.
 */
const validateOpening = (raw, report, decisionLevel, { units, problems = [] } = {}) => {
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== 'object') {
    problems.push('OPENING: the answer was not valid JSON');
    return null;
  }
  return validateHero(parsed.hero ?? parsed, report, decisionLevel, units, problems);
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
module.exports = { validateBrief, validateOpening, validateQuestions, validateChapters, validateHero, deterministicBrief };
