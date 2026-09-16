const { selectForecastIntervals } = require('./report-evidence');
const { parseIsoTimeToMs, parseClockToMinutes, parseIsoClockMinutes, clampTravelWindowHours } = require('./time');
const finite = v => v == null || v === '' || typeof v === 'boolean' ? null : Number.isFinite(Number(v)) ? Number(v) : null;

// Weight measurements, not the number of narrative reasons. Unknown metadata
// remains usable context but cannot establish high-quality local evidence.
const snowEvidence = (snowpack, weather) => {
  const reference = parseIsoTimeToMs(weather?.forecastStartTime) ?? Date.now();
  const elevation = finite(weather?.elevation);
  const stations = snowpack?.snotelStations?.length ? snowpack.snotelStations : [snowpack?.snotel];
  const rows = [...stations.map(row => ({ ...row, kind: 'station' })),
    { ...snowpack?.cdec, kind: 'station' }, { ...snowpack?.nohrsc, kind: 'grid' }]
    .map(row => {
      const depth = finite(row.snowDepthIn), swe = finite(row.sweIn);
      const distance = finite(row.distanceKm), stationElevation = finite(row.elevationFt);
      const observed = parseIsoTimeToMs(row.observedDate || row.sampledTime);
      const ageHours = observed === null ? null : (reference - observed) / 3600000;
      const elevationDifferenceFt = elevation === null || stationElevation === null ? null : Math.abs(elevation - stationElevation);
      const rejected = ((depth === null || depth < 0) && (swe === null || swe < 0)) || (ageHours !== null && (ageHours < -24 || ageHours > 168)) || (distance !== null && distance > 80);
      const weight = rejected ? 0 : (ageHours === null ? 0.35 : Math.exp(-Math.max(0, ageHours) / 72)) *
        (row.kind === 'grid' ? 1 : (distance === null ? 0.4 : Math.exp(-distance / 30)) *
          (elevationDifferenceFt === null ? 0.4 : Math.exp(-elevationDifferenceFt / 1500)));
      return { source: row.source || row.stationName || row.kind, depth, swe, ageHours, distanceKm: distance, elevationDifferenceFt, weight };
    }).filter(row => row.depth !== null || row.swe !== null);
  const accepted = rows.filter(row => row.weight > 0);
  const median = key => {
    const sorted = accepted.filter(r => r[key] !== null && r[key] >= 0).sort((a, b) => a[key] - b[key]);
    let remaining = sorted.reduce((sum, r) => sum + r.weight, 0) / 2;
    for (const row of sorted) { remaining -= row.weight; if (remaining <= 0) return row[key]; }
    return null;
  };
  const snow = row => (row.depth !== null && row.depth >= 2) || (row.swe !== null && row.swe >= 0.5);
  const disagreement = accepted.some(snow) && accepted.some(row => !snow(row));
  return { depthIn: median('depth'), sweIn: median('swe'), disagreement, sources: rows,
    quality: accepted.some(r => r.weight >= 0.5) ? 'representative' : accepted.length ? 'limited' : 'unavailable',
    sourceCount: accepted.length };
};

// Duration-weighted hourly intervals; partial hours and gaps are not whole hours.
const surfaceIntervals = (weather, options = {}) => {
  const hours = clampTravelWindowHours(options.selectedTravelWindowHours, Math.min(24, weather?.trend?.length || 6));
  const reference = parseIsoTimeToMs(weather?.forecastStartTime);
  const requested = parseClockToMinutes(options.selectedStartClock);
  const providerClock = parseIsoClockMinutes(weather?.forecastStartTime);
  const start = reference === null ? null : reference + (requested !== null && providerClock !== null ? (requested - providerClock) * 60000 : 0);
  const end = start === null ? null : start + hours * 3600000;
  const rows = start === null ? [] : selectForecastIntervals(weather?.trend || [], new Date(start).toISOString(), hours)
    .map(p => ({ ...p, temp: finite(p.temp), durationHours: p.hours, label: p.time || p.timeIso }));
  return { rows, hours, start, end, coverageHours: rows.filter(p => p.temp !== null).reduce((sum, p) => sum + p.durationHours, 0) };
};

