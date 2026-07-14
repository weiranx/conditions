const { clampTravelWindowHours } = require('./time');
const { computeFeelsLikeF } = require('./weather-normalizers');

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
  const addSuggestion = (id, title, detail, category, tone, priority = 50) => {
    if (typeof id !== 'string' || !id.trim() || typeof title !== 'string' || !title.trim()) {
      return;
    }
    const existing = suggestionMap.get(id);
    if (!existing || priority < existing.priority) {
      suggestionMap.set(id, { id, title, detail, category, tone, priority });
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
  const hasDaylightInWindow = weatherData?.isDaytime !== false || trend.some((row) => row?.isDaytime === true);
  const convective = /thunder|lightning|t-storm|tstm/.test(windowDescription);
  const avyDanger = avalancheEnabled ? Number(avalancheData?.dangerLevel) : Number.NaN;
  const hasAlerts = Number(alertsData?.activeCount) > 0;
  const heatLevel = heatRiskEnabled ? Number(heatRiskData?.level) : Number.NaN;

  addSuggestion(
    'backcountry-essentials',
    'Core backcountry kit',
    'Offline map + compass, headlamp, first-aid/repair kit, emergency communication, extra food, and reserve water.',
    'Safety',
    'go',
    8,
  );

  addSuggestion(
    'layering-core',
    'Layering core',
    'Moisture-wicking base + breathable midlayer. Avoid cotton to limit chill during breaks.',
    'Conditions',
    'go',
    10,
  );

  if (hasWetSignal || hasRainAccumulation) {
    addSuggestion(
      'shell-wet',
      'Storm shell',
      `Waterproof-breathable jacket + pants${formatWhole(windowPeakPrecipChance, '%') ? ` (window peak ${formatWhole(windowPeakPrecipChance, '%')} precip)` : ''}${formatOneDecimal(rain24hIn, ' in rain/24h') ? ` and ${formatOneDecimal(rain24hIn, ' in rain/24h')}` : ''}.`,
      'Conditions',
      'caution',
      20,
    );
    addSuggestion('gaiters-wet', 'Wet-foot control', 'Gaiters + waterproof footwear to reduce ankle/boot soak-through.', 'Conditions', 'watch', 32);
  } else if (hasSnowSignal || windy) {
    addSuggestion(
      'shell-wind-snow',
      'Wind/snow shell',
      `Wind-resistant outer layer for exposed terrain${formatWhole(windowPeakGustMph, ' mph') ? ` (window peak ${formatWhole(windowPeakGustMph, ' mph')} gusts)` : ''}.`,
      'Conditions',
      'caution',
      22,
    );
  } else {
    addSuggestion('shell-light', 'Light shell backup', 'Pack a light wind shell for ridge exposure and fast weather shifts.', 'Conditions', 'go', 60);
  }

  if (cold || hasSnowSignal || windy) {
    addSuggestion(
      'insulation-stop',
      'Static insulation',
      `Puffy sized over active layers${formatWhole(windowMinFeelsLikeF, 'F') ? ` (window low feels like ${formatWhole(windowMinFeelsLikeF, 'F')})` : ''} for stops and contingencies.`,
      'Conditions',
      'caution',
      24,
    );
  }
  if (veryCold) {
    addSuggestion('extremities-cold', 'Cold extremities kit', 'Warm hat, neck gaiter, insulated gloves/mitts, and spare liners.', 'Conditions', 'caution', 16);
  }

  if (muddy || hasRainAccumulation) {
    addSuggestion('traction-mud', 'Mud traction', 'Aggressive-lug footwear and poles for slick or soft approaches.', 'Conditions', 'watch', 34);
  }
  if (icy || snowy || hasSnowSignal || hasFreshSnow || (Number.isFinite(maxObservedSnowDepthIn) && maxObservedSnowDepthIn >= 4)) {
    addSuggestion(
      'traction-snow',
      'Snow/ice traction',
      `Carry traction devices + poles${formatOneDecimal(maxObservedSnowDepthIn, ' in observed snow depth') ? ` (${formatOneDecimal(maxObservedSnowDepthIn, ' in observed snow depth')})` : ''}.`,
      'Conditions',
      'caution',
      26,
    );
  }
  if ((Number.isFinite(maxObservedSnowDepthIn) && maxObservedSnowDepthIn >= 12) || (Number.isFinite(snow24hIn) && snow24hIn >= 6)) {
    addSuggestion('snow-flotation', 'Snow flotation', 'Snowshoes or skis may be needed for deep or unconsolidated snow; verify supportability near the trailhead.', 'Conditions', 'watch', 27);
  }
  if (icy && (cold || (Number.isFinite(maxObservedSnowDepthIn) && maxObservedSnowDepthIn >= 4))) {
    addSuggestion('alpine-hardware', 'Technical snow travel', 'For steep, firm snow only: ice axe, crampons, and helmet — and the training to use them. Otherwise change the route.', 'Safety', 'caution', 15);
  }

  if (Number.isFinite(humidity) && humidity > 80) {
    addSuggestion('humidity-management', 'Moisture backup', `Pack one dry base layer for high humidity (${Math.round(humidity)}% RH).`, 'Conditions', 'go', 48);
  }
  if (airQualityEnabled && Number(airQualityData?.usAqi) >= 101) {
    addSuggestion('aq-health', 'Smoke respirator', `If travel is unavoidable, carry a well-fitting NIOSH-approved N95 or P100 respirator and reduce exertion (AQI ${Math.round(Number(airQualityData.usAqi))}). A Buff or cloth covering does not filter wildfire smoke.`, 'Exposure', 'watch', 30);
  }
  if (hasAlerts) {
    addSuggestion('alerts-comms', 'Alerts contingency', 'Verify active alert details and carry backup comms/power.', 'Safety', 'watch', 28);
  }
  if (fireRiskEnabled && Number(fireRiskData?.level) >= 3) {
    addSuggestion('fire-risk', 'Heat/fire prep', `Extra water + sun protection; verify land-management restrictions (${fireRiskData.label || 'elevated fire risk'}).`, 'Exposure', 'watch', 36);
  }

  if (avalancheEnabled && avalancheData?.relevant !== false && (avyDanger >= 1 || avalancheData?.dangerUnknown)) {
    addSuggestion('avalanche-kit', 'Avalanche rescue kit', 'Each traveler: transceiver on and checked, metal shovel, and probe — with partners trained and practiced in rescue.', 'Safety', 'nogo', 14);
  }
  if (avalancheEnabled && avalancheData?.relevant !== false && avalancheData?.dangerUnknown) {
    addSuggestion('avalanche-unknown', 'Avalanche coverage gap', 'No official rating. Choose non-avalanche terrain and conservative slopes.', 'Safety', 'nogo', 12);
  }

  if (Number.isFinite(windowMaxFeelsLikeF) && windowMaxFeelsLikeF >= 68 && hasDaylightInWindow) {
    addSuggestion('sun-protection', 'Sun protection', 'Sunscreen, sunglasses, and sun hat for UV exposure on open terrain.', 'Exposure', 'go', 40);
  }
  if (Number.isFinite(heatLevel) && heatLevel >= 1) {
    addSuggestion('hydration-heat', 'Heat hydration', 'Carry extra water; plan re-supply points for heat-stress conditions.', 'Exposure', 'watch', 38);
  }
  if (Number.isFinite(heatLevel) && heatLevel >= 2) {
    addSuggestion('electrolytes-heat', 'Electrolytes', 'Pack electrolyte tabs or drink mix to offset sweat-salt loss in heat.', 'Exposure', 'watch', 42);
  }

  if (weatherContextEnabled && /fog|mist|smoke|blizzard/.test(windowDescription)) {
    addSuggestion('navigation-low-vis', 'Navigation', 'GPS device or downloaded offline maps required in low-visibility conditions.', 'General', 'watch', 44);
  }

  if (convective) {
    addSuggestion('storm-contingency', 'Storm contingency kit', 'Headlamp, backup power, and waterproof protection for navigation and communication. Gear does not make exposed terrain safe in lightning.', 'Safety', 'caution', 17);
  }

  if ((hasAlerts && cold) || avyDanger >= 3) {
    addSuggestion('emergency-shelter', 'Emergency shelter', 'Bivy sack or space blanket for severe conditions or extended rescue scenarios.', 'Safety', 'caution', 18);
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
    .map(({ id, title, detail, category, tone }) => ({ id, title, detail, category, tone }))
    .slice(0, MAX_GEAR_SUGGESTIONS);
};

module.exports = {
  buildLayeringGearSuggestions,
};
