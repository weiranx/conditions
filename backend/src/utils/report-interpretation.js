'use strict';

// What the report's sources mean for the plan, in the viewer's units: the
// avalanche context, recent and expected precipitation, snowpack signal and
// source agreement, fire and heat levels, trail surface, how current each
// source is, visibility, pressure trend, clear daylight hours and daylight left.

const {
  convertElevationFt,
  formatClockForStyle,
  formatDistance,
  formatDurationMinutes,
  formatElevation,
  formatRainAmount,
  formatSnowDepth,
  formatSnowfallAmount,
  formatSwe,
  localizeUnitText,
  minutesToTwentyFourHourClock,
  parseHourLabelToMinutes,
  parseSolarClockMinutes,
  parseTimeInputMinutes,
} = require('./display-format');
const {
  classifySnowpackFreshness,
  formatAgeFromNow,
  formatCompactAge,
  freshnessClass,
  isTravelWindowCoveredByAlertWindow,
  parseIsoToMs,
  pickNewestIsoTimestamp,
  pickOldestIsoTimestamp,
  resolveSelectedTravelWindowMs,
} = require('./source-freshness');
const { normalizeDangerLevel } = require('./decision');
const { parseTerrainFromLocation, windDirectionToDegrees } = require('./avalanche-terrain');
const { normalizeWindHintDirection } = require('./wind-loading');
const { computeFeelsLikeF } = require('./weather-normalizers');
const { toFiniteOrNull } = require('./numbers');

const finite = (value) => toFiniteOrNull(value) ?? Number.NaN;
const isNum = Number.isFinite;

// ── Avalanche ────────────────────────────────────────────────────────────────

const DANGER_LABELS = ['No rating', 'Low', 'Moderate', 'Considerable', 'High', 'Extreme'];

const ELEVATION_WORDS = { upper: 'above', middle: 'near', lower: 'below' };

/**
 * Where each avalanche problem sits, from the bulletin's location text: its
 * aspects and elevation bands (upper, middle, lower), empty where the bulletin
 * does not say, so an unstated slope is never drawn as affected.
 */
const buildProblemTerrain = (problems) => (Array.isArray(problems) ? problems : []).map((problem) => {
  const { aspects, elevations } = parseTerrainFromLocation(problem?.location);
  const bands = ['upper', 'middle', 'lower'].filter((band) => elevations.has(band));
  const aspectText = aspects.size === 8 ? 'All aspects' : aspects.size ? [...aspects].join(', ') : 'Aspects not stated';
  const bandText = elevations.size === 3
    ? 'all elevations'
    : elevations.size ? `${bands.map((band) => ELEVATION_WORDS[band]).join(', ')} treeline` : 'elevations not stated';
  return {
    name: problem?.name || 'Avalanche problem',
    aspects: [...aspects],
    elevations: bands,
    description: `${aspectText} · ${bandText}`,
  };
});

const buildAvalancheDisplay = (report, units) => {
  const avalanche = report?.avalanche;
  const relevant = Boolean(avalanche && avalanche.relevant !== false);
  const expiredForSelectedStart = avalanche?.coverageStatus === 'expired_for_selected_start';
  const coverageUnknown = avalanche
    ? ['no_center_coverage', 'temporarily_unavailable', 'no_active_forecast'].includes(String(avalanche.coverageStatus || ''))
    : false;
  const unknown = avalanche ? relevant && Boolean(avalanche.dangerUnknown || coverageUnknown) : false;
  const overallLevel = avalanche && !unknown ? normalizeDangerLevel(avalanche.dangerLevel) : null;
  const notApplicableReason = avalanche
    ? localizeUnitText(avalanche.relevanceReason || 'Avalanche forecast is not applicable for this objective/date based on seasonal and snowpack context.', units)
    : '';
  const elevationRows = avalanche && !unknown
    ? [
      { key: 'above', label: 'Above treeline', rating: avalanche.elevations?.above?.level ?? null },
      { key: 'at', label: 'Near treeline', rating: avalanche.elevations?.at?.level ?? null },
      { key: 'below', label: 'Below treeline', rating: avalanche.elevations?.below?.level ?? null },
    ]
    : [];
  // One line for the Brief: the rating when there is one; otherwise why there is none.
  let briefCaption;
  if (!avalanche) briefCaption = 'No avalanche information is available for this plan.';
  else if (!relevant) briefCaption = notApplicableReason;
  else if (overallLevel !== null && overallLevel > 0) {
    briefCaption = `${DANGER_LABELS[overallLevel] || `Level ${overallLevel}`} (${overallLevel} of 5) is the highest rating in the ${avalanche.center || 'avalanche center'} forecast.`;
  } else {
    const missing = expiredForSelectedStart
      ? 'The avalanche forecast expires before your start.'
      : avalanche.coverageStatus === 'no_active_forecast'
        ? `${avalanche.center || 'The avalanche center'} has no current forecast for this zone.`
        : avalanche.coverageStatus === 'no_center_coverage'
          ? 'No avalanche center forecasts this area.'
          : avalanche.coverageStatus === 'temporarily_unavailable'
            ? 'The avalanche forecast could not be loaded.'
            : 'The current avalanche product has no danger rating.';
    briefCaption = `${missing} ${notApplicableReason}`.trim();
  }
  return {
    relevant,
    expiredForSelectedStart,
    coverageUnknown,
    unknown,
    overallLevel,
    notApplicableReason,
    elevationRows,
    briefCaption,
    problemTerrain: buildProblemTerrain(avalanche?.problems),
  };
};

// ── Precipitation ────────────────────────────────────────────────────────────

// A precipitation total: numbers, or the first number in text like "0.2 in".
const precipValue = (value) => {
  const parsed = toFiniteOrNull(value);
  if (parsed !== null) return parsed;
  if (typeof value !== 'string') return Number.NaN;
  const match = value.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
};

