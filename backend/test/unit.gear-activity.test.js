const { buildLayeringGearSuggestions, normalizeGearActivity } = require('../src/utils/gear-suggestions');

const calmInput = (overrides = {}) => ({
  weatherData: {
    temp: 60,
    feelsLike: 58,
    description: 'Mostly Sunny',
    windSpeed: 8,
    windGust: 12,
    precipChance: 10,
    humidity: 45,
    isDaytime: true,
  },
  trailStatus: 'dry',
  avalancheData: { relevant: false, dangerLevel: 0, dangerUnknown: false },
  airQualityData: { usAqi: 30 },
  alertsData: { activeCount: 0 },
  rainfallData: null,
  snowpackData: null,
  fireRiskData: { level: 0, label: 'Low' },
  heatRiskData: { level: 0 },
  ...overrides,
});

const icyInput = (overrides = {}) => calmInput({
  weatherData: {
    temp: 18,
    feelsLike: 10,
    description: 'Clear',
    windSpeed: 6,
    windGust: 10,
    precipChance: 5,
    humidity: 40,
    isDaytime: true,
  },
  trailStatus: 'Icy / firm snow',
  snowpackData: { snotel: { snowDepthIn: 30 } },
  ...overrides,
});

const ids = (suggestions) => suggestions.map((item) => item.id);
const byId = (suggestions, id) => suggestions.find((item) => item.id === id);

describe('normalizeGearActivity', () => {
  test('keeps known activities and falls back to backcountry', () => {
    expect(normalizeGearActivity('ski-touring')).toBe('ski-touring');
    expect(normalizeGearActivity(' Trail-Running ')).toBe('trail-running');
    expect(normalizeGearActivity('paragliding')).toBe('backcountry');
    expect(normalizeGearActivity(undefined)).toBe('backcountry');
  });
});

