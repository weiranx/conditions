interface BuildLayeringGearSuggestionsOptions {
  weatherData: any;
  trailStatus: string | null | undefined;
  avalancheData?: any;
  airQualityData?: any;
  alertsData?: any;
  rainfallData?: any;
  snowpackData?: any;
  fireRiskData?: any;
}

export const buildLayeringGearSuggestions = ({
  weatherData,
  trailStatus,
  avalancheData,
  airQualityData,
  alertsData,
  rainfallData,
  snowpackData,
  fireRiskData,
}: BuildLayeringGearSuggestionsOptions): string[] => {
  const suggestionMap = new Map<string, { text: string; priority: number }>();
  const addSuggestion = (key: string, text: string, priority: number = 50) => {
    if (typeof key !== 'string' || !key.trim() || typeof text !== 'string' || !text.trim()) {
      return;
    }
    const existing = suggestionMap.get(key);
    if (!existing || priority < existing.priority) {
      suggestionMap.set(key, { text, priority });
    }
  };
  const formatWhole = (value: any, suffix: string): string | null => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${Math.round(numeric)}${suffix}` : null;
  };
  const formatOneDecimal = (value: any, suffix: string): string | null => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${numeric.toFixed(1)}${suffix}` : null;
  };

  const description = String(weatherData?.description || '').toLowerCase();
  const tempF = parseFloat(weatherData?.temp);
  const feelsLikeF = Number.isFinite(parseFloat(weatherData?.feelsLike)) ? (parseFloat(weatherData?.feelsLike) as number) : tempF;
  const windMph = parseFloat(weatherData?.windSpeed);
  const gustMph = parseFloat(weatherData?.windGust);
  const precipChance = parseFloat(weatherData?.precipChance);
  const humidity = parseFloat(weatherData?.humidity);
  const rain24hIn = parseFloat(rainfallData?.totals?.rainPast24hIn ?? rainfallData?.totals?.past24hIn);
  const snow24hIn = parseFloat(rainfallData?.totals?.snowPast24hIn);
  const snotelDepthIn = parseFloat(snowpackData?.snotel?.snowDepthIn);
  const nohrscDepthIn = parseFloat(snowpackData?.nohrsc?.snowDepthIn);
  const maxObservedSnowDepthIn = [snotelDepthIn, nohrscDepthIn].filter(Number.isFinite).reduce((max, current) => Math.max(max as number, current as number), 0) as number;

  const hasWetSignal =
    /rain|shower|drizzle|wet|thunder|storm/.test(description) ||
    (Number.isFinite(precipChance) && (precipChance as number) >= 45 && Number.isFinite(tempF) && (tempF as number) > 30);
  const hasSnowSignal =
    /snow|sleet|freezing|ice|blizzard|wintry|graupel|flurr/.test(description) ||
    (Number.isFinite(tempF) && (tempF as number) <= 34 && Number.isFinite(precipChance) && (precipChance as number) >= 40) ||
    maxObservedSnowDepthIn >= 2;
  const windy = (Number.isFinite(gustMph) && (gustMph as number) >= 25) || (Number.isFinite(windMph) && (windMph as number) >= 18);
  const cold = Number.isFinite(feelsLikeF) && (feelsLikeF as number) <= 20;
  const veryCold = Number.isFinite(feelsLikeF) && (feelsLikeF as number) <= 5;
  const muddy = String(trailStatus || '').toLowerCase().includes('mud');
  const icy = String(trailStatus || '').toLowerCase().includes('icy') || String(trailStatus || '').toLowerCase().includes('snow');
  const hasRainAccumulation = Number.isFinite(rain24hIn) && (rain24hIn as number) >= 0.2;
  const hasFreshSnow = Number.isFinite(snow24hIn) && (snow24hIn as number) >= 2;

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

  if (Number.isFinite(humidity) && (humidity as number) > 80) {
    addSuggestion('humidity-management', `Moisture backup: Pack one dry base layer for high humidity (${Math.round(humidity as number)}% RH).`, 48);
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
