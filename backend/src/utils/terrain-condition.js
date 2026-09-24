const { snowEvidence, surfaceIntervals, meltFreezeAnalysis, groundMoisture, surfaceOutlook } = require('./surface-evidence');
const { toFiniteOrNull: toFinite } = require('./numbers');

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
    addReason('Recent or forecast snowfall with cold temperatures supports possible soft surface snow; wind crust and supportability are unmeasured.');
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
      confidence: 'medium',
      reasons: reasons.slice(0, 4),
      meltFreeze,
    };
  }

  if (
    hasSnowCoverage &&
    meltFreeze?.cycleDetected &&
    freezeThawMinTempF !== null &&
    freezeThawMaxTempF !== null &&
    freezeThawMinTempF <= 31 &&
    freezeThawMaxTempF >= 38 &&
    !hasRainAccumulationSignal &&
    wetTrendHours === 0
  ) {
    addReason('Preceding-night freezing and travel-window warming support a possible firm-to-soft transition; corn snow is unconfirmed.');
    addReason(
      `${tempContextWindowHours || 24}h temperature swing (${Math.round(freezeThawMinTempF)}F to ${Math.round(
        freezeThawMaxTempF,
      )}F) aligns with a spring corn-cycle pattern.`,
    );
    return {
      code: 'spring_snow',
      label: '🌤️ Freeze-Thaw Snow',
      summary: meltFreeze?.summary || 'Freeze-thaw cycle indicates a corn-snow window with rapid daytime softening potential.',
      confidence: 'medium',
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
      summary: 'Cold snow has firm or icy travel potential; supportability and prior refreeze remain unconfirmed.',
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
  const travelIntervals = surfaceIntervals(weatherData, options);
  const nearTermTrend = travelIntervals.rows.length ? travelIntervals.rows : trend.slice(0, options.selectedTravelWindowHours || 6);
  const contextTrend = trend.slice(0, 24);
  const wetTrendHours = nearTermTrend.filter((point) => {
    const pointPrecip = toFinite(point?.precipChance);
    const pointCondition = String(point?.condition || '').toLowerCase();
    return (pointPrecip !== null && pointPrecip >= 55) || /rain|drizzle|shower|thunder|storm|wet/.test(pointCondition);
  }).reduce((sum, point) => sum + (point.durationHours ?? 1), 0);
  const snowTrendHours = nearTermTrend.filter((point) => {
    const pointPrecip = toFinite(point?.precipChance);
    const pointTemp = toFinite(point?.temp);
    const pointCondition = String(point?.condition || '').toLowerCase();
    return (pointPrecip !== null && pointPrecip >= 35 && pointTemp !== null && pointTemp <= 34) || /snow|sleet|freezing|flurr|wintry|ice/.test(pointCondition);
  }).reduce((sum, point) => sum + (point.durationHours ?? 1), 0);
  const trendTemps = nearTermTrend.map((point) => toFinite(point?.temp)).filter((value) => value !== null);
  const trendMaxTemp = trendTemps.length > 0 ? Math.max(...trendTemps) : null;
  const contextTrendTemps = contextTrend.map((point) => toFinite(point?.temp)).filter((value) => value !== null);
  const contextTrendMaxTemp = contextTrendTemps.length > 0 ? Math.max(...contextTrendTemps) : null;
  const tempContext24h = weatherData?.temperatureContext24h || null;
  const tempContextWindowHours = toFinite(tempContext24h?.windowHours) || 24;
  const tempContextMinF = toFinite(tempContext24h?.minTempF);
  const tempContextMaxF = toFinite(tempContext24h?.maxTempF);
  const tempContextOvernightLowF = toFinite(tempContext24h?.overnightLowF);
  const tempContextDaytimeHighF = toFinite(tempContext24h?.daytimeHighF);
  const freezeThawMinTempF = weatherData?.precedingNight?.complete ? toFinite(weatherData.precedingNight.minTempF) : null;
  const freezeThawMaxTempF = tempContextDaytimeHighF ?? tempContextMaxF ?? contextTrendMaxTemp ?? trendMaxTemp;

  const snotel = snowpackData?.snotel || null;
  const cdec = snowpackData?.cdec || null;
  const snotelDistanceKm = toFinite(snotel?.distanceKm);
  const cdecDistanceKm = toFinite(cdec?.distanceKm);

  const evidence = snowEvidence(snowpackData, weatherData);
  const maxDepthIn = evidence.depthIn;
  const maxSweIn = evidence.sweIn;
  const moisture = groundMoisture(rainfallData, weatherData);
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

  const meltFreeze = meltFreezeAnalysis(weatherData, options, hasSnowCoverage || hasFreshSnowSignal || hasExpectedSnowSignal || hasSnowWeatherSignal);

  const snowProfile = deriveSnowProfile({
    hasSnowCoverage,
    hasSnowWeatherSignal: hasSnowWeatherSignal || hasExpectedSnowSignal,
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

  const addReason = (reason) => {
    if (typeof reason !== 'string' || !reason.trim()) {
      return;
    }
    reasons.push(reason.trim());

  };

  if (weatherUnavailableSignal && trend.length === 0 && maxDepthIn === null && maxSweIn === null && !hasRainAccumulationSignal && !hasFreshSnowSignal) {
    code = 'weather_unavailable';
    label = '⚠️ Weather Unavailable';
    impact = 'moderate';
    recommendedTravel = 'Do not rely on this surface estimate. Check official products, then test traction and supportability in low-consequence terrain before committing.';
    addReason('Weather feed is unavailable, so terrain classification confidence is limited.', 1);
  } else if (
    noSnowOrWetSignal && !hasFreezeThawSignal && noBroadSnowSignal && !evidence.disagreement && evidence.quality === 'representative' &&
    rain48hIn !== null && rain48hIn < 0.1 && expectedRainWindowIn !== null && expectedRainWindowIn < 0.05 &&
    expectedSnowWindowIn !== null && expectedSnowWindowIn < 0.1 &&
    moisture.state !== 'retained_moisture_possible' &&
    precipChance !== null && precipChance <= 25 && humidity !== null && humidity >= 30 && humidity <= 75 &&
    tempF !== null && tempF >= 35
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
  } else if (hasSnowCoverage || hasSnowWeatherSignal || hasFreshSnowSignal || hasExpectedSnowSignal || snowTrendHours >= 2) {
    if (snowProfile.code === 'fresh_powder') {
      code = 'snow_fresh_powder';
      label = '❄️ Fresh Powder Snow';
      impact = 'high';
      recommendedTravel = 'Allow extra time for hidden obstacles and route-finding; use conservative terrain and spacing until depth and supportability are confirmed.';
    } else if (snowProfile.code === 'spring_snow') {
      code = 'spring_snow';
      label = '🌤️ Freeze-Thaw Snow';
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
          ? `Near-term forecast shows ${snowTrendHours} hour(s) with snow/icy cues during the travel window.`
          : `Forecast description indicates winter surface cues ("${weatherData?.description || 'snow signal'}").`,
        1,
      );
    }
    if (tempF !== null && tempF <= 34) {
      addReason(`Temperature near ${Math.round(tempF)}F supports firm/refrozen surface conditions.`, 1);
    }
  } else if (hasRainWeatherSignal || wetTrendHours >= 1 || hasRainAccumulationSignal || hasExpectedRainSignal || moisture.state === 'retained_moisture_possible') {
    if (moisture.state === 'retained_moisture_possible') addReason(moisture.summary);
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
      addReason(`Near-term forecast shows ${wetTrendHours} wet hour(s) during the travel window.`, 1);
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
    label = '🌵 Drying / Footing Uncertain';
    impact = 'moderate';
    recommendedTravel = 'Reduce speed on corners and descents, use poles for control, and avoid exposed moves where loose gravel makes a slip consequential.';
    if (humidity !== null) {
      addReason(`Low humidity (${Math.round(humidity)}%) supports drying, but does not establish trail texture.`, 1);
    }
    if (gustMph !== null || windMph !== null) {
      addReason(`Wind exposure ${Math.round(gustMph ?? windMph ?? 0)} mph can promote drying; loose footing is unconfirmed.`, 1);
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

  const interval = surfaceIntervals(weatherData, options);
  const confidenceReasons = [];
  if (tempF === null || precipChance === null) confidenceReasons.push('Temperature or precipitation probability is missing.');
  if (interval.coverageHours < interval.hours - 0.01) confidenceReasons.push('Hourly temperature coverage is incomplete.');
  if (evidence.quality !== 'representative') confidenceReasons.push('Snow observations lack fresh, representative location/elevation evidence.');
  if (evidence.disagreement) confidenceReasons.push('Snow observations disagree on broad snow presence.');
  if (rain48hIn === null || expectedRainWindowIn === null) confidenceReasons.push('Recent or expected precipitation amounts are missing.');
  if (hasSnowCoverage && meltFreeze.refreezeQuality === 'unknown') confidenceReasons.push('Preceding-night refreeze evidence is incomplete.');
  const leadHours = interval.start === null ? null : (interval.start - Date.now()) / 3600000;
  if (leadHours === null || leadHours > 48) confidenceReasons.push('Forecast lead time is long or unavailable.');
  // Surface texture is indirect, even with complete weather and snow evidence.
  const essentialWeather = tempF !== null && precipChance !== null && interval.coverageHours >= interval.hours - 0.01;
  const moistureEvidence = rain48hIn !== null && expectedRainWindowIn !== null;
  const snowEvidenceRequired = hasSnowCoverage || code === 'dry_firm';
  const confidence = !essentialWeather || !moistureEvidence || evidence.disagreement ||
    (snowEvidenceRequired && evidence.quality !== 'representative') ||
    code === 'weather_unavailable' || code === 'mixed_variable' || leadHours === null || leadHours > 48 ? 'low' : 'medium';
  snowProfile.confidence = confidence;
  const outlook = surfaceOutlook(weatherData, options, hasSnowCoverage || hasExpectedSnowSignal || hasFreshSnowSignal, moisture, code);
  if (code === 'mixed_variable') addReason('Surface evidence is insufficient to establish dry, firm footing.');
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
    confidenceReasons,
    evidence,
    moisture,
    outlook,
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
      snowpackSourceCount: evidence.sourceCount,
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