const buildRainfallDisplay = (rainfall, units, travelWindowHours) => {
  const totals = rainfall?.totals || null;
  const eu = units.elevation;
  const rainIn = [12, 24, 48].map((h) => precipValue(totals?.[`rainPast${h}hIn`] ?? totals?.[`past${h}hIn`]));
  const rainMm = [12, 24, 48].map((h) => precipValue(totals?.[`rainPast${h}hMm`] ?? totals?.[`past${h}hMm`]));
  const snowIn = [12, 24, 48].map((h) => precipValue(totals?.[`snowPast${h}hIn`]));
  const snowCm = [12, 24, 48].map((h) => precipValue(totals?.[`snowPast${h}hCm`]));
  const rainDisplay = rainIn.map((value, i) => formatRainAmount(value, rainMm[i], eu));
  const snowDisplay = snowIn.map((value, i) => formatSnowfallAmount(value, snowCm[i], eu));
  const expected = rainfall?.expected || null;
  const expectedHoursRaw = Number(expected?.travelWindowHours);
  const expectedTravelWindowHours = isNum(expectedHoursRaw) ? Math.max(1, Math.round(expectedHoursRaw)) : travelWindowHours;
  const expectedRainIn = precipValue(expected?.rainWindowIn);
  const expectedRainMm = precipValue(expected?.rainWindowMm);
  const expectedSnowIn = precipValue(expected?.snowWindowIn);
  const expectedSnowCm = precipValue(expected?.snowWindowCm);
  const expectedRainWindowDisplay = formatRainAmount(expectedRainIn, expectedRainMm, eu);
  const expectedSnowWindowDisplay = formatSnowfallAmount(expectedSnowIn, expectedSnowCm, eu);
  const status = String(rainfall?.status || '').toLowerCase();
  const available = status === 'ok' || status === 'partial';
  const [rain24, snow24] = [rainIn[1], snowIn[1]];
  const rain24Display = rainDisplay[1];
  const snow24Display = snowDisplay[1];
  const insightLine = (() => {
    const rain = isNum(rain24) ? rain24 : null;
    const snow = isNum(snow24) ? snow24 : null;
    const anySignal = rain !== null || snow !== null;
    const none = anySignal && (rain === null || rain <= 0.01) && (snow === null || snow <= 0.01);
    if (rain !== null && rain >= 0.6 && snow !== null && snow >= 2) return `Mixed precip signal: 24h rain ${rain24Display} plus 24h snow ${snow24Display}.`;
    if (rain !== null && rain >= 0.6) return `Strong rain signal: 24h rain ${rain24Display}. Expect wetter, softer footing.`;
    if (snow !== null && snow >= 4) return `Strong snow signal: 24h snow ${snow24Display}. Fresh coverage likely.`;
    if (rain !== null && rain >= 0.25) return `Moderate rain signal: 24h rain ${rain24Display}. Slick/muddy sections are likely.`;
    if (snow !== null && snow >= 1.5) return `Moderate snow signal: 24h snow ${snow24Display}. Patchy fresh snow likely.`;
    if (none) return `No recent precip signal: 24h rain ${rain24Display} • 24h snow ${snow24Display}.`;
    if (anySignal) return `Light recent precip: 24h rain ${rain24Display} • 24h snow ${snow24Display}.`;
    return 'Recent rain/snow totals are unavailable for this objective/time.';
  })();
  const nullable = (value) => (isNum(value) ? value : null);
  return {
    // Accumulations in inches (null when missing), for the charts.
    rainIn: { past12h: nullable(rainIn[0]), past24h: nullable(rainIn[1]), past48h: nullable(rainIn[2]) },
    snowIn: { past12h: nullable(snowIn[0]), past24h: nullable(snowIn[1]), past48h: nullable(snowIn[2]) },
    rainDisplay: { past12h: rainDisplay[0], past24h: rainDisplay[1], past48h: rainDisplay[2] },
    snowDisplay: { past12h: snowDisplay[0], past24h: snowDisplay[1], past48h: snowDisplay[2] },
    expectedTravelWindowHours,
    expectedRainWindowDisplay,
    expectedSnowWindowDisplay,
    modeLabel: rainfall?.mode === 'projected_for_selected_start'
      ? 'Projected around selected start'
      : rainfall?.mode === 'observed_recent' ? 'Observed recent accumulation' : 'Mode unavailable',
    noteLine: (typeof rainfall?.note === 'string' && rainfall.note.trim())
      || (available
        ? rainfall?.mode === 'projected_for_selected_start'
          ? 'Rolling rain and snowfall totals are anchored to selected start time and can include forecast hours.'
          : 'Rolling rain and snowfall totals are based on recent hours prior to the selected period.'
        : 'Rolling rain/snow totals unavailable for this objective/time.'),
    expectedNoteLine: (typeof expected?.note === 'string' && expected.note.trim())
      || `Expected precipitation totals for the next ${expectedTravelWindowHours}h from selected start time.`,
    insightLine,
  };
};

// ── Snowpack ─────────────────────────────────────────────────────────────────

const snowMetrics = (snowpack) => {
  const snotel = snowpack?.snotel || null;
  const nohrsc = snowpack?.nohrsc || null;
  const cdec = snowpack?.cdec || null;
  return {
    snotel,
    nohrsc,
    cdec,
    snotelDepth: finite(snotel?.snowDepthIn),
    nohrscDepth: finite(nohrsc?.snowDepthIn),
    cdecDepth: finite(cdec?.snowDepthIn),
    snotelSwe: finite(snotel?.sweIn),
    nohrscSwe: finite(nohrsc?.sweIn),
    cdecSwe: finite(cdec?.sweIn),
  };
};

const elevationDeltaText = (deltaFt, unit) => `${Math.round(convertElevationFt(deltaFt, unit)).toLocaleString('en-US')} ${unit}`;

