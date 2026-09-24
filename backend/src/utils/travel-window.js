'use strict';

// Hour-by-hour checks of the travel window against the traveler's limits.
//
// Two framings of the same forecast:
//   - reading rows: one per hourly reading, in trend order (the Weather chapter)
//   - planned rows: one per planned hour from the start time, each built from
//     the readings that overlap it (the brief, timing and the day strip)
// With an approach profile, each hour is checked at the elevation the party is
// expected to be at, not at the objective.

const { computeFeelsLikeF } = require('./weather-normalizers');
const {
  clockMinutes,
  convertWindMph,
  dateTimeInputsFor,
  formatClockForStyle,
  formatSnowDepth,
  formatTemperature,
  windSpeedUnitLabel,
  minutesToTwentyFourHourClock,
  parseSolarClockMinutes,
} = require('./display-format');
const {
  adjustPointToElevation,
  adjustReadingForApproach,
  highestElevationBetween,
} = require('./approach-elevation');

const measured = (value) => typeof value === 'number' && Number.isFinite(value);
const numberOrZero = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** Snow depth that makes travel a posthole slog, from the terrain signal or the nearest station. */
const snowDepthForReport = (report) =>
  report?.terrainCondition?.signals?.maxSnowDepthIn
  ?? report?.snowpack?.snotel?.snowDepthIn
  ?? report?.snowpack?.nohrsc?.snowDepthIn
  ?? null;

/**
 * Check each reading against the limits. Legacy semantics: a missing reading
 * reads as zero here; buildReadingRows restores missing values afterwards.
 */
const buildTravelWindowRows = (trend, context, { snowDepthIn = null } = {}) => {
  const { limits, units } = context;
  const rows = (Array.isArray(trend) ? trend : []).map((point) => {
    const gust = numberOrZero(point?.gust);
    const wind = numberOrZero(point?.wind);
    const temp = numberOrZero(point?.temp);
    const feelsLike = computeFeelsLikeF(temp, wind);
    const precipChance = numberOrZero(point?.precipChance);
    const failedRules = [];
    const failedRuleLabels = [];
    const displayGust = Math.round(convertWindMph(gust, units.wind));
    const displayMaxGust = Math.round(convertWindMph(limits.maxWindGustMph, units.wind));
    const displayFeelsLike = formatTemperature(feelsLike, units.temperature);

    if (gust > limits.maxWindGustMph) {
      failedRules.push(`gust ${displayGust}>${displayMaxGust} ${windSpeedUnitLabel(units.wind)}`);
      failedRuleLabels.push('Gust above limit');
    }
    if (precipChance > limits.maxPrecipChance) {
      failedRules.push(`precip ${Math.round(precipChance)}%>${limits.maxPrecipChance}%`);
      failedRuleLabels.push('Precip above limit');
    }
    if (feelsLike < limits.minFeelsLikeF) {
      failedRules.push(`feels ${displayFeelsLike}<${formatTemperature(limits.minFeelsLikeF, units.temperature)}`);
      failedRuleLabels.push('Feels-like below limit');
    }
    if (feelsLike > limits.maxFeelsLikeF) {
      failedRules.push(`feels ${displayFeelsLike}>${formatTemperature(limits.maxFeelsLikeF, units.temperature)}`);
      failedRuleLabels.push('Heat above limit');
    }
    const condition = String(point?.condition || '');
    const condLower = condition.toLowerCase();
    const lightningRisk = /thunder|lightning/.test(condLower);
    if (/thunder|lightning|hail|blizzard/.test(condLower)) {
      failedRules.push(`condition: ${point.condition}`);
      failedRuleLabels.push('Severe weather risk');
    }
    if (Number.isFinite(snowDepthIn) && snowDepthIn >= 12) {
      failedRules.push(`snow depth ${formatSnowDepth(snowDepthIn, units.elevation)}`);
      failedRuleLabels.push('Deep snow / postholing risk');
    }

    return {
      time: point?.time,
      pass: failedRules.length === 0,
      condition: condition.trim() || 'Unknown',
      reasonSummary: failedRules.length === 0 ? 'Meets thresholds' : failedRules.join(' • '),
      failedRules,
      failedRuleLabels,
      temp,
      feelsLike,
      wind,
      gust,
      precipChance,
      lightningRisk,
    };
  });
  return annotateExposure(rows);
};

/**
 * Classify each failing hour by how long the breach lasts. A party is only
 * exposed to a ridge or storm cell for as long as they are in it — an isolated
 * over-threshold hour flanked by clean hours is a brief crossing, whereas a
 * sustained run of breaches is a hard blocker.
 */
