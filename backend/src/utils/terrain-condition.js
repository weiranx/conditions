const deriveTerrainCondition = (weatherData, snowpackData = null, rainfallData = null) => {
  const toFinite = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const description = String(weatherData?.description || '').toLowerCase();
  const precipChance = toFinite(weatherData?.precipChance);
  const humidity = toFinite(weatherData?.humidity);
  const tempF = toFinite(weatherData?.temp);
  const windMph = toFinite(weatherData?.windSpeed);
  const gustMph = toFinite(weatherData?.windGust);

  const trend = Array.isArray(weatherData?.trend) ? weatherData.trend : [];
  const nearTermTrend = trend.slice(0, 6);
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
    (trendMinTemp !== null && trendMaxTemp !== null && trendMinTemp <= 31 && trendMaxTemp >= 35) ||
    (tempF !== null && tempF >= 30 && tempF <= 36 && precipChance !== null && precipChance >= 35);
  const hasDryWindySignal =
    (humidity !== null && humidity <= 30) &&
    (precipChance === null || precipChance < 20) &&
    ((gustMph !== null && gustMph >= 25) || (windMph !== null && windMph >= 16));
  const weatherUnavailableSignal = !description || /weather data unavailable|weather unavailable|unavailable/.test(description);

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
    code = 'snow_ice';
    label = '❄️ Snow-Covered / Icy';
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
    if (hasFreezeThawSignal && trendMinTemp !== null && trendMaxTemp !== null) {
      addReason(`Freeze-thaw signal in next 6 hours (${Math.round(trendMinTemp)}F to ${Math.round(trendMaxTemp)}F).`, 2);
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
