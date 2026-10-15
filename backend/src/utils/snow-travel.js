'use strict';

const { isSnowTravelActivity } = require('./activity-profiles');

// Surfaces the terrain classification reads as snow or ice underfoot.
const SNOW_SURFACES = new Set(['snow_fresh_powder', 'spring_snow', 'wet_snow', 'snow_ice', 'snow_mixed']);

/**
 * Whether snow on the ground shapes this trip, and why: the activity travels on
 * snow, the surface is expected to be snow or ice, or the avalanche forecast
 * applies to the objective. Only then does a satellite image of snow cover earn
 * a place in the AI read; a dry summer hike gets none.
 *
 * Reasons: 'snow_travel_activity', 'snow_surface', 'avalanche_terrain'.
 */
const assessSnowTravel = (report, activity = report?.forecast?.activity) => {
  const reasons = [];
  if (isSnowTravelActivity(activity)) reasons.push('snow_travel_activity');
  if (SNOW_SURFACES.has(report?.terrainCondition?.code)) reasons.push('snow_surface');
  if (report?.avalanche?.relevant === true) reasons.push('avalanche_terrain');
  return { consequential: reasons.length > 0, reasons };
};

module.exports = { SNOW_SURFACES, assessSnowTravel };
