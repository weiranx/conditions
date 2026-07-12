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
  const reasons = [];

  const hasRedFlagWarning = fireAlertEvents.some((alert) => /red flag warning/i.test(String(alert?.event || '')));
  const hasFireWeatherWatch = fireAlertEvents.some((alert) => /fire weather watch/i.test(String(alert?.event || '')));
  const hasWildfireOrSmokeAlert = fireAlertEvents.some((alert) => /wildfire|smoke|air quality/i.test(String(alert?.event || '')));

  if (hasRedFlagWarning) {
    level = Math.max(level, 4);
    reasons.push('Red Flag Warning is active.');
  } else if (hasFireWeatherWatch) {
    level = Math.max(level, 3);
    reasons.push('Fire Weather Watch is active.');
  }

  if (Number.isFinite(tempF) && Number.isFinite(humidity) && Number.isFinite(wind)) {
    if (tempF >= 90 && humidity <= 20 && wind >= 20) {
      level = Math.max(level, 4);
      reasons.push(`Hot/dry/windy pattern (${tempF}F, RH ${humidity}%, wind ${wind} mph).`);
    } else if (tempF >= 80 && humidity <= 25 && wind >= 15) {
      level = Math.max(level, 3);
      reasons.push(`Elevated fire-weather pattern (${tempF}F, RH ${humidity}%, wind ${wind} mph).`);
    } else if (tempF >= 70 && humidity <= 30 && (wind >= 12 || gust >= 20)) {
      level = Math.max(level, 2);
      reasons.push(`Dry and breezy conditions support faster fire spread (${tempF}F, RH ${humidity}%).`);
    }
  }

  if (/smoke|haze/.test(weatherDescription) || (Number.isFinite(usAqi) && usAqi >= 101) || hasWildfireOrSmokeAlert) {
    level = Math.max(level, 2);
    reasons.push('Smoke/air-quality signal may indicate nearby fire activity or transport.');
  } else if (Number.isFinite(usAqi) && usAqi >= 51) {
    level = Math.max(level, 1);
    reasons.push('Moderate AQI could affect exertion tolerance in exposed terrain.');
  }

  const nearestIncident = nearbyIncidents.find((incident) => Number.isFinite(Number(incident?.distanceKm))) || nearbyIncidents[0];
  const nearestIncidentKm = Number(nearestIncident?.distanceKm);
  const nearestDetectionKm = Number(firmsDetections.find((detection) => Number.isFinite(Number(detection?.distanceKm)))?.distanceKm);
  if (Number.isFinite(nearestIncidentKm) && nearestIncidentKm <= 15) {
    level = Math.max(level, 4);
    reasons.push(`Current WFIGS fire perimeter/incident is approximately ${Math.round(nearestIncidentKm)} km away (${nearestIncident?.name || 'unnamed incident'}).`);
  } else if (Number.isFinite(nearestIncidentKm) && nearestIncidentKm <= 50) {
    level = Math.max(level, 3);
    reasons.push(`Current WFIGS fire activity is approximately ${Math.round(nearestIncidentKm)} km away (${nearestIncident?.name || 'unnamed incident'}).`);
  } else if (nearbyIncidents.length > 0) {
    level = Math.max(level, 2);
    reasons.push(`${nearbyIncidents.length} current WFIGS fire incident/perimeter signal(s) are within 150 km.`);
  }
  if (Number.isFinite(nearestDetectionKm) && nearestDetectionKm <= 25) {
    level = Math.max(level, 3);
    reasons.push(`NASA FIRMS detected recent thermal activity approximately ${Math.round(nearestDetectionKm)} km away.`);
  }

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
