const { toFiniteOrNull } = require('./numbers');
const { haversineKm } = require('./geo');

const buildAirNowUrl = ({ lat, lon, apiKey, now = Date.now() }) => {
  const padLat = 75 / 111;
  const padLon = Math.min(180, padLat / Math.max(0.1, Math.cos(lat * Math.PI / 180)));
  const params = new URLSearchParams({
    startDate: new Date(now - 3 * 3600000).toISOString().slice(0, 13), endDate: new Date(now).toISOString().slice(0, 13),
    parameters: 'PM25,PM10,OZONE', BBOX: [Math.max(-180, lon - padLon), Math.max(-90, lat - padLat), Math.min(180, lon + padLon), Math.min(90, lat + padLat)].join(','),
    dataType: 'B', format: 'application/json', verbose: '1', monitorType: '0', includerawconcentrations: '0', API_KEY: apiKey,
  });
  return `https://www.airnowapi.org/aq/data/?${params}`;
};
const parseAirNowObservations = (rows, { lat, lon, now = Date.now() }) => {
  const latest = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const aqi = toFiniteOrNull(row.AQI);
    const latitude = toFiniteOrNull(row.Latitude), longitude = toFiniteOrNull(row.Longitude);
    const utc = typeof row.UTC === 'string' ? row.UTC : '';
    const observedTime = utc ? (/Z$|[+-]\d\d:\d\d$/.test(utc) ? utc : `${utc}Z`) : null;
    const time = Date.parse(observedTime);
    if (aqi === null || aqi < 0 || latitude === null || longitude === null || !Number.isFinite(time) || now - time > 3 * 3600000 || time > now + 300000) continue;
    const distanceKm = haversineKm(lat, lon, latitude, longitude);
    if (distanceKm > 75) continue;
    const key = `${row.FullAQSCode || `${latitude},${longitude}`}:${row.Parameter}`;
    if (!latest.has(key) || time > Date.parse(latest.get(key).observedTime)) latest.set(key, {
      parameter: row.Parameter || null, aqi: Math.round(aqi), category: null,
      reportingArea: row.SiteName || null, latitude, longitude, distanceKm: Math.round(distanceKm * 10) / 10,
      observedTime, observedDate: observedTime.slice(0, 10), observedHour: new Date(time).getUTCHours(), localTimeZone: 'UTC',
    });
  }
  return [...latest.values()];
};
module.exports = { buildAirNowUrl, parseAirNowObservations };