describe('buildLayeringGearSuggestions — activity tailoring', () => {
  test('without an activity the list matches the general backcountry list', () => {
    expect(buildLayeringGearSuggestions(icyInput())).toEqual(
      buildLayeringGearSuggestions(icyInput({ activity: 'backcountry' })),
    );
    expect(buildLayeringGearSuggestions(icyInput({ activity: 'hiking' }))).toEqual(
      buildLayeringGearSuggestions(icyInput()),
    );
  });

  test('trail runners get a vest kit, water and fuel, and running traction', () => {
    const suggestions = buildLayeringGearSuggestions(icyInput({ activity: 'trail-running' }));
    expect(byId(suggestions, 'backcountry-essentials').title).toBe('Running vest essentials');
    expect(byId(suggestions, 'hydration-run')).toBeDefined();
    expect(byId(suggestions, 'traction-snow').title).toMatch(/running traction/i);
  });

  test('trail runners get spare socks instead of waterproof boots in the wet', () => {
    const wet = { weatherData: { ...calmInput().weatherData, description: 'Rain showers', precipChance: 80 } };
    const running = buildLayeringGearSuggestions(calmInput({ ...wet, activity: 'trail-running' }));
    expect(byId(running, 'gaiters-wet').title).toBe('Spare dry socks');
    expect(byId(running, 'shell-wet').title).toBe('Light waterproof jacket');
    const hiking = buildLayeringGearSuggestions(calmInput({ ...wet, activity: 'hiking' }));
    expect(byId(hiking, 'gaiters-wet').title).toBe('Waterproof boots and gaiters');
  });

  test('scramblers always get a helmet', () => {
    const suggestions = buildLayeringGearSuggestions(calmInput({ activity: 'scrambling' }));
    expect(byId(suggestions, 'helmet-scramble')).toMatchObject({ tone: 'go', category: 'Safety & rescue' });
    expect(ids(buildLayeringGearSuggestions(calmInput()))).not.toContain('helmet-scramble');
  });

  test('alpine climbers get a rack, and crampons instead of microspikes on snow', () => {
    const calm = buildLayeringGearSuggestions(calmInput({ activity: 'alpine-climbing' }));
    expect(ids(calm)).toContain('climbing-kit');
    expect(ids(calm)).not.toContain('alpine-hardware');

    const icy = buildLayeringGearSuggestions(icyInput({ activity: 'alpine-climbing' }));
    expect(byId(icy, 'alpine-hardware')).toMatchObject({ title: 'Ice axe and crampons', tone: 'caution' });
    expect(ids(icy)).not.toContain('traction-snow');
  });

  test('snow climbers always carry axe and crampons, raised to caution when icy', () => {
    const calm = buildLayeringGearSuggestions(calmInput({ activity: 'snow-climbing' }));
    expect(byId(calm, 'alpine-hardware')).toMatchObject({ tone: 'go', reason: '' });
    expect(byId(calm, 'sun-protection').title).toBe('Glacier glasses and sunscreen');

    const icy = buildLayeringGearSuggestions(icyInput({ activity: 'snow-climbing' }));
    expect(byId(icy, 'alpine-hardware').tone).toBe('caution');
    expect(ids(icy)).not.toContain('traction-snow');
  });

  test('ski tourers get skins and a repair kit, never microspikes or snowshoes', () => {
    const suggestions = buildLayeringGearSuggestions(icyInput({ activity: 'ski-touring' }));
    expect(ids(suggestions)).toContain('ski-touring-kit');
    expect(byId(suggestions, 'traction-snow').title).toBe('Ski crampons and boot crampons');
    expect(ids(suggestions)).not.toContain('snow-flotation');

    const hiking = buildLayeringGearSuggestions(icyInput({ activity: 'hiking' }));
    expect(ids(hiking)).toContain('snow-flotation');
    expect(byId(hiking, 'traction-snow').title).toBe('Microspikes and trekking poles');
  });

  test('ski tours keep the avalanche kit without a published rating', () => {
    const avalancheData = { relevant: true, dangerLevel: 0, dangerUnknown: false };
    const skiing = buildLayeringGearSuggestions(icyInput({ avalancheData, activity: 'ski-touring' }));
    expect(byId(skiing, 'avalanche-kit')).toMatchObject({ tone: 'nogo', reason: 'Ski touring in avalanche terrain' });
    expect(ids(buildLayeringGearSuggestions(icyInput({ avalancheData })))).not.toContain('avalanche-kit');
  });

  test('ski tours skip the avalanche kit when avalanche terrain is not relevant', () => {
    const suggestions = buildLayeringGearSuggestions(calmInput({ activity: 'ski-touring' }));
    expect(ids(suggestions)).not.toContain('avalanche-kit');
  });

  test('ski tours skip the avalanche kit when avalanche details are disabled', () => {
    const suggestions = buildLayeringGearSuggestions(icyInput({
      activity: 'ski-touring',
      avalancheData: { relevant: true, dangerLevel: 0 },
      scoreFeatures: { avalancheDetails: false },
    }));
    expect(ids(suggestions)).not.toContain('avalanche-kit');
  });

  test('activity kit survives the item cap in a busy forecast', () => {
    const suggestions = buildLayeringGearSuggestions(icyInput({
      activity: 'scrambling',
      weatherData: {
        temp: -5, feelsLike: -20, description: 'Blizzard with fog', windSpeed: 35, windGust: 55,
        precipChance: 95, humidity: 90, isDaytime: false,
      },
      avalancheData: { relevant: true, dangerLevel: 4 },
      alertsData: { activeCount: 2 },
      airQualityData: { usAqi: 160 },
      rainfallData: { totals: { rainPast24hIn: 0.5, snowPast24hIn: 10 } },
    }));
    expect(suggestions.length).toBeLessThanOrEqual(12);
    expect(ids(suggestions)).toEqual(expect.arrayContaining(['backcountry-essentials', 'layering-core', 'helmet-scramble']));
  });
});