/** A headline and caveats for the snowpack signal; null without any snow metric. */
const buildSnowpackInterpretation = (snowpack, objectiveElevationFt, unit, nowMs) => {
  const m = snowMetrics(snowpack);
  const has = {
    snotelDepth: isNum(m.snotelDepth), nohrscDepth: isNum(m.nohrscDepth), cdecDepth: isNum(m.cdecDepth),
    snotelSwe: isNum(m.snotelSwe), nohrscSwe: isNum(m.nohrscSwe), cdecSwe: isNum(m.cdecSwe),
  };
  if (!Object.values(has).some(Boolean)) return null;
  const stationDistanceKm = finite(m.snotel?.distanceKm);
  const stationElevationFt = finite(m.snotel?.elevationFt);
  const anySnow = (has.snotelDepth && m.snotelDepth > 0) || (has.nohrscDepth && m.nohrscDepth > 0) || (has.cdecDepth && m.cdecDepth > 0)
    || (has.snotelSwe && m.snotelSwe > 0) || (has.nohrscSwe && m.nohrscSwe > 0) || (has.cdecSwe && m.cdecSwe > 0);
  const maxDepth = Math.max(has.snotelDepth ? m.snotelDepth : 0, has.nohrscDepth ? m.nohrscDepth : 0, has.cdecDepth ? m.cdecDepth : 0);
  const maxSwe = Math.max(has.snotelSwe ? m.snotelSwe : 0, has.nohrscSwe ? m.nohrscSwe : 0, has.cdecSwe ? m.cdecSwe : 0);
  const lowBroad = maxDepth <= 1 && maxSwe <= 0.2;
  let confidence = 'solid';
  const bullets = [];

  if (has.snotelDepth && has.nohrscDepth) {
    const baseline = Math.max(Math.abs(m.snotelDepth), Math.abs(m.nohrscDepth), 1);
    if ((Math.abs(m.nohrscDepth - m.snotelDepth) / baseline) * 100 <= 30) {
      bullets.push('SNOTEL and NOHRSC depth are broadly aligned, so snow coverage confidence is higher.');
    } else {
      confidence = lowBroad ? 'solid' : 'watch';
      bullets.push('SNOTEL vs NOHRSC depth diverge significantly, indicating patchy or elevation-sensitive snow distribution.');
    }
  } else {
    confidence = lowBroad ? 'solid' : 'watch';
    bullets.push(lowBroad
      ? 'Only one depth source is available, but broad snow signal remains minimal.'
      : 'Only one depth source is available; treat this as directional context, not a full snowpack picture.');
  }
  if (isNum(stationDistanceKm) && !lowBroad) {
    const distance = formatDistance(stationDistanceKm, unit);
    if (stationDistanceKm <= 10) {
      bullets.push(`Nearest SNOTEL is close (${distance}), improving local representativeness.`);
    } else if (stationDistanceKm > 25) {
      confidence = confidence === 'solid' ? 'watch' : confidence;
      bullets.push(`Nearest SNOTEL is ${distance} away, so conditions may differ materially at your objective.`);
    }
  }
  const objectiveFt = finite(objectiveElevationFt);
  if (isNum(stationElevationFt) && isNum(objectiveFt) && !lowBroad) {
    const delta = Math.abs(stationElevationFt - objectiveFt);
    if (delta >= 2000) {
      confidence = confidence === 'solid' ? 'watch' : confidence;
      bullets.push(`SNOTEL station elevation differs by ~${elevationDeltaText(delta, unit)} from the objective; expect vertical snowpack variability.`);
    }
  }
  const observedMs = /^\d{4}-\d{2}-\d{2}$/.test(String(m.snotel?.observedDate || '').trim())
    ? Date.parse(`${String(m.snotel.observedDate).trim()}T00:00:00Z`)
    : Number.NaN;
  if (isNum(observedMs)) {
    const ageDays = Math.max(0, Math.floor((nowMs - observedMs) / 86400000));
    if (ageDays >= 3) {
      confidence = lowBroad ? 'watch' : 'low';
      bullets.push(lowBroad
        ? `SNOTEL observation is ${ageDays} days old; broad no-snow signal is likely still valid, but verify for shaded pockets.`
        : `SNOTEL observation is ${ageDays} days old; re-verify with latest center/weather products before committing.`);
    } else if (ageDays >= 1) {
      confidence = confidence === 'solid' ? 'watch' : confidence;
      bullets.push(`SNOTEL observation is ${ageDays} day${ageDays === 1 ? '' : 's'} old; recent weather may have changed conditions.`);
    }
  }
  const zeroOrMissing = (present, value) => !present || value <= 0;
  if (isNum(objectiveFt) && objectiveFt >= 7500 && !anySnow
    && zeroOrMissing(has.nohrscDepth, m.nohrscDepth) && zeroOrMissing(has.cdecDepth, m.cdecDepth) && zeroOrMissing(has.snotelDepth, m.snotelDepth)) {
    bullets.push('All automated sources show minimal or no snow at this elevation. Gridded models can underrepresent isolated mountain snowpack — verify with local avalanche center, ranger station, or recent trip reports.');
  }
  if (anySnow) {
    const substantial = (has.nohrscDepth && m.nohrscDepth >= 24) || (has.cdecDepth && m.cdecDepth >= 24)
      || (has.snotelSwe && m.snotelSwe >= 8) || (has.nohrscSwe && m.nohrscSwe >= 8) || (has.cdecSwe && m.cdecSwe >= 8);
    return {
      headline: substantial
        ? 'Substantial snowpack signal. Treat avalanche terrain as consequential.'
        : 'Some snowpack signal present. Validate terrain-specific stability as you travel.',
      confidence,
      bullets: bullets.slice(0, 4),
    };
  }
  return {
    headline: 'Minimal broad snow signal in these sources. Non-snow travel is more likely, but isolated snow/ice pockets can remain.',
    confidence: confidence === 'low' ? 'watch' : confidence,
    bullets: bullets.slice(0, 4),
  };
};

