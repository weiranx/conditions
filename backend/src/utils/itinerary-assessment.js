'use strict';

// A checked multi-day itinerary: each day's decision at its camp and high
// points, each night at camp, and the trip verdict. The trip is only as good
// as its weakest day or night, so nothing here is averaged or ranked, and a
// day or night that could not be checked is never counted as a good one.

const { buildPlanContext } = require('./plan-context');
const { buildTripDay } = require('./trip-days');
const { toFiniteOrNull } = require('./numbers');

/** Beyond this many days out, hourly forecasts lose most of their skill. */
const LOW_CONFIDENCE_DAYS_AHEAD = 5;
const DECISION_RANK = { 'NO-GO': 0, CAUTION: 1, GO: 2 };
const EARTH_RADIUS_MILES = 3958.8;

const completeHour = (point) =>
  [point?.temp, point?.wind, point?.gust, point?.precipChance].every((value) => toFiniteOrNull(value) !== null);

const daysBetween = (from, to) => {
  const start = Date.parse(`${from}T12:00:00Z`);
  const end = Date.parse(`${to}T12:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 86400000) : 0;
};

const straightLineMiles = (a, b) => {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLon = toRadians(b.lon - a.lon);
  const h = Math.sin(deltaLat / 2) ** 2
    + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(deltaLon / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

/** The closest way out of a camp: a bail point, the trailhead or the exit, in a straight line. */
const nearestExit = (camp, exits) => exits.reduce((best, point) => {
  const miles = straightLineMiles(camp, point);
  return !best || miles < best.miles ? { name: point.name || null, lat: point.lat, lon: point.lon, miles: Math.round(miles * 10) / 10 } : best;
}, null);

/** A camp night as the trip reads it; anything not covered is unknown, never settled. */
const nightState = (data, dayChecked) => {
  if (!dayChecked || !data) return 'unavailable';
  if (data.status !== 'ok') return 'not-forecast';
  if (data.severity === 'high') return 'serious';
  if (data.severity === 'moderate') return 'hard';
  return data.complete ? 'settled' : 'incomplete';
};

// A day's decision at one point, with the traveler's limits over that day's hours.
const assessPoint = (report, stage, planSettings, activity) => {
  if (!report) return null;
  const context = buildPlanContext({
    ...planSettings,
    date: stage.date,
    start: stage.start,
    travel_window_hours: String(stage.travelHours),
    activity,
  }, report, { withTurnaround: false });
  const { rankValue: _rank, rankable: _rankable, ...day } = buildTripDay(report, context);
  return day;
};

const linkName = (link) => (link.kind === 'day' ? `Day ${link.index + 1}` : `Night ${link.index + 1}`);

/** The verdict's headline: the weak link, named, and why. */
const verdictHeadline = ({ level, weakLink, links }) => {
  if (level === 'INCOMPLETE') {
    const first = links.find((link) => link.rank >= 4) || weakLink;
    return first
      ? { title: `${linkName(first)} can't be cleared yet`, reason: first.reason }
      : { title: "Part of the trip can't be cleared yet", reason: null };
  }
  if (!weakLink || level === 'GO') {
    const hardNight = links.find((link) => link.kind === 'night' && link.rank === 3);
    return {
      title: 'Every day is within your limits',
      reason: hardNight ? `${linkName(hardNight)} is the hardest: ${hardNight.reason}` : null,
    };
  }
  return weakLink.kind === 'day'
    ? { title: `${linkName(weakLink)} limits the trip`, reason: weakLink.reason }
    : { title: `${linkName(weakLink)} is the weak link`, reason: weakLink.reason };
};

/**
 * @param {object} input
 * @param {Array} input.stages validated stages: { index, date, start, travelHours, from, to, layover, checkpoints }
 * @param {Array} input.results per stage: { report, checkpoints: [{ name, report }] }
 * @param {object} input.planSettings the traveler's limits and units (plan params)
 * @param {string} input.activity
 * @param {string} input.todayDate YYYY-MM-DD
 * @param {Array} [input.bailPoints] other ways out besides the trailhead and exit
 */
