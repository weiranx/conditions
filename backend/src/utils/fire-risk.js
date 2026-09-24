const { FIRE_NEAR_KM, MI_PER_KM, fireEdgeKm } = require('./fire-proximity');

// A fire this far contained is no longer spreading freely: closures and smoke
// can remain, but it does not make the area's fire risk high or extreme.
const LARGELY_CONTAINED_PERCENT = 90;
// Active fire this close to the objective is treated as extreme.
const FIRE_EXTREME_KM = 15;

const finiteNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const distanceText = (km) => `${Math.round(km)} km (${Math.round(km * MI_PER_KM)} mi)`;
// WFIGS names are often all capitals ("GARDA FALLS"); read them as names.
const incidentName = (incident) => {
  const name = String(incident?.name || '').trim();
  if (!name) return 'An unnamed fire';
  const readable = name === name.toUpperCase() ? name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : name;
  return /\b(fire|complex)$/i.test(readable) ? `The ${readable}` : `The ${readable} fire`;
};
const isLargelyContained = (incident) => (finiteNumber(incident?.percentContained) ?? -1) >= LARGELY_CONTAINED_PERCENT;

// One sentence naming the fire, its size and containment, and how far away it
// is. WFIGS reports the distance to the fire's origin; for a large fire the
// edge can be much closer, so say so rather than quoting the estimate as fact.
const describeIncident = ({ incident, edgeKm }) => {
  const facts = [
    finiteNumber(incident?.acres) > 0 ? `${Math.round(incident.acres).toLocaleString('en-US')} acres` : null,
    finiteNumber(incident?.percentContained) !== null ? `${Math.round(incident.percentContained)}% contained` : null,
  ].filter(Boolean);
  const reportedKm = finiteNumber(incident?.distanceKm) ?? edgeKm;
  const edgeCloser = reportedKm - edgeKm >= 1;
  const where = edgeCloser
    ? `was reported about ${distanceText(reportedKm)} away; at its size its edge could be ${edgeKm < 1 ? 'at the objective' : `within about ${distanceText(edgeKm)}`}`
    : `is about ${distanceText(reportedKm)} away`;
  return `${incidentName(incident)}${facts.length ? ` (${facts.join(', ')})` : ''} ${where}.`;
};

const createUnavailableFireRiskData = (status = 'unavailable') => ({
  source: 'Derived from NOAA weather, NWS alerts, and air-quality signals',
  status,
  level: null,
  label: 'Unknown',
  guidance: 'Fire-risk guidance is unavailable. Check current closures, incident maps, and official fire-weather products before departure.',
  reasons: ['Fire-risk guidance is unavailable from the current source inputs.'],
  alertsConsidered: [],
  alertsUsed: 0,
});

