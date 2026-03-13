const { parseIsoTimeToMs } = require('./time');
const { computeFeelsLikeF } = require('./weather-normalizers');
const { parseWindMph } = require('./wind');
const { clampTravelWindowHours, parseClockToMinutes, parseIsoClockMinutes } = require('./time');
const { normalizeAlertSeverity } = require('./alerts');

const calculateSafetyScore = ({
  weatherData,
  avalancheData,
  alertsData,
  airQualityData,
  fireRiskData,
  heatRiskData,
  rainfallData,
  selectedDate,
  solarData,
  selectedStartClock,
  selectedTravelWindowHours = null,
}) => {
  const explanations = [];
  const factors = [];
  const groupCaps = {
    avalanche: 55,
    weather: 42,
    alerts: 24,
    airQuality: 20,
    fire: 18,
  };

  const AVALANCHE_UNKNOWN_MESSAGE =
    "No official avalanche center forecast covers this objective. Avalanche terrain can still be dangerous. Treat conditions as unknown and use conservative terrain choices.";

  const mapHazardToGroup = (hazard) => {
    const normalized = String(hazard || '').toLowerCase();
    if (normalized.includes('avalanche')) return 'avalanche';
    if (normalized.includes('alert')) return 'alerts';
    if (normalized.includes('air quality')) return 'airQuality';
    if (normalized.includes('fire')) return 'fire';
    return 'weather';
  };

  const applyFactor = (hazard, impact, message, source) => {
    if (!Number.isFinite(impact) || impact <= 0) {
      return;
    }
    factors.push({ hazard, impact, source, message, group: mapHazardToGroup(hazard) });
    explanations.push(message);
  };

  const weatherDescription = String(weatherData?.description || '').toLowerCase();
  const wind = parseFloat(weatherData?.windSpeed);
  const gust = parseFloat(weatherData?.windGust);
  const precipChance = parseFloat(weatherData?.precipChance);
  const humidity = parseFloat(weatherData?.humidity);
  const tempF = parseFloat(weatherData?.temp);
  const feelsLikeF = Number.isFinite(parseFloat(weatherData?.feelsLike)) ? parseFloat(weatherData?.feelsLike) : tempF;
  const isDaytime = weatherData?.isDaytime;
  const visibilityRiskScoreRaw = Number(weatherData?.visibilityRisk?.score);
  const visibilityRiskScore = Number.isFinite(visibilityRiskScoreRaw) ? visibilityRiskScoreRaw : null;
  const visibilityRiskLevel = String(weatherData?.visibilityRisk?.level || '').trim();
  const visibilityActiveHoursRaw = Number(weatherData?.visibilityRisk?.activeHours);
  const visibilityActiveHours = Number.isFinite(visibilityActiveHoursRaw) ? visibilityActiveHoursRaw : null;

  const normalizedRisk = String(avalancheData?.risk || '').toLowerCase();
  const avalancheRelevant = avalancheData?.relevant !== false;
  const avalancheUnknown = avalancheRelevant
    && Boolean(avalancheData?.dangerUnknown || normalizedRisk.includes('unknown') || normalizedRisk.includes('no forecast'));
  const avalancheDangerLevel = Number(avalancheData?.dangerLevel);
  const avalancheProblemCount = Array.isArray(avalancheData?.problems) ? avalancheData.problems.length : 0;

  const alertsStatus = String(alertsData?.status || '');
  const alertsCount = Number(alertsData?.activeCount);
  const highestAlertSeverity = normalizeAlertSeverity(alertsData?.highestSeverity);
  const alertEvents =
    Array.isArray(alertsData?.alerts) && alertsData.alerts.length
      ? [...new Set(alertsData.alerts.map((alert) => alert.event).filter(Boolean))].slice(0, 3)
      : [];

  const usAqi = Number(airQualityData?.usAqi);
  const airQualityStatus = String(airQualityData?.status || '').toLowerCase();
  const airQualityRelevantForScoring = airQualityStatus !== 'not_applicable_future_date';
  const aqiCategory = String(airQualityData?.category || 'Unknown');

  const trend = Array.isArray(weatherData?.trend) ? weatherData.trend : [];
  const requestedWindowHours = clampTravelWindowHours(selectedTravelWindowHours, 12);
  const effectiveTrendWindowHours = Math.max(1, trend.length || requestedWindowHours);
  const trendTemps = trend.map((item) => Number(item?.temp)).filter(Number.isFinite);
  const trendGusts = trend.map((item) => Number(item?.gust)).filter(Number.isFinite);
  const trendPrecips = trend.map((item) => Number(item?.precipChance)).filter(Number.isFinite);
  const trendFeelsLike = trend
    .map((item) => {
      const rowTemp = Number(item?.temp);
      const rowWind = Number.isFinite(Number(item?.wind)) ? Number(item.wind) : 0;
      if (!Number.isFinite(rowTemp)) return Number.NaN;
      return computeFeelsLikeF(rowTemp, Number.isFinite(rowWind) ? rowWind : 0);
    })
    .filter(Number.isFinite);
  const tempRange = trendTemps.length ? Math.max(...trendTemps) - Math.min(...trendTemps) : 0;
  const trendMinFeelsLike = trendFeelsLike.length ? Math.min(...trendFeelsLike) : feelsLikeF;
  const trendMaxFeelsLike = trendFeelsLike.length ? Math.max(...trendFeelsLike) : feelsLikeF;
  const trendPeakPrecip = trendPrecips.length ? Math.max(...trendPrecips) : precipChance;
  const trendPeakGust = trendGusts.length ? Math.max(...trendGusts) : Number.isFinite(gust) ? gust : 0;
  const severeWindHours = trend.filter((item) => {
    const rowWind = Number(item?.wind);
    const rowGust = Number.isFinite(Number(item?.gust)) ? Number(item.gust) : rowWind;
    return (Number.isFinite(rowWind) && rowWind >= 30) || (Number.isFinite(rowGust) && rowGust >= 45);
  }).length;
  const strongWindHours = trend.filter((item) => {
    const rowWind = Number(item?.wind);
    const rowGust = Number.isFinite(Number(item?.gust)) ? Number(item.gust) : rowWind;
    return (Number.isFinite(rowWind) && rowWind >= 20) || (Number.isFinite(rowGust) && rowGust >= 30);
  }).length;
  const highPrecipHours = trendPrecips.filter((value) => value >= 60).length;
  const moderatePrecipHours = trendPrecips.filter((value) => value >= 40).length;
  const coldExposureHours = trendFeelsLike.filter((value) => value <= 15).length;
  const extremeColdHours = trendFeelsLike.filter((value) => value <= 0).length;
  const heatExposureHours = trendFeelsLike.filter((value) => value >= 85).length;

  // Temporal weighting: early-window hazards penalize more than late-window
  const trendLen = trend.length;
  const temporalWeight = (i) => {
    if (trendLen <= 1) return 1.0;
    return 1.0 - 0.7 * (i / (trendLen - 1));
  };
  let weightedSevereWindHours = 0;
  let weightedStrongWindHours = 0;
  let weightedHighPrecipHours = 0;
  let weightedModeratePrecipHours = 0;
  let weightedTrendPeakGust = 0;
  trend.forEach((item, i) => {
    const w = temporalWeight(i);
    const rowWind = Number(item?.wind);
    const rowGust = Number.isFinite(Number(item?.gust)) ? Number(item.gust) : rowWind;
    if ((Number.isFinite(rowWind) && rowWind >= 30) || (Number.isFinite(rowGust) && rowGust >= 45)) {
      weightedSevereWindHours += w;
    }
    if ((Number.isFinite(rowWind) && rowWind >= 20) || (Number.isFinite(rowGust) && rowGust >= 30)) {
      weightedStrongWindHours += w;
    }
    if (Number.isFinite(rowGust)) {
      weightedTrendPeakGust = Math.max(weightedTrendPeakGust, rowGust);
    }
    const rowPrecip = Number(item?.precipChance);
    if (Number.isFinite(rowPrecip) && rowPrecip >= 60) {
      weightedHighPrecipHours += w;
    }
    if (Number.isFinite(rowPrecip) && rowPrecip >= 40) {
      weightedModeratePrecipHours += w;
    }
  });

  const rainfallTotals = rainfallData?.totals || {};
  const rainfallExpected = rainfallData?.expected || {};
  const rainPast24hIn = Number(rainfallTotals?.rainPast24hIn ?? rainfallTotals?.past24hIn);
  const snowPast24hIn = Number(rainfallTotals?.snowPast24hIn);
  const expectedRainWindowIn = Number(rainfallExpected?.rainWindowIn);
  const expectedSnowWindowIn = Number(rainfallExpected?.snowWindowIn);
  const sunriseMinutes = parseClockToMinutes(solarData?.sunrise);
  const selectedStartMinutes = parseClockToMinutes(selectedStartClock) ?? parseIsoClockMinutes(weatherData?.forecastStartTime);
  const isNightBeforeSunrise =
    isDaytime === false
    && Number.isFinite(selectedStartMinutes)
    && Number.isFinite(sunriseMinutes)
    && selectedStartMinutes < sunriseMinutes;
  const forecastStartMs = parseIsoTimeToMs(weatherData?.forecastStartTime);
  const selectedDateMs =
    typeof selectedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)
      ? Date.parse(`${selectedDate}T12:00:00Z`)
      : null;
  const forecastLeadHoursRaw =
    forecastStartMs !== null
      ? (forecastStartMs - Date.now()) / (1000 * 60 * 60)
      : Number.isFinite(selectedDateMs)
        ? (selectedDateMs - Date.now()) / (1000 * 60 * 60)
        : null;
  const forecastLeadHours = Number.isFinite(forecastLeadHoursRaw) ? Number(forecastLeadHoursRaw) : null;
  const alertsRelevantForSelectedTime = forecastLeadHours === null || forecastLeadHours <= 48;

  if (avalancheRelevant) {
    if (avalancheUnknown) {
      applyFactor('Avalanche Uncertainty', 16, AVALANCHE_UNKNOWN_MESSAGE, 'Avalanche center coverage');
    } else if (Number.isFinite(avalancheDangerLevel)) {
      if (avalancheDangerLevel >= 4 || normalizedRisk.includes('high') || normalizedRisk.includes('extreme')) {
        applyFactor('Avalanche', 52, 'High avalanche danger reported. Avoid avalanche terrain and steep loaded slopes.', 'Avalanche center forecast');
      } else if (avalancheDangerLevel === 3 || normalizedRisk.includes('considerable')) {
        applyFactor('Avalanche', 34, 'Considerable avalanche danger. Conservative terrain selection and strict spacing are required.', 'Avalanche center forecast');
      } else if (avalancheDangerLevel === 2 || normalizedRisk.includes('moderate')) {
        applyFactor('Avalanche', 15, 'Moderate avalanche danger. Evaluate snowpack and avoid connected terrain traps.', 'Avalanche center forecast');
      } else if (avalancheDangerLevel === 1) {
        applyFactor('Avalanche', 4, 'Low avalanche danger still requires basic avalanche precautions in suspect terrain.', 'Avalanche center forecast');
      }
    }

    if (avalancheProblemCount >= 3) {
      applyFactor(
        'Avalanche',
        6,
        `${avalancheProblemCount} avalanche problems are listed by the center, increasing snowpack complexity.`,
        'Avalanche problem list',
      );
    }
  }

  const effectiveWind = Math.max(
    Number.isFinite(wind) ? wind : 0,
    Number.isFinite(gust) ? gust : 0,
    weightedTrendPeakGust,
  );
  if (effectiveWind >= 50 || (Number.isFinite(wind) && wind >= 35)) {
    applyFactor(
      'Wind',
      20,
      `Severe wind exposure expected (start wind ${Math.round(Number.isFinite(wind) ? wind : 0)} mph, gust ${Math.round(Number.isFinite(gust) ? gust : effectiveWind)} mph, trend peak ${Math.round(effectiveWind)} mph).`,
      'NOAA hourly forecast',
    );
  } else if (effectiveWind >= 40 || (Number.isFinite(wind) && wind >= 25)) {
    applyFactor(
      'Wind',
      12,
      `Strong winds expected (start wind ${Math.round(Number.isFinite(wind) ? wind : 0)} mph, gust ${Math.round(Number.isFinite(gust) ? gust : effectiveWind)} mph, trend peak ${Math.round(effectiveWind)} mph).`,
      'NOAA hourly forecast',
    );
  } else if (effectiveWind >= 30 || (Number.isFinite(wind) && wind >= 18)) {
    applyFactor('Wind', 6, `Moderate wind signal (trend peak ${Math.round(effectiveWind)} mph) may affect exposed movement.`, 'NOAA hourly forecast');
  }

  if (weightedSevereWindHours >= 2.8) {
    applyFactor('Wind', 8, `${severeWindHours}/${trend.length} trend hours are severe wind windows (>=30 mph sustained or >=45 mph gust).`, 'NOAA hourly trend');
  } else if (weightedSevereWindHours >= 1.5) {
    applyFactor('Wind', 5, `${severeWindHours}/${trend.length} trend hours show severe wind windows.`, 'NOAA hourly trend');
  } else if (weightedStrongWindHours >= 4.0) {
    applyFactor('Wind', 4, `${strongWindHours}/${trend.length} trend hours are windy (>=20 mph sustained or >=30 mph gust).`, 'NOAA hourly trend');
  } else if (weightedStrongWindHours >= 2.0) {
    applyFactor('Wind', 2, `${strongWindHours}/${trend.length} trend hours are windy and may reduce margin on exposed terrain.`, 'NOAA hourly trend');
  }

  if (Number.isFinite(trendPeakPrecip) && trendPeakPrecip >= 80) {
    applyFactor('Storm', 12, `Peak precipitation chance in the window reaches ${Math.round(trendPeakPrecip)}%.`, 'NOAA hourly forecast');
  } else if (Number.isFinite(trendPeakPrecip) && trendPeakPrecip >= 60) {
    applyFactor('Storm', 8, `Peak precipitation chance in the window reaches ${Math.round(trendPeakPrecip)}%.`, 'NOAA hourly forecast');
  } else if (Number.isFinite(trendPeakPrecip) && trendPeakPrecip >= 40) {
    applyFactor('Storm', 4, `Peak precipitation chance in the window reaches ${Math.round(trendPeakPrecip)}%.`, 'NOAA hourly forecast');
  }

  if (weightedHighPrecipHours >= 2.8) {
    applyFactor('Storm', 7, `${highPrecipHours}/${trend.length} trend hours are high precip windows (>=60%).`, 'NOAA hourly trend');
  } else if (weightedHighPrecipHours >= 1.5) {
    applyFactor('Storm', 4, `${highPrecipHours}/${trend.length} trend hours are high precip windows.`, 'NOAA hourly trend');
  } else if (weightedModeratePrecipHours >= 4.0) {
    applyFactor('Storm', 3, `${moderatePrecipHours}/${trend.length} trend hours are moderate precip windows (>=40%).`, 'NOAA hourly trend');
  }

  if (/thunderstorm|lightning|blizzard/.test(weatherDescription)) {
    applyFactor('Storm', 18, `Convective or severe weather signal in forecast: "${weatherData.description}".`, 'NOAA short forecast');
  } else if (/snow|sleet|freezing rain|ice/.test(weatherDescription)) {
    applyFactor('Winter Weather', 10, `Frozen precipitation in forecast ("${weatherData.description}") increases travel hazard.`, 'NOAA short forecast');
  }

  if (visibilityRiskScore !== null) {
    let visibilityImpact = 0;
    if (visibilityRiskScore >= 80) {
      visibilityImpact = 12;
    } else if (visibilityRiskScore >= 60) {
      visibilityImpact = 9;
    } else if (visibilityRiskScore >= 40) {
      visibilityImpact = 6;
    } else if (visibilityRiskScore >= 20) {
      visibilityImpact = 3;
    }
    if (visibilityImpact > 0) {
      const activeHoursNote =
        visibilityActiveHours !== null && trend.length > 0
          ? ` ${Math.round(visibilityActiveHours)}/${trend.length} trend hours show reduced-visibility signal.`
          : '';
      applyFactor(
        'Visibility',
        visibilityImpact,
        `Whiteout/visibility risk is ${visibilityRiskLevel || 'elevated'} (${Math.round(visibilityRiskScore)}/100).${activeHoursNote}`,
        weatherData?.visibilityRisk?.source || 'Derived weather visibility model',
      );
    }
  } else if (/fog|smoke|haze/.test(weatherDescription)) {
    applyFactor('Visibility', 6, `Reduced-visibility weather in forecast ("${weatherData.description}").`, 'NOAA short forecast');
  }

  if (Number.isFinite(trendMinFeelsLike) && trendMinFeelsLike <= -10) {
    applyFactor('Cold', 15, `Minimum apparent temperature in the window is ${Math.round(trendMinFeelsLike)}F.`, 'NOAA temp + windchill');
  } else if (Number.isFinite(trendMinFeelsLike) && trendMinFeelsLike <= 0) {
    applyFactor('Cold', 10, `Very cold apparent temperature in the window (${Math.round(trendMinFeelsLike)}F).`, 'NOAA temp + windchill');
  } else if (Number.isFinite(trendMinFeelsLike) && trendMinFeelsLike <= 15) {
    applyFactor('Cold', 6, `Cold apparent temperature in the window (${Math.round(trendMinFeelsLike)}F).`, 'NOAA temp + windchill');
  } else if (Number.isFinite(trendMinFeelsLike) && trendMinFeelsLike <= 25) {
    applyFactor('Cold', 3, `Cool apparent temperatures (${Math.round(trendMinFeelsLike)}F) reduce comfort and dexterity margin.`, 'NOAA temp + windchill');
  }

  const coldOnlyHours = coldExposureHours - extremeColdHours;
  const coldDurationImpact = Math.min(12, Math.round(extremeColdHours * 1.5 + coldOnlyHours * 0.8));
  if (coldDurationImpact > 0) {
    const coldLabel = extremeColdHours > 0
      ? `${extremeColdHours}/${trend.length} trend hours are at or below 0F and ${coldOnlyHours} additional hours are below 15F apparent temperature.`
      : `${coldExposureHours}/${trend.length} trend hours are at or below 15F apparent temperature.`;
    applyFactor('Cold', coldDurationImpact, coldLabel, 'NOAA hourly trend');
  }

  const heatRiskLevel = Number(heatRiskData?.level);
  if (Number.isFinite(heatRiskLevel) && heatRiskLevel >= 4) {
    applyFactor('Heat', 14, `Heat risk is ${heatRiskData?.label || 'Extreme'} with significant heat-stress potential in the selected window.`, heatRiskData?.source || 'Heat risk synthesis');
  } else if (Number.isFinite(heatRiskLevel) && heatRiskLevel >= 3) {
    applyFactor('Heat', 10, `Heat risk is ${heatRiskData?.label || 'High'} in the selected window.`, heatRiskData?.source || 'Heat risk synthesis');
  } else if (Number.isFinite(heatRiskLevel) && heatRiskLevel >= 2) {
    applyFactor('Heat', 6, `Heat risk is ${heatRiskData?.label || 'Elevated'} in the selected window.`, heatRiskData?.source || 'Heat risk synthesis');
  } else if (Number.isFinite(heatRiskLevel) && heatRiskLevel >= 1) {
    applyFactor('Heat', 2, `Heat risk is ${heatRiskData?.label || 'Guarded'}; monitor pace and hydration.`, heatRiskData?.source || 'Heat risk synthesis');
  } else if (Number.isFinite(trendMaxFeelsLike) && trendMaxFeelsLike >= 90) {
    applyFactor('Heat', 6, `Peak apparent temperature in the window reaches ${Math.round(trendMaxFeelsLike)}F.`, 'NOAA temp + humidity');
  } else if (Number.isFinite(trendMaxFeelsLike) && trendMaxFeelsLike >= 82 && heatExposureHours >= 4) {
    applyFactor('Heat', 3, `${heatExposureHours}/${trend.length} trend hours are warm (>=85F apparent).`, 'NOAA hourly trend');
  }

  if (rainfallData?.fallbackMode === 'zeroed_totals') {
    applyFactor('Surface Conditions', 4, 'Precipitation data unavailable (upstream outage) — surface conditions are unknown; treat as potentially hazardous.', rainfallData?.source || 'Open-Meteo precipitation history');
  } else if (Number.isFinite(rainPast24hIn) && rainPast24hIn >= 0.75) {
    applyFactor('Surface Conditions', 7, `Recent rainfall is heavy (${rainPast24hIn.toFixed(2)} in in 24h), increasing slick/trail-softening risk.`, rainfallData?.source || 'Open-Meteo precipitation history');
  } else if (Number.isFinite(rainPast24hIn) && rainPast24hIn >= 0.3) {
    applyFactor('Surface Conditions', 4, `Recent rainfall (${rainPast24hIn.toFixed(2)} in in 24h) can create slippery or muddy travel.`, rainfallData?.source || 'Open-Meteo precipitation history');
  }

  if (Number.isFinite(snowPast24hIn) && snowPast24hIn >= 6) {
    applyFactor('Surface Conditions', 8, `Recent snowfall is substantial (${snowPast24hIn.toFixed(1)} in in 24h), increasing trail and route uncertainty.`, rainfallData?.source || 'Open-Meteo precipitation history');
  } else if (Number.isFinite(snowPast24hIn) && snowPast24hIn >= 2) {
    applyFactor('Surface Conditions', 4, `Recent snowfall (${snowPast24hIn.toFixed(1)} in in 24h) can hide surface hazards and slow travel.`, rainfallData?.source || 'Open-Meteo precipitation history');
  }

  if (Number.isFinite(expectedRainWindowIn) && expectedRainWindowIn >= 0.5) {
    applyFactor('Storm', 6, `Expected rain in selected travel window is ${expectedRainWindowIn.toFixed(2)} in.`, rainfallData?.source || 'Open-Meteo precipitation forecast');
  } else if (Number.isFinite(expectedRainWindowIn) && expectedRainWindowIn >= 0.2) {
    applyFactor('Storm', 3, `Expected rain in selected travel window is ${expectedRainWindowIn.toFixed(2)} in.`, rainfallData?.source || 'Open-Meteo precipitation forecast');
  }

  if (Number.isFinite(expectedSnowWindowIn) && expectedSnowWindowIn >= 4) {
    applyFactor('Winter Weather', 7, `Expected snowfall in selected travel window is ${expectedSnowWindowIn.toFixed(1)} in.`, rainfallData?.source || 'Open-Meteo precipitation forecast');
  } else if (Number.isFinite(expectedSnowWindowIn) && expectedSnowWindowIn >= 1.5) {
    applyFactor('Winter Weather', 3, `Expected snowfall in selected travel window is ${expectedSnowWindowIn.toFixed(1)} in.`, rainfallData?.source || 'Open-Meteo precipitation forecast');
  }

  if (isDaytime === false && !isNightBeforeSunrise) {
    applyFactor('Darkness', 5, 'Selected forecast period is nighttime, reducing navigation margin and terrain visibility.', 'NOAA isDaytime flag');
  }

  if (Number.isFinite(tempRange) && tempRange >= 18) {
    applyFactor(
      'Weather Volatility',
      6,
      `Large ${effectiveTrendWindowHours}-hour temperature swing (${Math.round(tempRange)}F) suggests unstable conditions.`,
      'NOAA hourly trend',
    );
  }
  if (Number.isFinite(trendPeakGust) && trendPeakGust >= 45 && (!Number.isFinite(gust) || gust < 45)) {
    applyFactor('Wind', 6, `Peak gusts in the next ${effectiveTrendWindowHours} hours reach ${Math.round(trendPeakGust)} mph.`, 'NOAA hourly trend');
  }

  // Combined hazard escalation: co-occurring weather hazards compound risk
  const weatherCats = {
    wind: factors.some((f) => f.group === 'weather' && /^wind$/i.test(f.hazard)),
    coldHeat: factors.some((f) => f.group === 'weather' && /^(cold|heat)$/i.test(f.hazard)),
    precipStorm: factors.some((f) => f.group === 'weather' && /^(storm|winter weather)$/i.test(f.hazard)),
    visibility: factors.some((f) => f.group === 'weather' && /^visibility$/i.test(f.hazard)),
  };
  const activeWeatherCategories = Object.values(weatherCats).filter(Boolean).length;
  if (activeWeatherCategories >= 3) {
    applyFactor('Combined Exposure', 10, `${activeWeatherCategories} weather hazard categories are active simultaneously, compounding exposure risk.`, 'Safety score synthesis');
  } else if (activeWeatherCategories >= 2) {
    const hasDangerousPair =
      (weatherCats.wind && weatherCats.coldHeat) ||
      (weatherCats.wind && weatherCats.precipStorm) ||
      (weatherCats.coldHeat && weatherCats.precipStorm);
    if (hasDangerousPair) {
      applyFactor('Combined Exposure', 5, 'Co-occurring weather hazards increase exposure risk.', 'Safety score synthesis');
    }
  }

  // Condition trajectory: deteriorating conditions are riskier than improving
  if (trend.length >= 4) {
    const halfLen = Math.floor(trend.length / 2);
    const firstHalfGusts = trend.slice(0, halfLen).map((item) => {
      const g = Number.isFinite(Number(item?.gust)) ? Number(item.gust) : Number(item?.wind);
      return Number.isFinite(g) ? g : 0;
    });
    const secondHalfGusts = trend.slice(halfLen).map((item) => {
      const g = Number.isFinite(Number(item?.gust)) ? Number(item.gust) : Number(item?.wind);
      return Number.isFinite(g) ? g : 0;
    });
    const firstHalfPrecips = trend.slice(0, halfLen).map((item) => {
      const p = Number(item?.precipChance);
      return Number.isFinite(p) ? p : 0;
    });
    const secondHalfPrecips = trend.slice(halfLen).map((item) => {
      const p = Number(item?.precipChance);
      return Number.isFinite(p) ? p : 0;
    });
    const avgArr = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const firstAvgGust = avgArr(firstHalfGusts);
    const secondAvgGust = avgArr(secondHalfGusts);
    const firstAvgPrecip = avgArr(firstHalfPrecips);
    const secondAvgPrecip = avgArr(secondHalfPrecips);
    const windDeteriorating = secondAvgGust >= firstAvgGust + 8 && secondAvgGust >= 20;
    const precipDeteriorating = secondAvgPrecip >= firstAvgPrecip + 15 && secondAvgPrecip >= 40;
    if (windDeteriorating && precipDeteriorating) {
      applyFactor('Condition Trajectory', 7, 'Both wind and precipitation are deteriorating through the travel window.', 'NOAA hourly trend');
    } else if (windDeteriorating) {
      applyFactor('Condition Trajectory', 4, 'Wind conditions are deteriorating through the travel window.', 'NOAA hourly trend');
    } else if (precipDeteriorating) {
      applyFactor('Condition Trajectory', 4, 'Precipitation is increasing through the travel window.', 'NOAA hourly trend');
    }
  }

  if (forecastLeadHours !== null && forecastLeadHours > 6) {
    let uncertaintyImpact = 2;
    if (forecastLeadHours >= 96) {
      uncertaintyImpact = 10;
    } else if (forecastLeadHours >= 72) {
      uncertaintyImpact = 8;
    } else if (forecastLeadHours >= 48) {
      uncertaintyImpact = 6;
    } else if (forecastLeadHours >= 24) {
      uncertaintyImpact = 4;
    }
    if (!alertsRelevantForSelectedTime) {
      uncertaintyImpact += 2;
    }
    applyFactor(
      'Forecast Uncertainty',
      Math.min(14, uncertaintyImpact),
      `Selected start is ${Math.round(forecastLeadHours)}h ahead; confidence is lower because fewer real-time feeds can be projected.`,
      'Forecast lead time',
    );
  }

  if (alertsRelevantForSelectedTime && Number.isFinite(alertsCount) && alertsCount > 0) {
    const listedEvents = alertEvents.length ? ` (${alertEvents.join(', ')})` : '';
    if (highestAlertSeverity === 'extreme') {
      applyFactor('Official Alert', 24, `${alertsCount} active NWS alert(s)${listedEvents} with EXTREME severity.`, 'NOAA/NWS Active Alerts');
    } else if (highestAlertSeverity === 'severe') {
      applyFactor('Official Alert', 16, `${alertsCount} active NWS alert(s)${listedEvents} with severe impacts possible.`, 'NOAA/NWS Active Alerts');
    } else if (highestAlertSeverity === 'moderate') {
      applyFactor('Official Alert', 10, `${alertsCount} active NWS alert(s)${listedEvents} indicate moderate hazard.`, 'NOAA/NWS Active Alerts');
    } else {
      applyFactor('Official Alert', 5, `${alertsCount} active NWS alert(s)${listedEvents} are in effect.`, 'NOAA/NWS Active Alerts');
    }
  }

  if (airQualityRelevantForScoring && Number.isFinite(usAqi)) {
    if (usAqi >= 201) {
      applyFactor('Air Quality', 20, `Air quality is hazardous (US AQI ${Math.round(usAqi)}).`, 'Open-Meteo Air Quality');
    } else if (usAqi >= 151) {
      applyFactor('Air Quality', 14, `Air quality is unhealthy (US AQI ${Math.round(usAqi)}).`, 'Open-Meteo Air Quality');
    } else if (usAqi >= 101) {
      applyFactor(
        'Air Quality',
        8,
        `Air quality is unhealthy for sensitive groups (US AQI ${Math.round(usAqi)}).`,
        'Open-Meteo Air Quality',
      );
    } else if (usAqi >= 51) {
      applyFactor('Air Quality', 3, `Air quality is moderate (US AQI ${Math.round(usAqi)}). Consider reducing intensity for sustained exertion.`, 'Open-Meteo Air Quality');
    }
  }

  const fireLevel = fireRiskData?.level != null ? Number(fireRiskData.level) : null;
  if (fireLevel !== null && Number.isFinite(fireLevel) && fireLevel >= 4) {
    applyFactor('Fire Danger', 16, 'Extreme fire-weather/alert signal for this objective window.', fireRiskData?.source || 'Fire risk synthesis');
  } else if (fireLevel !== null && Number.isFinite(fireLevel) && fireLevel >= 3) {
    applyFactor('Fire Danger', 10, 'High fire-weather signal: elevated spread potential or fire-weather alerts.', fireRiskData?.source || 'Fire risk synthesis');
  } else if (fireLevel !== null && Number.isFinite(fireLevel) && fireLevel >= 2) {
    applyFactor('Fire Danger', 5, 'Elevated fire risk signal from weather, smoke, or alert context.', fireRiskData?.source || 'Fire risk synthesis');
  }

  const rawGroupImpacts = factors.reduce((acc, factor) => {
    const group = factor.group || 'weather';
    acc[group] = (acc[group] || 0) + Number(factor.impact || 0);
    return acc;
  }, {});
  const groupImpacts = Object.entries(rawGroupImpacts).reduce((acc, [group, rawImpact]) => {
    const cap = Number(groupCaps[group] || 100);
    const raw = Number.isFinite(rawImpact) ? Math.round(rawImpact) : 0;
    const capped = Math.min(raw, cap);
    acc[group] = { raw, capped, cap };
    return acc;
  }, {});
  const totalCappedImpact = Object.values(groupImpacts).reduce((sum, entry) => sum + Number(entry.capped || 0), 0);
  const score = Math.max(0, Math.round(100 - totalCappedImpact));

  let confidence = 100;
  const confidenceReasons = [];
  const applyConfidencePenalty = (points, reason) => {
    if (!Number.isFinite(points) || points <= 0) {
      return;
    }
    confidence -= points;
    if (reason) {
      confidenceReasons.push(reason);
    }
  };

  const weatherDataUnavailable = weatherDescription.includes('weather data unavailable');
  if (weatherDataUnavailable) {
    applyFactor('Weather Unavailable', 20, 'All weather data is unavailable — wind, precipitation, and temperature conditions are unknown.', 'System');
    applyConfidencePenalty(30, 'Complete weather data unavailable — do not rely on this report for go/no-go decisions.');
  }

  const nowMs = Date.now();
  const weatherIssuedMs = parseIsoTimeToMs(weatherData?.issuedTime);
  if (!weatherDataUnavailable && weatherIssuedMs === null) {
    applyConfidencePenalty(8, 'Weather issue time unavailable.');
  } else if (!weatherDataUnavailable && weatherIssuedMs !== null) {
    const weatherAgeHours = (nowMs - weatherIssuedMs) / (1000 * 60 * 60);
    if (weatherAgeHours > 18) {
      applyConfidencePenalty(12, `Weather issuance is ${Math.round(weatherAgeHours)}h old.`);
    } else if (weatherAgeHours > 10) {
      applyConfidencePenalty(7, `Weather issuance is ${Math.round(weatherAgeHours)}h old.`);
    } else if (weatherAgeHours > 6) {
      applyConfidencePenalty(4, `Weather issuance is ${Math.round(weatherAgeHours)}h old.`);
    }
  }

  if (trend.length < 6) {
    applyConfidencePenalty(6, 'Limited hourly trend depth (<6 points).');
  }

  if (avalancheRelevant) {
    if (avalancheUnknown) {
      applyConfidencePenalty(20, 'Avalanche danger is unknown for this objective.');
    } else {
      const avalanchePublishedMs = parseIsoTimeToMs(avalancheData?.publishedTime);
      if (avalanchePublishedMs === null) {
        applyConfidencePenalty(8, 'Avalanche bulletin publish time unavailable.');
      } else {
        const avalancheAgeHours = (nowMs - avalanchePublishedMs) / (1000 * 60 * 60);
        if (avalancheAgeHours > 72) {
          applyConfidencePenalty(12, `Avalanche bulletin is ${Math.round(avalancheAgeHours)}h old.`);
        } else if (avalancheAgeHours > 48) {
          applyConfidencePenalty(8, `Avalanche bulletin is ${Math.round(avalancheAgeHours)}h old.`);
        } else if (avalancheAgeHours > 24) {
          applyConfidencePenalty(4, `Avalanche bulletin is ${Math.round(avalancheAgeHours)}h old.`);
        }
      }
    }
  }

  if (alertsRelevantForSelectedTime && alertsData?.status === 'unavailable') {
    applyConfidencePenalty(8, 'NWS alerts feed unavailable.');
  } else if (!alertsRelevantForSelectedTime) {
    applyConfidencePenalty(4, 'NWS alerts are current-state only and not forecast-valid for the selected start time.');
  }
  if (airQualityRelevantForScoring && airQualityData?.status === 'unavailable') {
    applyConfidencePenalty(6, 'Air quality feed unavailable.');
  } else if (airQualityRelevantForScoring && airQualityData?.status === 'no_data') {
    applyConfidencePenalty(3, 'Air quality point data unavailable.');
  }
  const rainfallAnchorMs = parseIsoTimeToMs(rainfallData?.anchorTime);
  if (rainfallData?.status === 'unavailable') {
    applyConfidencePenalty(5, 'Precipitation history feed unavailable.');
  } else if (rainfallData?.status === 'no_data') {
    applyConfidencePenalty(3, 'Precipitation history has no usable anchor/sample data.');
  } else if (rainfallData?.fallbackMode === 'zeroed_totals') {
    applyConfidencePenalty(8, 'Precipitation totals are fallback estimates due upstream feed outage.');
  } else if (rainfallAnchorMs === null) {
    applyConfidencePenalty(3, 'Precipitation anchor time unavailable.');
  } else {
    const rainfallAgeHours = (nowMs - rainfallAnchorMs) / (1000 * 60 * 60);
    if (rainfallAgeHours > 36) {
      applyConfidencePenalty(7, `Precipitation anchor is ${Math.round(rainfallAgeHours)}h old.`);
    } else if (rainfallAgeHours > 18) {
      applyConfidencePenalty(4, `Precipitation anchor is ${Math.round(rainfallAgeHours)}h old.`);
    } else if (rainfallAgeHours > 10) {
      applyConfidencePenalty(2, `Precipitation anchor is ${Math.round(rainfallAgeHours)}h old.`);
    }
  }
  if (forecastLeadHours !== null && forecastLeadHours >= 72) {
    applyConfidencePenalty(8, `Selected start is ${Math.round(forecastLeadHours)}h ahead (lower forecast certainty).`);
  } else if (forecastLeadHours !== null && forecastLeadHours >= 48) {
    applyConfidencePenalty(6, `Selected start is ${Math.round(forecastLeadHours)}h ahead (lower forecast certainty).`);
  } else if (forecastLeadHours !== null && forecastLeadHours >= 24) {
    applyConfidencePenalty(4, `Selected start is ${Math.round(forecastLeadHours)}h ahead (lower forecast certainty).`);
  }
  if (!fireRiskData || fireRiskData.status === 'unavailable') {
    applyConfidencePenalty(3, 'Fire risk synthesis unavailable.');
  }

  confidence = Math.max(20, Math.min(100, Math.round(confidence)));

  const factorsSorted = [...factors].sort((a, b) => b.impact - a.impact);
  const primaryHazard = factorsSorted[0]?.hazard || 'None';
  const sourcesUsed = [
    'NOAA/NWS hourly forecast',
    avalancheRelevant ? 'Avalanche center forecast' : null,
    alertsRelevantForSelectedTime && (alertsData?.status === 'ok' || alertsData?.status === 'none' || alertsData?.status === 'none_for_selected_start')
      ? 'NOAA/NWS active alerts'
      : null,
    airQualityRelevantForScoring && (airQualityData?.status === 'ok' || airQualityData?.status === 'no_data')
      ? 'Open-Meteo air quality'
      : null,
    (rainfallData?.status === 'ok' || rainfallData?.status === 'partial' || rainfallData?.status === 'no_data') && rainfallData?.fallbackMode !== 'zeroed_totals'
      ? 'Open-Meteo precipitation history/forecast'
      : null,
    heatRiskData?.status === 'ok' ? 'Heat risk synthesis (forecast + lower-terrain adjustment)' : null,
    fireRiskData?.status === 'ok' ? 'Fire risk synthesis (NOAA + NWS + AQI)' : null,
  ].filter(Boolean);

  return {
    score,
    confidence,
    primaryHazard,
    explanations: explanations.length > 0 ? explanations : ['Conditions appear stable for the selected plan window.'],
    factors: factorsSorted,
    groupImpacts,
    confidenceReasons,
    sourcesUsed,
    airQualityCategory: aqiCategory,
  };
};

module.exports = { calculateSafetyScore };
