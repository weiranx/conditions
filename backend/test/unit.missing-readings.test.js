'use strict';

// Providers report a missing reading as null. Number(null) is 0, so every
// parser must keep null distinct from a measured 0: an unknown sky is not
// clear, an unreported snow depth is not bare ground, and an unanswered
// elevation lookup is not sea level.

const { fetchWeatherPipeline } = require('../src/utils/weather-pipeline');
const { createSnowpackService } = require('../src/utils/snowpack');
const { createElevationService } = require('../src/utils/geo');

const HOUR = 3600000;
const isoAt = (hour) => {
  const local = new Date(Date.parse('2026-09-23T00:00:00-07:00') + (hour - 7) * HOUR).toISOString().slice(0, 19);
  return `${local}-07:00`;
};
const response = (payload) => ({ ok: true, headers: { get: () => null }, json: async () => payload });
const passThroughCache = () => ({ getOrFetch: (_key, fn) => fn() });

describe('NOAA hourly rows', () => {
  const runPipeline = async (periods) => {
    const fetchWithTimeout = jest.fn(async (url) => response(String(url).includes('/points/')
      ? { properties: { forecastHourly: 'https://api.weather.gov/hourly', elevation: { value: 1000 }, timeZone: 'America/Los_Angeles' } }
      : String(url).includes('sunrisesunset')
        ? { status: 'OK', results: { sunrise: '7:00:00 AM', sunset: '7:00:00 PM', day_length: '12:00:00' } }
        : { properties: { periods, updateTime: isoAt(0) } }));
    const { weatherData } = await fetchWeatherPipeline({
      parsedLat: 40,
      parsedLon: -111,
      requestedDate: '2026-09-23',
      requestedStartClock: '08:00',
      requestedTravelWindowHours: 4,
      fetchOptions: {},
      noaaPointsCache: passThroughCache(),
      noaaForecastCache: passThroughCache(),
      solarCache: passThroughCache(),
      fetchWithTimeout,
      fetchObjectiveElevationFt: jest.fn(),
      fetchOpenMeteoWeatherFallback: jest.fn(async () => { throw new Error('offline'); }),
      createUnavailableWeatherData: jest.fn(),
    });
    return weatherData;
  };

  const period = (hour, overrides = {}) => ({
    startTime: isoAt(hour),
    endTime: isoAt(hour + 1),
    temperature: 50,
    windSpeed: '5 mph',
    shortForecast: 'Mostly Cloudy',
    icon: 'https://api.weather.gov/icons/land/day/bkn?size=small',
    isDaytime: hour >= 7 && hour < 19,
    probabilityOfPrecipitation: { value: 10 },
    relativeHumidity: { value: 40 },
    dewpoint: { unitCode: 'wmoUnit:degC', value: 5 },
    ...overrides,
  });

  test('an hour whose sky cover cannot be derived stays unknown instead of clear', async () => {
    const periods = Array.from({ length: 48 }, (_, hour) => period(hour, hour === 9
      ? { shortForecast: 'Chance Rain Showers', icon: 'https://api.weather.gov/icons/land/day/rain_showers,40?size=small' }
      : {}));
    const weather = await runPipeline(periods);
    const rainHour = weather.trend.find((row) => row.timeIso === isoAt(9));
    expect(rainHour.cloudCover).toBeNull();
    expect(weather.trend.find((row) => row.timeIso === isoAt(8)).cloudCover).toBe(75);
  });

  test('a missing dew point is null, not 32 °F', async () => {
    const periods = Array.from({ length: 48 }, (_, hour) => period(hour, { dewpoint: { unitCode: 'wmoUnit:degC', value: null } }));
    const weather = await runPipeline(periods);
    expect(weather.dewPoint).toBeNull();
    expect(weather.sourceDetails.fieldSources.dewPoint).toBe('Unavailable');
    expect(weather.trend.every((row) => row.dewPoint === null)).toBe(true);
  });

  test('a missing temperature does not add a 0 °F low to the 24-hour context', async () => {
    const periods = Array.from({ length: 48 }, (_, hour) => period(hour, hour === 12 ? { temperature: null } : {}));
    const weather = await runPipeline(periods);
    expect(weather.temperatureContext24h.minTempF).toBe(50);
  });
});

