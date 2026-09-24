'use strict';

const { buildSunClock, windowIncludesDark, windowIncludesDaylight } = require('../src/utils/daylight');
const { buildLayeringGearSuggestions } = require('../src/utils/gear-suggestions');
const { calculateSafetyScore } = require('../src/utils/safety-score');

const denver = (solar, anchorIso = '2026-09-23T12:00:00-06:00') => buildSunClock({ solarData: solar, timeZone: 'America/Denver', anchorIso });
const iso = (ms) => new Date(ms).toISOString();

describe('sun clock', () => {
  const sun = denver({ sunrise: '6:30:00 AM', sunset: '6:45:00 PM' });

  test('needs sun times, a time zone and a report date', () => {
    const anchorIso = '2026-09-23T12:00:00-06:00';
    expect(buildSunClock({ solarData: { sunrise: 'N/A', sunset: 'N/A' }, timeZone: 'America/Denver', anchorIso })).toBeNull();
    expect(buildSunClock({ solarData: { sunrise: '6:30 AM', sunset: '6:30 AM' }, timeZone: 'America/Denver', anchorIso })).toBeNull();
    expect(buildSunClock({ solarData: { sunrise: '6:30 AM', sunset: '6:45 PM' }, timeZone: null, anchorIso })).toBeNull();
    expect(buildSunClock({ solarData: { sunrise: '6:30 AM', sunset: '6:45 PM' }, timeZone: 'Not/AZone', anchorIso })).toBeNull();
    expect(buildSunClock({ solarData: { sunrise: '6:30 AM', sunset: '6:45 PM' }, timeZone: 'America/Denver' })).toBeNull();
  });

  test('reads light and dark from the local clock', () => {
    expect(sun.isDarkAt(Date.parse('2026-09-23T06:29:00-06:00'))).toBe(true);
    expect(sun.isDarkAt(Date.parse('2026-09-23T06:30:00-06:00'))).toBe(false);
    expect(sun.isDarkAt(Date.parse('2026-09-23T18:44:00-06:00'))).toBe(false);
    expect(sun.isDarkAt(Date.parse('2026-09-23T18:45:00-06:00'))).toBe(true);
  });

  test('finds the next sunset and sunrise', () => {
    expect(new Date(sun.nextSunset(Date.parse('2026-09-23T12:00:00-06:00'))).toISOString()).toBe('2026-09-24T00:45:00.000Z');
    expect(new Date(sun.nextSunrise(Date.parse('2026-09-23T20:00:00-06:00'))).toISOString()).toBe('2026-09-24T12:30:00.000Z');
  });

  test('the next day keeps the sun time, not the clock time, across daylight saving', () => {
    // Clocks fall back on 1 November 2026: a 7:30 AM MDT sunrise returns at
    // about 6:30 AM MST, the same instant a day later, not at 7:30 MST.
    const fallBack = denver({ sunrise: '7:30:00 AM', sunset: '6:00:00 PM' }, '2026-10-31T12:00:00-06:00');
    expect(iso(fallBack.nextSunrise(Date.parse('2026-10-31T22:00:00-06:00')))).toBe('2026-11-01T13:30:00.000Z');
    // Clocks spring forward on 8 March 2026: 6:30 AM MST returns at 7:30 AM MDT.
    const springForward = denver({ sunrise: '6:30:00 AM', sunset: '6:00:00 PM' }, '2026-03-07T12:00:00-07:00');
    expect(iso(springForward.nextSunrise(Date.parse('2026-03-07T22:00:00-07:00')))).toBe('2026-03-08T13:30:00.000Z');
    expect(springForward.isDarkAt(Date.parse('2026-03-08T07:00:00-06:00'))).toBe(true);
  });

  test('a sunset after midnight keeps the evening light', () => {
    // Fairbanks near the solstice: up at 2:58 AM, down at 12:47 AM the next day.
    const north = buildSunClock({ solarData: { sunrise: '2:58:00 AM', sunset: '12:47:00 AM' }, timeZone: 'America/Anchorage', anchorIso: '2026-06-21T12:00:00-08:00' });
    expect(north.isDarkAt(Date.parse('2026-06-21T23:30:00-08:00'))).toBe(false);
    expect(north.isDarkAt(Date.parse('2026-06-22T01:00:00-08:00'))).toBe(true);
    expect(north.isDarkAt(Date.parse('2026-06-22T03:30:00-08:00'))).toBe(false);
    expect(iso(north.nextSunset(Date.parse('2026-06-21T20:00:00-08:00')))).toBe('2026-06-22T08:47:00.000Z');
    expect(iso(north.nextSunrise(Date.parse('2026-06-22T01:00:00-08:00')))).toBe('2026-06-22T10:58:00.000Z');
    expect(windowIncludesDark(north, '2026-06-21T14:00:00-08:00', 10)).toBe(false);
  });

  test('tells whether a window reaches the dark or the light', () => {
    expect(windowIncludesDark(sun, '2026-09-23T07:00:00-06:00', 10)).toBe(false);
    expect(windowIncludesDark(sun, '2026-09-23T09:00:00-06:00', 10)).toBe(true);
    expect(windowIncludesDark(sun, '2026-09-23T05:00:00-06:00', 4)).toBe(true);
    expect(windowIncludesDaylight(sun, '2026-09-23T20:00:00-06:00', 8)).toBe(false);
    expect(windowIncludesDaylight(sun, '2026-09-23T20:00:00-06:00', 12)).toBe(true);
    expect(windowIncludesDark(null, '2026-09-23T07:00:00-06:00', 10)).toBeNull();
  });
});

