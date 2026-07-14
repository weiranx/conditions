const SCORE_FEATURE_KEYS = Object.freeze([
  'avalancheDetails',
  'airQualityDetails',
  'fireRiskDetails',
  'heatRiskDetails',
  'snowpackDetails',
  'fieldObservations',
  'windLoadingDetails',
  'daylightTimeline',
  'weatherContextDetails',
]);

const FEATURE_LABELS = Object.freeze({
  avalancheDetails: 'avalanche',
  airQualityDetails: 'air quality',
  fireRiskDetails: 'fire risk',
  heatRiskDetails: 'heat risk',
  snowpackDetails: 'snowpack',
  fieldObservations: 'field observations',
  windLoadingDetails: 'avalanche wind loading',
  daylightTimeline: 'daylight and darkness',
  weatherContextDetails: 'weather visibility context',
});

const isFeatureEnabled = (flags, key) => flags?.[key] !== false;

const getScoreFeatureSnapshot = (flags) => Object.fromEntries(
  SCORE_FEATURE_KEYS.map((key) => [key, isFeatureEnabled(flags, key)]),
);

const getDisabledScoreFeatureLabels = (flags) => SCORE_FEATURE_KEYS
  .filter((key) => !isFeatureEnabled(flags, key))
  .map((key) => FEATURE_LABELS[key]);

const reportMatchesScoreFeatures = (report, flags) => {
  const reportFlags = report?.featureFlags;
  if (!reportFlags || typeof reportFlags !== 'object' || Array.isArray(reportFlags)) {
    return SCORE_FEATURE_KEYS.every((key) => isFeatureEnabled(flags, key));
  }
  return SCORE_FEATURE_KEYS.every((key) => (
    typeof reportFlags[key] === 'boolean'
    && reportFlags[key] === isFeatureEnabled(flags, key)
  ));
};

const cloneReport = (report) => JSON.parse(JSON.stringify(report));

const factorBelongsToDisabledFeature = (factor, flags) => {
  const hazard = String(factor?.hazard || '').toLowerCase();
  const group = String(factor?.group || '').toLowerCase();
  const source = String(factor?.source || '').toLowerCase();
  if (!isFeatureEnabled(flags, 'avalancheDetails') && (group === 'avalanche' || hazard.includes('avalanche'))) return true;
  if (!isFeatureEnabled(flags, 'airQualityDetails') && (group === 'airquality' || hazard.includes('air quality'))) return true;
  if (!isFeatureEnabled(flags, 'fireRiskDetails') && (group === 'fire' || hazard.includes('fire'))) return true;
  if (!isFeatureEnabled(flags, 'heatRiskDetails') && hazard === 'heat') return true;
  if (!isFeatureEnabled(flags, 'snowpackDetails') && hazard === 'snowpack') return true;
  if (!isFeatureEnabled(flags, 'fieldObservations') && (
    hazard === 'stream crossing'
    || /mrms|rfc qpe|nwps|nearby station/u.test(source)
  )) return true;
  if (!isFeatureEnabled(flags, 'windLoadingDetails') && hazard === 'avalanche wind loading') return true;
  if (!isFeatureEnabled(flags, 'daylightTimeline') && hazard === 'darkness') return true;
  if (!isFeatureEnabled(flags, 'weatherContextDetails') && hazard.includes('visibility')) return true;
  return false;
};

