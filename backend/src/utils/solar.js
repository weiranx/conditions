const { normalizeCoordDateKey } = require('./cache');

/**
 * Sunrise, sunset and day length at a point on a date, in the point's local
 * clock (api.sunrisesunset.io), cached per point and date. Dawn is civil
 * twilight, when there is light enough to move without a headlamp. Throws when
 * the service fails; callers decide what to show instead.
 */
const fetchSolarDay = ({ lat, lon, date, solarCache, fetchWithTimeout, fetchOptions }) =>
  solarCache.getOrFetch(normalizeCoordDateKey(lat, lon, date), async () => {
    const res = await fetchWithTimeout(`https://api.sunrisesunset.io/json?lat=${lat}&lng=${lon}&date=${date}`, fetchOptions);
    if (!res.ok) throw new Error(`Solar API returned ${res.status}`);
    const json = await res.json();
    if (json.status !== 'OK') throw new Error('Solar API status not OK');
    return {
      sunrise: json.results.sunrise,
      sunset: json.results.sunset,
      dayLength: json.results.day_length,
      dawn: json.results.dawn || null,
      dusk: json.results.dusk || null,
    };
  });

module.exports = { fetchSolarDay };