const meltFreezeAnalysis = (weather, options, hasSnowCoverage) => {
  const window = surfaceIntervals(weather, options);
  const night = weather?.precedingNight;
  const completeNight = night?.complete === true && finite(night?.minTempF) !== null;
  const refreezeQuality = !completeNight ? 'unknown' : night.freezingHours >= 4 && night.freezingDegreeHours >= 20 ? 'strong' : night.freezingHours >= 2 && night.freezingDegreeHours >= 4 ? 'fair' : 'weak';
  const temps = window.rows.filter(p => p.temp !== null);
  const meltDegreeHours = temps.reduce((sum, p) => sum + Math.max(0, p.temp - 32) * p.durationHours, 0);
  const aboveFreezingHours = temps.filter(p => p.temp > 32).reduce((sum, p) => sum + p.durationHours, 0);
  const clouds = window.rows.map(p => finite(p.cloudCover)).filter(v => v !== null);
  const averageCloudCover = clouds.length ? clouds.reduce((a, b) => a + b, 0) / clouds.length : null;
  const dayKnown = window.rows.length > 0 && window.rows.every(p => typeof p.isDaytime === 'boolean');
  const effectiveSolarHours = dayKnown && clouds.length === window.rows.length ? window.rows.reduce((sum, p) => sum + (p.isDaytime ? p.durationHours * Math.max(0.2, 1 - finite(p.cloudCover) * 0.008) : 0), 0) : null;
  const solarInput = effectiveSolarHours === null ? 'unknown' : effectiveSolarHours === 0 ? 'none' : effectiveSolarHours >= 3 ? 'high' : effectiveSolarHours >= 1 ? 'moderate' : 'low';
  const covered = window.coverageHours >= window.hours - 0.01;
  const meltPotential = !covered ? 'unknown' : meltDegreeHours >= 18 ? 'high' : meltDegreeHours >= 5 ? 'moderate' : 'low';
  const cycleDetected = hasSnowCoverage && ['strong', 'fair'].includes(refreezeQuality) && aboveFreezingHours > 0;
  const phase = !hasSnowCoverage ? 'no_snow' : !covered ? 'mixed' : meltPotential === 'high' ? 'wet_softening' : cycleDetected ? 'transitioning' : temps.length && temps.every(p => p.temp <= 31) && ['strong', 'fair'].includes(refreezeQuality) ? 'firm_refrozen' : 'mixed';
  const phaseLabels = { no_snow: 'No broad snow signal', mixed: 'Variable snow surface', wet_softening: 'Wet-snow softening possible', transitioning: 'Softening during window', firm_refrozen: 'Firm / refrozen' };
  const label = value => value[0].toUpperCase() + value.slice(1);
  const reasons = [completeNight ? `${night.freezingHours} preceding-night hour(s) below freezing, ${night.freezingDegreeHours.toFixed(1)} freezing degree-hours: ${refreezeQuality} refreeze potential.` : 'The preceding night is incomplete or unavailable; refreeze quality is unknown.',
    `${window.coverageHours.toFixed(1)} of ${window.hours} travel hours have temperature data.`];
  const summary = !hasSnowCoverage ? 'No broad snow signal in available evidence; isolated patches are not ruled out.' : `${phaseLabels[phase]}. ${reasons[0]} Aspect, shade, snow history, and surface observations are needed to establish a corn window; no precise softening time is predicted.`;
  return { cycleDetected, refreezeQuality, refreezeLabel: label(refreezeQuality), solarInput, solarInputLabel: label(solarInput), meltPotential, meltPotentialLabel: label(meltPotential), phase, phaseLabel: phaseLabels[phase], summary, reasons,
    signals: { travelWindowHours: window.hours, travelWindowMinTempF: temps.length ? Math.min(...temps.map(p => p.temp)) : null, travelWindowMaxTempF: temps.length ? Math.max(...temps.map(p => p.temp)) : null, aboveFreezingHours, meltDegreeHours: temps.length ? meltDegreeHours : null, averageCloudCover, effectiveSolarHours, sunrise: options.solarData?.sunrise || null, sunset: options.solarData?.sunset || null, softeningStart: null, wetSnowStart: null } };
};

const groundMoisture = (rainfall, weather) => {
  const rain72 = finite(rainfall?.totals?.rainPast72hIn);
  const rain48 = finite(rainfall?.totals?.rainPast48hIn ?? rainfall?.totals?.past48hIn);
  const rain24 = finite(rainfall?.totals?.rainPast24hIn ?? rainfall?.totals?.past24hIn);
  const complete = rain72 !== null && rain48 !== null && rain24 !== null;
  const retainedRainIn = complete ? rain24 + Math.max(0, rain48 - rain24) * 0.6 + Math.max(0, rain72 - rain48) * 0.3 : null;
  return { state: retainedRainIn === null ? 'unknown' : retainedRainIn >= 0.1 ? 'retained_moisture_possible' : 'low_recent_rain', retainedRainIn,
    lookbackHours: complete ? 72 : rain48 !== null ? 48 : null,
    dryingSignal: finite(weather?.humidity) !== null && weather.humidity < 40 && finite(weather?.temp) !== null && weather.temp > 45 ? 'favorable' : 'limited_or_unknown',
    summary: retainedRainIn === null ? 'Multi-day moisture history is incomplete; drainage and soil moisture are unknown.' : retainedRainIn >= 0.1 ? 'Three-day rain history indicates possible retained moisture. Soil, drainage, canopy, and actual drying are unmeasured; wet rock and mud may differ.' : 'Little rain in the preceding three days. Soil moisture, drainage, and snowmelt wetting remain unmeasured.' };
};

const surfaceOutlook = (weather, options, snow, moisture, code) => {
  const window = surfaceIntervals(weather, options);
  let warmth = 0;
  const timeline = window.rows.map(p => {
    if (p.temp !== null) warmth += Math.max(0, p.temp - 32) * p.durationHours;
    const state = p.temp === null ? 'unknown' : snow ? p.temp <= 31 ? 'firm_or_frozen_possible' : warmth >= 18 ? 'wet_snow_possible' : 'softening_possible' : p.temp <= 32 && moisture.state === 'retained_moisture_possible' ? 'frozen_ground_possible' : moisture.state === 'retained_moisture_possible' || (finite(p.precipChance) !== null && p.precipChance >= 55) ? 'wet_surface_possible' : code === 'dry_firm' ? 'dry_likely' : 'unknown';
    return { time: p.label, durationHours: p.durationHours, state };
  });
  return { coverage: snow ? 'snow_signal' : code === 'dry_firm' ? 'little_broad_snow_evidence' : 'unknown',
    state: code, travelEffects: snow ? ['Slippery footing and changing snow supportability possible'] : code === 'wet_muddy' ? ['Wet rock may be slippery; mud depends on soil and drainage'] : code === 'cold_slick' ? ['Patchy ice or frozen ground possible'] : [],
    timeline, coverageHours: window.coverageHours, requestedHours: window.hours,
    terrainLimitations: 'Point estimate, not a slope stability assessment. Route aspect, slope, canopy, soil, and snow supportability are not measured; shaded and exposed sections may differ.' };
};
module.exports = { snowEvidence, surfaceIntervals, meltFreezeAnalysis, groundMoisture, surfaceOutlook };