const annotateExposure = (rows) => {
  let idx = 0;
  while (idx < rows.length) {
    if (rows[idx].pass) {
      idx += 1;
      continue;
    }
    let end = idx;
    while (end < rows.length && !rows[end].pass) end += 1;
    const runLength = end - idx;
    const exposureClass = runLength <= 1 ? 'brief' : runLength === 2 ? 'short' : 'sustained';
    for (let i = idx; i < end; i += 1) {
      rows[i].exposureRunLength = runLength;
      rows[i].exposureClass = exposureClass;
    }
    idx = end;
  }
  return rows;
};

const adjustTrendForApproach = (report, trend, approach, start) => {
  const plan = {
    start,
    sunriseMinutes: parseSolarClockMinutes(report?.solar?.sunrise),
    sunsetMinutes: parseSolarClockMinutes(report?.solar?.sunset),
  };
  return trend.map((point, index) => adjustReadingForApproach(point, index, approach, plan));
};

/**
 * One row per reading, the first `hours` readings of the trend. Readings keep
 * their gaps: a missing temperature is not 0 °F, nor a missing gust a calm one.
 */
const buildReadingRows = (report, context, hours, approach = null) => {
  const rawTrend = (report?.weather?.trend || []).slice(0, hours);
  const adjustedTrend = approach ? adjustTrendForApproach(report, rawTrend, approach.profile, approach.start) : null;
  const trend = adjustedTrend ?? rawTrend;
  const rows = buildTravelWindowRows(trend, context, { snowDepthIn: snowDepthForReport(report) }).map((row, index) => {
    const point = trend[index];
    const complete = [point.temp, point.wind, point.gust, point.precipChance].every(measured);
    const knownFailures = row.failedRuleLabels.flatMap((label, ruleIndex) => {
      const known = label === 'Gust above limit' ? measured(point.gust)
        : label === 'Precip above limit' ? measured(point.precipChance)
          : label === 'Feels-like below limit' || label === 'Heat above limit' ? measured(point.temp) && measured(point.wind)
            : true;
      return known ? [{ label, reason: row.failedRules[ruleIndex] }] : [];
    });
    const adjusted = adjustedTrend?.[index];
    return {
      ...row,
      ...(adjusted && approach ? {
        elevationFt: adjusted.elevationFt,
        approachAdjusted: adjusted.elevationFt < approach.profile.objectiveElevationFt,
        inversionRisk: adjusted.inversionRisk,
      } : {}),
      temp: measured(point.temp) ? row.temp : Number.NaN,
      wind: measured(point.wind) ? row.wind : Number.NaN,
      feelsLike: measured(point.temp) && measured(point.wind) ? row.feelsLike : Number.NaN,
      gust: measured(point.gust) ? point.gust : Number.NaN,
      precipChance: measured(point.precipChance) ? row.precipChance : Number.NaN,
      complete,
      // Temperature and wind were measured (the legacy row reads a gap as zero).
      thermalComplete: measured(point.temp) && measured(point.wind),
      pass: complete && row.pass,
      failedRules: knownFailures.map((failure) => failure.reason),
      failedRuleLabels: [...knownFailures.map((failure) => failure.label), ...(!complete ? ['Incomplete hourly evidence'] : [])],
      reasonSummary: complete ? row.reasonSummary : [
        'Hourly evidence is incomplete. Verify the missing weather observations.',
        ...knownFailures.map((failure) => failure.reason),
      ].join(' '),
    };
  });
  return annotateExposure(rows);
};

const maxKnown = (values) => {
  const known = values.filter(Number.isFinite);
  return known.length ? Math.max(...known) : Number.NaN;
};

// Keep both cold and heat hazards in the reasons; display the breached
// temperature extreme alongside the largest wind/precipitation readings.
// Missing readings are NaN, so take the extremes from the readings that exist.
const hourReading = (rows, limits) => {
  const thermalRows = rows.filter((row) => Number.isFinite(row.feelsLike));
  const tempRows = rows.filter((row) => Number.isFinite(row.temp));
  const pool = thermalRows.length ? thermalRows : tempRows.length ? tempRows : rows;
  const value = (row) => (Number.isFinite(row.feelsLike) ? row.feelsLike : row.temp);
  const coldest = pool.reduce((a, b) => (value(a) < value(b) ? a : b));
  const hottest = pool.reduce((a, b) => (value(a) > value(b) ? a : b));
  return {
    thermal: value(coldest) < limits.minFeelsLikeF ? coldest : hottest,
    wind: maxKnown(rows.map((row) => row.wind)),
    gust: maxKnown(rows.map((row) => row.gust)),
  };
};

