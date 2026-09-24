const { parseIsoTimeToMs, clampTravelWindowHours } = require('./time');
const { selectForecastIntervals } = require('./report-evidence');
const { computeFeelsLikeF } = require('./weather-normalizers');
const { buildSunClock } = require('./daylight');

const HOUR = 3600000;

// Hours after the planned return to look at when the party runs late:
// a quarter of the trip, at least 2 h and at most 6 h.
const DELAY_BUFFER_MIN_HOURS = 2;
const DELAY_BUFFER_MAX_HOURS = 6;
const DELAY_BUFFER_FRACTION = 0.25;
// A night that begins later than this after the return is not "tonight".
const OVERNIGHT_SEARCH_HOURS = 14;
// Rows past the travel window the weather pipeline keeps for this module:
// enough to reach the latest qualifying nightfall and see the whole night.
const AFTER_WINDOW_HOURS = 30;
const LONG_DAY_HOURS = 8;
const NEAR_DARK_HOURS = 2;
const COLD_NIGHT_FEELS_LIKE_F = 32;

const STORM_PATTERN = /thunder|lightning|t-storm|tstm/i;
const FREEZING_RAIN_PATTERN = /freezing rain|freezing drizzle|ice storm|glaze/i;
const SNOW_PATTERN = /snow|sleet|blizzard|flurr|wintry/i;

// Ordered by consequence. Same thresholds as the safety score's window checks.
const DELAY_HAZARDS = [
  { key: 'storm', label: 'Thunderstorms', test: (row) => STORM_PATTERN.test(row.condition) },
  { key: 'freezingRain', label: 'Freezing rain', test: (row) => FREEZING_RAIN_PATTERN.test(row.condition) },
  { key: 'severeWind', label: 'Severe wind', test: (row) => row.wind >= 30 || row.gust >= 45 },
  { key: 'heavyPrecip', label: 'Likely precipitation', test: (row) => row.precipChance >= 60 },
  { key: 'extremeCold', label: 'Extreme cold', test: (row) => row.feelsLike <= 0 },
];

const finite = (value) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return Number.NaN;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
};

const normalizeRow = (row) => {
  const temp = finite(row?.temp);
  const wind = finite(row?.wind);
  const gustRaw = finite(row?.gust);
  const explicitFeelsLike = finite(row?.feelsLike);
  const derivedFeelsLike = computeFeelsLikeF(temp, Number.isFinite(wind) ? wind : 0);
  return {
    ...row,
    temp,
    wind,
    gust: Number.isFinite(gustRaw) ? gustRaw : wind,
    precipChance: finite(row?.precipChance),
    feelsLike: Number.isFinite(explicitFeelsLike) ? explicitFeelsLike : finite(derivedFeelsLike),
    condition: String(row?.condition || ''),
  };
};

const extremum = (rows, key, mode) => {
  const values = rows.map((row) => row[key]).filter(Number.isFinite);
  if (!values.length) return null;
  return mode === 'min' ? Math.min(...values) : Math.max(...values);
};

const totalHours = (rows) => Math.round(rows.reduce((sum, row) => sum + (row.hours || 0), 0) * 100) / 100;
const rowStartMs = (row) => parseIsoTimeToMs(row?.timeIso);
const toIso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const roundHours = (ms) => Math.round((ms / HOUR) * 10) / 10;

const describeOnset = (hoursAfterReturn) => (hoursAfterReturn < 0.5
  ? 'right at your planned return'
  : `from about ${hoursAfterReturn} h after your planned return`);

const resolveDelayBufferHours = (travelWindowHours) => Math.min(
  DELAY_BUFFER_MAX_HOURS,
  Math.max(DELAY_BUFFER_MIN_HOURS, Math.ceil(travelWindowHours * DELAY_BUFFER_FRACTION)),
);

// De-duplicate rows by start time: the travel-window trend and the rows kept
// past it can overlap by one partial hour when the start is off the hour.
const mergeRows = (trend, afterWindowTrend) => {
  const byStart = new Map();
  [...(Array.isArray(trend) ? trend : []), ...(Array.isArray(afterWindowTrend) ? afterWindowTrend : [])]
    .forEach((row) => {
      const start = rowStartMs(row);
      if (start !== null && !byStart.has(start)) byStart.set(start, row);
    });
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
};

