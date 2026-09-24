const { buildCampNight, classifyCampNight } = require('../src/utils/camp-night');
const { buildContingencyAssessment } = require('../src/utils/contingency');

const HOUR = 3600000;
const OFFSET = '-07:00';

// Local wall clock (hours from midnight 2026-09-23) -> ISO with a fixed offset.
const isoAt = (hour) => {
  const base = Date.parse(`2026-09-23T00:00:00${OFFSET}`) + hour * HOUR;
  const local = new Date(base - 7 * HOUR).toISOString().slice(0, 19);
  return `${local}${OFFSET}`;
};

// Sunrise 07:00, sunset 19:00 on every day of the fixture.
const isDaytimeAt = (hour) => {
  const h = ((hour % 24) + 24) % 24;
  return h >= 7 && h < 19;
};

const buildRows = (fromHour, count, overrides = () => ({})) => Array.from({ length: count }, (_, i) => {
  const hour = fromHour + i;
  return {
    time: `${hour}:00`,
    timeIso: isoAt(hour),
    endTimeIso: isoAt(hour + 1),
    temp: 45,
    wind: 5,
    gust: 10,
    precipChance: 5,
    condition: 'Clear',
    isDaytime: isDaytimeAt(hour),
    ...overrides(hour),
  };
});

const weatherFor = ({ startHour = 8, windowHours = 7, afterHours = 30, overrides, elevation = 7200 } = {}) => ({
  elevation,
  forecastStartTime: isoAt(startHour),
  trend: buildRows(startHour, windowHours, overrides),
  afterWindowTrend: buildRows(startHour + windowHours, afterHours, overrides),
});

const campNight = (options = {}) => buildCampNight({
  weatherData: weatherFor(options),
  selectedStartTime: isoAt(options.startHour ?? 8),
  selectedTravelWindowHours: options.windowHours ?? 7,
});

describe('camp night', () => {
  test('reads the night from sunset to sunrise after arriving at camp', () => {
    const night = campNight();
    expect(night).toMatchObject({
      status: 'ok',
      arrivalIso: new Date(Date.parse(isoAt(15))).toISOString(),
      startIso: new Date(Date.parse(isoAt(19))).toISOString(),
      endIso: new Date(Date.parse(isoAt(31))).toISOString(),
      elevationFt: 7200,
      nightHours: 12,
      complete: true,
      missing: [],
      lowTempF: 45,
      severity: 'low',
      reasonCodes: [],
    });
    expect(night.summary).toMatch(/^The night at camp looks settled/);
  });

  test('arriving after dark starts the night at arrival', () => {
    const night = campNight({ startHour: 12, windowHours: 9 });
    expect(night.startIso).toBe(new Date(Date.parse(isoAt(21))).toISOString());
    expect(night.nightHours).toBe(10);
  });

  test('a cold, windy, wet night is hard; severe wind or storms are serious', () => {
    const hard = campNight({ overrides: (hour) => (hour >= 19 ? { temp: 22, gust: 32, precipChance: 60, condition: 'Rain' } : {}) });
    expect(hard.severity).toBe('moderate');
    expect(hard.reasonCodes).toEqual(expect.arrayContaining(['coldNight', 'windyCamp', 'wetNight']));
    expect(hard.summary).toMatch(/^A hard night at camp: feels like -?\d+°F at the coldest, gusts to 32 mph, 60% precipitation chance/);

    const stormy = campNight({ overrides: (hour) => (hour === 22 ? { condition: 'Chance Thunderstorms', precipChance: 40 } : {}) });
    expect(stormy.severity).toBe('high');
    expect(stormy.reasonCodes).toContain('storm');

    const blown = campNight({ overrides: (hour) => (hour >= 19 ? { gust: 50 } : {}) });
    expect(blown.severity).toBe('high');
    expect(blown.reasonCodes).toContain('severeWind');
  });

  test('a night past the end of the forecast is incomplete, never settled', () => {
    const night = campNight({ afterHours: 8 });
    expect(night.status).toBe('ok');
    expect(night.complete).toBe(false);
    expect(night.severity).toBe('low');
    expect(night.summary).toMatch(/^Nothing stands out in the forecast so far/);
    expect(night.summary).toMatch(/forecast ends 4 h into the night, before morning/);
  });

  test('missing readings stay null and make the night incomplete', () => {
    const night = campNight({ overrides: () => ({ precipChance: null }) });
    expect(night.peakPrecipChance).toBeNull();
    expect(night.missing).toEqual(['precipitation']);
    expect(night.complete).toBe(false);
    expect(night.summary).not.toMatch(/settled/);
    expect(night.summary).toMatch(/No precipitation forecast for the night/);
  });

  test('no forecast rows or no night within reach is unavailable', () => {
    expect(buildCampNight({ weatherData: { trend: [] }, selectedStartTime: isoAt(8), selectedTravelWindowHours: 7 }))
      .toMatchObject({ status: 'unavailable', summary: 'No forecast covers the night at camp yet.' });
    expect(campNight({ afterHours: 2 }).status).toBe('unavailable');
  });

  test('matches the numbers the contingency overnight reads for the same night', () => {
    const options = { overrides: (hour) => (hour >= 19 ? { temp: 30, gust: 25 } : {}) };
    const night = campNight(options);
    const { overnight } = buildContingencyAssessment({
      weatherData: weatherFor(options),
      selectedStartTime: isoAt(8),
      selectedTravelWindowHours: 7,
    });
    for (const key of ['startIso', 'endIso', 'lowTempF', 'minFeelsLikeF', 'peakGustMph', 'peakPrecipChance', 'coveredHours']) {
      expect(night[key]).toEqual(overnight[key]);
    }
  });

  test('classifies from the readings it has', () => {
    expect(classifyCampNight({ minFeelsLikeF: null, peakGustMph: null, peakPrecipChance: null })).toEqual({ severity: 'low', reasonCodes: [] });
    expect(classifyCampNight({ minFeelsLikeF: -5 }).severity).toBe('high');
    expect(classifyCampNight({ snow: true }).reasonCodes).toEqual(['snow']);
    expect(classifyCampNight({ snow: true, freezingRain: true }).reasonCodes).toEqual(['freezingRain']);
  });
});
