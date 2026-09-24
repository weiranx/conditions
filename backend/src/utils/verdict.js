'use strict';

// The words around a decision: which reason leads, which checks limit it, how
// the score relates to it, and which field observations need a look.

const { enabledReportInsights } = require('./decision');
const { toFiniteOrNull } = require('./numbers');

/** The lead sentence of a check message, without its closing period. */
const checkSummary = (message) => {
  const text = String(message || '').trim();
  const lead = text.match(/^.*?[.!?](?=\s+[A-Z(]|$)/)?.[0] ?? text;
  return lead.replace(/\.$/, '');
};

/** Short names for failed checks, for compact lists. */
const FAILED_CHECK_LABELS = {
  'convective-signal': 'Forecast mentions thunderstorms',
  precipitation: 'Precipitation chance is above your limit',
  'wind-gust': 'Wind gusts are above your limit',
  daylight: 'Plan leaves less than 30 minutes of daylight margin',
  'feels-like': 'Feels-like temperature is below your limit',
  'nws-alerts': 'An active NWS alert overlaps your travel window',
  'air-quality': 'Air quality is worse than AQI 100',
  'fire-risk': 'Fire risk is High or above',
  'heat-risk': 'Heat risk is High or above',
  'terrain-signal': 'Trail surface assessment is unavailable',
  'source-freshness': 'Some core sources are out of date',
};

const describeFailedCheck = (check) => {
  if (check.key === 'avalanche') {
    return /no avalanche forecast covers|coverage unavailable/i.test(String(check.detail || ''))
      ? 'No avalanche bulletin covers this objective and time'
      : 'Avalanche danger exceeds Moderate';
  }
  return FAILED_CHECK_LABELS[check.key] || check.label;
};

/** Failed checks first, each failed one with a short name; the reason and action that lead. */
const buildDecisionSummary = (decision) => {
  const failed = decision.checks.filter((check) => !check.ok);
  const passed = decision.checks.filter((check) => check.ok);
  const limiting = decision.blockers.length > 0 ? decision.blockers : decision.cautions;
  return {
    orderedChecks: [...failed, ...passed].map((check) => (check.ok ? check : { ...check, failedLabel: describeFailedCheck(check) })),
    failedCount: failed.length,
    passedCount: passed.length,
    primaryReason: decision.level === 'NO-GO'
      ? decision.blockers[0] || 'A no-go threshold is tripped. Change the objective, timing, or day before committing.'
      : decision.level === 'CAUTION'
        ? decision.cautions[0] || 'Adjust terrain, timing, or pace, and define a clear turnaround trigger before committing.'
        : 'Conditions are within your limits. Check official sources and reassess at your planned checkpoints.',
    topRisks: limiting.slice(0, 3),
    actionLine: decision.level === 'NO-GO'
      ? 'Do not commit to this objective window. Change the objective, timing, or day instead of trying to solve the hazard with gear alone.'
      : decision.level === 'CAUTION'
        ? 'Make the listed adjustments before leaving, then reassess at planned checkpoints and turn around when a trigger is met.'
        : 'Keep normal backcountry precautions, verify current official sources, and reassess at planned checkpoints.',
    keyDrivers: limiting.length > 0 ? limiting.slice(0, 3) : passed.slice(0, 3).map((check) => check.label),
  };
};

/**
 * Local observations and access feeds worth a look before leaving, and the
 * feeds that could not confirm anything.
 */
const buildFieldSignals = (local, { maxWindGustMph }, nowMs = Date.now()) => {
  if (!local) {
    return [{ key: 'all', title: 'Field observations unavailable', detail: 'No local observation or access feed was returned.', tone: 'unavailable' }];
  }
  const signals = [];
  const add = (key, title, detail) => signals.push({ key, title, detail, tone: 'attention' });
  const roads = (local.access?.closedRoadCount || 0) + (local.access?.caltransClosureCount || 0);
  if (local.access?.available && roads > 0) {
    add('roads', `${roads} road closure${roads === 1 ? '' : 's'} nearby`, 'Check whether the closures affect your approach.');
  }
  const closures = Math.max(local.closures?.alertCount || 0, local.closures?.alerts?.length || 0);
  if (local.closures?.available && closures > 0) {
    add('closures', `${closures} land-manager notice${closures === 1 ? '' : 's'}`,
      local.closures?.alerts?.[0]?.title || 'Review the posted notices for route and access restrictions.');
  }
  if (local.radar?.lightning?.available && local.radar.lightning.detectionAtObjective === true) {
    add('lightning', 'Lightning detected at the objective', 'Review the observation time and current radar before continuing.');
  } else if (local.radar?.available && local.radar.echoDetected === true) {
    add('radar', 'Radar echo detected', 'Precipitation was detected near the objective; check the radar time.');
  }
  if (local.streamflow?.available && local.streamflow.trend === 'rising') {
    add('water', 'Nearby stream is rising', local.streamflow.siteName || 'Review the gauge and crossing conditions.');
  }
  if (local.smoke?.available) {
    const unusual = [local.smoke.currentCategory, local.smoke.peakCategory]
      .filter(Boolean)
      .find((value) => /moderate|unhealthy|hazardous|poor/i.test(value));
    if (unusual) add('smoke', `Smoke outlook: ${unusual}`, 'Check the current and peak forecast times; the peak may be later.');
  }
  const fires = Math.max(local.wildfire?.nearbyIncidentCount || 0, local.wildfire?.incidents?.length || 0);
  if (local.wildfire?.available && fires > 0) {
    add('fire', `${fires} wildfire incident${fires === 1 ? '' : 's'} nearby`,
      'Nearby incidents do not necessarily intersect this route. Check locations and access notices.');
  }
  if (local.wildfire?.available && (local.wildfire.firmsDetectionCount || 0) > 0) {
    add('detections', 'Satellite fire detections nearby', 'Review the detection locations and acquisition times.');
  }
  const observation = local.weatherObservation;
  const observedGust = toFiniteOrNull(observation?.gustMph);
  if (observation?.available && typeof observation.gustMph === 'number' && observedGust !== null && observedGust > maxWindGustMph) {
    add('gust', 'Observed gusts exceed your limit', 'The nearby station is reporting gusts above your selected weather threshold.');
  }
  const observedMs = observation?.observedTime ? Date.parse(observation.observedTime) : Number.NaN;
  if (observation?.available && Number.isFinite(observedMs) && nowMs - observedMs > 3 * 3600000) {
    add('stale', 'Station observation is over 3 hours old', 'Check the observation time before relying on this reading.');
  }
  for (const [key, label, value] of [
    ['station', 'Weather station', observation],
    ['access', 'Road access', local.access],
    ['closures', 'Land-manager notices', local.closures],
    ['radar', 'Radar', local.radar],
    ['fire', 'Wildfire feed', local.wildfire],
  ]) {
    if (!value?.available) {
      signals.push({ key: `missing-${key}`, title: `${label} unavailable`, detail: 'This feed cannot confirm current conditions.', tone: 'unavailable' });
    }
  }
  return signals;
};

// Report insights already cover these observations; the verdict lists each once.
const INSIGHT_COVERS_SIGNAL = {
  roads: 'access',
  closures: 'access',
  lightning: 'lightning',
  radar: 'radar',
  water: 'water',
  smoke: 'air-outlook',
  fire: 'fire-access',
  detections: 'fire-access',
};

/** The verdict's wording: tone, leading reason, how the score relates, and what to look at. */
const buildVerdict = (report, decision, summary, fieldSignals) => {
  const safety = report?.safety || {};
  const insufficient = safety.assessmentStatus === 'insufficient_evidence';
  const tone = decision.level === 'GO' ? 'go' : decision.level === 'NO-GO' ? 'stop' : 'watch';
  const insights = enabledReportInsights(report);
  const insightIds = new Set(insights.map((item) => item.id));
  const signals = report?.featureFlags?.fieldObservations === false ? [] : fieldSignals.filter((signal) =>
    !insightIds.has(INSIGHT_COVERS_SIGNAL[signal.key]) && !(signal.tone === 'unavailable' && insightIds.has('evidence-gaps')));
  const attention = signals.filter((signal) => signal.tone === 'attention');
  // An observation at the objective leads nearby access and area reports.
  const warnings = [...attention.filter((signal) => signal.key === 'lightning'), ...attention.filter((signal) => signal.key !== 'lightning')];
  const missing = signals.filter((signal) => signal.tone === 'unavailable');
  const review = insights.find((item) => item.decisionRelevant);
  // The score rates conditions overall; the decision is set by the most
  // limiting check. Explain when the score looks better than the decision.
  const score = Number(safety.score);
  const scoreOutranksDecision = !insufficient && Number.isFinite(score)
    && ((decision.level === 'CAUTION' && score >= 85) || (decision.level === 'NO-GO' && score >= 70));
  const limitingCount = decision.level === 'NO-GO' ? decision.blockers.length : decision.cautions.length;
  const limitingLabel = decision.level === 'NO-GO'
    ? (limitingCount > 1 ? `${limitingCount} blocking checks` : 'a blocking check')
    : (limitingCount > 1 ? `${limitingCount} checks that need attention` : 'a check that needs attention');
  const bridge = scoreOutranksDecision
    ? `The score of ${Number(score.toFixed(1))} rates conditions overall. The decision is set by ${limitingLabel}.`
    : '';
  const reason = decision.blockers[0]
    || (review ? `${review.title}. ${review.action}` : '')
    || summary.primaryReason
    || decision.cautions[0]
    || 'Nothing in the available forecast crosses your limits. Keep reassessing once you are in the field.';
  // Name the limiting checks when the count alone would leave them unclear,
  // leaving out the one the reason already states.
  const limitingSummaries = decision.level === 'GO'
    ? []
    : (decision.level === 'NO-GO' ? decision.blockers : decision.cautions).map(checkSummary).filter(Boolean);
  const unstated = limitingSummaries.filter((line) => !reason.startsWith(line));
  const limitingChecks = limitingSummaries.length > 1 || (bridge && unstated.length === 1) ? unstated : [];
  return {
    insufficient,
    tone,
    reason,
    bridge,
    limitingChecks,
    warnings,
    missing,
    scoreValue: !insufficient && Number.isFinite(score) ? Number(score.toFixed(1)) : null,
  };
};

module.exports = {
  checkSummary,
  describeFailedCheck,
  buildDecisionSummary,
  buildFieldSignals,
  buildVerdict,
};