/**
 * One row per planned hour from the start time. Readings are placed at their
 * own clock time instead of treating the first N records as N hours of
 * coverage: an hourly reading covers [timestamp, timestamp + 1h).
 */
const buildPlannedRows = (report, context, hours, plan) => {
  const trend = report?.weather?.trend || [];
  const readings = buildReadingRows(report, context, trend.length);
  const start = clockMinutes(plan.start);
  const planDay = Date.parse(`${plan.date}T00:00:00Z`);
  const timezone = report?.weather?.timezone || null;
  let legacyDay = 0;
  let previousClock = null;
  const timed = trend.map((point, index) => {
    let minute = clockMinutes(point?.time);
    let dayOffset = legacyDay;
    if (point?.timeIso && Number.isFinite(planDay)) {
      // ISO offsets and the objective timezone take precedence over a clock label.
      const local = timezone && /(?:Z|[+-]\d{2}:\d{2})$/.test(point.timeIso)
        ? dateTimeInputsFor(new Date(point.timeIso), timezone)
        : { date: point.timeIso.slice(0, 10), time: point.timeIso.slice(11, 16) };
      minute = clockMinutes(local.time);
      dayOffset = (Date.parse(`${local.date}T00:00:00Z`) - planDay) / 86400000;
    } else if (minute !== null) {
      if ((previousClock !== null && previousClock - minute > 720)
        || (previousClock === null && start !== null && start - minute > 720)) legacyDay += 1;
      dayOffset = legacyDay;
    }
    previousClock = minute;
    return { point, row: readings[index], minute: minute === null ? Number.NaN : dayOffset * 1440 + minute };
  }).sort((a, b) => b.minute - a.minute);
  const approach = plan.approach ?? null;
  const sunriseMinutes = parseSolarClockMinutes(report?.solar?.sunrise);
  const sunsetMinutes = parseSolarClockMinutes(report?.solar?.sunset);

  const rows = Array.from({ length: hours }, (_, index) => {
    const minute = start === null ? Number.NaN : start + index * 60;
    const time = Number.isFinite(minute) ? minutesToTwentyFourHourClock(minute % 1440) : 'Unavailable';
    const end = minute + 60;
    const overlaps = timed.filter((entry) => entry.minute < end && entry.minute + 60 > minute);
    // Check every subinterval, including the part after the final clock-hour
    // boundary. Sampling only the slot's start misses late storms and gaps.
    const boundaries = [...new Set([minute, end, ...overlaps.flatMap((entry) => [
      Math.max(minute, entry.minute), Math.min(end, entry.minute + 60),
    ])])].sort((a, b) => a - b);
    const used = new Set();
    let covered = Number.isFinite(minute);
    for (const boundary of boundaries.slice(0, -1)) {
      const entry = overlaps.find((item) => item.minute <= boundary && boundary < item.minute + 60);
      if (entry) used.add(entry);
      else covered = false;
    }
    const elevationFt = approach && start !== null && Number.isFinite(minute)
      ? highestElevationBetween(approach, minute - start, end - start)
      : null;
    const adjusted = Boolean(approach && elevationFt !== null && elevationFt < approach.objectiveElevationFt);
    const adjustedPoints = adjusted ? [...used].map((entry) => adjustPointToElevation(
      entry.point, approach.objectiveElevationFt, elevationFt,
      { minuteOfDay: entry.minute, sunriseMinutes, sunsetMinutes },
    )) : [];
    const contributing = adjusted
      ? buildReadingRows({ ...report, weather: { ...report.weather, trend: adjustedPoints } }, context, adjustedPoints.length)
      : [...used].map((entry) => entry.row);
    const approachFields = elevationFt === null ? {} : {
      elevationFt: Math.round(elevationFt),
      approachAdjusted: adjusted,
      inversionRisk: adjustedPoints.some((point) => point.inversionRisk),
    };
    if (contributing.length === 0) {
      const missing = { time, temp: Number.NaN, wind: Number.NaN, gust: Number.NaN, precipChance: Number.NaN, condition: 'Unavailable' };
      const row = buildReadingRows({ ...report, weather: { ...report?.weather, trend: [missing] } }, context, 1)[0];
      return { ...row, reasonSummary: 'No hourly forecast covers this planned time. Verify conditions before departure.' };
    }
    const complete = covered && contributing.every((row) => row.complete);
    const thermalComplete = covered && contributing.every((row) => row.thermalComplete);
    const pass = complete && contributing.every((row) => row.pass);
    const failedRules = [...new Set(contributing.flatMap((row) => row.failedRules))];
    const failedRuleLabels = [...new Set([
      ...contributing.flatMap((row) => row.failedRuleLabels),
      ...(!covered ? ['Incomplete hourly coverage'] : []),
    ])];
    const { thermal, wind, gust } = hourReading(contributing, context.limits);
    // Approach hours also keep the summit reading, for views that start from
    // the objective forecast (e.g. elevation bands for the selected hour).
    const summit = adjusted ? hourReading([...used].map((entry) => entry.row), context.limits) : null;
    return {
      ...thermal,
      ...approachFields,
      time,
      complete,
      thermalComplete,
      pass,
      failedRules,
      failedRuleLabels,
      ...(summit ? { objectiveReading: { temp: summit.thermal.temp, wind: summit.wind, gust: summit.gust } } : {}),
      wind,
      gust,
      precipChance: maxKnown(contributing.map((row) => row.precipChance)),
      lightningRisk: contributing.some((row) => row.lightningRisk),
      condition: [...new Set(contributing.map((row) => row.condition))].join(' / '),
      reasonSummary: pass ? 'Meets thresholds' : [
        ...(!covered ? ['Hourly forecast coverage is incomplete for this planned hour.'] : []),
        ...(!contributing.every((row) => row.complete) ? ['Hourly evidence is incomplete. Verify the missing weather observations.'] : []),
        ...failedRules,
      ].join(' '),
    };
  });
  return annotateExposure(rows);
};

