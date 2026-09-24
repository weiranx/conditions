'use strict';

// Built-in activities: the weather limits and route timing each one starts from.

const ACTIVITY_PROFILE_ORDER = [
  'hiking',
  'scrambling',
  'alpine-climbing',
  'mountaineering',
  'snow-climbing',
  'ski-touring',
  'trail-running',
  'backcountry',
];

const profile = (limits, timing) => ({ limits, timing });

const ACTIVITY_PROFILES = {
  hiking: profile(
    { maxWindGustMph: 25, maxPrecipChance: 60, minFeelsLikeF: 5, maxFeelsLikeF: 95 },
    { paceMinutesPerMile: 30, ascentMinutesPer1000Ft: 45, stopBufferMinutes: 45 },
  ),
  scrambling: profile(
    { maxWindGustMph: 20, maxPrecipChance: 45, minFeelsLikeF: 10, maxFeelsLikeF: 90 },
    { paceMinutesPerMile: 35, ascentMinutesPer1000Ft: 55, stopBufferMinutes: 60 },
  ),
  'alpine-climbing': profile(
    { maxWindGustMph: 18, maxPrecipChance: 35, minFeelsLikeF: 10, maxFeelsLikeF: 85 },
    { paceMinutesPerMile: 40, ascentMinutesPer1000Ft: 65, stopBufferMinutes: 90 },
  ),
  mountaineering: profile(
    { maxWindGustMph: 20, maxPrecipChance: 35, minFeelsLikeF: -5, maxFeelsLikeF: 85 },
    { paceMinutesPerMile: 40, ascentMinutesPer1000Ft: 65, stopBufferMinutes: 90 },
  ),
  'snow-climbing': profile(
    { maxWindGustMph: 20, maxPrecipChance: 40, minFeelsLikeF: 0, maxFeelsLikeF: 85 },
    { paceMinutesPerMile: 40, ascentMinutesPer1000Ft: 60, stopBufferMinutes: 90 },
  ),
  'ski-touring': profile(
    { maxWindGustMph: 25, maxPrecipChance: 50, minFeelsLikeF: -5, maxFeelsLikeF: 90 },
    { paceMinutesPerMile: 30, ascentMinutesPer1000Ft: 50, stopBufferMinutes: 60 },
  ),
  'trail-running': profile(
    { maxWindGustMph: 30, maxPrecipChance: 50, minFeelsLikeF: 25, maxFeelsLikeF: 85 },
    { paceMinutesPerMile: 20, ascentMinutesPer1000Ft: 30, stopBufferMinutes: 30 },
  ),
  backcountry: profile(
    { maxWindGustMph: 25, maxPrecipChance: 60, minFeelsLikeF: 5, maxFeelsLikeF: 95 },
    { paceMinutesPerMile: 30, ascentMinutesPer1000Ft: 45, stopBufferMinutes: 45 },
  ),
};

const DEFAULT_ACTIVITY = 'backcountry';

const normalizeActivity = (value) => {
  const key = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ACTIVITY_PROFILES, key) ? key : DEFAULT_ACTIVITY;
};

const activityLimits = (activity) => ({ ...ACTIVITY_PROFILES[normalizeActivity(activity)].limits });

module.exports = {
  ACTIVITY_PROFILE_ORDER,
  ACTIVITY_PROFILES,
  DEFAULT_ACTIVITY,
  normalizeActivity,
  activityLimits,
};