const assessItinerary = ({ stages, results, planSettings = {}, activity = '', todayDate, bailPoints = [] }) => {
  const exits = [stages[0]?.from, stages[stages.length - 1]?.to, ...bailPoints].filter(Boolean);
  const days = stages.map((stage) => {
    const result = results[stage.index] || {};
    const day = assessPoint(result.report, stage, planSettings, activity);
    const checkpoints = (result.checkpoints || []).map((entry) => ({
      name: entry.name || null,
      day: assessPoint(entry.report, stage, planSettings, activity),
    }));
    let level = day ? day.decisionLevel : null;
    let limitingPlace = day && day.decisionLevel !== 'GO' ? stage.to.name || null : null;
    let limitingChecks = day ? day.limitingChecks : [];
    checkpoints.forEach((checkpoint) => {
      if (!checkpoint.day) return;
      if (level === null || DECISION_RANK[checkpoint.day.decisionLevel] < DECISION_RANK[level]) {
        level = checkpoint.day.decisionLevel;
        limitingPlace = checkpoint.name;
        limitingChecks = checkpoint.day.limitingChecks;
      }
    });
    const checkedDays = [day, ...checkpoints.map((entry) => entry.day)];
    const reports = [result.report, ...(result.checkpoints || []).map((entry) => entry.report)];
    const avalanche = result.report?.avalanche;
    const daysAhead = daysBetween(todayDate, stage.date);
    return {
      index: stage.index,
      date: stage.date,
      layover: Boolean(stage.layover),
      elevationFt: toFiniteOrNull(result.report?.weather?.elevation) ?? stage.to.elevationFt ?? null,
      day,
      checkpoints,
      level,
      limitingPlace: level && level !== 'GO' ? limitingPlace : null,
      limitingChecks: level && level !== 'GO' ? limitingChecks : [],
      incompleteHours: checkedDays.reduce((sum, entry) => sum + (entry ? entry.hourlyWeather.filter((hour) => !completeHour(hour)).length : 0), 0),
      partial: checkedDays.some((entry) => !entry) || reports.some((report) => report?.partialData === true),
      avalancheNotIssued: Boolean(avalanche?.relevant) && avalanche?.coverageStatus === 'expired_for_selected_start',
      lowConfidence: daysAhead >= LOW_CONFIDENCE_DAYS_AHEAD,
      daysAhead,
    };
  });

  const nights = stages.slice(0, -1).map((stage) => {
    const report = results[stage.index]?.report || null;
    const data = report?.campNight || null;
    return {
      index: stage.index,
      date: stage.date,
      camp: stage.to,
      layoverFollows: Boolean(stages[stage.index + 1]?.layover),
      data,
      state: nightState(data, Boolean(report)),
      nearestExit: nearestExit(stage.to, exits),
    };
  });

  // Worst first. Anything that could not be checked outranks a clean result.
  //   0 a day over a hard limit, 1 a serious night, 2 a day that calls for
  //   caution, 3 a hard night, 4 not checked or not yet forecast, 5 partly
  //   forecast or missing readings. Weight: how much is wrong within a rank.
  const links = [];
  const add = (kind, index, rank, reason, weight = 0) => links.push({ kind, index, rank, reason, weight });
  days.forEach((day) => {
    if (day.level === 'NO-GO') add('day', day.index, 0, day.limitingChecks[0] || day.day?.decisionHeadline || 'Conditions cross a hard limit.', day.limitingChecks.length);
    else if (day.level === 'CAUTION') add('day', day.index, 2, day.limitingChecks[0] || day.day?.decisionHeadline || 'Conditions call for caution.', day.limitingChecks.length);
    if (!day.day) add('day', day.index, 4, 'This day could not be checked at camp.');
    else if (day.checkpoints.some((checkpoint) => !checkpoint.day)) add('day', day.index, 5, 'A high point on this day could not be checked.');
    else if (day.incompleteHours > 0) add('day', day.index, 5, `${day.incompleteHours} h lack a complete forecast.`);
    else if (day.partial) add('day', day.index, 5, 'Some sources were unavailable for this day.');
  });
  nights.forEach((night) => {
    const summary = night.data?.summary || '';
    const reasons = night.data?.status === 'ok' ? (night.data.reasonCodes || []).length : 0;
    if (night.state === 'serious') add('night', night.index, 1, summary, reasons);
    else if (night.state === 'hard') add('night', night.index, 3, summary, reasons);
    else if (night.state === 'unavailable') add('night', night.index, 4, 'This night could not be checked.');
    else if (night.state === 'not-forecast') add('night', night.index, 4, summary || 'No forecast covers this night yet.');
    // A hard or serious night can still be only partly forecast: what it holds
    // before morning is unknown, so it stays unresolved as well.
    if (night.data?.status === 'ok' && night.data.complete !== true) add('night', night.index, 5, summary);
  });
  // Within a rank the one with the most wrong leads; then the earliest, and a
  // day before its night: day 2 is walked before night 2.
  links.sort((a, b) => a.rank - b.rank || b.weight - a.weight || a.index - b.index || (a.kind === 'day' ? -1 : 1));
  const weakLink = links[0] || null;
  const worstRank = weakLink ? weakLink.rank : Infinity;
  const unresolved = links.filter((link) => link.rank >= 4).length;
  // A hard night alone does not stop a trip, but nothing is cleared while a
  // day or night is unchecked.
  const level = worstRank === 0
    ? 'NO-GO'
    : worstRank <= 2
      ? 'CAUTION'
      : unresolved > 0
        ? 'INCOMPLETE'
        : 'GO';

  const coldestNight = nights
    .filter((night) => night.data?.status === 'ok' && toFiniteOrNull(night.data.minFeelsLikeF) !== null)
    .reduce((coldest, night) => (!coldest || night.data.minFeelsLikeF < coldest.data.minFeelsLikeF ? night : coldest), null);

  const assessment = { level, links, weakLink, unresolved, coldestNightIndex: coldestNight ? coldestNight.index : null, days, nights };
  return {
    ...assessment,
    headline: verdictHeadline(assessment),
    // Other days or nights over a limit, so the weak link is not read as the only one.
    alsoLimiting: level === 'GO' || level === 'INCOMPLETE' ? [] : links.filter((link) => link !== weakLink && link.rank <= 2),
  };
};