// When dark falls within `bufferHours` of a return made in daylight. With the
// sun's times this is sunset itself; otherwise the first row the forecast flags
// as night, which for NOAA is a fixed 6 PM rather than sunset.
const findNightfall = ({ sun, windowRows, bufferRows, returnMs, bufferHours }) => {
  if (sun) {
    if (sun.isDarkAt(returnMs - 1)) return null;
    const sunsetMs = sun.nextSunset(returnMs);
    return sunsetMs < returnMs + bufferHours * HOUR
      ? { onsetIso: toIso(sunsetMs), hoursAfterReturn: roundHours(sunsetMs - returnMs) }
      : null;
  }
  const windowEndsInDaylight = windowRows.length > 0 && windowRows[windowRows.length - 1].isDaytime === true;
  const firstDarkRow = windowEndsInDaylight ? bufferRows.find((row) => row.isDaytime === false) : null;
  return firstDarkRow
    ? { onsetIso: toIso(Math.max(returnMs, rowStartMs(firstDarkRow) ?? returnMs)), hoursAfterReturn: roundHours(Math.max(0, (rowStartMs(firstDarkRow) ?? returnMs) - returnMs)) }
    : null;
};

const buildDelayBuffer = ({ allRows, windowRows, returnMs, bufferHours, sun = null }) => {
  const bufferRows = selectForecastIntervals(allRows, toIso(returnMs), bufferHours).map(normalizeRow);
  const coveredHours = totalHours(bufferRows);
  const hazardsInWindow = new Set(
    DELAY_HAZARDS.filter((hazard) => windowRows.some(hazard.test)).map((hazard) => hazard.key),
  );
  const onsetHazards = DELAY_HAZARDS
    .filter((hazard) => !hazardsInWindow.has(hazard.key))
    .map((hazard) => {
      const firstRow = bufferRows.find(hazard.test);
      if (!firstRow) return null;
      // A row that started inside the window only counts from the return time.
      const onsetMs = Math.max(returnMs, rowStartMs(firstRow) ?? returnMs);
      return {
        key: hazard.key,
        label: hazard.label,
        onsetIso: toIso(onsetMs),
        hoursAfterReturn: roundHours(onsetMs - returnMs),
      };
    })
    .filter(Boolean);

  const nightfall = findNightfall({ sun, windowRows, bufferRows, returnMs, bufferHours });

  const parts = onsetHazards.map((hazard) => `${hazard.label.toLowerCase()} ${describeOnset(hazard.hoursAfterReturn)}`);
  if (nightfall) parts.push(`darkness ${describeOnset(nightfall.hoursAfterReturn)}`);
  const summary = coveredHours <= 0
    ? `No forecast covers the ${bufferHours} h after your planned return.`
    : parts.length
      ? `If you're delayed up to ${bufferHours} h, expect ${parts.join('; ')}.`
      : `If you're delayed up to ${bufferHours} h, the forecast adds no new hazards.`;

  return {
    hours: bufferHours,
    startIso: toIso(returnMs),
    endIso: toIso(returnMs + bufferHours * HOUR),
    coveredHours,
    complete: coveredHours >= bufferHours - 0.01,
    minFeelsLikeF: extremum(bufferRows, 'feelsLike', 'min'),
    peakGustMph: extremum(bufferRows, 'gust', 'max'),
    peakPrecipChance: extremum(bufferRows, 'precipChance', 'max'),
    onsetHazards,
    nightfall,
    summary,
  };
};

const classifyOvernightSeverity = ({ minFeelsLikeF, peakGustMph, peakPrecipChance, storm, freezingRain }) => {
  const fl = Number.isFinite(minFeelsLikeF) ? minFeelsLikeF : null;
  const gust = Number.isFinite(peakGustMph) ? peakGustMph : 0;
  const precip = Number.isFinite(peakPrecipChance) ? peakPrecipChance : 0;
  if (freezingRain || (fl !== null && (fl <= 10 || (fl <= 40 && precip >= 50) || (fl <= 25 && gust >= 35)))) return 'high';
  if (storm || precip >= 50 || gust >= 30 || (fl !== null && fl <= COLD_NIGHT_FEELS_LIKE_F)) return 'moderate';
  return 'low';
};

const NO_NIGHT_SUMMARY = 'No night falls soon after your planned return within the forecast range.';

