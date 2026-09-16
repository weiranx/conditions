const HEADINGS = ['BIG PICTURE', 'WHY IT MATTERS', 'WATCH CLOSELY', 'DATA CONFIDENCE', 'COMFORT CHECK', 'BEST MOVE'];
const readPath = (report, path) => {
  if (typeof path !== 'string' || !/^[a-zA-Z0-9_.]+$/.test(path)) return undefined;
  return path.split('.').reduce((value, key) => value && Object.hasOwn(value, key) ? value[key] : undefined, report);
};
const numbers = value => (String(value).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
const validateBrief = (raw, report, decisionLevel) => {
  let parsed;
  try { parsed = JSON.parse(String(raw).replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return null; }
  if (!Array.isArray(parsed.sections) || parsed.sections.length !== HEADINGS.length) return null;
  const lines = [];
  for (let i = 0; i < HEADINGS.length; i += 1) {
    const section = parsed.sections[i];
    if (section.heading !== HEADINGS[i] || typeof section.text !== 'string' || !section.text.trim() || !Array.isArray(section.evidence) || !section.evidence.length) return null;
    const allowed = [];
    for (const claim of section.evidence) {
      const actual = readPath(report, claim.path);
      if (actual === undefined || actual === null || typeof actual === 'object' || actual !== claim.value) return null;
      allowed.push(...numbers(actual));
    }
    // All quantities must be quoted in source units; conversions are done by the UI.
    if (numbers(section.text).some(number => !allowed.includes(number))) return null;
    // Conservative fail-closed checks; citations are traceability, not semantic proof.
    if (/\b(safe to|all clear|risk.free|guaranteed|no (?:risk|hazards))\b/i.test(section.text)) return null;
    if (decisionLevel !== 'GO' && /\b(proceed|go ahead|good to go|green light|recommend going)\b/i.test(section.text)) return null;
    if (decisionLevel === 'NO-GO' && /\bGO\b/.test(section.text.replace(/NO-GO/g, ''))) return null;
    lines.push(`${section.heading}: ${section.text.trim()}`);
  }
  return { narrative: lines.join('\n'), evidence: parsed.sections.map(({ heading, evidence }) => ({ heading, evidence })) };
};
const deterministicBrief = (report, decisionLevel) => {
  const safety = report.safety || {};
  const reasons = [...(safety.evidenceReasons || []), ...(safety.confidenceReasons || [])];
  return [
    `BIG PICTURE: Computed decision: ${decisionLevel}. ${safety.assessmentStatus === 'insufficient_evidence' ? 'Insufficient evidence for a complete trip assessment.' : 'Review the report checks before committing.'}`,
    `WHY IT MATTERS: ${(safety.explanations || []).slice(0, 3).join(' ') || 'No supporting hazard explanations were supplied.'}`,
    'WATCH CLOSELY: Recheck source validity and conditions across the entire planned travel window.',
    `DATA CONFIDENCE: ${reasons.join(' ') || 'Evidence quality has not been independently calibrated against observations.'}`,
    'COMFORT CHECK: Weather comfort does not offset hazards or missing evidence.',
    `BEST MOVE: ${decisionLevel === 'NO-GO' ? 'Postpone or change the objective, timing, or day.' : 'Resolve failed checks and missing evidence before committing.'}`,
  ].join('\n');
};
module.exports = { validateBrief, deterministicBrief };