/** Badges for the snowpack signal, source agreement, freshness and representativeness. */
const buildSnowpackInsights = (snowpack, objectiveElevationFt, unit, nowMs) => {
  const m = snowMetrics(snowpack);
  const maxDepth = Math.max(isNum(m.snotelDepth) ? m.snotelDepth : 0, isNum(m.nohrscDepth) ? m.nohrscDepth : 0, isNum(m.cdecDepth) ? m.cdecDepth : 0);
  const maxSwe = Math.max(isNum(m.snotelSwe) ? m.snotelSwe : 0, isNum(m.nohrscSwe) ? m.nohrscSwe : 0, isNum(m.cdecSwe) ? m.cdecSwe : 0);
  const observed = [m.snotelDepth, m.nohrscDepth, m.cdecDepth, m.snotelSwe, m.nohrscSwe, m.cdecSwe].some(isNum);
  const lowBroad = observed && maxDepth <= 1 && maxSwe <= 0.2;

  let signal;
  if (!observed) {
    signal = { label: 'Signal limited', detail: 'No usable SNOTEL/NOHRSC/CDEC snow metrics were returned.', tone: 'watch' };
  } else if (maxDepth >= 24 || maxSwe >= 8) {
    signal = { label: 'Strong signal', detail: `Depth up to ${formatSnowDepth(maxDepth, unit)} or SWE up to ${formatSwe(maxSwe, unit)}.`, tone: 'watch' };
  } else if (maxDepth >= 6 || maxSwe >= 1.5) {
    signal = { label: 'Measurable signal', detail: `Depth up to ${formatSnowDepth(maxDepth, unit)} and SWE up to ${formatSwe(maxSwe, unit)}.`, tone: 'watch' };
  } else {
    signal = {
      label: 'Minimal broad signal',
      detail: `Depth/SWE are low (${formatSnowDepth(maxDepth, unit)}, ${formatSwe(maxSwe, unit)}), but isolated snow terrain may still exist.`,
      tone: 'good',
    };
  }

  const distanceKm = finite(m.snotel?.distanceKm);
  const stationFt = finite(m.snotel?.elevationFt);
  const objectiveFt = finite(objectiveElevationFt);
  const hasDistance = isNum(distanceKm);
  const hasElevDelta = isNum(stationFt) && isNum(objectiveFt);
  const elevDeltaFt = hasElevDelta ? Math.abs(stationFt - objectiveFt) : null;
  const distanceText = hasDistance ? formatDistance(distanceKm, unit) : 'N/A';
  const deltaText = elevDeltaFt !== null ? elevationDeltaText(elevDeltaFt, unit) : 'N/A';
  let representativeness;
  if (!hasDistance && !hasElevDelta) {
    representativeness = {
      label: lowBroad ? 'Context optional' : 'Representativeness unknown',
      detail: lowBroad
        ? 'Distance/elevation context is unavailable, but broad no-snow signal is still informative.'
        : 'Nearest SNOTEL distance/elevation context is unavailable.',
      tone: lowBroad ? 'good' : 'warn',
    };
  } else if (hasDistance && distanceKm <= 10 && (elevDeltaFt === null || elevDeltaFt <= 1500)) {
    representativeness = {
      label: 'High representativeness',
      detail: `Nearest station is ${distanceText} away${elevDeltaFt !== null ? ` with ~${deltaText} elevation offset` : ''}.`,
      tone: 'good',
    };
  } else if ((hasDistance && distanceKm > 30) || (elevDeltaFt !== null && elevDeltaFt > 3000)) {
    representativeness = {
      label: lowBroad ? 'Lower representativeness' : 'Low representativeness',
      detail: `Station context is less local (${distanceText}${elevDeltaFt !== null ? `, ~${deltaText} elevation offset` : ''}); verify with on-route observations.`,
      tone: lowBroad ? 'watch' : 'warn',
    };
  } else {
    representativeness = {
      label: 'Moderate representativeness',
      detail: `Station context is usable but not exact (${distanceText}${elevDeltaFt !== null ? `, ~${deltaText} elevation offset` : ''}).`,
      tone: 'watch',
    };
  }

  const depthPair = isNum(m.snotelDepth) && isNum(m.nohrscDepth);
  const swePair = isNum(m.snotelSwe) && isNum(m.nohrscSwe);
  const depthDeltaIn = depthPair ? Math.abs(m.snotelDepth - m.nohrscDepth) : null;
  const sweDeltaIn = swePair ? Math.abs(m.snotelSwe - m.nohrscSwe) : null;
  const depthDeltaPct = depthPair ? (depthDeltaIn / Math.max(Math.abs(m.snotelDepth), Math.abs(m.nohrscDepth), 1)) * 100 : null;
  const sweDeltaPct = swePair ? (sweDeltaIn / Math.max(Math.abs(m.snotelSwe), Math.abs(m.nohrscSwe), 0.1)) * 100 : null;
  const maxDeltaPct = Math.max(depthDeltaPct ?? 0, sweDeltaPct ?? 0);
  let agreement;
  if (!depthPair && !swePair) {
    agreement = { label: 'Single-source view', detail: 'Only one source has usable snow metrics. Treat this as directional context.', tone: lowBroad ? 'good' : 'watch' };
  } else {
    const parts = [
      depthDeltaIn !== null ? `Depth Δ ${formatSnowDepth(depthDeltaIn, unit)}${depthDeltaPct !== null ? ` (${Math.round(depthDeltaPct)}%)` : ''}` : null,
      sweDeltaIn !== null ? `SWE Δ ${formatSwe(sweDeltaIn, unit)}${sweDeltaPct !== null ? ` (${Math.round(sweDeltaPct)}%)` : ''}` : null,
    ].filter(Boolean).join(' • ');
    if (maxDeltaPct <= 35) {
      agreement = { label: 'Sources aligned', detail: parts || 'SNOTEL and NOHRSC broadly agree.', tone: 'good' };
    } else if (maxDeltaPct <= 70 || lowBroad) {
      agreement = { label: 'Partial agreement', detail: `${parts || 'Sources diverge somewhat.'} Expect patchy distribution.`, tone: 'watch' };
    } else {
      agreement = { label: 'Sources diverge', detail: `${parts || 'Large disagreement between sources.'} Verify snow coverage on route before committing.`, tone: 'warn' };
    }
  }

  const snotelAgeLabel = formatCompactAge(m.snotel?.observedDate || null, nowMs);
  const nohrscAgeLabel = formatCompactAge(m.nohrsc?.sampledTime || null, nowMs);
  const ageHours = (value) => {
    const ms = parseIsoToMs(value);
    return ms === null ? null : (nowMs - ms) / 3600000;
  };
  const snotelAge = ageHours(m.snotel?.observedDate || null);
  const nohrscAge = ageHours(m.nohrsc?.sampledTime || null);
  const ageDetail = [snotelAgeLabel ? `SNOTEL ${snotelAgeLabel}` : null, nohrscAgeLabel ? `NOHRSC ${nohrscAgeLabel}` : null].filter(Boolean).join(' • ');
  let freshness;
  if (snotelAge === null && nohrscAge === null) {
    freshness = {
      label: lowBroad ? 'Timestamp limited' : 'Freshness unknown',
      detail: lowBroad ? 'No timestamps were returned; broad no-snow signal is likely still directionally useful.' : 'No observation timestamps were returned.',
      tone: lowBroad ? 'watch' : 'warn',
    };
  } else if ((nohrscAge === null || nohrscAge <= 8) && (snotelAge === null || snotelAge <= 60)) {
    freshness = { label: 'Fresh data', detail: ageDetail, tone: 'good' };
  } else if ((nohrscAge === null || nohrscAge <= 18) && (snotelAge === null || snotelAge <= 96)) {
    freshness = { label: 'Aging data', detail: ageDetail, tone: 'watch' };
  } else {
    freshness = { label: lowBroad ? 'Aging data' : 'Stale data', detail: ageDetail || 'Observation times are outdated.', tone: lowBroad ? 'watch' : 'warn' };
  }
  return { signal, freshness, representativeness, agreement };
};

const isoDateLabel = (isoDate) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ''))) return String(isoDate || '');
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
};

/** A sample time as "Sep 24, 6:00 AM MDT" in the objective's time zone (UTC when unknown). */
const formatObservationTime = (isoString, timeZone, timeStyle) => {
  const ms = parseIsoToMs(isoString);
  if (ms === null) return String(isoString);
  const options = {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', hour12: timeStyle !== '24h',
  };
  if (timeZone) {
    try {
      return new Date(ms).toLocaleString('en-US', { ...options, timeZone });
    } catch {
      // An unknown zone reads in UTC.
    }
  }
  return new Date(ms).toLocaleString('en-US', { ...options, timeZone: 'UTC' });
};