// When an hourly row's hour ends: the next row's start, or an hour after the
// last row's start. A span through a 2:30 PM row runs until 3:30 PM.
const rowEndTime = (rows, index) => {
  const next = rows[index + 1]?.time;
  if (next) return next;
  const { time } = rows[index];
  const minutes = clockMinutes(time);
  return minutes === null ? time : minutesToTwentyFourHourClock((minutes + 60) % 1440);
};

const deriveTravelWindowSpans = (rows) => {
  const spans = [];
  let startIndex = -1;
  rows.forEach((row, idx) => {
    if (row.pass && startIndex === -1) startIndex = idx;
    const spanEnded = startIndex !== -1 && (!row.pass || idx === rows.length - 1);
    if (!spanEnded) return;
    const endIndex = row.pass ? idx : idx - 1;
    const length = endIndex - startIndex + 1;
    if (length > 0) spans.push({ start: rows[startIndex].time, end: rowEndTime(rows, endIndex), length });
    startIndex = -1;
  });
  return spans;
};

const formatTravelWindowSpan = (span, timeStyle) => {
  const start = formatClockForStyle(span.start, timeStyle);
  return span.length <= 1 ? `${start} only` : `${start} to ${formatClockForStyle(span.end, timeStyle)}`;
};

const conditionTrend = (rows) => {
  if (rows.length === 0) {
    return {
      conditionTrendLabel: 'Unavailable',
      conditionTrendSummary: 'No hourly weather condition labels available in this travel window.',
    };
  }
  const startCondition = rows[0].condition;
  const endCondition = rows[rows.length - 1].condition;
  const counts = new Map();
  rows.forEach((row) => {
    const label = String(row.condition || '').trim() || 'Unknown';
    const key = label.toLowerCase();
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { label, count: 1 });
  });
  const dominant = [...counts.values()].sort((a, b) => (b.count === a.count ? a.label.localeCompare(b.label) : b.count - a.count))[0];
  if (startCondition.toLowerCase() === endCondition.toLowerCase()) {
    return {
      conditionTrendLabel: 'Stable conditions',
      conditionTrendSummary: `${startCondition} remains the primary condition (${dominant.count}/${rows.length}h).`,
    };
  }
  return {
    conditionTrendLabel: `${startCondition} → ${endCondition}`,
    conditionTrendSummary: `Conditions shift across the window; most frequent: ${dominant.label} (${dominant.count}/${rows.length}h).`,
  };
};

