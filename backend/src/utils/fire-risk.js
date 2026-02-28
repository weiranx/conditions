const createUnavailableFireRiskData = (status = 'unavailable') => ({
  source: 'Derived from NOAA weather, NWS alerts, and air-quality signals',
  status,
  level: null,
  label: 'Unknown',
  guidance: 'Fire risk signal unavailable.',
  reasons: ['Fire risk signal unavailable.'],
  alertsConsidered: [],
  alertsUsed: 0,
});

const buildFireRiskData = ({ weatherData, alertsData, airQualityData }) => {
  const weatherDescription = String(weatherData?.description || '').toLowerCase();
  const tempF = parseFloat(weatherData?.temp);
  const humidity = parseFloat(weatherData?.humidity);
  const wind = parseFloat(weatherData?.windSpeed);
  const gust = parseFloat(weatherData?.windGust);
  const usAqi = parseFloat(airQualityData?.usAqi);
  const alerts = Array.isArray(alertsData?.alerts) ? alertsData.alerts : [];
  const alertsRelevant = String(alertsData?.status || '') !== 'future_time_not_supported';

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

  const labelMap = ['Low', 'Guarded', 'Elevated', 'High', 'Extreme'];
  const guidanceMap = [
    'No strong fire-weather signal from current sources.',
    'Monitor updates; keep route options flexible.',
    'Avoid committing to long, exposed approaches; identify smoke/egress contingencies.',
    'Conservative plan advised: shorter objective, hard turn-around rules, and active monitoring.',
    'Do not commit to exposed objective windows in fire-prone terrain.',
  ];

  return {
    source: 'Derived from NOAA weather, NWS alerts, and air-quality signals',
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