// The first night after the return: from sunset (or the return, if it is
// already dark) to the next sunrise, and the forecast rows that cover it.
const selectNight = ({ allRows, returnMs, sun }) => {
  if (sun) {
    const startMs = sun.isDarkAt(returnMs) ? returnMs : sun.nextSunset(returnMs);
    if (startMs - returnMs > OVERNIGHT_SEARCH_HOURS * HOUR) return { error: NO_NIGHT_SUMMARY };
    const endMs = sun.nextSunrise(startMs);
    const rows = selectForecastIntervals(allRows, toIso(startMs), (endMs - startMs) / HOUR).map(normalizeRow);
    if (!rows.length) return { error: NO_NIGHT_SUMMARY };
    return { startMs, endMs, rows, complete: totalHours(rows) >= (endMs - startMs) / HOUR - 0.01 };
  }
  const afterReturn = selectForecastIntervals(allRows, toIso(returnMs), AFTER_WINDOW_HOURS).map(normalizeRow);
  if (!afterReturn.some((row) => typeof row.isDaytime === 'boolean')) {
    return { error: 'Day/night timing is unavailable, so the overnight scenario could not be built.' };
  }
  const nightStartIndex = afterReturn.findIndex((row) => row.isDaytime === false);
  const startMs = nightStartIndex >= 0 ? Math.max(returnMs, rowStartMs(afterReturn[nightStartIndex]) ?? returnMs) : null;
  if (nightStartIndex < 0 || startMs - returnMs > OVERNIGHT_SEARCH_HOURS * HOUR) return { error: NO_NIGHT_SUMMARY };
  const nightEndOffset = afterReturn.slice(nightStartIndex).findIndex((row) => row.isDaytime === true);
  const rows = nightEndOffset < 0 ? afterReturn.slice(nightStartIndex) : afterReturn.slice(nightStartIndex, nightStartIndex + nightEndOffset);
  const lastRow = rows[rows.length - 1];
  const endMs = nightEndOffset < 0
    ? (rowStartMs(lastRow) ?? startMs) + (lastRow?.hours || 1) * HOUR
    : rowStartMs(afterReturn[nightStartIndex + nightEndOffset]);
  return { startMs, endMs, rows, complete: nightEndOffset >= 0 };
};

const buildOvernight = ({ allRows, returnMs, windowHours, winterTerrain, sun = null }) => {
  const night = selectNight({ allRows, returnMs, sun });
  if (night.error) {
    return { status: 'unavailable', relevant: false, reasons: [], reasonCodes: [], summary: night.error };
  }
  const { startMs: nightStartMs, endMs: nightEndMs, rows: nightRows } = night;
  const coveredHours = totalHours(nightRows);

  const lowTempF = extremum(nightRows, 'temp', 'min');
  const minFeelsLikeF = extremum(nightRows, 'feelsLike', 'min');
  const peakWindMph = extremum(nightRows, 'wind', 'max');
  const peakGustMph = extremum(nightRows, 'gust', 'max');
  const peakPrecipChance = extremum(nightRows, 'precipChance', 'max');
  const precipHours = totalHours(nightRows.filter((row) => row.precipChance >= 50));
  const storm = nightRows.some((row) => STORM_PATTERN.test(row.condition));
  const freezingRain = nightRows.some((row) => FREEZING_RAIN_PATTERN.test(row.condition));
  const snow = nightRows.some((row) => SNOW_PATTERN.test(row.condition));
  const severity = classifyOvernightSeverity({ minFeelsLikeF, peakGustMph, peakPrecipChance, storm, freezingRain });

  const hoursToDark = roundHours(nightStartMs - returnMs);
  // Codes for clients that format units themselves; text for everything else.
  const reasonCodes = [];
  const reasons = [];
  if (windowHours >= LONG_DAY_HOURS) {
    reasonCodes.push('longDay');
    reasons.push(`Long day (${windowHours} h)`);
  }
  if (hoursToDark <= NEAR_DARK_HOURS) {
    reasonCodes.push('nearDark');
    reasons.push(hoursToDark <= 0 ? 'Return is after dark' : `Return is ${hoursToDark} h before dark`);
  }
  if (Number.isFinite(minFeelsLikeF) && minFeelsLikeF <= COLD_NIGHT_FEELS_LIKE_F) {
    reasonCodes.push('coldNight');
    reasons.push(`Night feels like ${Math.round(minFeelsLikeF)}°F`);
  }
  if (winterTerrain) {
    reasonCodes.push('winterTerrain');
    reasons.push('Snow or avalanche terrain');
  }

  const conditions = [
    Number.isFinite(minFeelsLikeF) ? `feels like ${Math.round(minFeelsLikeF)}°F at the coldest` : null,
    Number.isFinite(peakGustMph) && peakGustMph >= 20 ? `gusts to ${Math.round(peakGustMph)} mph` : null,
    Number.isFinite(peakPrecipChance) && peakPrecipChance >= 30 ? `${Math.round(peakPrecipChance)}% precipitation chance` : null,
    storm ? 'thunderstorms' : null,
    freezingRain ? 'freezing rain' : null,
    snow && !freezingRain ? 'snow' : null,
  ].filter(Boolean);
  const lead = severity === 'high'
    ? 'An unplanned night would be serious'
    : severity === 'moderate'
      ? 'An unplanned night would be cold or wet'
      : 'An unplanned night looks manageable';
  const summary = `${lead}${conditions.length ? `: ${conditions.join(', ')}` : ''}.`;

  return {
    status: coveredHours > 0 ? 'ok' : 'unavailable',
    relevant: reasons.length > 0,
    reasons,
    reasonCodes,
    startIso: toIso(nightStartMs),
    endIso: toIso(nightEndMs),
    complete: night.complete,
    coveredHours,
    hoursToDark,
    lowTempF,
    minFeelsLikeF,
    peakWindMph,
    peakGustMph,
    peakPrecipChance,
    precipHours,
    storm,
    freezingRain,
    snow,
    severity,
    summary,
  };
};

