const { buildPlannedStartIso } = require('./time');
const HOUR = 3600000;
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const stamp = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/i.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const clean = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
const link = value => /^https?:\/\//i.test(value || '') ? value : undefined;

// Deterministic interpretation, not an additional scoring model. Rebuild after
// feature filtering so saved/client-supplied insights cannot bypass exclusions.
function buildReportInsights(report) {
  const local = report.localConditions || {};
  const supplemental = report.supplementalEvidence || {};
  if (!report.localConditions && !report.supplementalEvidence) return undefined;
  const flags = report.featureFlags || {};
  const enabled = key => flags[key] !== false;
  const generated = stamp(report.generatedAt);
  const start = stamp(buildPlannedStartIso({ selectedDate: report.forecast?.selectedDate, startClock: report.forecast?.requestedStartTime, referenceIso: report.forecast?.selectedStartTime || report.weather?.forecastStartTime }));
  const nearDeparture = generated !== null && start !== null && Math.abs(start - generated) <= 2 * HOUR;
  const fresh = (time, hours) => generated !== null && stamp(time) !== null && generated - stamp(time) >= -300000 && generated - stamp(time) <= hours * HOUR;
  const items = [];
  const add = (id, tone, title, meaning, action, evidence, features, decisionRelevant = false) => {
    if (!features.every(enabled)) return;
    items.push({ id, tone, title, meaning, action, evidence, features, decisionRelevant });
  };
  const evidence = (source, detail, time, url) => ({ source, detail: clean(detail), ...(time ? { time } : {}), ...(link(url) ? { url: link(url) } : {}) });
  const fieldFeatures = ['fieldObservations'];
  const access = local.access;
  const notices = local.closures;
  const roads = access?.available ? Math.max(0, number(access.closedRoadCount) || 0) + Math.max(0, number(access.caltransClosureCount) || 0) : 0;
  const alerts = notices?.available ? Math.max(number(notices.alertCount) || 0, notices.alerts?.length || 0) : 0;
  if (roads || alerts) {
    add('access', 'caution', 'Verify the approach before committing',
      `${roads ? `${roads} nearby road closure${roads === 1 ? '' : 's'}` : ''}${roads && alerts ? ' and ' : ''}${alerts ? `${alerts} land-manager notice${alerts === 1 ? '' : 's'}` : ''} need a route check. A usable weather window does not establish that the approach is open. These feeds have not been matched to your exact route.`,
      'Match the road names and notice boundaries to your drive and trail. Choose another approach if a restriction applies, and recheck before departure.',
      [roads ? evidence(access.source || 'Road access', (access.roads || []).slice(0, 3).map(r => r.name || r.routeStatus).filter(Boolean).join('; ') || 'Closures reported in the search area', null, access.sourceLink || access.dataSourceLink) : null,
        alerts ? evidence(notices.source || 'Land manager', (notices.alerts || []).slice(0, 3).map(a => a.title).filter(Boolean).join('; ') || 'Notices reported in the search area', null, notices.alerts?.[0]?.url || notices.sourceLink) : null].filter(Boolean), fieldFeatures, true);
  } else if (access?.available || notices?.available) {
    add('access', 'context', 'Access still needs a route-specific check', 'The available feeds returned no nearby closure or notice. This is not confirmation that your road or trail is open; coverage can be incomplete.',
      'Confirm the actual approach with the land manager before leaving.', [evidence('Access feeds', 'No restrictions returned by the available feeds', null, access?.sourceLink || notices?.sourceLink)], fieldFeatures);
  }

  const lightning = local.radar?.lightning;
  const radar = local.radar;
  if (lightning?.available && lightning.detectionAtObjective === true) {
    const current = fresh(lightning.productTime, 0.5);
    add('lightning', current && nearDeparture ? 'caution' : 'context', current ? 'Lightning needs an immediate check' : 'A lightning report needs a time check',
      `${current ? 'The recent satellite product detected lightning at the objective.' : 'The report contains a lightning detection, but its time is old or unverified.'} ${nearDeparture ? 'Review this before entering exposed terrain.' : 'This is a current observation, not a prediction for your departure.'}`,
      'Open the latest radar and lightning source and reassess exposed travel before committing.', [evidence(lightning.source || 'Lightning', 'Detection at the objective', lightning.productTime, lightning.sourceLink)], fieldFeatures, current && nearDeparture);
  } else if (radar?.available && radar.echoDetected === true) {
    const current = fresh(radar.observedTime, 1);
    add('radar', current && nearDeparture ? 'caution' : 'context', 'Check precipitation already near the objective',
      `Radar contains a precipitation echo. ${current && nearDeparture ? 'The departure forecast may not capture the exact arrival and movement of this precipitation.' : 'Its observation time does not establish conditions during the trip.'}`,
      'Check the latest radar movement and prepare for changing visibility and wet surfaces if the echo reaches your route.', [evidence(radar.source || 'Radar', 'Echo detected near the objective', radar.observedTime, radar.sourceLink)], fieldFeatures, current && nearDeparture);
  }

  // Deduplicate stations across NWS and Synoptic; never call a shared station
  // independent evidence. Compare sustained wind with sustained wind, not gust.
  const stations = new Map();
  const candidates = supplemental.synoptic?.available ? [...(supplemental.synoptic.stations || [])] : [];
  const nws = local.weatherObservation;
  if (nws?.available) candidates.push({ id: nws.stationId, name: nws.stationName, distanceKm: nws.distanceKm, elevationFt: nws.elevationFt,
    readings: { windMph: { value: nws.windMph, observedTime: nws.observedTime }, gustMph: { value: nws.gustMph, observedTime: nws.observedTime } } });
  for (const station of candidates) {
    if (!station.id) continue;
    const reading = station.readings?.windMph;
    if (number(reading?.value) === null || reading.value < 0 || !fresh(reading.observedTime, 2)) continue;
    const key = String(station.id).toUpperCase();
    const previous = stations.get(key);
    if (!previous || stamp(reading.observedTime) > stamp(previous.readings.windMph.observedTime)) stations.set(key, station);
  }
  const elevation = number(report.weather?.elevation);
  const comparableLocation = station => number(station?.distanceKm) !== null && station.distanceKm >= 0 && station.distanceKm <= 15
    && elevation !== null && number(station.elevationFt) !== null && Math.abs(station.elevationFt - elevation) <= 500;
  const mainWind = number(report.weather?.windSpeed);
  const stationList = [...stations.values()];
  const matched = nearDeparture && mainWind !== null ? stationList.filter(s => comparableLocation(s) && Math.abs(stamp(s.readings.windMph.observedTime) - start) <= HOUR) : [];
  if (stationList.length) {
    const values = matched.map(s => s.readings.windMph.value);
    const higher = values.some(v => v >= mainWind + 10);
    const similar = values.length > 0 && values.every(v => Math.abs(v - mainWind) <= 5);
    add('station-wind', higher ? 'caution' : similar ? 'support' : 'context', higher ? 'Nearby sustained winds are stronger than forecast' : similar ? 'Nearby wind readings are similar to the forecast' : 'Station readings provide context, not a departure forecast',
      higher ? `A nearby station close in time and elevation reports sustained wind at least 10 mph above the ${mainWind} mph departure forecast. Local exposure may explain the difference; do not assume the lower forecast everywhere.`
        : similar ? `Comparable station readings are within 5 mph of the ${mainWind} mph sustained-wind forecast. This is a limited wind cross-check, not validation of gusts or the whole trip.`
          : 'The readings are current, but distance, elevation, time, or missing forecast values prevent a direct comparison. They cannot confirm wind on a future trip or an exposed summit.',
      higher ? 'Recheck the forecast and actual exposure before committing to ridges; set a wind turnaround limit.' : 'Recheck observations near departure and assess wind in low-consequence terrain before exposed travel.',
      (matched.length ? matched : stationList).slice(0, 3).map(s => evidence(`Station ${s.id}`, `${s.name || s.id}: sustained wind ${s.readings.windMph.value} mph; ${number(s.distanceKm) === null ? 'distance unknown' : `${s.distanceKm} km away`}; ${number(s.elevationFt) === null ? 'elevation unknown' : `${s.elevationFt} ft elevation`}`, s.readings.windMph.observedTime)), fieldFeatures, higher);
  }

  const nbm = supplemental.nbm;
  if (nbm?.available && fresh(nbm.issuedTime, 24)) {
    const points = (nbm.points || []).filter(p => stamp(p.validTime) !== null && [p.windMph?.p10, p.windMph?.p50, p.windMph?.p90].every(v => number(v) !== null && v >= 0) && p.windMph.p10 <= p.windMph.p50 && p.windMph.p50 <= p.windMph.p90);
    const point = start === null ? null : points.sort((a, b) => Math.abs(stamp(a.validTime) - start) - Math.abs(stamp(b.validTime) - start))[0];
    if (point) {
      const matches = comparableLocation(nbm.station) && Math.abs(stamp(point.validTime) - start) <= HOUR && mainWind !== null;
      const high = matches && point.windMph.p90 >= mainWind + 10;
      add('wind-range', high ? 'caution' : 'context', high ? 'Allow for stronger sustained wind than the main forecast' : 'Wind guidance shows a range of possible outcomes',
        `${high ? 'At a nearby station with similar elevation and timing, the higher-end wind estimate exceeds the main sustained-wind forecast by at least 10 mph. ' : ''}${matches ? '' : 'The station or forecast time is not comparable enough to establish disagreement with the objective forecast. '}P10 to P90 spans the central part of this model distribution; it is not a gust range, summit forecast, or guarantee.`,
        'Use the higher-end scenario when reviewing exposed sections, then check the hourly gust forecast separately.',
        [evidence('NOAA NBM', `${nbm.station?.name || nbm.station?.id || 'Forecast station'}: ${point.windMph.p10}–${point.windMph.p90} mph sustained wind, median ${point.windMph.p50} mph`, point.validTime, nbm.sourceLink)], ['weatherContextDetails'], high);
    }
  }

  const water = local.streamflow;
  if (water?.available) {
    const rising = water.trend === 'rising' && fresh(water.observedTime, 3);
    const rain = number(report.rainfall?.expected?.rainWindowIn);
    add('water', rising && nearDeparture ? 'caution' : 'context', rising ? 'Build a contingency for stream crossings' : 'A gauge reading cannot establish a safe crossing',
      `${rising ? 'The nearby gauge is rising. ' : 'A nearby gauge provides context, but does not establish water depth or current at your crossing. '}${rising && rain !== null && rain > 0 ? 'Rain is also forecast during the travel window, which adds a reason to watch for changing water levels. ' : ''}${nearDeparture ? '' : 'Current flow is not a forecast for your trip. '}The gauge has not been matched to your route or drainage.`,
      'If your route crosses unbridged water, identify a bridge or alternate route and reassess at the crossing; do not infer crossing safety from discharge alone.',
      [evidence(water.source || 'USGS', `${water.siteName || water.siteId || 'Nearby gauge'}: ${number(water.dischargeCfs) === null ? 'discharge unavailable' : `${water.dischargeCfs} cfs`}; trend ${water.trend || 'unknown'}`, water.observedTime)], fieldFeatures, rising && nearDeparture);
  }
  const fire = local.wildfire;
  const incidents = fire?.available ? Math.max(number(fire.nearbyIncidentCount) || 0, fire.incidents?.length || 0) : 0;
  const detections = fire?.available ? Math.max(0, number(fire.firmsDetectionCount) || 0) : 0;
  if (incidents || detections) add('fire-access', 'caution', 'Check fire locations against your approach and escape routes',
    `${incidents} nearby fire incident${incidents === 1 ? '' : 's'} and ${detections} satellite detection${detections === 1 ? '' : 's'} were returned. Proximity does not establish that the route is affected, and these feeds can lag changing conditions.`,
    'Compare current fire perimeters and official restrictions with the route and road access before choosing an approach.',
    [evidence(fire.source || 'Fire observations', (fire.incidents || []).slice(0, 3).map(i => i.name).join('; ') || 'Satellite detections in the search area', null, fire.sourceLink)], ['fieldObservations', 'fireRiskDetails'], true);

  const smoke = supplemental.hrrrSmoke;
  if (smoke?.available && number(smoke.nearSurfaceUgM3) !== null && smoke.nearSurfaceUgM3 >= 0 && fresh(smoke.issuedTime, 12)) {
    const atStart = start !== null && stamp(smoke.validTime) !== null && Math.abs(stamp(smoke.validTime) - start) <= HOUR;
    add('smoke', 'context', 'Use smoke guidance alongside air quality, not as an AQI replacement',
      `${smoke.nearSurfaceUgM3 === 0 ? 'The sampled model grid shows zero wildfire-smoke concentration' : 'The model includes wildfire smoke at the sampled grid point'}${atStart ? ' near departure' : ', but its time does not match departure closely'}. This does not establish clean air: other pollutants, new fires, and later changes may be missed.`,
      'Compare the report’s AQI with current monitoring and the forecast through your trip; reassess if smoke or visibility changes.',
      [evidence('NOAA HRRR-Smoke', `Near-surface smoke ${smoke.nearSurfaceUgM3} µg/m³; grid ${smoke.gridDistanceKm ?? 'unknown'} km away`, smoke.validTime, smoke.sourceLink),
        number(report.airQuality?.usAqi) !== null ? evidence(report.airQuality.source || 'Air quality', `AQI ${report.airQuality.usAqi}; ${report.airQuality.dataType || 'type unspecified'}`, report.airQuality.validTime || report.airQuality.measuredTime) : null].filter(Boolean), ['airQualityDetails']);
  }
  const outlook = local.smoke;
  if (outlook?.available && (outlook.currentCategory || outlook.peakCategory)) add('air-outlook', 'context', 'Check when the air-quality outlook is worst',
    `The field outlook reports ${clean(outlook.currentCategory) || 'an unavailable current category'} now and ${clean(outlook.peakCategory) || 'an unavailable peak category'} at its forecast peak. That peak may fall outside your trip, so it is not automatically your exposure.`,
    'Compare the peak time with departure and return, and use the report’s AQI and monitoring sources to reassess conditions.',
    [evidence(outlook.source || 'Air-quality outlook', `Current category: ${clean(outlook.currentCategory) || 'unknown'}; peak: ${clean(outlook.peakCategory) || 'unknown'}`, outlook.peakTimeIso)], ['fieldObservations', 'airQualityDetails']);

  const tide = local.tides;
  if (tide?.available && (tide.nextHigh?.timeIso || tide.nextLow?.timeIso)) add('tides', 'context', 'Check tidal timing if the route uses the shoreline',
    'The nearby tide station describes water-level timing, not whether a beach passage is passable. Wave run-up and the route elevation are not established here.',
    'For coastal sections, check tide times against the planned crossing and return, and keep an inland alternative.',
    [evidence(tide.source || 'Tide predictions', `${tide.stationName || 'Nearby station'}; next high ${tide.nextHigh?.timeIso || 'unavailable'}; next low ${tide.nextLow?.timeIso || 'unavailable'}`)], fieldFeatures);

  const discussion = supplemental.discussion;
  if (discussion?.available && fresh(discussion.issuedTime, 24)) {
    // Quote only an explicitly labeled key-messages block. Do not keyword-match
    // prose into point hazards (negation, dates, and geography matter).
    const block = discussion.text?.match(/(?:^|\n)\.?KEY MESSAGES[^\n]*\n([\s\S]*?)(?:\n&&|\n\.[A-Z][A-Z /]+|$)/i)?.[1];
    if (block?.trim()) add('forecaster-context', 'context', 'Regional forecasters add context to the point forecast',
      'The forecaster’s key messages below apply to the office region and their stated periods. They are not automatically conditions on your route.',
      'Read the discussion for the locations and time periods that overlap your plan before applying these messages.',
      [evidence(`NWS ${discussion.office || ''}`, block, discussion.issuedTime, discussion.sourceLink)], ['weatherContextDetails']);
  }
  const gaps = [];
  if (enabled('fieldObservations') && report.localConditions) {
    if (!access?.available) gaps.push('road access');
    if (!notices?.available) gaps.push('land-manager notices');
    if (!stationList.length) gaps.push('fresh station wind observations');
  }
  if (gaps.length) add('evidence-gaps', 'gap', 'Some checks still need a direct source',
    `The report could not establish ${gaps.join(', ')}. Missing evidence is not confirmation of clear conditions.`,
    'Check the relevant official sources before departure; refresh this report when new readings are available.', [], fieldFeatures);
  const rank = { caution: 0, gap: 1, context: 2, support: 3 };
  const priority = { lightning: 0, 'fire-access': 1, access: 2, 'station-wind': 3, 'wind-range': 4, water: 5 };
  items.sort((a, b) => rank[a.tone] - rank[b.tone] || (priority[a.id] ?? 20) - (priority[b.id] ?? 20));
  const concerns = items.filter(i => i.decisionRelevant);
  return { version: 1, summary: concerns.length ? `${concerns[0].title}. ${concerns.length > 1 ? 'Additional field and forecast checks also need review.' : 'Resolve this check alongside the main forecast before committing.'}` : 'Use the available field evidence to check the forecast and approach; it does not establish conditions for the whole route.', items };
}
module.exports = { buildReportInsights };