const riskTrend = (rows) => {
  if (rows.length < 2) {
    return {
      trendDirection: 'steady',
      trendStrength: 'slight',
      trendDelta: 0,
      trendLabel: 'Steady',
      trendSummary: 'Not enough hourly rows to classify improving vs worsening trend.',
    };
  }
  const riskScores = rows.map((row) => {
    if (row.pass) return 0;
    let score = Math.max(1, row.failedRuleLabels.length);
    row.failedRuleLabels.forEach((label) => {
      const normalized = String(label || '').toLowerCase();
      if (normalized.includes('gust') || normalized.includes('wind')) score += 1.1;
      if (normalized.includes('precip')) score += 1.0;
      if (normalized.includes('feels-like') || normalized.includes('cold')) score += 0.8;
      if (normalized.includes('heat')) score += 1.0;
      if (normalized.includes('snow') || normalized.includes('posthol')) score += 0.8;
      if (normalized.includes('lightning') || normalized.includes('severe')) score += 1.5;
    });
    return score;
  });
  const segmentHours = Math.max(2, Math.min(6, Math.floor(rows.length / 3) || 2));
  const avg = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
  const delta = avg(riskScores.slice(-segmentHours)) - avg(riskScores.slice(0, segmentHours));
  const absDelta = Math.abs(delta);
  const strength = absDelta >= 2 ? 'strong' : absDelta >= 1.1 ? 'moderate' : 'slight';
  if (delta >= 0.6) {
    return {
      trendDirection: 'worsening',
      trendStrength: strength,
      trendDelta: delta,
      trendLabel: `Worsening (${strength})`,
      trendSummary: `Risk trend worsens from first ${segmentHours}h to last ${segmentHours}h.`,
    };
  }
  if (delta <= -0.6) {
    return {
      trendDirection: 'improving',
      trendStrength: strength,
      trendDelta: delta,
      trendLabel: `Improving (${strength})`,
      trendSummary: `Risk trend improves from first ${segmentHours}h to last ${segmentHours}h.`,
    };
  }
  return {
    trendDirection: 'steady',
    trendStrength: strength,
    trendDelta: delta,
    trendLabel: 'Steady',
    trendSummary: `Risk trend is mostly steady across first/last ${segmentHours}h segments.`,
  };
};

/** Pass hours, the best continuous window, the most common failures and the risk trend. */
const buildTravelWindowInsights = (rows, timeStyle = 'ampm') => {
  const trend = riskTrend(rows);
  const base = { ...trend, ...conditionTrend(rows) };
  if (rows.length === 0) {
    return {
      passHours: 0,
      failHours: 0,
      bestWindow: null,
      nextCleanWindow: null,
      topFailureLabels: [],
      ...base,
      summary: 'No hourly trend data available for travel-window analysis.',
    };
  }
  const passHours = rows.filter((row) => row.pass).length;
  const failHours = rows.length - passHours;
  const spans = deriveTravelWindowSpans(rows);
  const bestWindow = spans.length > 0
    ? spans.slice().sort((a, b) => (b.length === a.length ? a.start.localeCompare(b.start) : b.length - a.length))[0]
    : null;
  const nextCleanWindow = spans.length > 0 ? spans[0] : null;
  const failureCounts = new Map();
  rows.filter((row) => !row.pass).forEach((row) => {
    row.failedRuleLabels.forEach((label) => failureCounts.set(label, (failureCounts.get(label) || 0) + 1));
  });
  const topFailureLabels = [...failureCounts.entries()]
    .sort((a, b) => (b[1] === a[1] ? a[0].localeCompare(b[0]) : b[1] - a[1]))
    .slice(0, 3)
    .map(([label, count]) => `${label} (${count}h)`);
  const insights = { passHours, failHours, bestWindow, nextCleanWindow, topFailureLabels, ...base };

  if (passHours === 0) {
    return {
      ...insights,
      summary: `No clean travel window in the next ${rows.length} hours under current thresholds. ${trend.trendSummary}`,
    };
  }
  if (!bestWindow) {
    return { ...insights, summary: `Passing ${passHours}/${rows.length} hours. ${trend.trendSummary}` };
  }
  const baseSummary = `Passing ${passHours}/${rows.length} hours. Best continuous window: ${formatTravelWindowSpan(bestWindow, timeStyle)} (${bestWindow.length}h).`;
  if (nextCleanWindow && nextCleanWindow.start !== rows[0].time) {
    return {
      ...insights,
      summary: `${baseSummary} First clean hour starts at ${formatClockForStyle(nextCleanWindow.start, timeStyle)}. ${trend.trendSummary}`,
    };
  }
  return { ...insights, summary: `${baseSummary} ${trend.trendSummary}` };
};

module.exports = {
  snowDepthForReport,
  buildTravelWindowRows,
  annotateExposure,
  buildReadingRows,
  buildPlannedRows,
  deriveTravelWindowSpans,
  formatTravelWindowSpan,
  buildTravelWindowInsights,
};