const NIGHT_STATE_LABEL = {
  settled: 'SETTLED',
  hard: 'HARD NIGHT',
  serious: 'SERIOUS',
  incomplete: 'PARTLY FORECAST',
  'not-forecast': 'NOT YET FORECAST',
  unavailable: 'NOT CHECKED',
};

const place = (point) => (point ? { name: point.name || null, latitude: point.lat, longitude: point.lon, elevationFt: point.elevationFt ?? null } : null);

/**
 * What the chat about a trip reads: the verdict, each day's decision and the
 * checks behind it with its hourly window, and each night at camp. Full
 * reports stay out; a week of them is several times the size the chat
 * accepts (MAX_REPORT_LENGTH in routes/report-chat.js).
 */
const buildItineraryChatContext = ({ name, checkedAt, startDate, stages, assessment, context, featureFlags = {}, bailPoints = [] }) => ({
  contextType: 'multi-day-itinerary',
  activity: context.activity,
  featureFlags,
  trip: {
    name: name || 'Multi-day trip',
    checkedAt,
    startDate,
    days: stages.length,
    nights: stages.length - 1,
    trailhead: place(stages[0]?.from),
    exit: place(stages[stages.length - 1]?.to),
    bailPoints: bailPoints.map(place),
    method: 'Each day is checked at its camp over its travel hours, plus any high points it crosses; each night is read at its camp. The trip is as good as its weakest day or night.',
  },
  verdict: {
    level: assessment.level,
    headline: assessment.headline.title,
    reason: assessment.headline.reason,
    weakLink: assessment.weakLink,
    unresolvedCount: assessment.unresolved,
  },
  limits: {
    maxWindGustMph: context.limits.maxWindGustMph,
    maxPrecipChancePct: context.limits.maxPrecipChance,
    minFeelsLikeF: context.limits.minFeelsLikeF,
    maxFeelsLikeF: context.limits.maxFeelsLikeF,
  },
  displayUnits: context.units,
  days: assessment.days.map((day) => {
    const stage = stages[day.index];
    return {
      day: day.index + 1,
      date: day.date,
      from: place(stage.from),
      to: place(stage.to),
      layover: day.layover,
      start: stage.start,
      travelHours: stage.travelHours,
      decision: day.level || 'NOT CHECKED',
      limitingPlace: day.limitingPlace,
      limitingChecks: day.limitingChecks,
      temperatureHighF: day.day?.tempHighF ?? null,
      temperatureLowF: day.day?.tempLowF ?? null,
      peakWindGustMph: day.day?.peakGustMph ?? null,
      peakPrecipitationChancePct: day.day?.peakPrecipChance ?? null,
      expectedRainIn: day.day?.expectedRainIn ?? null,
      expectedSnowIn: day.day?.expectedSnowIn ?? null,
      weatherDescription: day.day?.weatherDescription ?? null,
      sunrise: day.day?.sunrise ?? null,
      sunset: day.day?.sunset ?? null,
      activeWeatherAlerts: day.day?.alertCount ?? null,
      airQualityAqi: day.day?.airQualityAqi ?? null,
      avalancheForecastNotIssued: day.avalancheNotIssued,
      hoursWithoutCompleteForecast: day.incompleteHours,
      partialData: day.partial,
      daysAhead: day.daysAhead,
      lowForecastConfidence: day.lowConfidence,
      highPoints: day.checkpoints.map((checkpoint) => ({
        name: checkpoint.name,
        decision: checkpoint.day?.decisionLevel || 'NOT CHECKED',
        limitingChecks: checkpoint.day?.limitingChecks || [],
        peakWindGustMph: checkpoint.day?.peakGustMph ?? null,
      })),
      hourlyTravelWindow: (day.day?.hourlyWeather || []).map((hour) => ({
        time: hour.time,
        temperatureF: hour.temp,
        gustMph: hour.gust,
        precipitationChancePct: hour.precipChance,
        condition: hour.condition,
      })),
    };
  }),
  nights: assessment.nights.map((night) => {
    const data = night.data?.status === 'ok' ? night.data : null;
    return {
      night: night.index + 1,
      date: night.date,
      camp: place(night.camp),
      layoverFollows: night.layoverFollows,
      state: NIGHT_STATE_LABEL[night.state],
      summary: night.data?.summary ?? null,
      lowTempF: data?.lowTempF ?? null,
      minFeelsLikeF: data?.minFeelsLikeF ?? null,
      peakGustMph: data?.peakGustMph ?? null,
      peakPrecipitationChancePct: data?.peakPrecipChance ?? null,
      thunderstorms: data?.storm ?? null,
      snow: data?.snow ?? null,
      freezingRain: data?.freezingRain ?? null,
      forecastComplete: data?.complete ?? false,
      missingReadings: data?.missing ?? [],
      nearestWayOut: night.nearestExit,
    };
  }),
});

module.exports = {
  LOW_CONFIDENCE_DAYS_AHEAD,
  assessItinerary,
  buildItineraryChatContext,
  nearestExit,
  nightState,
  straightLineMiles,
  verdictHeadline,
};
