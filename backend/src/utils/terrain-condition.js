const toFinite = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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
    };
  }

  if (
    hasSnowCoverage &&
    hasFreezeThawSignal &&
    freezeThawMinTempF !== null &&
    freezeThawMaxTempF !== null &&
    freezeThawMinTempF <= 31 &&
    freezeThawMaxTempF >= 38 &&
    !hasRainAccumulationSignal &&
    wetTrendHours === 0
  ) {
    addReason('Freeze-thaw pattern supports spring-style corn cycles on solar aspects.');
    addReason(
      `${tempContextWindowHours || 24}h temperature swing (${Math.round(freezeThawMinTempF)}F to ${Math.round(
        freezeThawMaxTempF,
      )}F) aligns with spring transition snow.`,
    );
    return {
      code: 'spring_snow',
      label: '🌤️ Spring Snow',
      summary: 'Freeze-thaw cycle indicates spring snow (corn window potential with rapid warming effects).',
      confidence: 'medium',
      reasons: reasons.slice(0, 4),
    };
  }

  if (
    hasSnowCoverage &&
    ((tempF !== null && tempF >= 34) || (freezeThawMaxTempF !== null && freezeThawMaxTempF >= 36)) &&
    (hasRainAccumulationSignal || wetTrendHours >= 1 || (precipChance !== null && precipChance >= 45))
  ) {
    addReason('Warm/wet signal on top of snowpack supports wet, heavy, or slushy surface snow.');
    if (precipChance !== null) {
      addReason(`Precipitation chance (${Math.round(precipChance)}%) increases wet-snow likelihood.`);
    }
    return {
      code: 'wet_slushy_snow',
      label: '💧 Wet / Slushy Snow',
      summary: 'Warm and/or wet signal over existing snowpack suggests slushy, heavy surface conditions.',
      confidence: 'medium',
      reasons: reasons.slice(0, 4),
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
    };
  }

  addReason('Snowpack signal exists, but no single fresh/icy/spring pattern dominates.');
  return {
    code: 'mixed_snow',
    label: '❄️ Mixed Snow Surface',
    summary: 'Mixed snow profile with variable firmness and moisture across terrain/aspects.',
    confidence: hasSnowCoverage ? 'medium' : 'low',
    reasons: reasons.slice(0, 4),
  };
};

