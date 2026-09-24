import type { ActivityType, SafetyData, UserPreferences } from './types';

/** Report chapters an activity can reorder; Checks & sources and Gear always close the report. */
export type ActivityChapter = 'forecast' | 'timing' | 'terrain' | 'route';
/** The check cards on the report brief. */
export type ActivityCheck = 'weather' | 'alerts' | 'daylight' | 'terrain' | 'avalanche' | 'air';

/**
 * How a report reads for an activity. Order only: every chapter and check is
 * still shown, and a check that fails is always lifted to the front. The
 * backend weights hazards to match (backend/src/utils/activity-profiles.js).
 */
export interface ActivityReportLens {
  chapters: ActivityChapter[];
  checks: ActivityCheck[];
  /** Short phrase for what leads the report, e.g. "avalanche and snowpack". */
  leads: string | null;
}

export interface ActivityProfile {
  label: string;
  shortLabel: string;
  description: string;
  report: ActivityReportLens;
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
  'mountaineering',
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
    report: {
      chapters: ['forecast', 'timing', 'terrain', 'route'],
      checks: ['weather', 'daylight', 'alerts', 'terrain', 'air', 'avalanche'],
      leads: 'storms and daylight',
    },
    preferencePatch: {
      defaultActivity: 'hiking', maxWindGustMph: 25, maxPrecipChance: 60, minFeelsLikeF: 5, maxFeelsLikeF: 95,
      runnerPaceMinutesPerMile: 30, runnerAscentMinutesPer1000Ft: 45, runnerStopBufferMinutes: 45,
    },
  },
  scrambling: {
    label: 'Exposed scrambling',
    shortLabel: 'Scramble',
    description: 'Hands-on movement where wind, precipitation, and visibility quickly affect consequences.',
    report: {
      chapters: ['forecast', 'timing', 'terrain', 'route'],
      checks: ['weather', 'alerts', 'terrain', 'daylight', 'air', 'avalanche'],
      leads: 'wind, storms and wet rock',
    },
    preferencePatch: {
      defaultActivity: 'scrambling', maxWindGustMph: 20, maxPrecipChance: 45, minFeelsLikeF: 10, maxFeelsLikeF: 90,
      runnerPaceMinutesPerMile: 35, runnerAscentMinutesPer1000Ft: 55, runnerStopBufferMinutes: 60,
    },
  },
  'alpine-climbing': {
    label: 'Alpine climbing',
    shortLabel: 'Alpine',
    description: 'Long, exposed objectives with technical transitions and limited retreat options.',
    report: {
      chapters: ['forecast', 'timing', 'terrain', 'route'],
      checks: ['weather', 'daylight', 'terrain', 'alerts', 'avalanche', 'air'],
      leads: 'wind, storms and daylight',
    },
    preferencePatch: {
      defaultActivity: 'alpine-climbing', maxWindGustMph: 18, maxPrecipChance: 35, minFeelsLikeF: 10, maxFeelsLikeF: 85,
      runnerPaceMinutesPerMile: 40, runnerAscentMinutesPer1000Ft: 65, runnerStopBufferMinutes: 90,
    },
  },
  mountaineering: {
    label: 'Mountaineering',
    shortLabel: 'Mountaineer',
    description: 'Glaciated and high peaks on snow, ice, and rock, with rope teams, altitude, and long summit days.',
    report: {
      chapters: ['forecast', 'terrain', 'timing', 'route'],
      checks: ['weather', 'avalanche', 'terrain', 'daylight', 'alerts', 'air'],
      leads: 'wind, cold and snow conditions',
    },
    preferencePatch: {
      defaultActivity: 'mountaineering', maxWindGustMph: 20, maxPrecipChance: 35, minFeelsLikeF: -5, maxFeelsLikeF: 85,
      runnerPaceMinutesPerMile: 40, runnerAscentMinutesPer1000Ft: 65, runnerStopBufferMinutes: 90,
    },
  },
  'snow-climbing': {
    label: 'Snow climbing',
    shortLabel: 'Snow climb',
    description: 'Snow and glacier objectives where refreeze, warming, and avalanche timing dominate.',
    report: {
      chapters: ['terrain', 'timing', 'forecast', 'route'],
      checks: ['terrain', 'avalanche', 'daylight', 'weather', 'alerts', 'air'],
      leads: 'snow, refreeze and timing',
    },
    preferencePatch: {
      defaultActivity: 'snow-climbing', maxWindGustMph: 20, maxPrecipChance: 40, minFeelsLikeF: 0, maxFeelsLikeF: 85,
      runnerPaceMinutesPerMile: 40, runnerAscentMinutesPer1000Ft: 60, runnerStopBufferMinutes: 90,
    },
  },
  'ski-touring': {
    label: 'Ski touring',
    shortLabel: 'Ski tour',
    description: 'Human-powered snow travel with avalanche exposure and transition time.',
    report: {
      chapters: ['terrain', 'forecast', 'timing', 'route'],
      checks: ['avalanche', 'terrain', 'weather', 'alerts', 'daylight', 'air'],
      leads: 'avalanche and snowpack',
    },
    preferencePatch: {
      defaultActivity: 'ski-touring', maxWindGustMph: 25, maxPrecipChance: 50, minFeelsLikeF: -5, maxFeelsLikeF: 90,
      runnerPaceMinutesPerMile: 30, runnerAscentMinutesPer1000Ft: 50, runnerStopBufferMinutes: 60,
    },
  },
  'trail-running': {
    label: 'Trail running',
    shortLabel: 'Run',
    description: 'Fast summer movement with tighter heat limits and shorter stop buffers.',
    report: {
      chapters: ['forecast', 'timing', 'route', 'terrain'],
      checks: ['weather', 'air', 'daylight', 'alerts', 'terrain', 'avalanche'],
      leads: 'heat, air quality and daylight',
    },
    preferencePatch: {
      defaultActivity: 'trail-running', maxWindGustMph: 30, maxPrecipChance: 50, minFeelsLikeF: 25, maxFeelsLikeF: 85,
      runnerPaceMinutesPerMile: 20, runnerAscentMinutesPer1000Ft: 30, runnerStopBufferMinutes: 30,
    },
  },
  backcountry: {
    label: 'General backcountry',
    shortLabel: 'General',
    description: 'A neutral baseline when the objective does not fit a more specific movement mode.',
    report: {
      chapters: ['forecast', 'timing', 'terrain', 'route'],
      checks: ['weather', 'alerts', 'daylight', 'terrain', 'avalanche', 'air'],
      leads: null,
    },
    preferencePatch: {
      defaultActivity: 'backcountry', maxWindGustMph: 25, maxPrecipChance: 60, minFeelsLikeF: 5, maxFeelsLikeF: 95,
      runnerPaceMinutesPerMile: 30, runnerAscentMinutesPer1000Ft: 45, runnerStopBufferMinutes: 45,
    },
  },
};