const buildFireRiskData = ({ weatherData, alertsData, airQualityData, localConditionsData }) => {
  const weatherDescription = String(weatherData?.description || '').toLowerCase();
  const tempF = parseFloat(weatherData?.temp);
  const humidity = parseFloat(weatherData?.humidity);
  const wind = parseFloat(weatherData?.windSpeed);
  const gust = parseFloat(weatherData?.windGust);
  const usAqi = parseFloat(airQualityData?.usAqi);
  const alerts = Array.isArray(alertsData?.alerts) ? alertsData.alerts : [];
  const alertsRelevant = String(alertsData?.status || '') !== 'future_time_not_supported';
  const nearbyIncidents = Array.isArray(localConditionsData?.wildfire?.incidents)
    ? localConditionsData.wildfire.incidents
    : [];
  const firmsDetections = Array.isArray(localConditionsData?.wildfire?.firmsDetections)
    ? localConditionsData.wildfire.firmsDetections
    : [];

  const fireAlertEvents = alertsRelevant
    ? alerts.filter((alert) => /red flag|fire weather|wildfire|smoke|air quality/i.test(String(alert?.event || '')))
    : [];

  let level = 0;
  // Each reason carries the level it supports and what drives it (fire
  // weather, smoke, or fire on the ground), so the strongest comes first.
  const rankedReasons = [];
  const raise = (reasonLevel, driver, reason) => {
    level = Math.max(level, reasonLevel);
    rankedReasons.push({ level: reasonLevel, driver, reason });
  };

  const hasRedFlagWarning = fireAlertEvents.some((alert) => /red flag warning/i.test(String(alert?.event || '')));
  const hasFireWeatherWatch = fireAlertEvents.some((alert) => /fire weather watch/i.test(String(alert?.event || '')));
  const hasWildfireOrSmokeAlert = fireAlertEvents.some((alert) => /wildfire|smoke|air quality/i.test(String(alert?.event || '')));

  if (hasRedFlagWarning) {
    raise(4, 'weather', 'A Red Flag Warning is active.');
  } else if (hasFireWeatherWatch) {
    raise(3, 'weather', 'A Fire Weather Watch is active.');
  }

  if (Number.isFinite(tempF) && Number.isFinite(humidity) && Number.isFinite(wind)) {
    if (tempF >= 90 && humidity <= 20 && wind >= 20) {
      raise(4, 'weather', `Hot, dry, windy fire weather (${tempF}F, RH ${humidity}%, wind ${wind} mph).`);
    } else if (tempF >= 80 && humidity <= 25 && wind >= 15) {
      raise(3, 'weather', `Warm, dry, breezy fire weather (${tempF}F, RH ${humidity}%, wind ${wind} mph).`);
    } else if (tempF >= 70 && humidity <= 30 && (wind >= 12 || gust >= 20)) {
      raise(2, 'weather', `Dry and breezy conditions support faster fire spread (${tempF}F, RH ${humidity}%).`);
    }
  }

  if (/smoke|haze/.test(weatherDescription) || (Number.isFinite(usAqi) && usAqi >= 101) || hasWildfireOrSmokeAlert) {
    raise(2, 'smoke', 'Smoke/air-quality signal may indicate nearby fire activity or transport.');
  } else if (Number.isFinite(usAqi) && usAqi >= 51) {
    raise(1, 'smoke', 'Moderate AQI could affect exertion tolerance in exposed terrain.');
  }

  // Measure incidents to their likely edge; see fire-proximity.js. Only fire
  // that is still spreading raises the level past a caution; incidents beyond
  // FIRE_NEAR_KM are noted but do not raise it to a caution.
  const knownIncidents = nearbyIncidents
    .map((incident) => ({ incident, edgeKm: fireEdgeKm(incident) }))
    .filter((entry) => entry.edgeKm !== null)
    .sort((a, b) => a.edgeKm - b.edgeKm);
  const nearestActive = knownIncidents.find((entry) => !isLargelyContained(entry.incident));
  const nearestContained = knownIncidents.find((entry) => isLargelyContained(entry.incident));
  const nearestIncidentKm = knownIncidents.length ? knownIncidents[0].edgeKm : NaN;
  const unplacedIncidents = nearbyIncidents.length - knownIncidents.length;
  const nearestDetectionKm = Math.min(...firmsDetections.map(fireEdgeKm).filter((value) => value !== null));
  if (nearestActive && nearestActive.edgeKm <= FIRE_EXTREME_KM) {
    raise(4, 'fire', describeIncident(nearestActive));
  } else if (nearestActive && nearestActive.edgeKm <= FIRE_NEAR_KM) {
    raise(3, 'fire', describeIncident(nearestActive));
  } else if (unplacedIncidents > 0) {
    raise(2, 'fire', `${unplacedIncidents} current WFIGS fire incident/perimeter signal(s) within 150 km have no reported location, so they are treated as nearby.`);
  } else if (nearestContained && nearestContained.edgeKm <= FIRE_NEAR_KM) {
    raise(1, 'fire', `${describeIncident(nearestContained)} It is largely contained, but closures and smoke can remain.`);
  } else if (nearbyIncidents.length > 0) {
    raise(1, 'fire', `${nearbyIncidents.length} current WFIGS fire incident/perimeter signal(s) are within 150 km, the nearest approximately ${distanceText(nearestIncidentKm)} away; none are within ${FIRE_NEAR_KM} km.`);
  }
  if (Number.isFinite(nearestDetectionKm) && nearestDetectionKm <= 25) {
    raise(3, 'fire', `NASA FIRMS detected recent thermal activity approximately ${Math.round(nearestDetectionKm)} km away.`);
  }
  rankedReasons.sort((a, b) => b.level - a.level);
  const reasons = rankedReasons.map((entry) => entry.reason);

  const labelMap = ['Low', 'Caution', 'Elevated', 'High', 'Extreme'];
  const guidanceMap = [
    'No strong fire-weather signal appears in current sources. Still check closures before departure and avoid flame or spark-producing activity.',
    'Monitor fire-weather and incident updates, keep more than one exit option, and avoid ignition sources.',
    'Elevated fire conditions are possible. Shorten exposed approaches, identify smoke and closure triggers, and keep a clear exit route.',
    'High fire risk. Choose a shorter objective with multiple exits, use no flame or sparks, and turn around for increasing smoke, wind, or new closures.',
    'Extreme fire risk. Choose another area or time; do not enter fire-affected terrain, and verify closures and evacuation information before travel.',
  ];

  return {
    source: nearbyIncidents.length || firmsDetections.length
      ? 'Derived from NOAA weather, NWS alerts, air quality, NIFC WFIGS, and NASA FIRMS signals'
      : 'Derived from NOAA weather, NWS alerts, and air-quality signals',
    status: 'ok',
    level,
    label: labelMap[level] || 'Low',
    guidance: guidanceMap[level] || guidanceMap[0],
    reasons: reasons.length > 0 ? reasons : [guidanceMap[0]],
    // What sets the level: 'weather' (fire weather or a fire-weather alert),
    // 'fire' (a fire or thermal detection near the objective) or 'smoke'.
    primaryDriver: level > 0 ? rankedReasons[0]?.driver || null : null,
    alertsConsidered: fireAlertEvents.slice(0, 5).map((alert) => ({
      event: alert?.event || 'Alert',
      severity: alert?.severity || 'Unknown',
      expires: alert?.expires || null,
      link: alert?.link || null,
    })),
    alertsUsed: fireAlertEvents.length,
  };
};

module.exports = {
  createUnavailableFireRiskData,
  buildFireRiskData,
};
