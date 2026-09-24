'use strict';

// How current each report source is, judged at evaluation time.

/** ISO timestamp → epoch ms. A date alone is midnight UTC; a time without an offset is UTC. */
const parseIsoToMs = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T00:00:00Z`
    : /([zZ]|[+-]\d{2}:\d{2})$/.test(trimmed)
      ? trimmed
      : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(trimmed)
        ? `${trimmed}Z`
        : trimmed;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
};

const pickTimestamp = (values, better) => {
  let picked = null;
  let pickedMs = null;
  for (const value of values) {
    const ms = parseIsoToMs(value);
    if (ms === null) continue;
    if (pickedMs === null || better(ms, pickedMs)) {
      pickedMs = ms;
      picked = value || null;
    }
  }
  return picked;
};

const pickOldestIsoTimestamp = (values) => pickTimestamp(values, (ms, best) => ms < best);
const pickNewestIsoTimestamp = (values) => pickTimestamp(values, (ms, best) => ms > best);

const formatCompactAge = (value, nowMs = Date.now()) => {
  const ms = parseIsoToMs(value);
  if (ms === null) return null;
  const ageMinutes = Math.max(0, Math.round((nowMs - ms) / 60000));
  if (ageMinutes < 60) return `${ageMinutes}m old`;
  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 24) return `${ageHours}h old`;
  return `${Math.floor(ageHours / 24)}d old`;
};

/**
 * How long ago a source was issued ("3h 20m ago"), or when it applies for a
 * source stamped with the forecast hour it describes ("valid in 2h").
 */
const formatAgeFromNow = (value, nowMs = Date.now()) => {
  const ms = parseIsoToMs(value);
  if (ms === null) return 'Unavailable';
  const offsetMinutes = Math.round((nowMs - ms) / 60000);
  const span = (totalMinutes) => {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours === 0 ? `${minutes}m` : minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  };
  if (offsetMinutes < -5) return `valid in ${span(-offsetMinutes)}`;
  return `${span(Math.max(0, offsetMinutes))} ago`;
};

/** fresh within half the stale age, aging up to it, stale after it; missing without a timestamp. */
const freshnessClass = (value, staleHours, nowMs = Date.now()) => {
  const ms = parseIsoToMs(value);
  if (ms === null) return 'missing';
  const ageHours = (nowMs - ms) / 3600000;
  if (ageHours <= staleHours * 0.5) return 'fresh';
  if (ageHours <= staleHours) return 'aging';
  return 'stale';
};

/** SNOTEL reports daily; NOHRSC models hourly. One fresh source keeps snowpack from reading stale. */
const classifySnowpackFreshness = (snotelObservedDate, nohrscSampledTime, nowMs = Date.now()) => {
  const ageHours = (value) => {
    const ms = parseIsoToMs(value);
    return ms === null ? null : (nowMs - ms) / 3600000;
  };
  const classifyByAge = (age, freshHours, agingHours) => {
    if (age === null) return 'missing';
    if (age <= freshHours) return 'fresh';
    if (age <= agingHours) return 'aging';
    return 'stale';
  };
  const states = [
    classifyByAge(ageHours(snotelObservedDate), 60, 120),
    classifyByAge(ageHours(nohrscSampledTime), 8, 24),
  ].filter((state) => state !== 'missing');

  let state;
  if (states.length === 0) state = 'missing';
  else if (!states.includes('stale')) state = states.includes('aging') ? 'aging' : 'fresh';
  else state = states.includes('fresh') || states.includes('aging') ? 'aging' : 'stale';

  const snotelAge = formatCompactAge(snotelObservedDate, nowMs);
  const nohrscAge = formatCompactAge(nohrscSampledTime, nowMs);
  const detail = [nohrscAge ? `NOHRSC ${nohrscAge}` : null, snotelAge ? `SNOTEL ${snotelAge}` : null].filter(Boolean);
  return {
    state,
    referenceTimestamp: pickNewestIsoTimestamp([nohrscSampledTime || null, snotelObservedDate || null]),
    displayValue: detail.length > 0 ? detail.join(' • ') : 'Unavailable',
  };
};

/** The selected travel window in epoch ms, from the forecast period or the requested hours. */
const resolveSelectedTravelWindowMs = (report, fallbackTravelWindowHours) => {
  if (!report) return null;
  const startMs = parseIsoToMs(report.weather?.forecastStartTime || report.forecast?.selectedStartTime || null);
  if (startMs === null) return null;
  const fallbackDurationMs = Math.max(1, Math.round(Number(fallbackTravelWindowHours) || 12)) * 3600000;
  const explicitEndMs = parseIsoToMs(report.forecast?.selectedEndTime || report.weather?.forecastEndTime || null);
  const endMs = explicitEndMs !== null && explicitEndMs > startMs ? explicitEndMs : startMs + fallbackDurationMs;
  return { startMs, endMs };
};

/** True when one alert's validity spans the whole travel window. */
const isTravelWindowCoveredByAlertWindow = (window, alerts) => {
  if (!window || !Array.isArray(alerts) || alerts.length === 0) return false;
  return alerts.some((alert) => {
    const alertStartMs = parseIsoToMs(alert?.onset || alert?.effective || alert?.sent || null);
    const alertEndMs = parseIsoToMs(alert?.ends || alert?.expires || null);
    if (alertStartMs === null && alertEndMs === null) return false;
    const start = alertStartMs ?? Number.NEGATIVE_INFINITY;
    const end = alertEndMs ?? Number.POSITIVE_INFINITY;
    if (end <= start) return false;
    return window.startMs >= start && window.endMs <= end;
  });
};

module.exports = {
  parseIsoToMs,
  pickOldestIsoTimestamp,
  pickNewestIsoTimestamp,
  formatCompactAge,
  formatAgeFromNow,
  freshnessClass,
  classifySnowpackFreshness,
  resolveSelectedTravelWindowMs,
  isTravelWindowCoveredByAlertWindow,
};
