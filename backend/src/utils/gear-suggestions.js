const { clampTravelWindowHours } = require('./time');
const { computeFeelsLikeF } = require('./weather-normalizers');
const { buildSunClock, windowIncludesDark, windowIncludesDaylight } = require('./daylight');

const buildLayeringGearSuggestions = ({
  weatherData,
  trailStatus,
  avalancheData,
  airQualityData,
  alertsData,
  rainfallData,
  snowpackData,
  fireRiskData,
  heatRiskData,
  selectedTravelWindowHours,
  scoreFeatures = null,
  contingencyData = null,
  solarData = null,
  selectedStartTime = null,
}) => {
  const MAX_GEAR_SUGGESTIONS = 12;
  const BASELINE_GEAR_IDS = new Set(['backcountry-essentials', 'layering-core']);
  const TONE_PRIORITY = { nogo: 0, caution: 1, watch: 2, go: 3 };
  const suggestionMap = new Map();
  const scoreFeatureEnabled = (key) => scoreFeatures?.[key] !== false;
  const avalancheEnabled = scoreFeatureEnabled('avalancheDetails');
  const airQualityEnabled = scoreFeatureEnabled('airQualityDetails');
  const fireRiskEnabled = scoreFeatureEnabled('fireRiskDetails');
  const heatRiskEnabled = scoreFeatureEnabled('heatRiskDetails');
  const snowpackEnabled = scoreFeatureEnabled('snowpackDetails');
  const weatherContextEnabled = scoreFeatureEnabled('weatherContextDetails');
  const contingencyEnabled = scoreFeatureEnabled('contingencyPlanning');
  const daylightEnabled = scoreFeatureEnabled('daylightTimeline');
  const addSuggestion = (id, title, detail, category, tone, priority = 50, reason = '') => {
    if (typeof id !== 'string' || !id.trim() || typeof title !== 'string' || !title.trim()) {
      return;
    }
    const existing = suggestionMap.get(id);
    if (!existing || priority < existing.priority) {
      suggestionMap.set(id, { id, title, detail, reason, category, tone, priority });
    }
  };
  const formatWhole = (value, suffix) => {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${Math.round(numeric)}${suffix}` : null;
  };
  const formatOneDecimal = (value, suffix) => {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${numeric.toFixed(1)}${suffix}` : null;
  };
  const toFiniteNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const windowHours = selectedTravelWindowHours === null || selectedTravelWindowHours === undefined || selectedTravelWindowHours === ''
    ? 12
    : clampTravelWindowHours(selectedTravelWindowHours, 12);
  const trend = Array.isArray(weatherData?.trend) ? weatherData.trend.slice(0, windowHours) : [];
  const description = String(weatherData?.description || '').toLowerCase();
  const windowDescription = [description, ...trend.map((row) => String(row?.condition || '').toLowerCase())].join(' ');
  const tempF = parseFloat(weatherData?.temp);
  const feelsLikeF = Number.isFinite(parseFloat(weatherData?.feelsLike)) ? parseFloat(weatherData?.feelsLike) : tempF;
  const windMph = parseFloat(weatherData?.windSpeed);
  const gustMph = parseFloat(weatherData?.windGust);
  const precipChance = parseFloat(weatherData?.precipChance);
  const humidity = parseFloat(weatherData?.humidity);
  const trendFeelsLike = trend
    .map((row) => {
      const explicitFeelsLike = toFiniteNumber(row?.feelsLike);
      if (explicitFeelsLike !== null) return explicitFeelsLike;
      const rowTemp = toFiniteNumber(row?.temp);
      const rowWind = toFiniteNumber(row?.wind);
      return computeFeelsLikeF(rowTemp, rowWind ?? 0);
    })
    .filter(Number.isFinite);
  const trendWind = trend.map((row) => toFiniteNumber(row?.wind)).filter((value) => value !== null);
  const trendGusts = trend.map((row) => toFiniteNumber(row?.gust)).filter((value) => value !== null);
  const trendPrecip = trend.map((row) => toFiniteNumber(row?.precipChance)).filter((value) => value !== null);
  const windowMinFeelsLikeF = [feelsLikeF, ...trendFeelsLike].filter(Number.isFinite).reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY);
  const windowMaxFeelsLikeF = [feelsLikeF, ...trendFeelsLike].filter(Number.isFinite).reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY);
  const windowPeakWindMph = [windMph, ...trendWind].filter(Number.isFinite).reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY);
  const windowPeakGustMph = [gustMph, ...trendGusts].filter(Number.isFinite).reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY);
  const windowPeakPrecipChance = [precipChance, ...trendPrecip].filter(Number.isFinite).reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY);
  const rain24hIn = parseFloat(rainfallData?.totals?.rainPast24hIn ?? rainfallData?.totals?.past24hIn);
  const snow24hIn = parseFloat(rainfallData?.totals?.snowPast24hIn);
  const snowDepthSamples = (snowpackEnabled ? [
    snowpackData?.snotelConsensus?.medianDepthIn,
    snowpackData?.snotel?.snowDepthIn,
    snowpackData?.nohrsc?.snowDepthIn,
    snowpackData?.cdec?.snowDepthIn,
  ] : []).map(toFiniteNumber).filter((value) => value !== null && value >= 0);
  const maxObservedSnowDepthIn = snowDepthSamples.length
    ? snowDepthSamples.reduce((max, current) => Math.max(max, current), 0)
    : null;

  const windowWeatherRows = [
    { condition: description, temp: tempF, precipChance },
    ...trend.map((row) => ({
      condition: String(row?.condition || '').toLowerCase(),
      temp: toFiniteNumber(row?.temp),
      precipChance: toFiniteNumber(row?.precipChance),
    })),
  ];

  const hasWetSignal = windowWeatherRows.some((row) => (
    /rain|shower|drizzle|wet|thunder|storm/.test(row.condition)
    || (Number.isFinite(row.precipChance) && row.precipChance >= 45 && Number.isFinite(row.temp) && row.temp > 30)
  ));
  const hasSnowSignal = windowWeatherRows.some((row) => (
    /snow|sleet|freezing|ice|blizzard|wintry|graupel|flurr/.test(row.condition)
    || (Number.isFinite(row.temp) && row.temp <= 34 && Number.isFinite(row.precipChance) && row.precipChance >= 40)
  )) || (Number.isFinite(maxObservedSnowDepthIn) && maxObservedSnowDepthIn >= 2);
  const windy = (Number.isFinite(windowPeakGustMph) && windowPeakGustMph >= 25) || (Number.isFinite(windowPeakWindMph) && windowPeakWindMph >= 18);
  const cold = Number.isFinite(windowMinFeelsLikeF) && windowMinFeelsLikeF <= 20;
  const veryCold = Number.isFinite(windowMinFeelsLikeF) && windowMinFeelsLikeF <= 5;
  const trailSurface = String(trailStatus || '').toLowerCase();
  const muddy = String(trailStatus || '').toLowerCase().includes('mud');
  const icy = /icy|\bice\b|firm snow|hard snow/.test(trailSurface);
  const snowy = /snow/.test(trailSurface);
  const hasRainAccumulation = Number.isFinite(rain24hIn) && rain24hIn >= 0.2;
  const hasFreshSnow = Number.isFinite(snow24hIn) && snow24hIn >= 2;
  // Sunrise and sunset decide light and dark; NOAA's isDaytime flag is a fixed
  // 6 AM-6 PM period and is only the fallback.
  const windowStartIso = selectedStartTime || weatherData?.forecastStartTime || null;
  const sun = buildSunClock({ solarData, timeZone: weatherData?.timezone, anchorIso: windowStartIso });
  const hasDaylightInWindow = windowIncludesDaylight(sun, windowStartIso, windowHours)
    ?? (weatherData?.isDaytime !== false || trend.some((row) => row?.isDaytime === true));
  const convective = /thunder|lightning|t-storm|tstm/.test(windowDescription);
  const avyDanger = avalancheEnabled ? Number(avalancheData?.dangerLevel) : Number.NaN;
  const hasAlerts = Number(alertsData?.activeCount) > 0;
  const heatLevel = heatRiskEnabled ? Number(heatRiskData?.level) : Number.NaN;

  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const windowLowFeelsLike = formatWhole(windowMinFeelsLikeF, 'F');
  const windowPeakGust = formatWhole(windowPeakGustMph, ' mph');
  const windowPeakWind = formatWhole(windowPeakWindMph, ' mph');
  const windowPeakPrecip = formatWhole(windowPeakPrecipChance, '%');
  const rain24h = formatOneDecimal(rain24hIn, ' in');
  const snow24h = formatWhole(snow24hIn, ' in');
  const snowDepth = formatWhole(maxObservedSnowDepthIn, ' in');
  const snowOnGround = snowy || icy || (Number.isFinite(maxObservedSnowDepthIn) && maxObservedSnowDepthIn >= 2);
  const hasDarkInWindow = windowIncludesDark(sun, windowStartIso, windowHours)
    ?? (weatherData?.isDaytime === false || trend.some((row) => row?.isDaytime === false));
  const AVALANCHE_DANGER_LABELS = { 1: 'Low', 2: 'Moderate', 3: 'Considerable', 4: 'High', 5: 'Extreme' };

  addSuggestion(
    'backcountry-essentials',
    'Ten Essentials',
    'Map and compass or offline GPS, headlamp, sun protection, first aid, knife and repair kit, fire starter, emergency shelter, extra food, water, and layers, plus a way to call for help.',
    'Essentials',
    'go',
    8,
  );

  addSuggestion(
    'layering-core',
    'Base and mid layers',
    'Synthetic or wool base layer with a warm midlayer. Skip cotton: it stays wet and chills you at stops.',
    'Clothing',
    'go',
    10,
  );

  if (hasWetSignal || hasRainAccumulation) {
    const wetReasons = [
      windowPeakPrecip ? `Up to ${windowPeakPrecip} chance of ${hasSnowSignal ? 'rain or snow' : 'rain'}` : 'Wet weather in the forecast',
      hasRainAccumulation && rain24h ? `${rain24h} of rain in the last 24 h` : null,
    ].filter(Boolean);
    addSuggestion(
      'shell-wet',
      hasSnowSignal ? 'Waterproof jacket and pants' : 'Rain jacket and rain pants',
      'Waterproof and breathable, with a hood.',
      'Clothing',
      'caution',
      20,
      wetReasons.join('; '),
    );
    addSuggestion('gaiters-wet', 'Waterproof boots and gaiters', 'Keep feet dry on wet trail and brush, and pack spare socks.', 'Footwear & traction', 'watch', 32, 'Wet trail and brush likely');
  } else if (hasSnowSignal || windy) {
    addSuggestion(
      'shell-wind-snow',
      'Windproof shell with a hood',
      'Blocks wind and sheds snow on exposed ridges and summits.',
      'Clothing',
      'caution',
      22,
      windy
        ? (windowPeakGust && windowPeakGustMph >= 25 ? `Gusts to ${windowPeakGust}` : windowPeakWind ? `Wind to ${windowPeakWind}` : 'Windy in your window')
        : 'Snow or cold precipitation in your window',
    );
  } else {
    addSuggestion('shell-light', 'Light wind jacket', 'Weighs little and covers ridge wind or a passing shower.', 'Clothing', 'go', 60);
  }

  if (cold || hasSnowSignal || windy) {
    addSuggestion(
      'insulation-stop',
      'Insulated jacket',
      'A puffy that fits over your other layers, for breaks and for waiting out a delay.',
      'Clothing',
      'caution',
      24,
      windowLowFeelsLike ? `Feels like ${windowLowFeelsLike} at the coldest` : 'Cold, wind, or snow in your window',
    );
  }
  if (veryCold) {
    addSuggestion(
      'extremities-cold',
      'Warm hat, insulated gloves, and neck gaiter',
      'Add spare liner gloves. Wet or bare hands lose dexterity fast at these temperatures.',
      'Clothing',
      'caution',
      16,
      windowLowFeelsLike ? `Feels like ${windowLowFeelsLike} at the coldest` : 'Very cold in your window',
    );
  }

  if (muddy || hasRainAccumulation) {
    addSuggestion(
      'traction-mud',
      'Trekking poles and grippy shoes',
      'Deep lugs and poles for slick, muddy approaches.',
      'Footwear & traction',
      'watch',
      34,
      muddy ? 'Trail reported muddy' : `${rain24h} of rain in the last 24 h`,
    );
  }
  if (icy || snowy || hasSnowSignal || hasFreshSnow || (Number.isFinite(maxObservedSnowDepthIn) && maxObservedSnowDepthIn >= 4)) {
    addSuggestion(
      'traction-snow',
      'Microspikes and trekking poles',
      'Microspikes grip packed snow and ice on trails. They do not replace crampons on steep snow.',
      'Footwear & traction',
      'caution',
      26,
      icy ? 'Icy or firm snow on the trail'
        : hasFreshSnow && snow24h ? `${snow24h} of new snow in the last 24 h`
          : snowDepth && maxObservedSnowDepthIn >= 2 ? `Snow depth ~${snowDepth} nearby`
            : snowy ? 'Snow on the trail' : 'Snow in the forecast',
    );
  }
  if ((Number.isFinite(maxObservedSnowDepthIn) && maxObservedSnowDepthIn >= 12) || (Number.isFinite(snow24hIn) && snow24hIn >= 6)) {
    addSuggestion(
      'snow-flotation',
      'Snowshoes or skis',
      'Deep or soft snow makes travel on foot slow and exhausting. Check how well it supports you near the trailhead.',
      'Footwear & traction',
      'watch',
      27,
      Number.isFinite(snow24hIn) && snow24hIn >= 6 ? `${snow24h} of new snow in the last 24 h` : `Snow depth ~${snowDepth} nearby`,
    );
  }
  if (icy && (cold || (Number.isFinite(maxObservedSnowDepthIn) && maxObservedSnowDepthIn >= 4))) {
    addSuggestion(
      'alpine-hardware',
      'Ice axe, crampons, and helmet',
      'Only for steep, firm snow, and only if you are trained to self-arrest. Otherwise choose a different route.',
      'Safety & rescue',
      'caution',
      15,
      cold ? 'Firm, icy snow with cold temperatures' : `Icy trail with snow depth ~${snowDepth} nearby`,
    );
  }

  if (Number.isFinite(humidity) && humidity > 80 && (hasWetSignal || (Number.isFinite(windowMinFeelsLikeF) && windowMinFeelsLikeF <= 60))) {
    addSuggestion('humidity-management', 'Spare base layer', 'A dry layer to change into if you sweat or get rained through.', 'Clothing', 'go', 48, `${Math.round(humidity)}% humidity, so layers dry slowly`);
  }
  if (airQualityEnabled && Number(airQualityData?.usAqi) >= 101) {
    const aqi = Math.round(Number(airQualityData.usAqi));
    addSuggestion(
      'aq-health',
      'Smoke respirator',
      'A well-fitted NIOSH-approved N95 or P100, and an easier pace. A Buff or cloth covering does not filter wildfire smoke.',
      'Health',
      'watch',
      30,
      `Air quality index ${aqi}: unhealthy${aqi >= 151 ? ' for everyone' : ' for sensitive groups'}`,
    );
  }
  if (hasAlerts) {
    const alertCount = Math.round(Number(alertsData.activeCount));
    addSuggestion(
      'alerts-comms',
      'Satellite messenger and battery pack',
      'A way to call for help without cell service, and power to keep it running. Read the alert details before you go.',
      'Navigation & comms',
      'watch',
      28,
      `${plural(alertCount, 'active weather alert')} for this area`,
    );
  }
  if (fireRiskEnabled && Number(fireRiskData?.level) >= 3) {
    const fireLabel = String(fireRiskData.label || 'High').replace(/\.$/, '').toLowerCase();
    if (fireRiskData.primaryDriver === 'fire') {
      // Fire on the ground nearby: plan exits and updates, not hydration.
      addSuggestion(
        'fire-risk',
        'Offline map with more than one exit',
        'Know a second way out if smoke or fire closes the trail or road, and how you will check closure and evacuation updates.',
        'Navigation & comms',
        'watch',
        36,
        'Active fire near the objective',
      );
    } else {
      addSuggestion(
        'fire-risk',
        'Extra water and sun cover',
        'Hot, dry air dehydrates you quickly. Check campfire and stove restrictions before you go.',
        'Sun & heat',
        'watch',
        36,
        `${fireLabel.charAt(0).toUpperCase()}${fireLabel.slice(1)} fire danger in dry air`,
      );
    }
  }

  if (avalancheEnabled && avalancheData?.relevant !== false && (avyDanger >= 1 || avalancheData?.dangerUnknown)) {
    const dangerLabel = AVALANCHE_DANGER_LABELS[Math.round(avyDanger)];
    addSuggestion(
      'avalanche-kit',
      'Avalanche rescue kit',
      avalancheData?.dangerUnknown
        ? 'Each traveler: transceiver on and checked, metal shovel, and probe. With no official rating, stick to low-angle terrain away from avalanche paths.'
        : 'Each traveler: transceiver on and checked, metal shovel, and probe, with partners who have practiced rescue.',
      'Safety & rescue',
      'nogo',
      14,
      avalancheData?.dangerUnknown
        ? 'No avalanche forecast covers this area'
        : dangerLabel ? `Avalanche danger ${dangerLabel} (${Math.round(avyDanger)} of 5)` : 'Avalanche terrain on this objective',
    );
  }

  if (Number.isFinite(windowMaxFeelsLikeF) && windowMaxFeelsLikeF >= 68 && hasDaylightInWindow) {
    addSuggestion('sun-protection', 'Sunscreen, sunglasses, and sun hat', 'UV is stronger on open terrain and at altitude.', 'Sun & heat', 'go', 40, `Feels like up to ${formatWhole(windowMaxFeelsLikeF, 'F')} in daylight`);
  } else if (snowOnGround && hasDaylightInWindow) {
    addSuggestion('sun-protection', 'Dark sunglasses and sunscreen', 'Snow reflects most UV, so sunburn and snow blindness happen even on cold days.', 'Sun & heat', 'watch', 40, 'Daylight travel over snow');
  }
  if (Number.isFinite(heatLevel) && heatLevel >= 1) {
    addSuggestion('hydration-heat', 'Extra water', 'Carry more than usual and know where you can refill.', 'Sun & heat', 'watch', 38, heatRiskData?.label ? `Heat risk: ${String(heatRiskData.label).replace(/\.$/, '')}` : 'Heat stress possible in your window');
  }
  if (Number.isFinite(heatLevel) && heatLevel >= 2) {
    addSuggestion('electrolytes-heat', 'Electrolytes', 'Tabs or drink mix to replace salt lost to sweat.', 'Sun & heat', 'watch', 42, 'Heavy sweating likely');
  }

  if (weatherContextEnabled && /fog|mist|smoke|blizzard/.test(windowDescription)) {
    addSuggestion(
      'navigation-low-vis',
      'GPS with offline maps',
      'Download the route before you go. Trails and landmarks disappear in low visibility.',
      'Navigation & comms',
      'watch',
      44,
      /blizzard/.test(windowDescription) ? 'Blizzard conditions in your window'
        : /smoke/.test(windowDescription) ? 'Smoke may limit visibility' : 'Fog in your window',
    );
  }

  if (daylightEnabled && hasDarkInWindow) {
    addSuggestion('headlamp-dark', 'Headlamp and spare batteries', 'Check it works before you leave, and keep it where you can reach it.', 'Navigation & comms', 'watch', 35, 'Part of your time window is after dark');
  }

  if (convective) {
    addSuggestion(
      'storm-contingency',
      'Storm kit',
      'Rain layers, a headlamp, and a charged phone or messenger in case a storm delays you. Gear does not protect you from lightning: be off exposed terrain before storms build.',
      'Safety & rescue',
      'caution',
      17,
      'Thunderstorms possible in your window',
    );
  }

  if ((hasAlerts && cold) || avyDanger >= 3) {
    addSuggestion(
      'emergency-shelter',
      'Emergency bivy',
      'A bivy sack or emergency blanket in case you have to wait for help.',
      'Safety & rescue',
      'caution',
      18,
      avyDanger >= 3 ? `Avalanche danger ${AVALANCHE_DANGER_LABELS[Math.round(avyDanger)] || 'Considerable'} or higher` : 'Active alerts with cold temperatures',
    );
  }

  const overnight = contingencyEnabled ? contingencyData?.overnight : null;
  if (overnight?.status === 'ok' && overnight.relevant && (overnight.severity === 'moderate' || overnight.severity === 'high')) {
    const nightLow = formatWhole(overnight.minFeelsLikeF, 'F');
    const nightWet = Number(overnight.peakPrecipChance) >= 50 || overnight.freezingRain || overnight.snow;
    addSuggestion(
      'overnight-insulation',
      'Extra warm layers for a night out',
      'An extra insulating layer, warm hat, gloves, and a sit pad, sized for sitting still overnight rather than moving.',
      'Safety & rescue',
      overnight.severity === 'high' ? 'caution' : 'watch',
      overnight.severity === 'high' ? 16 : 30,
      nightLow ? `If you are delayed, the night feels like ${nightLow}` : 'An unplanned night would be cold',
    );
    if (overnight.severity === 'high' || nightWet) {
      addSuggestion(
        'emergency-shelter',
        'Emergency bivy',
        'A bivy sack or emergency blanket and a way to stay dry if you are stuck overnight.',
        'Safety & rescue',
        'caution',
        17,
        `A forced night out would be ${[overnight.severity === 'high' ? 'serious' : 'cold', nightWet ? 'wet' : null].filter(Boolean).join(' and ')}${nightLow ? ` (feels like ${nightLow})` : ''}`,
      );
    }
  }

  const rankedSuggestions = Array.from(suggestionMap.values())
    .sort((a, b) => (TONE_PRIORITY[a.tone] ?? 4) - (TONE_PRIORITY[b.tone] ?? 4) || a.priority - b.priority);
  const selectedSuggestions = rankedSuggestions.filter((item) => BASELINE_GEAR_IDS.has(item.id));
  for (const item of rankedSuggestions) {
    if (selectedSuggestions.length >= MAX_GEAR_SUGGESTIONS) break;
    if (!selectedSuggestions.some((selected) => selected.id === item.id)) {
      selectedSuggestions.push(item);
    }
  }

  return selectedSuggestions
    .sort((a, b) => (TONE_PRIORITY[a.tone] ?? 4) - (TONE_PRIORITY[b.tone] ?? 4) || a.priority - b.priority)
    .map(({ id, title, detail, reason, category, tone }) => ({ id, title, detail, reason, category, tone }))
    .slice(0, MAX_GEAR_SUGGESTIONS);
};

module.exports = {
  buildLayeringGearSuggestions,
};
