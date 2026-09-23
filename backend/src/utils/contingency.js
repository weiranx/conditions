const { parseIsoTimeToMs, clampTravelWindowHours } = require('./time');
const { selectForecastIntervals } = require('./report-evidence');
const { computeFeelsLikeF } = require('./weather-normalizers');

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

const buildDelayBuffer = ({ allRows, windowRows, returnMs, bufferHours }) => {
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

  const windowEndsInDaylight = windowRows.length > 0 && windowRows[windowRows.length - 1].isDaytime === true;
  const firstDarkRow = windowEndsInDaylight ? bufferRows.find((row) => row.isDaytime === false) : null;
  const nightfall = firstDarkRow
    ? { onsetIso: toIso(Math.max(returnMs, rowStartMs(firstDarkRow) ?? returnMs)), hoursAfterReturn: roundHours(Math.max(0, (rowStartMs(firstDarkRow) ?? returnMs) - returnMs)) }
    : null;

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

const buildOvernight = ({ allRows, returnMs, windowHours, winterTerrain }) => {
  const afterReturn = selectForecastIntervals(allRows, toIso(returnMs), AFTER_WINDOW_HOURS).map(normalizeRow);
  const hasDayFlags = afterReturn.some((row) => typeof row.isDaytime === 'boolean');
  if (!hasDayFlags) {
    return { status: 'unavailable', relevant: false, reasons: [], reasonCodes: [], summary: 'Day/night timing is unavailable, so the overnight scenario could not be built.' };
  }
  const nightStartIndex = afterReturn.findIndex((row) => row.isDaytime === false);
  const nightStartMs = nightStartIndex >= 0 ? Math.max(returnMs, rowStartMs(afterReturn[nightStartIndex]) ?? returnMs) : null;
  if (nightStartIndex < 0 || nightStartMs - returnMs > OVERNIGHT_SEARCH_HOURS * HOUR) {
    return { status: 'unavailable', relevant: false, reasons: [], reasonCodes: [], summary: 'No night falls soon after your planned return within the forecast range.' };
  }
  const nightEndOffset = afterReturn.slice(nightStartIndex).findIndex((row) => row.isDaytime === true);
  const nightRows = nightEndOffset < 0 ? afterReturn.slice(nightStartIndex) : afterReturn.slice(nightStartIndex, nightStartIndex + nightEndOffset);
  const lastNightRow = nightRows[nightRows.length - 1];
  const nightEndMs = nightEndOffset < 0 ? null : rowStartMs(afterReturn[nightStartIndex + nightEndOffset]);
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
    endIso: nightEndMs !== null ? toIso(nightEndMs) : toIso((rowStartMs(lastNightRow) ?? nightStartMs) + (lastNightRow?.hours || 1) * HOUR),
    complete: nightEndOffset >= 0,
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
  const delayBuffer = buildDelayBuffer({ allRows, windowRows, returnMs, bufferHours: resolveDelayBufferHours(windowHours) });
  const overnight = buildOvernight({ allRows, returnMs, windowHours, winterTerrain: Boolean(winterTerrain) });
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
