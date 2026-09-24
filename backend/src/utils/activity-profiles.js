// How the planned activity shapes the report: the weather limits and route
// timing it starts from, and how it weights hazards. The frontend keeps the
// matching labels and chapter order in frontend/src/app/activity-profiles.ts.
//
// Activity only ever sharpens the assessment: hazard weights are >= 1 and
// avalanche relevance can be switched on, never off. A hazard that matters
// less for one activity is reordered in the UI, not discounted here.

const NEUTRAL_ACTIVITY = 'backcountry';

const ACTIVITY_PROFILES = {
  backcountry: {
    limits: { maxWindGustMph: 25, maxPrecipChance: 60, minFeelsLikeF: 5, maxFeelsLikeF: 95 },
    timing: { paceMinutesPerMile: 30, ascentMinutesPer1000Ft: 45, stopBufferMinutes: 45 },
    label: 'General backcountry',
    focus: null,
    hazardWeights: {},
    snowTravel: false,
  },
  hiking: {
    limits: { maxWindGustMph: 25, maxPrecipChance: 60, minFeelsLikeF: 5, maxFeelsLikeF: 95 },
    timing: { paceMinutesPerMile: 30, ascentMinutesPer1000Ft: 45, stopBufferMinutes: 45 },
    label: 'Mountain hiking',
    focus: 'Lead with thunderstorm timing, daylight margin for the return, and trail surface. Keep snow and avalanche detail brief unless the report shows snow on the route.',
    hazardWeights: {},
    snowTravel: false,
  },
  'trail-running': {
    limits: { maxWindGustMph: 30, maxPrecipChance: 50, minFeelsLikeF: 25, maxFeelsLikeF: 85 },
    timing: { paceMinutesPerMile: 20, ascentMinutesPer1000Ft: 30, stopBufferMinutes: 30 },
    label: 'Trail running',
    focus: 'Lead with heat and apparent temperature, air quality (runners breathe hard for hours), storm timing, and daylight at running pace. Runners carry little gear, so connect cold, wet, and wind to a thin margin if they have to stop.',
    hazardWeights: { Heat: 1.3, 'Air Quality': 1.25, 'Fire-Heat Compound': 1.2 },
    snowTravel: false,
  },
  scrambling: {
    limits: { maxWindGustMph: 20, maxPrecipChance: 45, minFeelsLikeF: 10, maxFeelsLikeF: 90 },
    timing: { paceMinutesPerMile: 35, ascentMinutesPer1000Ft: 55, stopBufferMinutes: 60 },
    label: 'Exposed scrambling',
    focus: 'Lead with gusts on exposed ridges, whether rock will still be wet from recent or forecast rain, the lightning window, and cloud base or visibility. Retreat on scrambling terrain is slow, so stress turnaround times.',
    hazardWeights: { Wind: 1.25, Storm: 1.2, 'Surface Conditions': 1.25, Visibility: 1.15 },
    snowTravel: false,
  },
  'alpine-climbing': {
    limits: { maxWindGustMph: 18, maxPrecipChance: 35, minFeelsLikeF: 10, maxFeelsLikeF: 85 },
    timing: { paceMinutesPerMile: 40, ascentMinutesPer1000Ft: 65, stopBufferMinutes: 90 },
    label: 'Alpine climbing',
    focus: 'Lead with summit-elevation wind, the lightning window, freezing level and overnight refreeze, and rockfall potential from warming. Days are long with limited retreat, so stress daylight margin and turnaround triggers.',
    hazardWeights: { Wind: 1.2, Storm: 1.25, Cold: 1.1, Visibility: 1.15, Darkness: 1.15 },
    snowTravel: false,
  },
  mountaineering: {
    limits: { maxWindGustMph: 20, maxPrecipChance: 35, minFeelsLikeF: -5, maxFeelsLikeF: 85 },
    timing: { paceMinutesPerMile: 40, ascentMinutesPer1000Ft: 65, stopBufferMinutes: 90 },
    label: 'Mountaineering',
    focus: 'Lead with summit wind and wind chill, visibility and whiteout risk, freezing level, and avalanche conditions on snow slopes. Connect cold exposure to frostbite times and a long summit day.',
    hazardWeights: { Wind: 1.2, Cold: 1.2, Visibility: 1.25, 'Winter Weather': 1.15 },
    snowTravel: true,
  },
  'snow-climbing': {
    limits: { maxWindGustMph: 20, maxPrecipChance: 40, minFeelsLikeF: 0, maxFeelsLikeF: 85 },
    timing: { paceMinutesPerMile: 40, ascentMinutesPer1000Ft: 60, stopBufferMinutes: 90 },
    label: 'Snow climbing',
    focus: 'Lead with overnight refreeze, how fast the snow warms after sunrise (it sets the turnaround), sun exposure by aspect, and wet avalanche or cornice concerns. Treat a warm night as a reason for an earlier start or a different objective.',
    hazardWeights: { Heat: 1.2, Snowpack: 1.2, Visibility: 1.1 },
    snowTravel: true,
  },
  'ski-touring': {
    limits: { maxWindGustMph: 25, maxPrecipChance: 50, minFeelsLikeF: -5, maxFeelsLikeF: 90 },
    timing: { paceMinutesPerMile: 30, ascentMinutesPer1000Ft: 50, stopBufferMinutes: 60 },
    label: 'Ski touring',
    focus: 'Lead with the avalanche forecast: danger by elevation, the listed problems with their aspects and elevations, new snow, and wind loading. Then snowpack, visibility for route finding, and cold. Trail and heat details matter little.',
    hazardWeights: {
      Avalanche: 1.15,
      'Avalanche Storm Loading': 1.2,
      'Avalanche Wind Loading': 1.2,
      'Avalanche Uncertainty': 1.2,
      Snowpack: 1.15,
      Visibility: 1.15,
    },
    snowTravel: true,
  },
};

const ACTIVITY_KEYS = Object.keys(ACTIVITY_PROFILES);

// Unknown or missing activities plan as general backcountry.
const normalizeActivity = (value) => {
  const key = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ACTIVITY_PROFILES, key) ? key : NEUTRAL_ACTIVITY;
};

const activityProfile = (value) => ACTIVITY_PROFILES[normalizeActivity(value)];

/** Score multiplier for a hazard under this activity; 1 when it has no special weight. */
const activityHazardWeight = (activity, hazard) => {
  const weight = activityProfile(activity).hazardWeights[hazard];
  return Number.isFinite(weight) && weight > 1 ? weight : 1;
};

/** The weather limits an activity starts from, before the traveler's own. */
const activityLimits = (activity) => ({ ...activityProfile(activity).limits });

const isSnowTravelActivity = (activity) => activityProfile(activity).snowTravel === true;

/** One paragraph telling the AI what this activity cares about, or '' for general plans. */
const describeActivityInstruction = (activity) => {
  const profile = activityProfile(activity);
  if (!profile.focus) return '';
  return `Planned activity: ${profile.label}. Frame the briefing for this activity. ${profile.focus} Every hazard in the report still applies: reorder emphasis, never drop or downplay a reported hazard because of the activity.`;
};

module.exports = {
  ACTIVITY_KEYS,
  ACTIVITY_PROFILES,
  NEUTRAL_ACTIVITY,
  activityHazardWeight,
  activityLimits,
  activityProfile,
  describeActivityInstruction,
  isSnowTravelActivity,
  normalizeActivity,
};
