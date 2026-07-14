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

const FEATURE_REFERENCE_PATTERNS = Object.freeze({
  avalancheDetails: /avalanche/iu,
  airQualityDetails: /air quality|\baqi\b|pm2\.5|pm10/iu,
  fireRiskDetails: /fire risk|fire danger|wildfire|red flag warning/iu,
  heatRiskDetails: /heat risk|heat stress|heat index/iu,
  snowpackDetails: /snowpack|snow depth|snow water equivalent|\bswe\b|snotel|nohrsc|\bcdec\b/iu,
  fieldObservations: /field observation|nearby station|weather station|radar|streamflow|stream crossing|\bqpe\b|\bnwps\b/iu,
  windLoadingDetails: /wind load(?:ing|ed)?|wind slab|snow transport/iu,
  daylightTimeline: /daylight|darkness|sunrise|sunset/iu,
  weatherContextDetails: /visibility risk|pressure trend|atmospheric context/iu,
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
const AVALANCHE_REFERENCE_PATTERN = FEATURE_REFERENCE_PATTERNS.avalancheDetails;

const getDisabledReferencePatterns = (flags) => SCORE_FEATURE_KEYS
  .filter((key) => !isFeatureEnabled(flags, key))
  .map((key) => FEATURE_REFERENCE_PATTERNS[key])
  .filter(Boolean);

const containsAvalancheReference = (value) => {
  try {
    return AVALANCHE_REFERENCE_PATTERN.test(JSON.stringify(value));
  } catch {
    return false;
  }
};

const scrubAvalancheReferences = (value, preserveKeys = false) => {
  if (typeof value === 'string') {
    return AVALANCHE_REFERENCE_PATTERN.test(value) ? undefined : value;
  }
  if (Array.isArray(value)) {
    return value
      .filter((item) => !containsAvalancheReference(item))
      .map((item) => scrubAvalancheReferences(item))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (key === 'featureFlags') return [[key, scrubAvalancheReferences(item, true)]];
    if (!preserveKeys && AVALANCHE_REFERENCE_PATTERN.test(key)) return [];
    const scrubbed = scrubAvalancheReferences(item, preserveKeys);
    return scrubbed === undefined ? [] : [[key, scrubbed]];
  }));
};

const containsDisabledReference = (value, patterns) => {
  try {
    const serialized = JSON.stringify(value);
    return patterns.some((pattern) => pattern.test(serialized));
  } catch {
    return false;
  }
};

const scrubDisabledReferences = (value, patterns, preserveKeys = false) => {
  if (typeof value === 'string') {
    return patterns.some((pattern) => pattern.test(value)) ? undefined : value;
  }
  if (Array.isArray(value)) {
    return value
      .filter((item) => !containsDisabledReference(item, patterns))
      .map((item) => scrubDisabledReferences(item, patterns))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (key === 'featureFlags') return [[key, scrubDisabledReferences(item, patterns, true)]];
    if (!preserveKeys && patterns.some((pattern) => pattern.test(key))) return [];
    const scrubbed = scrubDisabledReferences(item, patterns, preserveKeys);
    return scrubbed === undefined ? [] : [[key, scrubbed]];
  }));
};

const removeAvalancheNarrativeReferences = (value) => String(value || '')
  .split('\n')
  .map((line) => {
    const labelMatch = /^([A-Z][A-Z ]+:)\s*(.*)$/u.exec(line.trim());
    const label = labelMatch?.[1] || '';
    const body = labelMatch?.[2] ?? line;
    const keptSentences = body
      .match(/[^.!?]+[.!?]?/gu)
      ?.map((sentence) => sentence.trim())
      .filter((sentence) => sentence && !AVALANCHE_REFERENCE_PATTERN.test(sentence)) || [];
    if (keptSentences.length > 0) return `${label}${label ? ' ' : ''}${keptSentences.join(' ')}`;
    return label ? `${label} No enabled-domain concern is available for this section.` : '';
  })
  .filter(Boolean)
  .join('\n');

