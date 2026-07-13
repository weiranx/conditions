import type { ActivityType, UserPreferences } from './types';

export interface ActivityProfile {
  label: string;
  shortLabel: string;
  description: string;
  preferencePatch: Pick<
    UserPreferences,
    | 'defaultActivity'
    | 'maxWindGustMph'
    | 'maxPrecipChance'
    | 'minFeelsLikeF'
    | 'maxFeelsLikeF'
    | 'runnerPaceMinutesPerMile'
    | 'runnerAscentMinutesPer1000Ft'
    | 'runnerStopBufferMinutes'
  >;
}

export const ACTIVITY_PROFILE_ORDER: ActivityType[] = [
  'hiking',
  'scrambling',
  'alpine-climbing',
  'snow-climbing',
  'ski-touring',
  'trail-running',
  'backcountry',
];

export const ACTIVITY_PROFILES: Record<ActivityType, ActivityProfile> = {
  hiking: {
    label: 'Mountain hiking',
    shortLabel: 'Hike',
    description: 'On-trail and off-trail mountain travel without sustained technical climbing.',
    preferencePatch: {
      defaultActivity: 'hiking', maxWindGustMph: 25, maxPrecipChance: 60, minFeelsLikeF: 5, maxFeelsLikeF: 95,
      runnerPaceMinutesPerMile: 30, runnerAscentMinutesPer1000Ft: 45, runnerStopBufferMinutes: 45,
    },
  },
  scrambling: {
    label: 'Exposed scrambling',
    shortLabel: 'Scramble',
    description: 'Hands-on movement where wind, precipitation, and visibility quickly affect consequences.',
    preferencePatch: {
      defaultActivity: 'scrambling', maxWindGustMph: 20, maxPrecipChance: 45, minFeelsLikeF: 10, maxFeelsLikeF: 90,
      runnerPaceMinutesPerMile: 35, runnerAscentMinutesPer1000Ft: 55, runnerStopBufferMinutes: 60,
    },
  },
  'alpine-climbing': {
    label: 'Alpine climbing',
    shortLabel: 'Alpine',
    description: 'Long, exposed objectives with technical transitions and limited retreat options.',
    preferencePatch: {
      defaultActivity: 'alpine-climbing', maxWindGustMph: 18, maxPrecipChance: 35, minFeelsLikeF: 10, maxFeelsLikeF: 85,
      runnerPaceMinutesPerMile: 40, runnerAscentMinutesPer1000Ft: 65, runnerStopBufferMinutes: 90,
    },
  },
  'snow-climbing': {
    label: 'Snow climbing',
    shortLabel: 'Snow climb',
    description: 'Snow and glacier objectives where refreeze, warming, and avalanche timing dominate.',
    preferencePatch: {
      defaultActivity: 'snow-climbing', maxWindGustMph: 20, maxPrecipChance: 40, minFeelsLikeF: 0, maxFeelsLikeF: 85,
      runnerPaceMinutesPerMile: 40, runnerAscentMinutesPer1000Ft: 60, runnerStopBufferMinutes: 90,
    },
  },
  'ski-touring': {
    label: 'Ski touring',
    shortLabel: 'Ski tour',
    description: 'Human-powered snow travel with avalanche exposure and transition time.',
    preferencePatch: {
      defaultActivity: 'ski-touring', maxWindGustMph: 25, maxPrecipChance: 50, minFeelsLikeF: -5, maxFeelsLikeF: 90,
      runnerPaceMinutesPerMile: 30, runnerAscentMinutesPer1000Ft: 50, runnerStopBufferMinutes: 60,
    },
  },
  'trail-running': {
    label: 'Trail running',
    shortLabel: 'Run',
    description: 'Fast summer movement with tighter heat limits and shorter stop buffers.',
    preferencePatch: {
      defaultActivity: 'trail-running', maxWindGustMph: 30, maxPrecipChance: 50, minFeelsLikeF: 25, maxFeelsLikeF: 85,
      runnerPaceMinutesPerMile: 20, runnerAscentMinutesPer1000Ft: 30, runnerStopBufferMinutes: 30,
    },
  },
  backcountry: {
    label: 'General backcountry',
    shortLabel: 'General',
    description: 'A neutral baseline when the objective does not fit a more specific movement mode.',
    preferencePatch: {
      defaultActivity: 'backcountry', maxWindGustMph: 25, maxPrecipChance: 60, minFeelsLikeF: 5, maxFeelsLikeF: 95,
      runnerPaceMinutesPerMile: 30, runnerAscentMinutesPer1000Ft: 45, runnerStopBufferMinutes: 45,
    },
  },
};