/** The snowpack card: best readings with their source, each source's readings, disagreement and historical context. */
const buildSnowpackDisplay = (report, units, insights) => {
  const unit = units.elevation;
  const snowpack = report?.snowpack;
  const m = snowMetrics(snowpack);
  const pickBest = (candidates) => candidates.filter((c) => isNum(c.value)).reduce((best, c) => (!best || c.value > best.value ? c : best), null);
  // The highest reading across sources (conservative for a safety tool), attributed.
  const bestDepth = pickBest([
    { source: 'NOHRSC grid', value: m.nohrscDepth },
    { source: 'CDEC', value: m.cdecDepth },
    { source: 'SNOTEL', value: m.snotelDepth },
  ]);
  const bestSwe = pickBest([
    { source: 'SNOTEL', value: m.snotelSwe },
    { source: 'CDEC', value: m.cdecSwe },
    { source: 'NOHRSC grid', value: m.nohrscSwe },
  ]);
  const depthCandidates = [
    { source: 'NOHRSC grid', value: m.nohrscDepth },
    { source: 'CDEC', value: m.cdecDepth },
    { source: 'SNOTEL', value: m.snotelDepth },
  ].filter((c) => isNum(c.value));
  // When sources disagree strongly, one confident number is misleading: show the spread.
  const depthConflict = Boolean(insights?.agreement.tone === 'warn' && bestDepth && depthCandidates.length >= 2);
  const minDepth = depthConflict ? depthCandidates.reduce((low, c) => (c.value < low.value ? c : low)) : null;
  const metricAvailable = [m.snotelDepth, m.nohrscDepth, m.cdecDepth, m.snotelSwe, m.nohrscSwe, m.cdecSwe].some(isNum);
  const maxDepth = Math.max(...[m.snotelDepth, m.nohrscDepth, m.cdecDepth].map((v) => (isNum(v) ? v : 0)));
  const maxSwe = Math.max(...[m.snotelSwe, m.nohrscSwe, m.cdecSwe].map((v) => (isNum(v) ? v : 0)));
  const lowBroad = metricAvailable && maxDepth <= 1 && maxSwe <= 0.2;
  const source = (station, depth, swe) => ({
    depthDisplay: formatSnowDepth(depth, unit),
    sweDisplay: formatSwe(swe, unit),
    distanceDisplay: formatDistance(finite(station?.distanceKm), unit),
  });

  const historical = snowpack?.historical || null;
  const metricLabel = String(historical?.overall?.metric || '').trim();
  const percent = typeof historical?.overall?.percentOfAverage === 'number' && isNum(historical.overall.percentOfAverage)
    ? historical.overall.percentOfAverage : null;
  const historicalComparisonLine = (() => {
    if (!historical) return 'Historical average unavailable for this selected date.';
    const metricLine = metricLabel.toUpperCase() === 'SWE'
      ? `${formatSwe(finite(historical.swe?.currentIn), unit)} vs avg ${formatSwe(finite(historical.swe?.averageIn), unit)}`
      : metricLabel.toLowerCase() === 'snow depth'
        ? `Depth ${formatSnowDepth(finite(historical.depth?.currentIn), unit)} vs avg ${formatSnowDepth(finite(historical.depth?.averageIn), unit)}`
        : null;
    const parts = [metricLine, percent !== null ? `${percent}% of average` : null, historical.targetDate ? `for ${isoDateLabel(historical.targetDate)}` : null].filter(Boolean);
    return parts.length > 0 ? parts.join(' • ') : 'Historical average unavailable for this selected date.';
  })();
  const observationParts = [
    m.snotel?.observedDate ? `SNOTEL obs ${m.snotel.observedDate}` : null,
    m.nohrsc?.sampledTime ? `NOHRSC sample ${formatObservationTime(m.nohrsc.sampledTime, report?.weather?.timezone || null, units.timeStyle)}` : null,
  ].filter(Boolean);
  return {
    bestDepthDisplay: bestDepth ? formatSnowDepth(bestDepth.value, unit) : 'N/A',
    bestDepthSource: bestDepth?.source ?? null,
    bestSweDisplay: bestSwe ? formatSwe(bestSwe.value, unit) : 'N/A',
    bestSweSource: bestSwe?.source ?? null,
    depthConflict,
    depthRangeDisplay: depthConflict && bestDepth && minDepth ? `${formatSnowDepth(minDepth.value, unit)} – ${formatSnowDepth(bestDepth.value, unit)}` : null,
    depthConflictCaption: depthConflict && bestDepth && minDepth
      ? `${bestDepth.source} reads ${formatSnowDepth(bestDepth.value, unit)} but ${minDepth.source} reads ${formatSnowDepth(minDepth.value, unit)} — verify coverage on route`
      : null,
    sources: {
      snotel: source(m.snotel, m.snotelDepth, m.snotelSwe),
      nohrsc: source(m.nohrsc, m.nohrscDepth, m.nohrscSwe),
      cdec: source(m.cdec, m.cdecDepth, m.cdecSwe),
    },
    statusLabel: lowBroad ? 'Low snow signal' : String(snowpack?.status || 'unavailable').toUpperCase(),
    historicalComparisonLine,
    observationContext: observationParts.length ? `Using observations: ${observationParts.join(' • ')}` : 'Using latest available snowpack observations.',
  };
};

// ── Fire, heat, surface ──────────────────────────────────────────────────────

/** A card's status from its label: unavailable, over (high, extreme, elevated, poor…), or fine. */
const labelStatus = (label) => {
  const text = String(label || '').toLowerCase();
  if (!text || /unavailable|unknown/.test(text)) return 'missing';
  return /high|extreme|elevated|poor|unhealthy|severe/.test(text) ? 'over' : 'ok';
};

const toneForLevel = (level, thresholds, fallback) => {
  if (!isNum(level)) return fallback;
  if (level >= thresholds.nogo) return 'nogo';
  if (level >= thresholds.caution) return 'caution';
  if (level >= thresholds.watch) return 'watch';
  return 'go';
};

const buildFireRiskDisplay = (report) => {
  const rawLevel = report?.fireRisk?.level;
  const level = rawLevel == null ? Number.NaN : Number(rawLevel);
  const label = report?.fireRisk?.label || (isNum(level) ? 'Low' : 'Unknown');
  return {
    level: isNum(level) ? level : null,
    label,
    tone: toneForLevel(level, { nogo: 4, caution: 3, watch: 2 }, 'caution'),
    // High fire danger (3+) is over the limit whatever the label says.
    status: isNum(level) && level >= 3 ? 'over' : labelStatus(label) === 'missing' ? 'missing' : 'ok',
  };
};

