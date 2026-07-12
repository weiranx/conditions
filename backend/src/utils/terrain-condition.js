const {
  clampTravelWindowHours,
  formatMinutesToClock,
  parseClockToMinutes,
  parseIsoClockMinutes,
} = require('./time');

const toFinite = (value) => {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const labelForLevel = (value) => {
  if (value === 'strong') return 'Strong';
  if (value === 'fair') return 'Fair';
  if (value === 'weak') return 'Weak';
  if (value === 'none') return 'None';
  if (value === 'high') return 'High';
  if (value === 'moderate') return 'Moderate';
  if (value === 'low') return 'Low';
  return 'Unknown';
};

const buildMeltFreezeAnalysis = ({
  hasSnowCoverage,
  tempF,
  freezeThawMinTempF,
  freezeThawMaxTempF,
  trend,
  cloudCover,
  solarData,
  selectedStartClock,
  selectedTravelWindowHours,
  forecastStartTime,
}) => {
  const requestedWindowHours = clampTravelWindowHours(
    selectedTravelWindowHours,
    Array.isArray(trend) && trend.length > 0 ? trend.length : 6,
  );
  const windowPoints = Array.isArray(trend) ? trend.slice(0, requestedWindowHours) : [];
  const windowTemps = windowPoints
    .map((point) => toFinite(point?.temp))
    .filter((value) => value !== null);
  if (windowTemps.length === 0 && tempF !== null) {
    windowTemps.push(tempF);
  }

  const travelWindowMinTempF = windowTemps.length ? Math.min(...windowTemps) : tempF;
  const travelWindowMaxTempF = windowTemps.length ? Math.max(...windowTemps) : tempF;
  const aboveFreezingHours = windowTemps.filter((value) => value > 32).length;
  const meltDegreeHours = windowTemps.reduce((sum, value) => sum + Math.max(0, value - 32), 0);

  const cloudSamples = [cloudCover, ...windowPoints.map((point) => point?.cloudCover)]
    .map(toFinite)
    .filter((value) => value !== null);
  const averageCloudCover = cloudSamples.length
    ? cloudSamples.reduce((sum, value) => sum + value, 0) / cloudSamples.length
    : null;

  const sunriseMinutes = parseClockToMinutes(solarData?.sunrise);
  const sunsetMinutes = parseClockToMinutes(solarData?.sunset);
  const startMinutes = parseClockToMinutes(selectedStartClock) ?? parseIsoClockMinutes(forecastStartTime);
  const endMinutes = startMinutes !== null ? startMinutes + requestedWindowHours * 60 : null;
  const validSolarClock =
    sunriseMinutes !== null && sunsetMinutes !== null && sunsetMinutes > sunriseMinutes;

  let daylightHours = null;
  if (validSolarClock && startMinutes !== null && endMinutes !== null) {
    const overlapMinutes = Math.max(
      0,
      Math.min(endMinutes, sunsetMinutes) - Math.max(startMinutes, sunriseMinutes),
    );
    daylightHours = overlapMinutes / 60;
  } else if (windowPoints.some((point) => typeof point?.isDaytime === 'boolean')) {
    daylightHours = windowPoints.filter((point) => point?.isDaytime === true).length;
  }

  const cloudTransmission = averageCloudCover === null
    ? 0.65
    : Math.max(0.2, Math.min(1, 1 - (averageCloudCover * 0.008)));
  const effectiveSolarHours = daylightHours === null ? null : daylightHours * cloudTransmission;
  let solarInput = 'unknown';
  if (daylightHours !== null && daylightHours <= 0) {
    solarInput = 'none';
  } else if (effectiveSolarHours !== null && effectiveSolarHours >= 3) {
    solarInput = 'high';
  } else if (effectiveSolarHours !== null && effectiveSolarHours >= 1) {
    solarInput = 'moderate';
  } else if (effectiveSolarHours !== null) {
    solarInput = 'low';
  }

  let refreezeQuality = 'unknown';
  if (freezeThawMinTempF !== null) {
    if (freezeThawMinTempF <= 26) refreezeQuality = 'strong';
    else if (freezeThawMinTempF <= 31) refreezeQuality = 'fair';
    else refreezeQuality = 'weak';
  }

  const cycleDetected = Boolean(
    hasSnowCoverage &&
    (refreezeQuality === 'strong' || refreezeQuality === 'fair') &&
    freezeThawMaxTempF !== null &&
    freezeThawMaxTempF >= 35,
  );

  let meltPotential = 'low';
  const warmestTempF = travelWindowMaxTempF;
  if (
    meltDegreeHours >= 18 ||
    (Number.isFinite(warmestTempF) && warmestTempF >= 42 && (solarInput === 'high' || solarInput === 'moderate'))
  ) {
    meltPotential = 'high';
  } else if (
    meltDegreeHours >= 5 ||
    (Number.isFinite(warmestTempF) && warmestTempF >= 35 && solarInput !== 'none')
  ) {
    meltPotential = 'moderate';
  }

  let softeningStartMinutes = null;
  let wetSnowStartMinutes = null;
  if (cycleDetected && sunriseMinutes !== null) {
    const baseDelay = solarInput === 'high' ? 60 : solarInput === 'moderate' ? 105 : 165;
    const refreezeDelay = refreezeQuality === 'strong' ? 30 : 0;
    softeningStartMinutes = sunriseMinutes + baseDelay + refreezeDelay;
    wetSnowStartMinutes = softeningStartMinutes + (meltPotential === 'high' ? 120 : meltPotential === 'moderate' ? 180 : 240);
  }

  let phase = 'mixed';
  if (!hasSnowCoverage) {
    phase = 'no_snow';
  } else if (cycleDetected && startMinutes !== null && softeningStartMinutes !== null && wetSnowStartMinutes !== null) {
    if (startMinutes >= wetSnowStartMinutes || (endMinutes !== null && endMinutes > wetSnowStartMinutes)) {
      phase = 'wet_softening';
    } else if (endMinutes !== null && startMinutes < softeningStartMinutes && endMinutes > softeningStartMinutes) {
      phase = 'transitioning';
    } else if (startMinutes < softeningStartMinutes) {
      phase = 'firm_refrozen';
    } else if (startMinutes < wetSnowStartMinutes) {
      phase = 'corn_window';
    }
  } else if (
    refreezeQuality === 'weak' &&
    (meltPotential === 'high' || (travelWindowMaxTempF !== null && travelWindowMaxTempF >= 38))
  ) {
    phase = 'wet_softening';
  } else if (tempF !== null && tempF <= 31 && (refreezeQuality === 'strong' || refreezeQuality === 'fair')) {
    phase = 'firm_refrozen';
  } else if (cycleDetected) {
    phase = 'transitioning';
  }

  const phaseLabels = {
    no_snow: 'No broad snow cover',
    firm_refrozen: 'Firm / refrozen',
    transitioning: 'Softening during window',
    corn_window: 'Corn window possible',
    wet_softening: 'Wet-snow softening',
    mixed: 'Variable snow surface',
  };

  const reasons = [];
  if (freezeThawMinTempF !== null) {
    reasons.push(
      `${Math.round(freezeThawMinTempF)}F overnight low indicates ${labelForLevel(refreezeQuality).toLowerCase()} refreeze potential.`,
    );
  }
  if (travelWindowMinTempF !== null && travelWindowMaxTempF !== null) {
    reasons.push(
      `Travel-window temperatures run ${Math.round(travelWindowMinTempF)}F to ${Math.round(travelWindowMaxTempF)}F with ${aboveFreezingHours} forecast hour(s) above freezing.`,
    );
  }
  if (effectiveSolarHours !== null) {
    reasons.push(
      `${effectiveSolarHours.toFixed(1)} effective solar hour(s) in the travel window${averageCloudCover !== null ? ` after about ${Math.round(averageCloudCover)}% cloud cover` : ''}.`,
    );
  }

  let summary = 'Snow surface timing remains variable; use aspect-specific field checks for crust, supportability, and free water.';
  if (cycleDetected && softeningStartMinutes !== null && wetSnowStartMinutes !== null) {
    const softeningClock = formatMinutesToClock(softeningStartMinutes);
    const wetClock = formatMinutesToClock(wetSnowStartMinutes);
    if (phase === 'firm_refrozen') {
      summary = `${labelForLevel(refreezeQuality)} overnight refreeze should favor firm early travel. Solar-facing slopes may begin softening around ${softeningClock}; shaded and north-facing terrain can lag.`;
    } else if (phase === 'transitioning') {
      summary = `The selected window crosses a rough solar-softening onset near ${softeningClock}. Expect firm snow first, then a short corn window on solar-facing slopes.`;
    } else if (phase === 'corn_window') {
      summary = `The start overlaps a rough corn-snow window (${softeningClock}-${wetClock}) on solar-facing slopes. Shaded aspects may stay firm longer.`;
    } else if (startMinutes !== null && startMinutes < wetSnowStartMinutes) {
      summary = `The selected window extends beyond a rough wet-snow transition near ${wetClock} on solar-facing slopes. Supportability may decline before the trip is over.`;
    } else {
      summary = `The start is after a rough wet-snow transition near ${wetClock} on solar-facing slopes. Expect declining supportability as warming continues.`;
    }
  } else if (refreezeQuality === 'weak' && hasSnowCoverage) {
    summary = `The forecast low near ${Math.round(freezeThawMinTempF)}F suggests a weak overnight refreeze. Existing snow may soften early, especially with ${labelForLevel(solarInput).toLowerCase()} solar input.`;
  } else if (phase === 'firm_refrozen') {
    summary = 'Cold temperatures and an overnight refreeze signal favor firm or icy snow at the selected start.';
  } else if (cycleDetected) {
    summary = 'A freeze-thaw cycle is present, but solar timing is incomplete; expect aspect-dependent firm-to-soft transitions.';
  }

  return {
    cycleDetected,
    refreezeQuality,
    refreezeLabel: labelForLevel(refreezeQuality),
    solarInput,
    solarInputLabel: labelForLevel(solarInput),
    meltPotential,
    meltPotentialLabel: labelForLevel(meltPotential),
    phase,
    phaseLabel: phaseLabels[phase] || phaseLabels.mixed,
    summary,
    reasons: reasons.slice(0, 4),
    signals: {
      travelWindowHours: requestedWindowHours,
      travelWindowMinTempF,
      travelWindowMaxTempF,
      aboveFreezingHours,
      meltDegreeHours: Number(meltDegreeHours.toFixed(1)),
      averageCloudCover: averageCloudCover === null ? null : Math.round(averageCloudCover),
      effectiveSolarHours: effectiveSolarHours === null ? null : Number(effectiveSolarHours.toFixed(1)),
      sunrise: solarData?.sunrise || null,
      sunset: solarData?.sunset || null,
      softeningStart: softeningStartMinutes === null ? null : formatMinutesToClock(softeningStartMinutes),
      wetSnowStart: wetSnowStartMinutes === null ? null : formatMinutesToClock(wetSnowStartMinutes),
    },
  };
};

const deriveSnowProfile = ({
  hasSnowCoverage,
  hasSnowWeatherSignal,
  hasFreshSnowSignal,
  hasFreezeThawSignal,
  hasRainAccumulationSignal,
  wetTrendHours,
  snowTrendHours,
  tempF,
  precipChance,
  freezeThawMinTempF,
  freezeThawMaxTempF,
  tempContextWindowHours,
  maxDepthIn,
  maxSweIn,
  meltFreeze,
}) => {
  const hasAnySnowSignal =
    hasSnowCoverage ||
    hasSnowWeatherSignal ||
    hasFreshSnowSignal ||
    snowTrendHours >= 1 ||
    (maxDepthIn !== null && maxDepthIn >= 0.5) ||
    (maxSweIn !== null && maxSweIn >= 0.1);

  const reasons = [];
  const addReason = (reason) => {
    if (typeof reason === 'string' && reason.trim()) {
      reasons.push(reason.trim());
    }
  };

  if (!hasAnySnowSignal) {
    if (maxDepthIn !== null || maxSweIn !== null) {
      addReason(
        `Snowpack signal is minimal (depth ${maxDepthIn !== null ? `${maxDepthIn.toFixed(1)} in` : 'N/A'}, SWE ${
          maxSweIn !== null ? `${maxSweIn.toFixed(1)} in` : 'N/A'
        }).`,
      );
    } else {
      addReason('No reliable snow depth/SWE signal is available for this objective.');
    }
    return {
      code: 'no_snow_signal',
      label: 'No broad snow signal',
      summary: 'No broad snowpack signal was detected in available observations and forecast cues.',
      confidence: maxDepthIn !== null || maxSweIn !== null ? 'medium' : 'low',
      reasons: reasons.slice(0, 4),
    };
  }

  if (
    (hasFreshSnowSignal || snowTrendHours >= 2 || (hasSnowWeatherSignal && (precipChance === null || precipChance >= 40))) &&
    !hasRainAccumulationSignal &&
    (tempF === null || tempF <= 30)
  ) {
    addReason('Recent snowfall and cold temperatures support soft, unconsolidated surface snow.');
    if (freezeThawMinTempF !== null && freezeThawMaxTempF !== null) {
      addReason(
        `${tempContextWindowHours || 24}h temperature context stays winter-like (${Math.round(freezeThawMinTempF)}F to ${Math.round(
          freezeThawMaxTempF,
        )}F).`,
      );
    }
    return {
      code: 'fresh_powder',
      label: '❄️ Fresh Powder',
      summary: 'Fresh, cold snowfall signal suggests powder-like surface conditions.',
      confidence: hasSnowCoverage && hasFreshSnowSignal ? 'high' : 'medium',
      reasons: reasons.slice(0, 4),
      meltFreeze,
    };
  }

  const hasSolarMeltSignal =
    hasSnowCoverage &&
    meltFreeze?.phase === 'wet_softening' &&
    meltFreeze?.meltPotential === 'high';

  if (
    hasSnowCoverage &&
    (((tempF !== null && tempF >= 34) || (freezeThawMaxTempF !== null && freezeThawMaxTempF >= 36)) &&
      (hasRainAccumulationSignal || wetTrendHours >= 1 || (precipChance !== null && precipChance >= 45)) ||
      hasSolarMeltSignal)
  ) {
    addReason(
      hasSolarMeltSignal
        ? 'Temperature and solar loading indicate wet-snow softening during the selected travel window.'
        : 'Warm/wet signal on top of snowpack supports wet, heavy, or slushy surface snow.',
    );
    if (precipChance !== null && !hasSolarMeltSignal) {
      addReason(`Precipitation chance (${Math.round(precipChance)}%) increases wet-snow likelihood.`);
    }
    return {
      code: 'wet_slushy_snow',
      label: '💧 Wet / Slushy Snow',
      summary: meltFreeze?.summary || 'Warm and/or wet signal over existing snowpack suggests slushy, heavy surface conditions.',
      confidence: hasSolarMeltSignal && meltFreeze?.solarInput !== 'unknown' ? 'high' : 'medium',
      reasons: reasons.slice(0, 4),
      meltFreeze,
    };
  }

  if (
    hasSnowCoverage &&
    (meltFreeze?.cycleDetected || hasFreezeThawSignal) &&
    freezeThawMinTempF !== null &&
    freezeThawMaxTempF !== null &&
    freezeThawMinTempF <= 31 &&
    freezeThawMaxTempF >= 38 &&
    !hasRainAccumulationSignal &&
    wetTrendHours === 0
  ) {
    addReason('Freeze-thaw pattern supports corn-snow cycles on solar aspects.');
    addReason(
      `${tempContextWindowHours || 24}h temperature swing (${Math.round(freezeThawMinTempF)}F to ${Math.round(
        freezeThawMaxTempF,
      )}F) aligns with a spring corn-cycle pattern.`,
    );
    return {
      code: 'spring_snow',
      label: '🌤️ Corn-Snow Cycle',
      summary: meltFreeze?.summary || 'Freeze-thaw cycle indicates a corn-snow window with rapid daytime softening potential.',
      confidence: meltFreeze?.solarInput && meltFreeze.solarInput !== 'unknown' ? 'high' : 'medium',
      reasons: reasons.slice(0, 4),
      meltFreeze,
    };
  }

  if (
    hasSnowCoverage &&
    !hasFreshSnowSignal &&
    ((tempF !== null && tempF <= 30) || (freezeThawMinTempF !== null && freezeThawMinTempF <= 28)) &&
    wetTrendHours === 0
  ) {
    addReason('Cold, non-stormy snowpack signal favors firm or icy surface conditions.');
    if (tempF !== null) {
      addReason(`Current temperature near ${Math.round(tempF)}F supports surface hardening/refreeze.`);
    }
    return {
      code: 'icy_hardpack',
      label: '🧊 Icy / Firm Snow',
      summary: 'Snowpack appears firm/refrozen with icy travel potential.',
      confidence: 'medium',
      reasons: reasons.slice(0, 4),
      meltFreeze,
    };
  }

  addReason('Snowpack signal exists, but no single fresh/icy/corn-cycle pattern dominates.');
  return {
    code: 'mixed_snow',
    label: '❄️ Mixed Snow Surface',
    summary: 'Mixed snow profile with variable firmness and moisture across terrain/aspects.',
    confidence: hasSnowCoverage ? 'medium' : 'low',
    reasons: reasons.slice(0, 4),
    meltFreeze,
  };
};

const deriveTerrainCondition = (weatherData, snowpackData = null, rainfallData = null, options = {}) => {

  const description = String(weatherData?.description || '').toLowerCase();
  const precipChance = toFinite(weatherData?.precipChance);
  const humidity = toFinite(weatherData?.humidity);
  const tempF = toFinite(weatherData?.temp);
  const windMph = toFinite(weatherData?.windSpeed);
  const gustMph = toFinite(weatherData?.windGust);
  const cloudCover = toFinite(weatherData?.cloudCover);

  const trend = Array.isArray(weatherData?.trend) ? weatherData.trend : [];
  const nearTermTrend = trend.slice(0, 6);
  const contextTrend = trend.slice(0, 24);
  const wetTrendHours = nearTermTrend.filter((point) => {
    const pointPrecip = toFinite(point?.precipChance);
    const pointCondition = String(point?.condition || '').toLowerCase();
    return (pointPrecip !== null && pointPrecip >= 55) || /rain|drizzle|shower|thunder|storm|wet/.test(pointCondition);
  }).length;
  const snowTrendHours = nearTermTrend.filter((point) => {
    const pointPrecip = toFinite(point?.precipChance);
    const pointTemp = toFinite(point?.temp);
    const pointCondition = String(point?.condition || '').toLowerCase();
    return (pointPrecip !== null && pointPrecip >= 35 && pointTemp !== null && pointTemp <= 34) || /snow|sleet|freezing|flurr|wintry|ice/.test(pointCondition);
  }).length;
  const trendTemps = nearTermTrend.map((point) => toFinite(point?.temp)).filter((value) => value !== null);
  const trendMinTemp = trendTemps.length > 0 ? Math.min(...trendTemps) : null;
  const trendMaxTemp = trendTemps.length > 0 ? Math.max(...trendTemps) : null;
  const contextTrendTemps = contextTrend.map((point) => toFinite(point?.temp)).filter((value) => value !== null);
  const contextTrendMinTemp = contextTrendTemps.length > 0 ? Math.min(...contextTrendTemps) : null;
  const contextTrendMaxTemp = contextTrendTemps.length > 0 ? Math.max(...contextTrendTemps) : null;
  const tempContext24h = weatherData?.temperatureContext24h || null;
  const tempContextWindowHours = toFinite(tempContext24h?.windowHours) || 24;
  const tempContextMinF = toFinite(tempContext24h?.minTempF);
  const tempContextMaxF = toFinite(tempContext24h?.maxTempF);
  const tempContextOvernightLowF = toFinite(tempContext24h?.overnightLowF);
  const tempContextDaytimeHighF = toFinite(tempContext24h?.daytimeHighF);
  const freezeThawMinTempF = tempContextOvernightLowF ?? tempContextMinF ?? contextTrendMinTemp ?? trendMinTemp;
  const freezeThawMaxTempF = tempContextDaytimeHighF ?? tempContextMaxF ?? contextTrendMaxTemp ?? trendMaxTemp;

  const snotel = snowpackData?.snotel || null;
  const snotelConsensus = snowpackData?.snotelConsensus || null;
  const nohrsc = snowpackData?.nohrsc || null;
  const cdec = snowpackData?.cdec || null;
  const snotelDistanceKm = toFinite(snotel?.distanceKm);
  const snotelNearby = snotelDistanceKm === null || snotelDistanceKm <= 80;
  const cdecDistanceKm = toFinite(cdec?.distanceKm);
  const cdecNearby = cdecDistanceKm === null || cdecDistanceKm <= 80;

  const depthSamples = [];
  const sweSamples = [];
  const snotelDepth = toFinite(snotelConsensus?.medianDepthIn ?? snotel?.snowDepthIn);
  const snotelSwe = toFinite(snotelConsensus?.medianSweIn ?? snotel?.sweIn);
  const nohrscDepth = toFinite(nohrsc?.snowDepthIn);
  const nohrscSwe = toFinite(nohrsc?.sweIn);
  const cdecDepth = toFinite(cdec?.snowDepthIn);
  const cdecSwe = toFinite(cdec?.sweIn);

  if (snotelNearby && snotelDepth !== null) depthSamples.push(snotelDepth);
  if (snotelNearby && snotelSwe !== null) sweSamples.push(snotelSwe);
  if (nohrscDepth !== null) depthSamples.push(nohrscDepth);
  if (nohrscSwe !== null) sweSamples.push(nohrscSwe);
  if (cdecNearby && cdecDepth !== null) depthSamples.push(cdecDepth);
  if (cdecNearby && cdecSwe !== null) sweSamples.push(cdecSwe);

  const maxDepthIn = depthSamples.length ? Math.max(...depthSamples) : null;
  const maxSweIn = sweSamples.length ? Math.max(...sweSamples) : null;
  const hasSnowCoverage =
    (maxDepthIn !== null && maxDepthIn >= 2) ||
    (maxSweIn !== null && maxSweIn >= 0.5);

  const hasSnowWeatherSignal =
    /snow|sleet|ice|freezing|blizzard|flurr|graupel|rime|wintry/.test(description) ||
    (tempF !== null && tempF <= 34 && precipChance !== null && precipChance >= 35);
  const hasRainWeatherSignal =
    /rain|drizzle|shower|thunder|storm|wet/.test(description) ||
    (precipChance !== null && precipChance >= 60 && tempF !== null && tempF > 34);
  const rain12hIn = toFinite(rainfallData?.totals?.rainPast12hIn ?? rainfallData?.totals?.past12hIn);
  const rain24hIn = toFinite(rainfallData?.totals?.rainPast24hIn ?? rainfallData?.totals?.past24hIn);
  const rain48hIn = toFinite(rainfallData?.totals?.rainPast48hIn ?? rainfallData?.totals?.past48hIn);
  const snow12hIn = toFinite(rainfallData?.totals?.snowPast12hIn);
  const snow24hIn = toFinite(rainfallData?.totals?.snowPast24hIn);
  const snow48hIn = toFinite(rainfallData?.totals?.snowPast48hIn);
  const expectedRainWindowIn = toFinite(rainfallData?.expected?.rainWindowIn);
  const expectedSnowWindowIn = toFinite(rainfallData?.expected?.snowWindowIn);
  const expectedWindowHours = toFinite(rainfallData?.expected?.travelWindowHours);
  const hasRainAccumulationSignal =
    (rain12hIn !== null && rain12hIn >= 0.1) ||
    (rain24hIn !== null && rain24hIn >= 0.2) ||
    (rain48hIn !== null && rain48hIn >= 0.35);
  const hasExpectedRainSignal =
    (expectedRainWindowIn !== null && expectedRainWindowIn >= 0.2);
  const hasFreshSnowSignal =
    (snow12hIn !== null && snow12hIn >= 0.5) ||
    (snow24hIn !== null && snow24hIn >= 1.5) ||
    (snow48hIn !== null && snow48hIn >= 2.5);
  const hasExpectedSnowSignal =
    (expectedSnowWindowIn !== null && expectedSnowWindowIn >= 1.0);
  const hasFreezeThawSignal =
    (freezeThawMinTempF !== null && freezeThawMaxTempF !== null && freezeThawMinTempF <= 31 && freezeThawMaxTempF >= 35) ||
    (tempF !== null && tempF >= 30 && tempF <= 36 && precipChance !== null && precipChance >= 35);
  const hasDryWindySignal =
    (humidity !== null && humidity <= 30) &&
    (precipChance === null || precipChance < 20) &&
    ((gustMph !== null && gustMph >= 25) || (windMph !== null && windMph >= 16));
  const weatherUnavailableSignal = !description || /weather data unavailable|weather unavailable|unavailable/.test(description);
  const noBroadSnowSignal =
    maxDepthIn !== null &&
    maxSweIn !== null &&
    maxDepthIn <= 1 &&
    maxSweIn <= 0.25;
  const noSnowOrWetSignal =
    !hasSnowCoverage &&
    !hasSnowWeatherSignal &&
    !hasFreshSnowSignal &&
    !hasExpectedSnowSignal &&
    snowTrendHours === 0 &&
    !hasRainWeatherSignal &&
    !hasRainAccumulationSignal &&
    !hasExpectedRainSignal &&
    wetTrendHours === 0;

  const meltFreeze = buildMeltFreezeAnalysis({
    hasSnowCoverage,
    tempF,
    freezeThawMinTempF,
    freezeThawMaxTempF,
    trend,
    cloudCover,
    solarData: options?.solarData || null,
    selectedStartClock: options?.selectedStartClock || null,
    selectedTravelWindowHours: options?.selectedTravelWindowHours,
    forecastStartTime: weatherData?.forecastStartTime || null,
  });

  const snowProfile = deriveSnowProfile({
    hasSnowCoverage,
    hasSnowWeatherSignal,
    hasFreshSnowSignal,
    hasFreezeThawSignal,
    hasRainAccumulationSignal,
    wetTrendHours,
    snowTrendHours,
    tempF,
    precipChance,
    freezeThawMinTempF,
    freezeThawMaxTempF,
    tempContextWindowHours,
    maxDepthIn,
    maxSweIn,
    meltFreeze,
  });

  let code = 'variable_surface';
  let label = '🌲 Variable Surface';
  let impact = 'moderate';
  let recommendedTravel = 'Start at a conservative pace, test traction at aspect and elevation transitions, and turn around if footing becomes unpredictable.';
  const reasons = [];
  let evidenceWeight = 0;
  const addReason = (reason, weight = 1) => {
    if (typeof reason !== 'string' || !reason.trim()) {
      return;
    }
    reasons.push(reason.trim());
    evidenceWeight += weight;
  };

  if (weatherUnavailableSignal && trend.length === 0 && maxDepthIn === null && maxSweIn === null && !hasRainAccumulationSignal && !hasFreshSnowSignal) {
    code = 'weather_unavailable';
    label = '⚠️ Weather Unavailable';
    impact = 'moderate';
    recommendedTravel = 'Do not rely on this surface estimate. Check official products, then test traction and supportability in low-consequence terrain before committing.';
    addReason('Weather feed is unavailable, so terrain classification confidence is limited.', 1);
  } else if (
    noSnowOrWetSignal &&
    (precipChance === null || precipChance <= 25) &&
    (humidity === null || humidity <= 75) &&
    (tempF === null || tempF >= 35)
  ) {
    code = 'dry_firm';
    label = '✅ Dry / Firm Trail';
    impact = 'low';
    recommendedTravel = 'Normal pacing is reasonable, but test loose or rocky sections before exposed moves and keep standard traction available.';
    addReason('No strong snow, rain, or freeze-thaw signal is present in recent/expected conditions.', 2);
    if (precipChance !== null) {
      addReason(`Low precipitation chance (${Math.round(precipChance)}%) supports drier surfaces.`, 1);
    }
    if (humidity !== null) {
      addReason(`Humidity near ${Math.round(humidity)}% indicates limited moisture loading at the surface.`, 1);
    }
    if (noBroadSnowSignal) {
      addReason('Snowpack observations remain near-zero, reducing broad snow-on-trail concerns.', 1);
    }
  } else if (hasSnowCoverage || hasSnowWeatherSignal || hasFreshSnowSignal || snowTrendHours >= 2) {
    if (snowProfile.code === 'fresh_powder') {
      code = 'snow_fresh_powder';
      label = '❄️ Fresh Powder Snow';
      impact = 'high';
      recommendedTravel = 'Allow extra time for hidden obstacles and route-finding; use conservative terrain and spacing until depth and supportability are confirmed.';
    } else if (snowProfile.code === 'spring_snow') {
      code = 'spring_snow';
      label = '🌤️ Corn-Snow Cycle';
      impact = 'moderate';
      recommendedTravel = `${meltFreeze.summary} Test boot penetration and surface water before steep solar terrain, and leave when supportability starts to fail.`;
    } else if (snowProfile.code === 'wet_slushy_snow') {
      code = 'wet_snow';
      label = '💧 Wet / Slushy Snow';
      impact = 'high';
      recommendedTravel = `${meltFreeze.summary} Shorten exposure and leave avalanche paths before boot penetration or free water increases.`;
    } else if (snowProfile.code === 'icy_hardpack') {
      code = 'snow_ice';
      label = '🧊 Icy / Firm Snow';
      impact = 'high';
      recommendedTravel = 'Use traction suited to firm or icy snow, and avoid any slope where a slip would be consequential; turn around if secure footing is not possible.';
    } else {
      code = 'snow_mixed';
      label = '❄️ Mixed Snow Surface';
      impact = 'moderate';
      recommendedTravel = 'Test traction and supportability whenever aspect or elevation changes; stay on lower-angle terrain and turn around if the surface becomes unpredictable.';
    }
    addReason(snowProfile.summary, 2);
    if (maxDepthIn !== null || maxSweIn !== null) {
      addReason(
        `Snowpack signal near objective: depth ${maxDepthIn !== null ? `${maxDepthIn.toFixed(1)} in` : 'N/A'}, SWE ${
          maxSweIn !== null ? `${maxSweIn.toFixed(1)} in` : 'N/A'
        }.`,
        2,
      );
    }
    if (hasFreshSnowSignal) {
      addReason(
        `Recent snowfall: ${snow12hIn !== null ? `${snow12hIn.toFixed(1)} in` : 'N/A'} (12h), ${
          snow24hIn !== null ? `${snow24hIn.toFixed(1)} in` : 'N/A'
        } (24h), ${snow48hIn !== null ? `${snow48hIn.toFixed(1)} in` : 'N/A'} (48h).`,
        2,
      );
    }
    if (hasExpectedSnowSignal) {
      addReason(
        `Expected snowfall in the next ${Math.round(expectedWindowHours || 12)}h is ${expectedSnowWindowIn !== null ? `${expectedSnowWindowIn.toFixed(1)} in` : 'N/A'}.`,
        1,
      );
    }
    if (hasSnowWeatherSignal || snowTrendHours > 0) {
      addReason(
        snowTrendHours > 0
          ? `Near-term forecast shows ${snowTrendHours} hour(s) with snow/icy cues in the next 6 hours.`
          : `Forecast description indicates winter surface cues ("${weatherData?.description || 'snow signal'}").`,
        1,
      );
    }
    if (tempF !== null && tempF <= 34) {
      addReason(`Temperature near ${Math.round(tempF)}F supports firm/refrozen surface conditions.`, 1);
    }
  } else if (hasRainWeatherSignal || wetTrendHours >= 1 || hasRainAccumulationSignal || hasExpectedRainSignal) {
    code = 'wet_muddy';
    label = '🌧️ Wet / Muddy';
    impact = 'moderate';
    recommendedTravel = 'Slow down on steep or eroded sections, use poles on descents, avoid widening the trail, and turn around where secure footing cannot be maintained.';
    if (hasRainAccumulationSignal) {
      addReason(
        `Recent rainfall: ${rain12hIn !== null ? `${rain12hIn.toFixed(2)} in` : 'N/A'} (12h), ${
          rain24hIn !== null ? `${rain24hIn.toFixed(2)} in` : 'N/A'
        } (24h), ${rain48hIn !== null ? `${rain48hIn.toFixed(2)} in` : 'N/A'} (48h).`,
        2,
      );
    }
    if (hasExpectedRainSignal) {
      addReason(
        `Expected rain in next ${Math.round(expectedWindowHours || 12)}h is ${expectedRainWindowIn !== null ? `${expectedRainWindowIn.toFixed(2)} in` : 'N/A'}.`,
        1,
      );
    }
    if (wetTrendHours > 0) {
      addReason(`Near-term forecast shows ${wetTrendHours} wet hour(s) in the next 6 hours.`, 1);
    }
    if (hasRainWeatherSignal) {
      addReason(`Forecast condition carries wet surface cues ("${weatherData?.description || 'rain signal'}").`, 1);
    }
  } else if (hasFreezeThawSignal || (tempF !== null && tempF <= 38 && precipChance !== null && precipChance >= 35)) {
    code = 'cold_slick';
    label = '🧊 Cold / Slick';
    impact = 'moderate';
    recommendedTravel = 'Expect patchy ice or frozen mud in shaded terrain; carry appropriate traction and avoid exposed sections if secure footing is uncertain.';
    if (hasFreezeThawSignal && freezeThawMinTempF !== null && freezeThawMaxTempF !== null) {
      addReason(
        `Freeze-thaw signal in next ${Math.round(tempContextWindowHours)} hours (${Math.round(freezeThawMinTempF)}F to ${Math.round(
          freezeThawMaxTempF,
        )}F).`,
        2,
      );
    }
    if (tempF !== null) {
      addReason(`Current temperature near freezing (${Math.round(tempF)}F).`, 1);
    }
    if (precipChance !== null && precipChance >= 35) {
      addReason(`Moisture risk remains elevated (${Math.round(precipChance)}% precip chance).`, 1);
    }
  } else if (hasDryWindySignal || (humidity !== null && humidity < 30 && (precipChance === null || precipChance < 20))) {
    code = 'dry_loose';
    label = '🌵 Dry / Loose';
    impact = 'moderate';
    recommendedTravel = 'Reduce speed on corners and descents, use poles for control, and avoid exposed moves where loose gravel makes a slip consequential.';
    if (humidity !== null) {
      addReason(`Low humidity (${Math.round(humidity)}%) supports loose/dry surface texture.`, 1);
    }
    if (gustMph !== null || windMph !== null) {
      addReason(`Wind exposure ${Math.round(gustMph ?? windMph ?? 0)} mph can dry and loosen top surface layers.`, 1);
    }
    if (precipChance !== null) {
      addReason(`Low moisture signal (${Math.round(precipChance)}% precip chance).`, 1);
    }
  } else {
    code = 'mixed_variable';
    label = '🌲 Variable Surface';
    impact = 'moderate';
    recommendedTravel = 'Expect changing surfaces across aspect and elevation; test footing at each transition and keep a lower-consequence route option available.';
    addReason('No single dominant wet, snow/ice, or freeze-thaw signal in current upstream data.', 1);
    if (tempF !== null) {
      addReason(`Temperature ${Math.round(tempF)}F with ${precipChance !== null ? `${Math.round(precipChance)}%` : 'unknown'} precip chance supports mixed surface outcomes.`, 1);
    }
  }

  if (snotelDistanceKm !== null && snotelDistanceKm > 80) {
    addReason(`Nearest SNOTEL station is ${snotelDistanceKm.toFixed(1)} km away, so local representativeness is lower.`, 0);
  }

  const confidence = code === 'weather_unavailable' ? 'low' : evidenceWeight >= 5 ? 'high' : evidenceWeight >= 3 ? 'medium' : 'low';
  const summary = reasons.length > 0
    ? reasons.slice(0, 2).join(' ')
    : 'Surface classification is based on weather description, precipitation probability, rolling rain/snow totals, temperature trend, and snowpack observations.';

  return {
    code,
    label,
    impact,
    recommendedTravel,

    snowProfile,
    confidence,
    summary,
    reasons: reasons.slice(0, 6),
    signals: {
      tempF,
      precipChance,
      humidity,
      windMph,
      gustMph,
      wetTrendHours,
      snowTrendHours,
      rain12hIn,
      rain24hIn,
      rain48hIn,
      snow12hIn,
      snow24hIn,
      snow48hIn,
      expectedRainWindowIn,
      expectedSnowWindowIn,
      maxSnowDepthIn: maxDepthIn,
      maxSweIn,
      snotelDistanceKm,
      cdecDistanceKm,
      snowpackSourceCount: [
        snotelNearby && (snotelDepth !== null || snotelSwe !== null),
        nohrscDepth !== null || nohrscSwe !== null,
        cdecNearby && (cdecDepth !== null || cdecSwe !== null),
      ].filter(Boolean).length,
      tempContextWindowHours,
      tempContextMinF,
      tempContextMaxF,
      tempContextOvernightLowF,
      tempContextDaytimeHighF,
      freezeThawMinTempF,
      freezeThawMaxTempF,
      cloudCover,
      meltFreezeCycleDetected: meltFreeze.cycleDetected,
      refreezeQuality: meltFreeze.refreezeQuality,
      solarInput: meltFreeze.solarInput,
      meltPotential: meltFreeze.meltPotential,
      snowSurfacePhase: meltFreeze.phase,
    },
  };
};

const deriveTrailStatus = (weatherData, snowpackData = null, rainfallData = null) => {
  const terrainCondition = deriveTerrainCondition(weatherData, snowpackData, rainfallData);
  return terrainCondition?.label || '🌲 Variable Surface';
};

module.exports = {
  deriveTerrainCondition,
  deriveTrailStatus,
};
