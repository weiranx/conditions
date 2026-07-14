/**
 * Local, location-dependent supplemental signals (Tier B):
 *   - River / streamflow (USGS NWIS)
 *   - Smoke / PM2.5 outlook (Open-Meteo Air Quality, forward-looking)
 *   - Tides (NOAA CO-OPS)
 *   - Road / trailhead closures (NPS alerts + USFS road status)
 *   - Nearby quality-controlled surface observations (NOAA/NWS/MADIS)
 *   - Radar/QPE nowcast (NOAA MRMS + NWS RFC)
 *   - Current wildfire activity (NIFC WFIGS + optional NASA FIRMS)
 *
 * This module holds the pure classification + assembly helpers (no network).
 * Fetching lives in local-conditions-fetch.js.
 */

const toFiniteOrNull = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

/**
 * Classify the direction of a flow/level time series.
 * Compares the mean of the most recent third against the mean of the oldest
 * third; ~8% relative change is the threshold for rising/falling.
 */
const classifyFlowTrend = (values) => {
  const series = (Array.isArray(values) ? values : [])
    .map(toFiniteOrNull)
    .filter((v) => v !== null);
  if (series.length < 4) {
    return 'unknown';
  }
  const third = Math.max(1, Math.floor(series.length / 3));
  const mean = (arr) => arr.reduce((sum, v) => sum + v, 0) / arr.length;
  const earliest = mean(series.slice(0, third));
  const latest = mean(series.slice(-third));
  if (earliest === 0) {
    return latest > 0 ? 'rising' : 'steady';
  }
  const change = (latest - earliest) / Math.abs(earliest);
  if (change >= 0.08) return 'rising';
  if (change <= -0.08) return 'falling';
  return 'steady';
};

// EPA PM2.5 category breakpoints (µg/m³).
const categorizePm25 = (pm25) => {
  const pm = toFiniteOrNull(pm25);
  if (pm === null) return null;
  if (pm <= 12) return 'Good';
  if (pm <= 35.4) return 'Moderate';
  if (pm <= 55.4) return 'Unhealthy for Sensitive Groups';
  if (pm <= 150.4) return 'Unhealthy';
  if (pm <= 250.4) return 'Very Unhealthy';
  return 'Hazardous';
};

/**
 * Reduce a CO-OPS hi/lo prediction list to the next high and next low after
 * `nowMs`, plus the inferred current direction.
 * Predictions: [{ t: "YYYY-MM-DD HH:mm", v: "5.23", type: "H"|"L" }]
 */
const summarizeTides = (predictions, nowMs = Date.now()) => {
  const rows = (Array.isArray(predictions) ? predictions : [])
    .map((p) => {
      // CO-OPS times are local station time without a zone; treat as local.
      const ms = Date.parse(String(p?.t || '').replace(' ', 'T'));
      return {
        ms,
        timeIso: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
        rawTime: p?.t || null,
        heightFt: toFiniteOrNull(p?.v),
        type: String(p?.type || '').toUpperCase(),
      };
    })
    .filter((row) => Number.isFinite(row.ms) && (row.type === 'H' || row.type === 'L'))
    .sort((a, b) => a.ms - b.ms);

  const upcoming = rows.filter((row) => row.ms >= nowMs);
  const nextHigh = upcoming.find((row) => row.type === 'H') || null;
  const nextLow = upcoming.find((row) => row.type === 'L') || null;

  let direction = 'unknown';
  const nextEvent = upcoming[0];
  if (nextEvent) {
    direction = nextEvent.type === 'H' ? 'rising' : 'falling';
  }

  const shape = (row) => (row ? { timeIso: row.timeIso, rawTime: row.rawTime, heightFt: row.heightFt } : null);
  return { nextHigh: shape(nextHigh), nextLow: shape(nextLow), direction };
};

const CLOSURE_CATEGORIES = ['park closure', 'danger', 'caution'];

/**
 * Keep alerts that affect access/safety (closures, dangers, cautions) and
 * normalize them to a compact shape.
 */
const filterClosureAlerts = (alerts, { limit = 6 } = {}) => {
  const list = Array.isArray(alerts) ? alerts : [];
  const normalized = list.map((alert) => ({
    title: String(alert?.title || '').trim(),
    category: String(alert?.category || '').trim(),
    description: String(alert?.description || '').trim(),
    url: alert?.url || null,
    lastIndexedDate: alert?.lastIndexedDate || null,
  }));
  const ranked = normalized
    .filter((alert) => alert.title && CLOSURE_CATEGORIES.includes(alert.category.toLowerCase()))
    .sort((a, b) => {
      const aClosure = CLOSURE_CATEGORIES.includes(a.category.toLowerCase()) ? 0 : 1;
      const bClosure = CLOSURE_CATEGORIES.includes(b.category.toLowerCase()) ? 0 : 1;
      return aClosure - bClosure;
    });
  return ranked.slice(0, limit);
};

/**
 * Bundle the four provider results into one `localConditions` payload section.
 * Each provider degrades to null independently.
 */
const buildLocalConditions = ({
  streamflow,
  smoke,
  tides,
  closures,
  weatherObservation,
  radar,
  access,
  wildfire,
  generatedTime,
} = {}) => ({
  streamflow: streamflow || null,
  smoke: smoke || null,
  tides: tides || null,
  closures: closures || null,
  weatherObservation: weatherObservation || null,
  radar: radar || null,
  access: access || null,
  wildfire: wildfire || null,
  hasAnySignal: Boolean(
    (streamflow && streamflow.available) ||
      (smoke && smoke.available) ||
      (tides && tides.available) ||
      (closures && closures.available) ||
      (weatherObservation && weatherObservation.available) ||
      (radar && radar.available) ||
      (access && access.available) ||
      (wildfire && wildfire.available),
  ),
  generatedTime: generatedTime || new Date().toISOString(),
});

module.exports = {
  toFiniteOrNull,
  classifyFlowTrend,
  categorizePm25,
  summarizeTides,
  filterClosureAlerts,
  buildLocalConditions,
};