// Snow on the ground or a relevant avalanche forecast: a night out is harder to
// survive and a slow descent is more likely.
const WINTER_SNOW_DEPTH_IN = 6;
const isWinterTerrain = ({ avalancheData, snowpackData } = {}) => {
  if (avalancheData?.relevant === true) return true;
  const depths = [
    snowpackData?.snotelConsensus?.medianDepthIn,
    snowpackData?.snotel?.snowDepthIn,
    snowpackData?.nohrsc?.snowDepthIn,
    snowpackData?.cdec?.snowDepthIn,
  ].map(finite).filter(Number.isFinite);
  return depths.length > 0 && Math.max(...depths) >= WINTER_SNOW_DEPTH_IN;
};

/**
 * What the weather does if the party is late: the hours right after the
 * planned return (delay buffer) and the first night after it (overnight).
 * Informational by design. Only the delay buffer's new-hazard onset feeds
 * the safety score, and only when the contingencyPlanning flag is on.
 */
const buildContingencyAssessment = ({
  weatherData,
  selectedStartTime,
  selectedTravelWindowHours,
  winterTerrain = false,
  solarData = null,
}) => {
  const windowHours = clampTravelWindowHours(selectedTravelWindowHours ?? 12, 12);
  const startIso = selectedStartTime || weatherData?.forecastStartTime || null;
  const startMs = parseIsoTimeToMs(startIso);
  const trend = Array.isArray(weatherData?.trend) ? weatherData.trend : [];
  const afterWindowTrend = Array.isArray(weatherData?.afterWindowTrend) ? weatherData.afterWindowTrend : [];
  if (startMs === null || trend.length === 0) {
    return {
      status: 'unavailable',
      plannedReturnIso: null,
      delayBuffer: null,
      overnight: null,
      summary: 'Forecast timing is unavailable, so late-return scenarios could not be built.',
    };
  }
  const returnMs = startMs + windowHours * HOUR;
  const allRows = mergeRows(trend, afterWindowTrend);
  const windowRows = selectForecastIntervals(trend, startIso, windowHours).map(normalizeRow);
  const sun = buildSunClock({ solarData, timeZone: weatherData?.timezone, anchorIso: startIso });
  const delayBuffer = buildDelayBuffer({ allRows, windowRows, returnMs, bufferHours: resolveDelayBufferHours(windowHours), sun });
  const overnight = buildOvernight({ allRows, returnMs, windowHours, winterTerrain: Boolean(winterTerrain), sun });
  const coverage = delayBuffer.coveredHours > 0 || overnight.status === 'ok';

  return {
    status: coverage ? 'ok' : 'unavailable',
    plannedReturnIso: toIso(returnMs),
    delayBuffer,
    overnight,
    summary: [delayBuffer.summary, overnight.relevant && overnight.status === 'ok' ? overnight.summary : null].filter(Boolean).join(' '),
  };
};

module.exports = {
  AFTER_WINDOW_HOURS,
  DELAY_HAZARDS,
  buildContingencyAssessment,
  classifyOvernightSeverity,
  describeOnset,
  isWinterTerrain,
  resolveDelayBufferHours,
};
