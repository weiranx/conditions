const { parseIsoTimeToMs, clampTravelWindowHours } = require('./time');
const { buildSunClock } = require('./daylight');
const { AFTER_WINDOW_HOURS, measureNight, mergeRows, selectNight } = require('./contingency');

// A planned night at camp: the first night after the day's travel ends, at the
// point the day was checked (the camp). The contingency module reads the same
// night as an unplanned bivy; here the party has a shelter and a sleep system,
// so the thresholds are about a hard night rather than survival.

const HOUR = 3600000;

// Below this the night is cold for a three-season bag; at or below the second
// it is past what most carry.
const COLD_CAMP_FEELS_LIKE_F = 25;
const VERY_COLD_CAMP_FEELS_LIKE_F = 0;
// Gusts that test a staked tent, and gusts that flatten one.
const WINDY_CAMP_GUST_MPH = 30;
const SEVERE_CAMP_GUST_MPH = 45;
const WET_NIGHT_PRECIP_CHANCE = 50;

const UNAVAILABLE_SUMMARY = 'No forecast covers the night at camp yet.';

const round = (value) => Math.round(value);

const classifyCampNight = ({ minFeelsLikeF, peakGustMph, peakPrecipChance, storm, freezingRain, snow }) => {
  const reasonCodes = [];
  if (freezingRain) reasonCodes.push('freezingRain');
  if (storm) reasonCodes.push('storm');
  if (Number.isFinite(peakGustMph) && peakGustMph >= SEVERE_CAMP_GUST_MPH) reasonCodes.push('severeWind');
  else if (Number.isFinite(peakGustMph) && peakGustMph >= WINDY_CAMP_GUST_MPH) reasonCodes.push('windyCamp');
  if (Number.isFinite(minFeelsLikeF) && minFeelsLikeF <= VERY_COLD_CAMP_FEELS_LIKE_F) reasonCodes.push('veryCold');
  else if (Number.isFinite(minFeelsLikeF) && minFeelsLikeF <= COLD_CAMP_FEELS_LIKE_F) reasonCodes.push('coldNight');
  if (Number.isFinite(peakPrecipChance) && peakPrecipChance >= WET_NIGHT_PRECIP_CHANCE) reasonCodes.push('wetNight');
  if (snow && !freezingRain) reasonCodes.push('snow');

  const high = ['freezingRain', 'storm', 'severeWind', 'veryCold'];
  const severity = reasonCodes.some((code) => high.includes(code))
    ? 'high'
    : reasonCodes.length > 0
      ? 'moderate'
      : 'low';
  return { severity, reasonCodes };
};

/**
 * The night at camp after a day of travel that starts at `selectedStartTime`
 * and lasts `selectedTravelWindowHours`. Readings the forecast lacks stay
 * null and are listed in `missing`; a night the forecast only partly covers
 * is `complete: false`. Neither is ever reported as a settled night.
 */
const buildCampNight = ({
  weatherData,
  selectedStartTime,
  selectedTravelWindowHours,
  solarData = null,
}) => {
  const windowHours = clampTravelWindowHours(selectedTravelWindowHours ?? 12, 12);
  const startIso = selectedStartTime || weatherData?.forecastStartTime || null;
  const startMs = parseIsoTimeToMs(startIso);
  const trend = Array.isArray(weatherData?.trend) ? weatherData.trend : [];
  const afterWindowTrend = Array.isArray(weatherData?.afterWindowTrend) ? weatherData.afterWindowTrend : [];
  const elevationFt = Number.isFinite(Number(weatherData?.elevation)) && weatherData?.elevation !== null ? Number(weatherData.elevation) : null;
  const unavailable = (summary) => ({
    status: 'unavailable',
    arrivalIso: Number.isFinite(startMs) ? new Date(startMs + windowHours * HOUR).toISOString() : null,
    elevationFt,
    summary,
  });
  if (startMs === null || trend.length === 0) return unavailable(UNAVAILABLE_SUMMARY);

  const arrivalMs = startMs + windowHours * HOUR;
  const sun = buildSunClock({ solarData, timeZone: weatherData?.timezone, anchorIso: startIso });
  const night = selectNight({ allRows: mergeRows(trend, afterWindowTrend), returnMs: arrivalMs, sun });
  if (night.error) return unavailable(UNAVAILABLE_SUMMARY);

  const measured = measureNight(night.rows);
  if (measured.coveredHours <= 0) return unavailable(UNAVAILABLE_SUMMARY);

  // Unknown when the rows run out before morning and the sun's times are missing.
  const nightHours = night.complete === true ? Math.round(((night.endMs - night.startMs) / HOUR) * 10) / 10 : null;
  const missing = [
    measured.lowTempF === null ? 'temperature' : null,
    measured.peakGustMph === null ? 'gust' : null,
    measured.peakPrecipChance === null ? 'precipitation' : null,
  ].filter(Boolean);
  const { severity, reasonCodes } = classifyCampNight(measured);
  const complete = night.complete === true && missing.length === 0;

  const conditions = [
    Number.isFinite(measured.minFeelsLikeF) ? `feels like ${round(measured.minFeelsLikeF)}°F at the coldest` : null,
    Number.isFinite(measured.peakGustMph) && measured.peakGustMph >= 20 ? `gusts to ${round(measured.peakGustMph)} mph` : null,
    Number.isFinite(measured.peakPrecipChance) && measured.peakPrecipChance >= 30 ? `${round(measured.peakPrecipChance)}% precipitation chance` : null,
    measured.storm ? 'thunderstorms' : null,
    measured.freezingRain ? 'freezing rain' : null,
    measured.snow && !measured.freezingRain ? 'snow' : null,
  ].filter(Boolean);
  const lead = severity === 'high'
    ? 'A serious night at camp'
    : severity === 'moderate'
      ? 'A hard night at camp'
      : complete
        ? 'The night at camp looks settled'
        : 'Nothing stands out in the forecast so far';
  // Without the sun's times the night's true length is unknown once the rows run out.
  const coverage = night.complete === true
    ? ''
    : ` The forecast ends ${measured.coveredHours} h into the night, before morning.`;
  const gaps = missing.length ? ` No ${missing.join(' or ')} forecast for the night.` : '';

  return {
    status: 'ok',
    arrivalIso: new Date(arrivalMs).toISOString(),
    startIso: new Date(night.startMs).toISOString(),
    endIso: new Date(night.endMs).toISOString(),
    elevationFt,
    nightHours,
    complete,
    missing,
    ...measured,
    severity,
    reasonCodes,
    summary: `${lead}${conditions.length ? `: ${conditions.join(', ')}` : ''}.${coverage}${gaps}`,
  };
};

module.exports = {
  AFTER_WINDOW_HOURS,
  COLD_CAMP_FEELS_LIKE_F,
  SEVERE_CAMP_GUST_MPH,
  VERY_COLD_CAMP_FEELS_LIKE_F,
  WET_NIGHT_PRECIP_CHANCE,
  WINDY_CAMP_GUST_MPH,
  buildCampNight,
  classifyCampNight,
};
