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
}) => {
  const suggestionMap = new Map();
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
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${Math.round(numeric)}${suffix}` : null;
  };
  const formatOneDecimal = (value, suffix) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${numeric.toFixed(1)}${suffix}` : null;
  };

  const description = String(weatherData?.description || '').toLowerCase();
  const tempF = parseFloat(weatherData?.temp);
  const feelsLikeF = Number.isFinite(parseFloat(weatherData?.feelsLike)) ? parseFloat(weatherData?.feelsLike) : tempF;
  const windMph = parseFloat(weatherData?.windSpeed);
  const gustMph = parseFloat(weatherData?.windGust);
  const precipChance = parseFloat(weatherData?.precipChance);
  const humidity = parseFloat(weatherData?.humidity);
  const rain24hIn = parseFloat(rainfallData?.totals?.rainPast24hIn ?? rainfallData?.totals?.past24hIn);
  const snow24hIn = parseFloat(rainfallData?.totals?.snowPast24hIn);
  const snotelDepthIn = parseFloat(snowpackData?.snotel?.snowDepthIn);
  const nohrscDepthIn = parseFloat(snowpackData?.nohrsc?.snowDepthIn);
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
  const isDaytime = weatherData?.isDaytime;
  const avyDanger = Number(avalancheData?.dangerLevel);
  const hasAlerts = Number(alertsData?.activeCount) > 0;
  const heatLevel = Number(heatRiskData?.level);

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
      `Waterproof-breathable jacket + pants${formatWhole(precipChance, '%') ? ` (${formatWhole(precipChance, '%')} precip)` : ''}${formatOneDecimal(rain24hIn, ' in rain/24h') ? ` and ${formatOneDecimal(rain24hIn, ' in rain/24h')}` : ''}.`,
      'Conditions',
      'caution',
      20,
    );
    addSuggestion('gaiters-wet', 'Wet-foot control', 'Gaiters + waterproof footwear to reduce ankle/boot soak-through.', 'Conditions', 'watch', 32);
  } else if (hasSnowSignal || windy) {
    addSuggestion(
      'shell-wind-snow',
      'Wind/snow shell',
      `Wind-resistant outer layer for exposed terrain${formatWhole(gustMph, ' mph') ? ` (${formatWhole(gustMph, ' mph')} gusts)` : ''}.`,
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
      `Puffy sized over active layers${formatWhole(feelsLikeF, 'F') ? ` (feels ${formatWhole(feelsLikeF, 'F')})` : ''} for stops and contingencies.`,
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
  if (icy || hasFreshSnow || maxObservedSnowDepthIn >= 4) {
    addSuggestion(
      'traction-snow',
      'Snow/ice traction',
      `Carry traction devices + poles${formatOneDecimal(maxObservedSnowDepthIn, ' in observed snow depth') ? ` (${formatOneDecimal(maxObservedSnowDepthIn, ' in observed snow depth')})` : ''}.`,
      'Conditions',
      'caution',
      26,
    );
  }
  if (maxObservedSnowDepthIn >= 12 || (icy && cold)) {
    addSuggestion('alpine-hardware', 'Alpine hardware', 'Ice axe + crampons for steep snow/ice; consider helmet for exposed terrain above treeline.', 'Safety', 'caution', 15);
  }

  if (Number.isFinite(humidity) && humidity > 80) {
    addSuggestion('humidity-management', 'Moisture backup', `Pack one dry base layer for high humidity (${Math.round(humidity)}% RH).`, 'Conditions', 'go', 48);
  }
  if (Number(airQualityData?.usAqi) >= 101) {
    addSuggestion('aq-health', 'Air quality protection', `Buff/mask + lower-intensity pacing (AQI ${Math.round(Number(airQualityData.usAqi))}).`, 'Exposure', 'watch', 30);
  }
  if (hasAlerts) {
    addSuggestion('alerts-comms', 'Alerts contingency', 'Verify active alert details and carry backup comms/power.', 'Safety', 'watch', 28);
  }
  if (Number(fireRiskData?.level) >= 3) {
    addSuggestion('fire-risk', 'Heat/fire prep', `Extra water + sun protection; verify land-management restrictions (${fireRiskData.label || 'elevated fire risk'}).`, 'Exposure', 'watch', 36);
  }

  if (avalancheData?.relevant !== false && avyDanger >= 2) {
    const avyTone = avyDanger >= 4 ? 'nogo' : 'caution';
    addSuggestion('avalanche-kit', 'Avalanche rescue kit', 'Beacon, shovel, probe, and partner check before departure.', 'Safety', avyTone, 14);
  }
  if (avalancheData?.relevant !== false && avalancheData?.dangerUnknown) {
    addSuggestion('avalanche-unknown', 'Avalanche coverage gap', 'No official rating. Choose non-avalanche terrain and conservative slopes.', 'Safety', 'nogo', 12);
  }

  if (Number.isFinite(feelsLikeF) && feelsLikeF >= 68 && isDaytime !== false) {
    addSuggestion('sun-protection', 'Sun protection', 'Sunscreen, sunglasses, and sun hat for UV exposure on open terrain.', 'Exposure', 'go', 40);
  }
  if (Number.isFinite(heatLevel) && heatLevel >= 1) {
    addSuggestion('hydration-heat', 'Heat hydration', 'Carry extra water; plan re-supply points for heat-stress conditions.', 'Exposure', 'watch', 38);
  }
  if (Number.isFinite(heatLevel) && heatLevel >= 2) {
    addSuggestion('electrolytes-heat', 'Electrolytes', 'Pack electrolyte tabs or drink mix to offset sweat-salt loss in heat.', 'Exposure', 'watch', 42);
  }

  if (/fog|mist|smoke|blizzard/.test(description)) {
    addSuggestion('navigation-low-vis', 'Navigation', 'GPS device or downloaded offline maps required in low-visibility conditions.', 'General', 'watch', 44);
  }

  if ((hasAlerts && cold) || avyDanger >= 3) {
    addSuggestion('emergency-shelter', 'Emergency shelter', 'Bivy sack or space blanket for severe conditions or extended rescue scenarios.', 'Safety', 'caution', 18);
  }

  return Array.from(suggestionMap.values())
    .sort((a, b) => a.priority - b.priority)
    .map(({ id, title, detail, category, tone }) => ({ id, title, detail, category, tone }))
    .slice(0, 10);
};

module.exports = {
  buildLayeringGearSuggestions,
};
