'use strict';

const { buildFireRiskData } = require('../src/utils/fire-risk');
const { buildLayeringGearSuggestions } = require('../src/utils/gear-suggestions');
const { calculateSafetyScore } = require('../src/utils/safety-score');

const calm = { temp: 45, humidity: 40, windSpeed: 5, windGust: 10, description: 'Sunny' };
const fireRisk = ({ incidents = [], weatherData = calm, usAqi = 20, alerts = [] } = {}) => buildFireRiskData({
  weatherData,
  alertsData: { status: alerts.length ? 'ok' : 'none', alerts },
  airQualityData: { usAqi },
  localConditionsData: { wildfire: { incidents } },
});

describe('fire near the objective', () => {
  test('names an uncontained fire, its size, and its distance', () => {
    const risk = fireRisk({ incidents: [{ name: 'GARDA FALLS', acres: 73, percentContained: 0, distanceKm: 8.3 }] });
    expect(risk).toMatchObject({ level: 4, label: 'Extreme', primaryDriver: 'fire' });
    expect(risk.reasons[0]).toBe('The Garda Falls fire (73 acres, 0% contained) is about 8 km (5 mi) away.');
  });

  test('a largely contained fire is a caution, not extreme fire risk', () => {
    const risk = fireRisk({ incidents: [{ name: 'GRASSHOPPER', acres: 93971, percentContained: 98, distanceKm: 19.1 }] });
    expect(risk).toMatchObject({ level: 1, label: 'Caution', primaryDriver: 'fire' });
    expect(risk.reasons[0]).toMatch(/^The Grasshopper fire \(93,971 acres, 98% contained\) was reported about 19 km \(12 mi\) away; at its size its edge could be at the objective\. It is largely contained/);
  });

  test('an active fire outranks a nearer contained one', () => {
    const risk = fireRisk({ incidents: [
      { name: 'Old Burn', acres: 500, percentContained: 100, distanceKm: 5 },
      { name: 'New Start', acres: 40, percentContained: 5, distanceKm: 30 },
    ] });
    expect(risk.level).toBe(3);
    expect(risk.reasons[0]).toMatch(/^The New Start fire \(40 acres, 5% contained\) is about 30 km/);
  });

  test('a fire with unknown containment is treated as active', () => {
    expect(fireRisk({ incidents: [{ name: 'Mystery', distanceKm: 10 }] }).level).toBe(4);
  });

  test('does not repeat "fire" in a name that has it', () => {
    expect(fireRisk({ incidents: [{ name: 'CEDAR CREEK FIRE', percentContained: 10, distanceKm: 12 }] }).reasons[0])
      .toMatch(/^The Cedar Creek Fire \(10% contained\)/);
  });
});

describe('reasons and drivers', () => {
  test('the reason that sets the level comes first', () => {
    const risk = fireRisk({ usAqi: 60, incidents: [{ name: 'Near', percentContained: 0, distanceKm: 5 }] });
    expect(risk.level).toBe(4);
    expect(risk.reasons[0]).toMatch(/^The Near fire/);
    expect(risk.reasons[1]).toMatch(/Moderate AQI/);
  });

  test('fire weather is the driver when the weather sets the level', () => {
    const risk = fireRisk({ weatherData: { temp: 92, humidity: 15, windSpeed: 22, windGust: 30, description: 'Sunny' } });
    expect(risk).toMatchObject({ level: 4, primaryDriver: 'weather' });
    expect(risk.reasons[0]).toBe('Hot, dry, windy fire weather (92F, RH 15%, wind 22 mph).');
  });

  test('no driver when nothing raises the level', () => {
    expect(fireRisk()).toMatchObject({ level: 0, primaryDriver: null });
  });
});

describe('fire gear and score wording follow the driver', () => {
  const fireGear = (fireRiskData) => buildLayeringGearSuggestions({
    weatherData: { ...calm, trend: [] },
    trailStatus: 'Dry',
    selectedTravelWindowHours: 8,
    fireRiskData,
  }).find((item) => item.id === 'fire-risk');

  test('fire on the ground asks for exits and updates, not hydration', () => {
    const gear = fireGear(fireRisk({ incidents: [{ name: 'Near', percentContained: 0, distanceKm: 5 }] }));
    expect(gear).toMatchObject({ title: 'Offline map with more than one exit', reason: 'Active fire near the objective' });
  });

  test('hot, dry fire weather keeps water and sun cover', () => {
    const gear = fireGear(fireRisk({ weatherData: { temp: 92, humidity: 15, windSpeed: 22, windGust: 30, description: 'Sunny' } }));
    expect(gear).toMatchObject({ title: 'Extra water and sun cover', reason: 'Extreme fire danger in dry air' });
  });

  test('the score factor names the cause', () => {
    const fireRiskData = fireRisk({ incidents: [{ name: 'GARDA FALLS', acres: 73, percentContained: 0, distanceKm: 8.3 }] });
    const factor = calculateSafetyScore({
      weatherData: { ...calm, trend: [] },
      avalancheData: { relevant: false },
      alertsData: { status: 'none', activeCount: 0, alerts: [] },
      airQualityData: { status: 'ok', usAqi: 20 },
      fireRiskData,
      selectedDate: '2026-09-24',
      selectedStartClock: '06:00',
      selectedTravelWindowHours: 8,
    }).factors.find((item) => item.hazard === 'Fire Danger');
    expect(factor.message).toBe('Extreme fire risk: The Garda Falls fire (73 acres, 0% contained) is about 8 km (5 mi) away.');
  });
});