const removeDisabledNarrativeReferences = (value, flags) => {
  const patterns = getDisabledReferencePatterns(flags);
  if (patterns.length === 0) return String(value || '');
  return String(value || '')
    .split('\n')
    .map((line) => {
      const labelMatch = /^([A-Z][A-Z ]+:)\s*(.*)$/u.exec(line.trim());
      const label = labelMatch?.[1] || '';
      const body = labelMatch?.[2] ?? line;
      const keptSentences = body
        .match(/[^.!?]+[.!?]?/gu)
        ?.map((sentence) => sentence.trim())
        .filter((sentence) => sentence && !patterns.some((pattern) => pattern.test(sentence))) || [];
      if (keptSentences.length > 0) return `${label}${label ? ' ' : ''}${keptSentences.join(' ')}`;
      return label ? `${label} No enabled-domain concern is available for this section.` : '';
    })
    .filter(Boolean)
    .join('\n');
};

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

const removeAvalancheReferences = (report) => {
  const filtered = cloneReport(report);
  delete filtered.avalanche;
  delete filtered.disabledProductDomains;
  filtered.safety = removeDisabledAnalysisDetails(filtered.safety, { avalancheDetails: false });
  if (Array.isArray(filtered.gear)) {
    filtered.gear = filtered.gear.filter((item) => !containsAvalancheReference(item));
  }
  if (filtered.alerts && typeof filtered.alerts === 'object' && Array.isArray(filtered.alerts.alerts)) {
    filtered.alerts.alerts = filtered.alerts.alerts.filter((alert) => !containsAvalancheReference(alert));
    filtered.alerts.activeCount = filtered.alerts.alerts.length;
    filtered.alerts.totalActiveCount = filtered.alerts.alerts.length;
    if (filtered.alerts.alerts.length === 0) {
      filtered.alerts.status = 'none';
      delete filtered.alerts.highestSeverity;
    } else {
      const severityRank = { Unknown: 0, Minor: 1, Moderate: 2, Severe: 3, Extreme: 4 };
      filtered.alerts.highestSeverity = filtered.alerts.alerts.reduce((highest, alert) => (
        (severityRank[alert?.severity] || 0) > (severityRank[highest] || 0) ? alert.severity : highest
      ), 'Unknown');
    }
  }
  return scrubAvalancheReferences(filtered);
};

const removeDisabledFeatureReferences = (report, flags) => {
  const patterns = getDisabledReferencePatterns(flags);
  if (patterns.length === 0) return cloneReport(report);
  const filtered = scrubDisabledReferences(report, patterns);
  if (filtered?.alerts && typeof filtered.alerts === 'object' && Array.isArray(filtered.alerts.alerts)) {
    filtered.alerts.activeCount = filtered.alerts.alerts.length;
    filtered.alerts.totalActiveCount = filtered.alerts.alerts.length;
    if (filtered.alerts.alerts.length === 0) {
      filtered.alerts.status = 'none';
      delete filtered.alerts.highestSeverity;
    } else {
      const severityRank = { Unknown: 0, Minor: 1, Moderate: 2, Severe: 3, Extreme: 4 };
      filtered.alerts.highestSeverity = filtered.alerts.alerts.reduce((highest, alert) => (
        (severityRank[alert?.severity] || 0) > (severityRank[highest] || 0) ? alert.severity : highest
      ), 'Unknown');
    }
  }
  return filtered;
};

const sanitizeReportForFeatureFlags = (report, flags) => {
  const filtered = cloneReport(report);
  filtered.featureFlags = { ...flags };

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
  if (!isFeatureEnabled(flags, 'elevationForecast') && filtered.weather && typeof filtered.weather === 'object') {
    delete filtered.weather.elevationForecast;
    delete filtered.weather.elevationForecastNote;
  }
  if (!isFeatureEnabled(flags, 'gearRecommendations')) delete filtered.gear;

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
  if (!isFeatureEnabled(flags, 'scoreBreakdown') && filtered.safety && typeof filtered.safety === 'object') {
    delete filtered.safety.factors;
    delete filtered.safety.explanations;
    delete filtered.safety.confidenceReasons;
    delete filtered.safety.sourcesUsed;
    delete filtered.safety.groupImpacts;
  }
  return removeDisabledFeatureReferences(filtered, flags);
};

module.exports = {
  SCORE_FEATURE_KEYS,
  getDisabledScoreFeatureLabels,
  getScoreFeatureSnapshot,
  removeDisabledFeatureReferences,
  removeDisabledNarrativeReferences,
  removeAvalancheReferences,
  removeAvalancheNarrativeReferences,
  reportMatchesScoreFeatures,
  sanitizeReportForFeatureFlags,
};
