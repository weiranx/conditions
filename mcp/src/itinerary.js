// A multi-day trip for MCP clients: one /api/safety check per day at that
// night's camp (with the night read there) and at each high point, reduced to
// compact evidence. Mirrors backend/src/routes/itineraries.js and
// backend/src/utils/itinerary-summary.js; this package ships without the
// backend, so the summary is kept here.

const finite = value => (value === null || value === undefined || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value)) ? null : Number(value));
const extreme = (rows, key, pick) => {
  const values = rows.map(row => finite(row?.[key])).filter(value => value !== null);
  return values.length ? pick(...values) : null;
};

export function summarizeReport(report) {
  if (!report || typeof report !== 'object') return null;
  const weather = report.weather || {};
  const trend = Array.isArray(weather.trend) ? weather.trend : [];
  const alerts = Array.isArray(report.alerts?.alerts) ? report.alerts.alerts : [];
  const insufficient = report.safety?.assessmentStatus === 'insufficient_evidence';
  return {
    location: report.location ?? null,
    selectedStartTime: report.forecast?.selectedStartTime ?? null,
    selectedEndTime: report.forecast?.selectedEndTime ?? null,
    elevationFt: finite(weather.elevation),
    safetyScore: insufficient ? null : finite(report.safety?.score),
    assessmentStatus: report.safety?.assessmentStatus ?? null,
    primaryHazard: report.safety?.primaryHazard ?? null,
    weather: {
      description: weather.description ?? null,
      forecastIssuedTime: weather.issuedTime ?? null,
      hoursInWindow: trend.length,
      lowTempF: extreme(trend, 'temp', Math.min),
      highTempF: extreme(trend, 'temp', Math.max),
      minFeelsLikeF: extreme(trend, 'feelsLike', Math.min),
      peakGustMph: extreme(trend, 'gust', Math.max),
      peakPrecipChancePct: extreme(trend, 'precipChance', Math.max),
      hoursMissingGust: trend.filter(row => finite(row?.gust) === null).length,
      hoursMissingPrecipChance: trend.filter(row => finite(row?.precipChance) === null).length,
      thunderstormHours: trend.filter(row => /thunder|t-storm|tstm|lightning/iu.test(String(row?.condition || ''))).length,
    },
    alerts: { status: report.alerts?.status ?? null, activeCount: finite(report.alerts?.activeCount) ?? alerts.length, headlines: alerts.slice(0, 3).map(a => a?.event || a?.headline).filter(Boolean) },
    avalanche: { relevant: report.avalanche?.relevant ?? null, coverageStatus: report.avalanche?.coverageStatus ?? null, dangerLevel: finite(report.avalanche?.dangerLevel), dangerUnknown: report.avalanche?.dangerUnknown ?? null },
    airQuality: { usAqi: finite(report.airQuality?.usAqi), category: report.airQuality?.category ?? null },
    campNight: report.campNight ?? null,
    partialData: report.partialData === true,
    apiWarning: report.apiWarning ?? null,
    generatedAt: report.generatedAt ?? null,
  };
}

const addDays = (date, days) => {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};
const samePlace = (a, b) => Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lon - b.lon) < 1e-5;

/**
 * Check each day in order. A day or high point that fails stays in place with
 * its failure, never dropped: the weak link may be the day that could not be
 * checked.
 */
export async function checkItinerary(api, { start_date: startDate, activity, days }, toFailure) {
  const results = [];
  for (const [index, day] of days.entries()) {
    const date = addDays(startDate, index);
    const last = index === days.length - 1;
    const layover = samePlace(day.from, day.to);
    const base = {
      date,
      start: day.start,
      travel_window_hours: day.travel_hours,
      ...(activity ? { activity } : {}),
      ...(day.from.elevation_ft !== undefined && !layover ? { trailhead_ft: day.from.elevation_ft } : { approach: 'off' }),
    };
    const check = async (point, extra = {}) => {
      try { return { summary: summarizeReport(await api.get('/api/safety', { ...base, lat: point.lat, lon: point.lon, ...extra })) }; }
      catch (error) { return { failure: toFailure(error) }; }
    };
    const camp = await check(day.to, last ? {} : { camp_night: '1' });
    const highPoints = [];
    for (const point of day.high_points ?? []) highPoints.push({ name: point.name ?? null, lat: point.lat, lon: point.lon, ...(await check(point)) });
    results.push({
      day: index + 1,
      date,
      from: day.from,
      to: day.to,
      layover,
      start: day.start,
      travelHours: day.travel_hours,
      endsAt: last ? 'exit' : 'camp',
      ...camp,
      highPoints,
    });
  }
  return results;
}