// NOAA hourly periods flag 6 AM-6 PM as day in every season.
const noaaDay = (hour) => hour >= 6 && hour < 18;
const winterWeather = ({ startHour, hours }) => ({
  description: 'Sunny',
  temp: 40,
  feelsLike: 40,
  windSpeed: 5,
  windGust: 8,
  precipChance: 0,
  humidity: 40,
  issuedTime: new Date().toISOString(),
  timezone: 'America/Denver',
  isDaytime: noaaDay(startHour),
  forecastStartTime: `2026-12-15T${String(startHour).padStart(2, '0')}:00:00-07:00`,
  trend: Array.from({ length: hours }, (_, i) => ({
    time: `${startHour + i}:00`,
    timeIso: `2026-12-15T${String(startHour + i).padStart(2, '0')}:00:00-07:00`,
    temp: 40,
    wind: 5,
    gust: 8,
    precipChance: 0,
    condition: 'Sunny',
    isDaytime: noaaDay(startHour + i),
  })),
});
const winterSolar = { sunrise: '7:14:00 AM', sunset: '4:41:00 PM' };

describe('gear follows the sun', () => {
  const gearIds = (weatherData, solarData) => buildLayeringGearSuggestions({
    weatherData,
    trailStatus: 'Dry',
    selectedTravelWindowHours: 8,
    solarData,
    selectedStartTime: weatherData.forecastStartTime,
  }).map((item) => item.id);

  test('a 6 AM winter start before sunrise needs a headlamp', () => {
    const weatherData = winterWeather({ startHour: 6, hours: 8 });
    expect(gearIds(weatherData, null)).not.toContain('headlamp-dark');
    expect(gearIds(weatherData, winterSolar)).toContain('headlamp-dark');
  });

  test('a day entirely between sunrise and sunset needs none', () => {
    const weatherData = winterWeather({ startHour: 8, hours: 8 });
    expect(gearIds(weatherData, winterSolar)).not.toContain('headlamp-dark');
  });
});

describe('darkness factor follows sunset', () => {
  const darkness = (weatherData, solarData, selectedStartClock) => calculateSafetyScore({
    weatherData,
    avalancheData: { relevant: false },
    alertsData: { status: 'none', activeCount: 0, alerts: [] },
    airQualityData: { status: 'ok', usAqi: 20 },
    rainfallData: { status: 'ok', anchorTime: new Date().toISOString() },
    selectedDate: '2026-12-15',
    selectedStartClock,
    selectedTravelWindowHours: 4,
    solarData,
  }).factors.find((factor) => factor.hazard === 'Darkness');

  test('a 5 PM December start is after sunset though NOAA calls it day', () => {
    const weatherData = { ...winterWeather({ startHour: 17, hours: 4 }), isDaytime: true };
    expect(darkness(weatherData, winterSolar, '17:00')).toMatchObject({ source: 'Sunrise and sunset times' });
  });

  test('a 6:30 PM June start before sunset is not dark though NOAA calls it night', () => {
    const weatherData = { ...winterWeather({ startHour: 18, hours: 4 }), isDaytime: false };
    expect(darkness(weatherData, { sunrise: '5:35:00 AM', sunset: '8:30:00 PM' }, '18:30')).toBeUndefined();
  });

  test('an alpine start before sunrise is not penalized', () => {
    const weatherData = { ...winterWeather({ startHour: 4, hours: 4 }), isDaytime: false };
    expect(darkness(weatherData, winterSolar, '04:00')).toBeUndefined();
  });

  test('a 10 PM start is still daylight when the sun sets after midnight', () => {
    const weatherData = { ...winterWeather({ startHour: 22, hours: 1 }), isDaytime: false };
    expect(darkness(weatherData, { sunrise: '2:58:00 AM', sunset: '12:47:00 AM' }, '22:00')).toBeUndefined();
  });

  test('falls back to the forecast flag without sun times', () => {
    const weatherData = { ...winterWeather({ startHour: 20, hours: 4 }), isDaytime: false };
    expect(darkness(weatherData, null, '20:00')).toMatchObject({ source: expect.stringMatching(/isDaytime flag/) });
  });
});