describe('snowpack observations', () => {
  const stations = [
    { stationTriplet: 'ONE:XX:SNTL', stationId: '1', networkCode: 'SNTL', name: 'One', latitude: 40, longitude: -111, elevation: 9000 },
    { stationTriplet: 'TWO:XX:SNTL', stationId: '2', networkCode: 'SNTL', name: 'Two', latitude: 40.1, longitude: -111, elevation: null },
  ];
  const element = (elementCode, values) => ({ stationElement: { elementCode }, values });
  const dataByTriplet = {
    // Today's readings are not reported yet.
    'ONE:XX:SNTL': [
      element('WTEQ', [
        { date: '2025-01-15', value: 10 },
        { date: '2026-01-14', value: 11 },
        { date: '2026-01-15', value: null },
      ]),
      element('SNWD', [
        { date: '2026-01-14', value: 40 },
        { date: '2026-01-15', value: null },
      ]),
    ],
    // A SWE-only site: it reports no depth.
    'TWO:XX:SNTL': [
      element('WTEQ', [{ date: '2026-01-15', value: 9 }]),
      element('SNWD', [{ date: '2026-01-15', value: null }]),
    ],
  };

  const fetchSnowpack = async () => {
    const fetchWithTimeout = jest.fn(async (url) => {
      if (url.includes('/stations?')) return response(stations);
      if (url.includes('/data?stationTriplets=')) {
        const triplets = new URL(url).searchParams.get('stationTriplets').split(',');
        return response(triplets.map((stationTriplet) => ({ stationTriplet, data: dataByTriplet[stationTriplet] })));
      }
      if (url.includes('/NOHRSC_Snow_Analysis/')) {
        return response({ results: [{ layerId: 3, attributes: { 'Service Pixel Value': null } }] });
      }
      return response({});
    });
    const service = createSnowpackService({
      fetchWithTimeout,
      formatIsoDateUtc: (date) => date.toISOString().slice(0, 10),
      shiftIsoDateUtc: (isoDate, days) => {
        const date = new Date(`${isoDate}T00:00:00Z`);
        date.setUTCDate(date.getUTCDate() + days);
        return date.toISOString().slice(0, 10);
      },
      haversineKm: (_lat, _lon, stationLat) => Math.abs(stationLat - 40) * 100,
    });
    return service.fetchSnowpackData(40, -111, '2026-01-15', {});
  };

  test('an unreported latest value falls back to the last real reading', async () => {
    const snowpack = await fetchSnowpack();
    expect(snowpack.snotel).toMatchObject({ snowDepthIn: 40, sweIn: 11, observedDate: '2026-01-14' });
  });

  test('an unreported SWE is not compared as 0% of the historical average', async () => {
    const { swe } = (await fetchSnowpack()).snotel.historical;
    expect(swe).toMatchObject({ currentIn: 11, averageIn: 10, status: 'at_average', percentOfAverage: 110 });
  });

  test('stations without a depth sensor or elevation stay out of the numbers', async () => {
    const snowpack = await fetchSnowpack();
    const two = snowpack.snotelStations.find((station) => station.stationTriplet === 'TWO:XX:SNTL');
    expect(two).toMatchObject({ snowDepthIn: null, sweIn: 9, elevationFt: null });
    expect(snowpack.snotelConsensus).toMatchObject({ minDepthIn: 40, maxDepthIn: 40, medianDepthIn: 40 });
  });

  test('a null NOHRSC pixel is no reading, not bare ground', async () => {
    expect((await fetchSnowpack()).nohrsc).toBeNull();
  });
});

describe('objective elevation', () => {
  test('a null USGS elevation falls back to Open-Meteo instead of reading as sea level', async () => {
    const fetchWithTimeout = jest.fn(async (url) => response(String(url).includes('epqs.nationalmap.gov')
      ? { value: null }
      : { elevation: [3000] }));
    const { fetchObjectiveElevationFt } = createElevationService({ fetchWithTimeout, requestTimeoutMs: 100 });
    await expect(fetchObjectiveElevationFt(40, -111, {})).resolves.toEqual({
      elevationFt: 9843,
      source: 'Open-Meteo elevation API',
    });
  });
});