const removeDisabledAnalysisDetails = (analysis, flags) => {
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) return analysis;
  const filtered = { ...analysis };
  const factors = Array.isArray(analysis.factors)
    ? analysis.factors.filter((factor) => !factorBelongsToDisabledFeature(factor, flags))
    : [];
  if (Array.isArray(analysis.factors)) filtered.factors = factors;

  const disabledPatterns = [];
  if (!isFeatureEnabled(flags, 'avalancheDetails')) disabledPatterns.push(/avalanche/iu);
  if (!isFeatureEnabled(flags, 'airQualityDetails')) disabledPatterns.push(/air quality|aqi/iu);
  if (!isFeatureEnabled(flags, 'fireRiskDetails')) disabledPatterns.push(/fire risk|fire danger/iu);
  if (!isFeatureEnabled(flags, 'heatRiskDetails')) disabledPatterns.push(/heat risk|heat stress/iu);
  if (!isFeatureEnabled(flags, 'snowpackDetails')) disabledPatterns.push(/snowpack/iu);
  if (!isFeatureEnabled(flags, 'fieldObservations')) disabledPatterns.push(/nearby station|radar|streamflow|stream crossing/iu);
  if (!isFeatureEnabled(flags, 'daylightTimeline')) disabledPatterns.push(/darkness|daylight|sunrise|sunset/iu);
  if (!isFeatureEnabled(flags, 'weatherContextDetails')) disabledPatterns.push(/visibility/iu);
  const keepText = (value) => !disabledPatterns.some((pattern) => pattern.test(String(value || '')));

  ['explanations', 'confidenceReasons', 'sourcesUsed'].forEach((key) => {
    if (Array.isArray(analysis[key])) filtered[key] = analysis[key].filter(keepText);
  });

  if (analysis.groupImpacts && typeof analysis.groupImpacts === 'object') {
    filtered.groupImpacts = { ...analysis.groupImpacts };
    if (!isFeatureEnabled(flags, 'avalancheDetails')) delete filtered.groupImpacts.avalanche;
    if (!isFeatureEnabled(flags, 'airQualityDetails')) delete filtered.groupImpacts.airQuality;
    if (!isFeatureEnabled(flags, 'fireRiskDetails')) delete filtered.groupImpacts.fire;
  }
  if (factorBelongsToDisabledFeature({ hazard: analysis.primaryHazard }, flags)) {
    filtered.primaryHazard = factors[0]?.hazard || 'None';
  }
  return filtered;
};

const sanitizeReportForFeatureFlags = (report, flags) => {
  const filtered = cloneReport(report);
  filtered.featureFlags = getScoreFeatureSnapshot(flags);

  if (!isFeatureEnabled(flags, 'avalancheDetails')) delete filtered.avalanche;
  if (!isFeatureEnabled(flags, 'airQualityDetails')) delete filtered.airQuality;
  if (!isFeatureEnabled(flags, 'fireRiskDetails')) delete filtered.fireRisk;
  if (!isFeatureEnabled(flags, 'heatRiskDetails')) delete filtered.heatRisk;
  if (!isFeatureEnabled(flags, 'snowpackDetails')) delete filtered.snowpack;
  if (!isFeatureEnabled(flags, 'fieldObservations')) delete filtered.localConditions;
  if (!isFeatureEnabled(flags, 'weatherContextDetails')) {
    delete filtered.atmosphere;
    if (filtered.weather && typeof filtered.weather === 'object') delete filtered.weather.visibilityRisk;
  }
  if (!isFeatureEnabled(flags, 'daylightTimeline')) {
    delete filtered.solar;
    if (filtered.weather && typeof filtered.weather === 'object') {
      delete filtered.weather.isDaytime;
      if (Array.isArray(filtered.weather.trend)) {
        filtered.weather.trend = filtered.weather.trend.map((row) => {
          if (!row || typeof row !== 'object') return row;
          const next = { ...row };
          delete next.isDaytime;
          return next;
        });
      }
    }
  }

  if (Array.isArray(filtered.gear)) {
    const disabledGearIds = new Set();
    if (!isFeatureEnabled(flags, 'avalancheDetails')) {
      disabledGearIds.add('avalanche-kit');
      disabledGearIds.add('avalanche-unknown');
    }
    if (!isFeatureEnabled(flags, 'airQualityDetails')) disabledGearIds.add('aq-health');
    if (!isFeatureEnabled(flags, 'fireRiskDetails')) disabledGearIds.add('fire-risk');
    if (!isFeatureEnabled(flags, 'heatRiskDetails')) {
      disabledGearIds.add('hydration-heat');
      disabledGearIds.add('electrolytes-heat');
    }
    if (!isFeatureEnabled(flags, 'weatherContextDetails')) disabledGearIds.add('navigation-low-vis');
    filtered.gear = filtered.gear.filter((item) => !disabledGearIds.has(String(item?.id || '')));
  }

  filtered.safety = removeDisabledAnalysisDetails(filtered.safety, flags);
  filtered.disabledProductDomains = getDisabledScoreFeatureLabels(flags);
  return filtered;
};

module.exports = {
  SCORE_FEATURE_KEYS,
  getDisabledScoreFeatureLabels,
  getScoreFeatureSnapshot,
  reportMatchesScoreFeatures,
  sanitizeReportForFeatureFlags,
};