export function activityProfile(activity: string | null | undefined): ActivityProfile {
  return (activity && Object.prototype.hasOwnProperty.call(ACTIVITY_PROFILES, activity))
    ? ACTIVITY_PROFILES[activity as ActivityType]
    : ACTIVITY_PROFILES.backcountry;
}

/**
 * The activity a report was generated for. Older reports predate
 * forecast.activity; the preferences saved with them hold it instead.
 */
export function reportActivity(report: {
  safetyData?: Pick<SafetyData, 'forecast'> | null;
  preferences?: Pick<UserPreferences, 'defaultActivity'> | null;
}): ActivityType {
  const activity = report.safetyData?.forecast?.activity ?? report.preferences?.defaultActivity;
  return activity && Object.prototype.hasOwnProperty.call(ACTIVITY_PROFILES, activity) ? activity : 'backcountry';
}

/** Checks in the activity's order, with failing checks lifted to the front so no hazard is buried. */
export function orderActivityChecks<T extends { key: ActivityCheck; over: boolean }>(checks: T[], activity: string | null | undefined): T[] {
  const order = activityProfile(activity).report.checks;
  const rank = (key: ActivityCheck) => {
    const index = order.indexOf(key);
    return index < 0 ? order.length : index;
  };
  return [...checks].sort((a, b) => Number(b.over) - Number(a.over) || rank(a.key) - rank(b.key));
}
