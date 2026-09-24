'use strict';

// The plan a report is evaluated for: start time, travel window, the
// traveler's weather limits, display units and approach. Read from a
// /api/safety query or a /api/evaluate body; both use the same flat keys:
//
//   date=2026-07-15            forecast date
//   start=07:00                departure (24-hour clock)
//   travel_window_hours=10     hours from departure to return
//   activity=hiking            sets default limits when none are given
//   max_gust_mph=25            weather limits (each optional)
//   max_precip_chance=60
//   min_feels_like_f=5
//   max_feels_like_f=95
//   temp_unit=f|c  wind_unit=mph|kph  elevation_unit=ft|m  time_style=ampm|24h
//   approach=off | trailhead_ft | ascent_min_per_kft | approach_route
//
// Invalid optional values fall back to defaults rather than failing the request.

const { clampTravelWindowHours, parseStartClock } = require('./time');
const { normalizeUnits, minutesToTwentyFourHourClock, parseTimeInputMinutes } = require('./display-format');
const { activityLimits, normalizeActivity } = require('./activity-profiles');
const { parseApproachQuery, resolveApproach } = require('./approach-elevation');
const { toFiniteOrNull } = require('./numbers');

const LIMIT_PARAMS = {
  maxWindGustMph: { key: 'max_gust_mph', min: 10, max: 80 },
  maxPrecipChance: { key: 'max_precip_chance', min: 0, max: 100 },
  minFeelsLikeF: { key: 'min_feels_like_f', min: -40, max: 60 },
  maxFeelsLikeF: { key: 'max_feels_like_f', min: 70, max: 120 },
};

const UNIT_PARAMS = {
  temperature: 'temp_unit',
  wind: 'wind_unit',
  elevation: 'elevation_unit',
  timeStyle: 'time_style',
};

/** Every key the plan reads; anything else in a query (lat, lon, name) is not part of the plan. */
const PLAN_PARAM_KEYS = [
  'date',
  'start',
  'travel_window_hours',
  'activity',
  ...Object.values(LIMIT_PARAMS).map((param) => param.key),
  ...Object.values(UNIT_PARAMS),
  'approach',
  'trailhead_ft',
  'ascent_min_per_kft',
  'approach_route',
  'target_elevation_ft',
];

const DEFAULT_START = '07:00';

const text = (value) => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '');

/**
 * The plan keys exactly as the client sent them, as strings. Echoed back with
 * the evaluation so a client can tell which plan it was evaluated for without
 * repeating the backend's normalization.
 */
const pickPlanParams = (source = {}) => {
  const params = {};
  for (const key of PLAN_PARAM_KEYS) {
    const value = text(source?.[key]);
    if (value) params[key] = value;
  }
  return params;
};

const parseLimit = (raw, { min, max }, fallback) => {
  const value = text(raw);
  if (!value) return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Number(Math.max(min, Math.min(max, numeric)).toFixed(2));
};

/**
 * Normalize plan params. `report` supplies what the plan can fall back to or
 * needs for the approach: the forecast date, objective elevation and bands.
 */
const buildPlanContext = (source = {}, report = null, options = {}) => {
  const params = pickPlanParams(source);
  const activity = normalizeActivity(params.activity);
  const defaults = activityLimits(activity);
  const limits = Object.fromEntries(Object.entries(LIMIT_PARAMS).map(([name, param]) => [
    name,
    parseLimit(params[param.key], param, defaults[name]),
  ]));
  limits.maxPrecipChance = Math.round(limits.maxPrecipChance);
  const units = normalizeUnits(Object.fromEntries(Object.entries(UNIT_PARAMS).map(([name, key]) => [name, params[key]])));
  const start = parseStartClock(params.start || '')
    || parseStartClock(report?.forecast?.requestedStartTime || '')
    || DEFAULT_START;
  const travelWindowHours = clampTravelWindowHours(params.travel_window_hours ?? null, 12);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date || '')
    ? params.date
    : report?.forecast?.selectedDate || null;
  // Like the report's daylight check, a return after midnight is checked as
  // 23:59 on the start day; wrapping it to the next morning would pass it.
  const startMinutes = parseTimeInputMinutes(start);
  const turnaroundTime = options.withTurnaround === false || startMinutes === null
    ? null
    : minutesToTwentyFourHourClock(Math.min(startMinutes + travelWindowHours * 60, 1439));
  // A what-if elevation to estimate conditions at, in feet.
  const targetElevation = toFiniteOrNull(params.target_elevation_ft ?? null);
  const targetElevationFt = targetElevation !== null && targetElevation >= 0 && targetElevation <= 30000 ? targetElevation : null;
  const approachRequest = parseApproachQuery(params);
  const resolvedApproach = report ? resolveApproach({ approachRequest, weatherData: report.weather, solarData: report.solar }) : null;

  return {
    params,
    date,
    start,
    travelWindowHours,
    turnaroundTime,
    activity,
    limits,
    units,
    approachRequest,
    // { profile, sunriseMinutes, sunsetMinutes } for comfort scoring; profile alone for the checks.
    resolvedApproach,
    approach: resolvedApproach?.profile ?? null,
    targetElevationFt,
    ignoreAvalancheForDecision: options.ignoreAvalancheForDecision === true,
    nowMs: options.nowMs ?? Date.now(),
  };
};

module.exports = {
  LIMIT_PARAMS,
  PLAN_PARAM_KEYS,
  pickPlanParams,
  buildPlanContext,
};