const HEAT_LABELS = ['Low', 'Caution', 'Elevated', 'High', 'Extreme'];

const buildHeatRiskDisplay = (report) => {
  const payloadLevel = toFiniteOrNull(report?.heatRisk?.level);
  let level;
  if (payloadLevel !== null) {
    level = Math.max(0, Math.min(4, Math.round(payloadLevel)));
  } else {
    // Without a heat assessment, estimate from the start hour's feels-like.
    const feelsLike = toFiniteOrNull(report?.weather?.feelsLike ?? report?.weather?.temp);
    level = feelsLike === null ? 0 : feelsLike >= 100 ? 4 : feelsLike >= 92 ? 3 : feelsLike >= 84 ? 2 : feelsLike >= 76 ? 1 : 0;
  }
  const label = report?.heatRisk?.label || HEAT_LABELS[level];
  return {
    level,
    label,
    tone: toneForLevel(level, { nogo: 4, caution: 2, watch: 1 }, 'go'),
    status: labelStatus(label),
    guidance: report?.heatRisk?.guidance
      || (level >= 4
        ? 'Extreme heat-stress risk. Choose a cooler time or objective and avoid long exposed travel.'
        : level >= 3
          ? 'High heat-stress risk. Move in cooler hours, shorten exposed segments, and set water and cooling checkpoints.'
          : level >= 2
            ? 'Heat stress may build. Schedule shade and hydration breaks, ease the pace, and watch for early symptoms.'
            : level >= 1
              ? 'Warm conditions are possible. Carry extra water, use sun protection, and ease the pace before symptoms build.'
              : 'No notable heat signal in the current forecast. Carry normal water and sun protection, and reassess if the day runs warmer than forecast.'),
  };
};

const CAUTION_SURFACES = ['snow_ice', 'snow_fresh_powder', 'snow_mixed', 'spring_snow', 'wet_snow', 'wet_muddy', 'cold_slick', 'dry_loose'];

const buildTerrainConditionDisplay = (report, units) => {
  const terrain = report?.terrainCondition;
  // Provider sentences quote imperial values ("Temperature near 28F.").
  const localize = (text) => (units ? localizeUnitText(text, units) : text);
  const snowProfile = terrain?.snowProfile
    ? {
      label: terrain.snowProfile.label || 'Snow profile unavailable',
      summary: localize(terrain.snowProfile.summary || ''),
      reasons: Array.isArray(terrain.snowProfile.reasons) ? terrain.snowProfile.reasons.slice(0, 4).map(localize) : [],
      confidence: terrain.snowProfile.confidence || null,
      meltFreeze: terrain.snowProfile.meltFreeze || null,
    }
    : null;
  const hasDetail = terrain && (terrain.summary || (Array.isArray(terrain.reasons) && terrain.reasons.length > 0));
  const code = String(terrain?.code || '').toLowerCase();
  const label = terrain?.label?.trim() || '';
  let tone;
  if (code === 'dry_firm') tone = 'go';
  else if (code === 'weather_unavailable') tone = 'watch';
  else if (CAUTION_SURFACES.includes(code)) tone = 'caution';
  else if (code) tone = 'watch';
  else {
    const text = String(terrain?.label || report?.trail || '').toLowerCase();
    tone = !text ? 'caution' : /weather unavailable|partially unavailable|unknown/.test(text) ? 'watch' : /snow|icy|wet|muddy|slick/.test(text) ? 'caution' : 'go';
  }
  return {
    summary: hasDetail
      ? localize(terrain.summary || 'Surface classification is based on weather, precipitation totals, trend, and snowpack observations.')
      : 'Surface classification is based on weather description, precip probability, rolling rain/snow totals, temperature trend, and available snowpack observations.',
    reasons: hasDetail && Array.isArray(terrain.reasons) ? terrain.reasons.slice(0, 6).map(localize) : [],
    confidence: hasDetail ? terrain.confidence || null : null,
    impact: hasDetail ? terrain.impact || null : null,
    recommendedTravel: hasDetail && terrain.recommendedTravel ? localize(terrain.recommendedTravel) : null,
    snowProfile,
    tone,
    // Matches the decision: these surfaces are cautions, and an unavailable
    // assessment is missing evidence rather than a clear surface.
    status: !label || code === 'weather_unavailable'
      ? 'missing'
      : ['snow_ice', 'wet_muddy', 'cold_slick', 'dry_loose'].includes(code) || terrain?.impact === 'high' ? 'over' : 'ok',
    surfaceLabel: label.replace(/^[\p{Extended_Pictographic}️\s]+/u, '') || null,
  };
};

// ── Source freshness ─────────────────────────────────────────────────────────

/**
 * How current each source is: its issue time, how old it may get, and its
 * state (fresh, aging, stale, missing) when evaluated. A source with nothing
 * to report for the plan (no active alerts, no bulletin this season, air
 * quality past its forecast range) counts as fresh.
 */
