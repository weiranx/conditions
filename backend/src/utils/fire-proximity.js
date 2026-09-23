// Shared distance rules for wildfire incidents and satellite detections, so the
// fire-risk level and the fire-access insight agree on what counts as near.
const FIRE_NEAR_KM = 50;
const KM2_PER_ACRE = 0.00404686;
const MI_PER_KM = 0.621371;

// WFIGS distance is to the ignition point, so subtract twice the radius of a
// circle with the fire's area to allow for an elongated perimeter. Returns
// null when the distance is missing or invalid.
const fireEdgeKm = (item) => {
  const distance = typeof item?.distanceKm === 'number' && Number.isFinite(item.distanceKm) ? item.distanceKm : null;
  if (distance === null || distance < 0) return null;
  const acres = typeof item.acres === 'number' && Number.isFinite(item.acres) ? item.acres : null;
  return Math.max(0, distance - (acres !== null && acres > 0 ? 2 * Math.sqrt(acres * KM2_PER_ACRE / Math.PI) : 0));
};

// Fire with no usable distance counts as near.
const isNearFire = (item) => {
  const edge = fireEdgeKm(item);
  return edge === null || edge <= FIRE_NEAR_KM;
};

module.exports = { FIRE_NEAR_KM, MI_PER_KM, fireEdgeKm, isNearFire };
