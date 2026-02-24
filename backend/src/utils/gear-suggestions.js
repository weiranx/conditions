const buildLayeringGearSuggestions = ({
  weatherData,
  trailStatus,
  avalancheData,
  airQualityData,
  alertsData,
  rainfallData,
  snowpackData,
  fireRiskData,
}) => {
  const suggestionMap = new Map();
  const addSuggestion = (key, text, priority = 50) => {
    if (typeof key !== 'string' || !key.trim() || typeof text !== 'string' || !text.trim()) {
      return;
    }
    const existing = suggestionMap.get(key);
    if (!existing || priority < existing.priority) {
      suggestionMap.set(key, { text, priority });
    }
  };
  const formatWhole = (value, suffix) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${Math.round(numeric)}${suffix}` : null;
  };
  const formatOneDecimal = (value, suffix) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${numeric.toFixed(1)}${suffix}` : null;
  };

  const description = String(weatherData?.description || '').toLowerCase();
  const tempF = Number(weatherData?.temp);
  const feelsLikeF = Number.isFinite(Number(weatherData?.feelsLike)) ? Number(weatherData?.feelsLike) : tempF;
  const windMph = Number(weatherData?.windSpeed);
  const gustMph = Number(weatherData?.windGust);
  const precipChance = Number(weatherData?.precipChance);
  const humidity = Number(weatherData?.humidity);
  const rain24hIn = Number(rainfallData?.totals?.rainPast24hIn ?? rainfallData?.totals?.past24hIn);
  const snow24hIn = Number(rainfallData?.totals?.snowPast24hIn);
  const snotelDepthIn = Number(snowpackData?.snotel?.snowDepthIn);
  const nohrscDepthIn = Number(snowpackData?.nohrsc?.snowDepthIn);
  const maxObservedSnowDepthIn = [snotelDepthIn, nohrscDepthIn].filter(Number.isFinite).reduce((max, current) => Math.max(max, current), 0);

  const hasWetSignal =
    /rain|shower|drizzle|wet|thunder|storm/.test(description) ||
    (Number.isFinite(precipChance) && precipChance >= 45 && Number.isFinite(tempF) && tempF > 30);
  const hasSnowSignal =
    /snow|sleet|freezing|ice|blizzard|wintry|graupel|flurr/.test(description) ||
    (Number.isFinite(tempF) && tempF <= 34 && Number.isFinite(precipChance) && precipChance >= 40) ||
    maxObservedSnowDepthIn >= 2;
  const windy = (Number.isFinite(gustMph) && gustMph >= 25) || (Number.isFinite(windMph) && windMph >= 18);
  const cold = Number.isFinite(feelsLikeF) && feelsLikeF <= 20;
  const veryCold = Number.isFinite(feelsLikeF) && feelsLikeF <= 5;
  const muddy = String(trailStatus || '').toLowerCase().includes('mud');
  const icy = String(trailStatus || '').toLowerCase().includes('icy') || String(trailStatus || '').toLowerCase().includes('snow');
  const hasRainAccumulation = Number.isFinite(rain24hIn) && rain24hIn >= 0.2;
  const hasFreshSnow = Number.isFinite(snow24hIn) && snow24hIn >= 2;

  addSuggestion(
    'layering-core',
    'Layering core: Moisture-wicking base + breathable midlayer. Avoid cotton to limit chill during breaks.',
    10,
  );

  if (hasWetSignal || hasRainAccumulation) {
    addSuggestion(
      'shell-wet',
      `Storm shell: Waterproof-breathable jacket + pants${formatWhole(precipChance, '%') ? ` (${formatWhole(precipChance, '%')} precip)` : ''}${formatOneDecimal(rain24hIn, ' in rain/24h') ? ` and ${formatOneDecimal(rain24hIn, ' in rain/24h')}` : ''}.`,
      20,
    );
    addSuggestion('gaiters-wet', 'Wet-foot control: Gaiters + waterproof footwear to reduce ankle/boot soak-through.', 32);
  } else if (hasSnowSignal || windy) {
    addSuggestion(
      'shell-wind-snow',
      `Wind/snow shell: Wind-resistant outer layer for exposed terrain${formatWhole(gustMph, ' mph') ? ` (${formatWhole(gustMph, ' mph')} gusts)` : ''}.`,
      22,
    );
  } else {
    addSuggestion('shell-light', 'Light shell backup: Pack a light wind shell for ridge exposure and fast weather shifts.', 60);
  }

  if (cold || hasSnowSignal || windy) {
    addSuggestion(
      'insulation-stop',
      `Static insulation: Puffy sized over active layers${formatWhole(feelsLikeF, 'F') ? ` (feels ${formatWhole(feelsLikeF, 'F')})` : ''} for stops and contingencies.`,
      24,
    );
  }
  if (veryCold) {
    addSuggestion('extremities-cold', 'Cold extremities kit: Warm hat, neck gaiter, insulated gloves/mitts, and spare liners.', 16);
  }

  if (muddy || hasRainAccumulation) {
    addSuggestion('traction-mud', 'Mud traction: Aggressive-lug footwear and poles for slick or soft approaches.', 34);
  }
  if (icy || hasFreshSnow || maxObservedSnowDepthIn >= 4) {
    addSuggestion(
      'traction-snow',
      `Snow/ice traction: Carry traction devices + poles${formatOneDecimal(maxObservedSnowDepthIn, ' in observed snow depth') ? ` (${formatOneDecimal(maxObservedSnowDepthIn, ' in observed snow depth')})` : ''}.`,
      26,
    );
  }

  if (Number.isFinite(humidity) && humidity > 80) {
    addSuggestion('humidity-management', `Moisture backup: Pack one dry base layer for high humidity (${Math.round(humidity)}% RH).`, 48);
  }
  if (Number(airQualityData?.usAqi) >= 101) {
    addSuggestion('aq-health', `Air quality protection: Buff/mask + lower-intensity pacing (AQI ${Math.round(Number(airQualityData.usAqi))}).`, 30);
  }
  if (Number(alertsData?.activeCount) > 0) {
    addSuggestion('alerts-comms', 'Alerts contingency: Verify active alert details and carry backup comms/power.', 28);
  }
  if (Number(fireRiskData?.level) >= 3) {
    addSuggestion('fire-risk', `Heat/fire prep: Extra water + sun protection; verify land-management restrictions (${fireRiskData.label || 'elevated fire risk'}).`, 36);
  }

  if (avalancheData?.relevant !== false && Number(avalancheData?.dangerLevel) >= 2) {
    addSuggestion('avalanche-kit', 'Avalanche rescue kit: Beacon, shovel, probe, and partner check before departure.', 14);
  }
  if (avalancheData?.relevant !== false && avalancheData?.dangerUnknown) {
    addSuggestion('avalanche-unknown', 'Avalanche coverage gap: No official rating. Choose non-avalanche terrain and conservative slopes.', 12);
  }

  addSuggestion('final-system-check', 'Final system check: Confirm shell + insulation work together without loft compression or mobility loss.', 70);

  return Array.from(suggestionMap.values())
    .sort((a, b) => a.priority - b.priority)
    .map((entry) => entry.text)
    .slice(0, 9);
};

module.exports = {
  buildLayeringGearSuggestions,
};