const buildSourceFreshness = (report, avalancheRelevant, travelWindowHours, nowMs) => {
  const alertsStatus = report?.alerts?.status || null;
  const alertsNoActive = alertsStatus === 'none' || alertsStatus === 'none_for_selected_start';
  const alertsWindowCovered = isTravelWindowCoveredByAlertWindow(resolveSelectedTravelWindowMs(report, travelWindowHours), report?.alerts?.alerts || []);
  const airQualityFutureNotApplicable = String(report?.airQuality?.status || '').toLowerCase() === 'not_applicable_future_date';
  const snowpackFreshness = classifySnowpackFreshness(report?.snowpack?.snotel?.observedDate || null, report?.snowpack?.nohrsc?.sampledTime || null, nowMs);
  // A known no-bulletin state (seasonal gap or uncovered zone) is not a data
  // failure; the avalanche card explains it.
  const coverage = String(report?.avalanche?.coverageStatus || '');
  const noBulletin = coverage === 'no_active_forecast' || coverage === 'no_center_coverage';
  const rainfall = report?.rainfall || report?.rainfallData || null;
  const rows = [
    { label: 'Weather', issued: pickOldestIsoTimestamp([report?.weather?.issuedTime || null, report?.weather?.forecastStartTime || null]), staleHours: 12 },
    ...(avalancheRelevant ? [{
      label: 'Avalanche',
      issued: pickOldestIsoTimestamp([report?.avalanche?.publishedTime || null]),
      staleHours: 24,
      displayValue: noBulletin ? (coverage === 'no_center_coverage' ? 'No coverage here' : 'No bulletin (seasonal)') : null,
      state: noBulletin ? 'fresh' : null,
    }] : []),
    {
      label: 'Alerts',
      issued: pickNewestIsoTimestamp((report?.alerts?.alerts || []).flatMap((alert) => [alert?.sent || null, alert?.effective || null, alert?.onset || null])),
      staleHours: 6,
      displayValue: alertsNoActive ? 'No active' : alertsWindowCovered ? 'Window covered' : null,
      state: alertsNoActive || alertsWindowCovered ? 'fresh' : null,
    },
    {
      label: 'Air Quality',
      issued: pickOldestIsoTimestamp([report?.airQuality?.measuredTime || null]),
      staleHours: 8,
      displayValue: airQualityFutureNotApplicable ? 'Outside forecast' : null,
      state: airQualityFutureNotApplicable ? 'fresh' : null,
    },
    { label: 'Precipitation', issued: pickOldestIsoTimestamp([rainfall?.anchorTime || null]), staleHours: 8 },
    { label: 'Snowpack', issued: snowpackFreshness.referenceTimestamp, staleHours: 30, displayValue: snowpackFreshness.displayValue, state: snowpackFreshness.state },
  ].map((row) => ({
    label: row.label,
    issued: row.issued,
    staleHours: row.staleHours,
    displayValue: row.displayValue ?? null,
    state: row.state || freshnessClass(row.issued, row.staleHours, nowMs),
  }));
  const needsReview = rows.filter((row) => row.state === 'stale' || row.state === 'missing');
  return {
    rows,
    hasWarning: needsReview.length > 0,
    warningSummary: needsReview
      .slice(0, 3)
      .map((row) => `${row.label}: ${row.displayValue || (row.state === 'missing' ? 'missing' : formatAgeFromNow(row.issued, nowMs))}`)
      .join(' • '),
    airQualityFutureNotApplicable,
  };
};

// ── Visibility, pressure, daylight ───────────────────────────────────────────

const visibilityLevel = (levelValue, score) => {
  const normalized = String(levelValue || '').trim().toLowerCase();
  const named = { extreme: 'Extreme', high: 'High', moderate: 'Moderate', low: 'Low', minimal: 'Minimal', unknown: 'Unknown' }[normalized];
  if (named) return named;
  if (!isNum(Number(score)) || score === null) return 'Unknown';
  return score >= 80 ? 'Extreme' : score >= 60 ? 'High' : score >= 40 ? 'Moderate' : score >= 20 ? 'Low' : 'Minimal';
};

const VISIBILITY_SUMMARY = {
  Extreme: 'Whiteout is plausible. Terrain reading can collapse quickly.',
  High: 'Poor visibility likely; route-finding will be harder.',
  Moderate: 'Intermittent low-contrast conditions are possible.',
  Low: 'Mostly workable visibility with occasional reductions.',
  Minimal: 'No strong whiteout signal at this hour.',
  Unknown: 'Visibility signal unavailable.',
};

/** Whiteout and low-contrast risk from one reading, when the forecast carries no visibility assessment. */
const estimateVisibilityFromPoint = ({ description, precipChance, wind, gust, humidity, cloudCover, isDaytime }) => {
  const text = String(description || '').toLowerCase();
  const factors = [];
  let score = 0;
  const add = (points, reason) => { score += points; factors.push(reason); };
  if (/whiteout|blizzard|snow squall/.test(text)) add(55, 'blizzard/whiteout signal');
  else if (/heavy snow|blowing snow|snow showers/.test(text)) add(30, 'reduced-visibility weather signal');
  else if (/\bsnow\b/.test(text)) add(10, 'snow signal');
  else if (/fog|mist|haze|smoke/.test(text)) add(30, 'reduced-visibility weather signal');
  else if (/rain|drizzle|showers/.test(text)) add(10, 'precipitation signal');
  const precip = toFiniteOrNull(precipChance);
  if (precip !== null && precip >= 80) add(20, `precip ${Math.round(precip)}%`);
  else if (precip !== null && precip >= 60) add(14, `precip ${Math.round(precip)}%`);
  else if (precip !== null && precip >= 40) add(8, `precip ${Math.round(precip)}%`);
  const effectiveWind = Math.max(toFiniteOrNull(wind) ?? 0, toFiniteOrNull(gust) ?? 0);
  if (effectiveWind >= 45) add(18, `wind/gust ${Math.round(effectiveWind)} mph`);
  else if (effectiveWind >= 35) add(12, `wind/gust ${Math.round(effectiveWind)} mph`);
  else if (effectiveWind >= 25) add(7, `wind/gust ${Math.round(effectiveWind)} mph`);
  const rh = toFiniteOrNull(humidity);
  const cloud = toFiniteOrNull(cloudCover);
  if (rh !== null && cloud !== null && rh >= 92 && cloud >= 92) add(16, 'high humidity + overcast');
  else if (cloud !== null && cloud >= 85) add(5, `cloud cover ${Math.round(cloud)}%`);
  if (isDaytime === false) add(6, 'nighttime contrast reduction');
  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  const level = visibilityLevel(null, bounded);
  return { score: bounded, level, summary: VISIBILITY_SUMMARY[level], factors: factors.slice(0, 3), activeHours: null, windowHours: null, source: 'Derived from selected weather hour' };
};

const buildVisibility = (report, units) => {
  const weather = report?.weather || {};
  const fallback = estimateVisibilityFromPoint({
    description: weather.description,
    precipChance: weather.precipChance,
    wind: weather.windSpeed,
    gust: weather.windGust,
    humidity: weather.humidity,
    cloudCover: weather.cloudCover,
    isDaytime: typeof weather.isDaytime === 'boolean' ? weather.isDaytime : null,
  });
  const provided = weather.visibilityRisk || {};
  const score = toFiniteOrNull(provided.score ?? null);
  const level = visibilityLevel(provided.level ?? null, score);
  const factors = Array.isArray(provided.factors) && provided.factors.length > 0 ? provided.factors.slice(0, 3) : [];
  const risk = {
    score: score ?? fallback.score,
    level: score !== null || level !== 'Unknown' ? level : fallback.level,
    summary: String(provided.summary || '').trim() || fallback.summary,
    factors: factors.length > 0 ? factors : fallback.factors,
    activeHours: toFiniteOrNull(provided.activeHours ?? null),
    windowHours: toFiniteOrNull(provided.windowHours ?? null),
    source: String(provided.source || fallback.source),
  };
  return {
    ...risk,
    detail: localizeUnitText(risk.factors.length > 0 ? risk.factors.join(' • ') : risk.summary, units),
    status: labelStatus(risk.level),
  };
};