const deriveTerrainCondition = (weatherData, snowpackData = null, rainfallData = null) => {

  const description = String(weatherData?.description || '').toLowerCase();
  const precipChance = toFinite(weatherData?.precipChance);
  const humidity = toFinite(weatherData?.humidity);
  const tempF = toFinite(weatherData?.temp);
  const windMph = toFinite(weatherData?.windSpeed);
  const gustMph = toFinite(weatherData?.windGust);

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
    const pointCondition = String(point?.condition || '').toLowerCase();
    return (pointPrecip !== null && pointPrecip >= 35 && tempF !== null && tempF <= 34) || /snow|sleet|freezing|flurr|wintry|ice/.test(pointCondition);
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
  const nohrsc = snowpackData?.nohrsc || null;
  const snotelDistanceKm = toFinite(snotel?.distanceKm);
  const snotelNearby = snotelDistanceKm === null || snotelDistanceKm <= 80;

  const depthSamples = [];
  const sweSamples = [];
  const snotelDepth = toFinite(snotel?.snowDepthIn);
  const snotelSwe = toFinite(snotel?.sweIn);
  const nohrscDepth = toFinite(nohrsc?.snowDepthIn);
  const nohrscSwe = toFinite(nohrsc?.sweIn);

  if (snotelNearby && snotelDepth !== null) depthSamples.push(snotelDepth);
  if (snotelNearby && snotelSwe !== null) sweSamples.push(snotelSwe);
  if (nohrscDepth !== null) depthSamples.push(nohrscDepth);
  if (nohrscSwe !== null) sweSamples.push(nohrscSwe);

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
  const hasRainAccumulationSignal =
    (rain12hIn !== null && rain12hIn >= 0.1) ||
    (rain24hIn !== null && rain24hIn >= 0.2) ||
    (rain48hIn !== null && rain48hIn >= 0.35);
  const hasFreshSnowSignal =
    (snow12hIn !== null && snow12hIn >= 0.5) ||
    (snow24hIn !== null && snow24hIn >= 1.5) ||
    (snow48hIn !== null && snow48hIn >= 2.5);
  const hasFreezeThawSignal =
    (freezeThawMinTempF !== null && freezeThawMaxTempF !== null && freezeThawMinTempF <= 31 && freezeThawMaxTempF >= 35) ||
    (tempF !== null && tempF >= 30 && tempF <= 36 && precipChance !== null && precipChance >= 35);
  const hasDryWindySignal =
    (humidity !== null && humidity <= 30) &&
    (precipChance === null || precipChance < 20) &&
    ((gustMph !== null && gustMph >= 25) || (windMph !== null && windMph >= 16));
  const weatherUnavailableSignal = !description || /weather data unavailable|weather unavailable|unavailable/.test(description);

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
  });

  let code = 'variable_surface';
  let label = '🌲 Variable Surface';
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
    addReason('Weather feed is unavailable, so terrain classification confidence is limited.', 1);
  } else if (hasSnowCoverage || hasSnowWeatherSignal || hasFreshSnowSignal || snowTrendHours >= 2) {
    if (snowProfile.code === 'fresh_powder') {
      code = 'snow_fresh_powder';
      label = '❄️ Fresh Powder Snow';
    } else if (snowProfile.code === 'spring_snow') {
      code = 'spring_snow';
      label = '🌤️ Spring Snow';
    } else if (snowProfile.code === 'wet_slushy_snow') {
      code = 'wet_snow';
      label = '💧 Wet / Slushy Snow';
    } else if (snowProfile.code === 'icy_hardpack') {
      code = 'snow_ice';
      label = '🧊 Icy / Firm Snow';
    } else {
      code = 'snow_ice';
      label = '❄️ Mixed Snow Surface';
    }
    addReason(snowProfile.summary, 2);
    if (Array.isArray(snowProfile.reasons) && snowProfile.reasons.length > 0) {
      snowProfile.reasons.forEach((reason) => addReason(reason, 1));
    }
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
    if (hasSnowWeatherSignal || snowTrendHours > 0) {
      addReason(
        snowTrendHours > 0
          ? `Near-term forecast shows ${snowTrendHours} hour(s) with snow/icy cues in the next 6 hours.`
          : `Forecast description indicates winter surface cues ("${weatherData?.description || 'snow signal'}").`,
        1,
      );
    }
    if (tempF !== null && tempF <= 34) {
      addReason(`Temperature near ${Math.round(tempF)}F supports icy persistence.`, 1);
    }
  } else if (hasRainWeatherSignal || wetTrendHours >= 1 || hasRainAccumulationSignal) {
    code = 'wet_muddy';
    label = '🌧️ Wet / Muddy';
    if (hasRainAccumulationSignal) {
      addReason(
        `Recent rainfall: ${rain12hIn !== null ? `${rain12hIn.toFixed(2)} in` : 'N/A'} (12h), ${
          rain24hIn !== null ? `${rain24hIn.toFixed(2)} in` : 'N/A'
        } (24h), ${rain48hIn !== null ? `${rain48hIn.toFixed(2)} in` : 'N/A'} (48h).`,
        2,
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
      maxSnowDepthIn: maxDepthIn,
      maxSweIn,
      snotelDistanceKm,
      tempContextWindowHours,
      tempContextMinF,
      tempContextMaxF,
      tempContextOvernightLowF,
      tempContextDaytimeHighF,
      freezeThawMinTempF,
      freezeThawMaxTempF,
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