const buildPressureTrend = (trendWindow, travelWindowHours) => {
  const pressures = trendWindow.map((point) => toFiniteOrNull(point?.pressure)).filter((value) => value !== null);
  if (pressures.length < 2) return null;
  const start = pressures[0];
  const end = pressures[pressures.length - 1];
  const delta = end - start;
  const direction = delta >= 1 ? 'Rising' : delta <= -1 ? 'Falling' : 'Steady';
  return `${direction} pressure over ${travelWindowHours}h: ${delta > 0 ? '+' : ''}${delta.toFixed(1)} hPa (${start.toFixed(1)} → ${end.toFixed(1)} hPa)`;
};

const validPercent = (value) => typeof value === 'number' && isNum(value) && value >= 0 && value <= 100;

/** Share of daylight forecast hours that are clear and dry; not the chance of a bluebird day. */
const buildBluebird = (points) => {
  const daylight = points.filter((point) => point?.isDaytime === true);
  const complete = daylight.filter((point) => validPercent(point.cloudCover) && validPercent(point.precipChance));
  const clear = complete.filter((point) => point.cloudCover <= 20 && point.precipChance <= 10
    && !/rain|shower|drizzle|snow|sleet|freezing|fog|mist|haze|smoke|thunder|storm|lightning/i.test(point.condition || ''));
  const unknownDaylight = points.some((point) => typeof point?.isDaytime !== 'boolean');
  return {
    percent: !unknownDaylight && daylight.length > 0 && complete.length === daylight.length
      ? Math.round((100 * clear.length) / daylight.length)
      : null,
    daylightHours: daylight.length,
    completeHours: complete.length,
    bluebirdHours: clear.length,
    reason: unknownDaylight
      ? 'Daylight classification is incomplete.'
      : daylight.length === 0
        ? 'No daylight forecast hours are available in this window.'
        : complete.length < daylight.length ? 'Cloud cover or precipitation readings are missing.' : null,
  };
};

/** Daylight from the start (or sunrise, if later) until sunset. */
const buildDaylightFromStart = (report, start) => {
  const startMinutes = parseTimeInputMinutes(start);
  const sunrise = parseSolarClockMinutes(report?.solar?.sunrise);
  const sunset = parseSolarClockMinutes(report?.solar?.sunset);
  if (startMinutes === null || sunrise === null || sunset === null) return { minutes: null, label: 'N/A' };
  const minutes = Math.max(0, sunset - Math.max(startMinutes, sunrise));
  const duration = formatDurationMinutes(minutes);
  return {
    minutes,
    label: startMinutes >= sunset
      ? `${duration} (start is after sunset)`
      : startMinutes < sunrise ? `${duration} (start before sunrise)` : duration,
  };
};

/** The travel window's hourly readings for the weather charts, with feels-like and wind direction in degrees. */
const buildWeatherTrendRows = (trendWindow, timeStyle) => trendWindow.map((point) => {
  const time = String(point?.time || '').trim();
  const minutes = parseTimeInputMinutes(time) ?? parseHourLabelToMinutes(time) ?? parseSolarClockMinutes(point?.time || undefined);
  const temp = toFiniteOrNull(point?.temp);
  const wind = toFiniteOrNull(point?.wind);
  const gust = toFiniteOrNull(point?.gust);
  const directionLabel = normalizeWindHintDirection(point?.windDirection || null);
  return {
    time: point?.time || '',
    label: formatClockForStyle(point?.time || '', timeStyle),
    hourValue: minutes === null ? null : minutesToTwentyFourHourClock(minutes),
    temp,
    feelsLike: temp !== null && wind !== null ? computeFeelsLikeF(temp, wind) : null,
    wind,
    gust: gust ?? wind,
    pressure: toFiniteOrNull(point?.pressure),
    precipChance: toFiniteOrNull(point?.precipChance),
    humidity: toFiniteOrNull(point?.humidity),
    dewPoint: toFiniteOrNull(point?.dewPoint),
    cloudCover: toFiniteOrNull(point?.cloudCover),
    windDirection: directionLabel && directionLabel !== 'CALM' && directionLabel !== 'VRB' ? windDirectionToDegrees(directionLabel) : null,
    windDirectionLabel: directionLabel || null,
  };
});

/**
 * What the report's sources say for this plan, ready to show: every label,
 * tone and sentence in the plan's units.
 *
 * @param {object} report  a /api/safety payload
 * @param {object} context from buildPlanContext
 */
const buildReportInterpretation = (report, context) => {
  const { units, travelWindowHours, nowMs, start } = context;
  const trend = Array.isArray(report?.weather?.trend) ? report.weather.trend : [];
  const trendWindow = trend.slice(0, travelWindowHours);
  const objectiveElevationFt = report?.weather?.elevation;
  const avalanche = buildAvalancheDisplay(report, units);
  const snowpackInsights = buildSnowpackInsights(report?.snowpack, objectiveElevationFt, units.elevation, nowMs);
  // Older reports carried precipitation as rainfallData.
  const rainfall = report?.rainfall && typeof report.rainfall === 'object'
    ? report.rainfall
    : report?.rainfallData && typeof report.rainfallData === 'object' ? report.rainfallData : null;
  return {
    avalanche,
    rainfall: buildRainfallDisplay(rainfall, units, travelWindowHours),
    snowpack: {
      interpretation: buildSnowpackInterpretation(report?.snowpack, objectiveElevationFt, units.elevation, nowMs),
      insights: snowpackInsights,
      ...buildSnowpackDisplay(report, units, snowpackInsights),
    },
    fireRisk: buildFireRiskDisplay(report),
    heatRisk: buildHeatRiskDisplay(report),
    terrainCondition: buildTerrainConditionDisplay(report, units),
    sourceFreshness: buildSourceFreshness(report, avalanche.relevant, travelWindowHours, nowMs),
    visibility: buildVisibility(report, units),
    pressureTrend: buildPressureTrend(trendWindow, travelWindowHours),
    weatherTrend: buildWeatherTrendRows(trendWindow, units.timeStyle),
    bluebird: buildBluebird(trendWindow),
    daylightFromStart: buildDaylightFromStart(report, start),
  };
};

module.exports = {
  buildAvalancheDisplay,
  buildRainfallDisplay,
  buildSnowpackInterpretation,
  buildSnowpackInsights,
  buildSnowpackDisplay,
  buildFireRiskDisplay,
  buildHeatRiskDisplay,
  buildTerrainConditionDisplay,
  buildSourceFreshness,
  estimateVisibilityFromPoint,
  buildVisibility,
  buildPressureTrend,
  buildBluebird,
  buildDaylightFromStart,
  buildWeatherTrendRows,
  buildReportInterpretation,
};
