const { SNOTEL_NETWORK_CODES, parseSnotelStationCatalog } = require('../src/utils/snotel-stations');
const seed = require('../src/data/snotel-stations.json');

test('the catalog keeps snow stations with a location and only the fields a report reads', () => {
  const raw = [
    { stationTriplet: 'A:WA:SNTL', stationId: 'A', stateCode: 'WA', networkCode: 'SNTL', name: 'Alpha', elevation: 5400, latitude: 47.5, longitude: -121.4, huc: '17110012', countyName: 'King', operator: 'NRCS' },
    { stationTriplet: 'B:UT:MSNT', stationId: 'B', stateCode: 'UT', networkCode: 'msnt', name: 'Bravo', elevation: '9100', latitude: '40.1', longitude: '-111.2' },
    { stationTriplet: 'C:CO:SNTLT', stationId: 'C', stateCode: 'CO', networkCode: 'SNTLT', name: 'Charlie', elevation: null, latitude: 39.2, longitude: -106.1 },
    { stationTriplet: 'D:AZ:SCAN', networkCode: 'SCAN', latitude: 33, longitude: -112 },
    { stationTriplet: 'E:WA:SNTL', networkCode: 'SNTL', latitude: null, longitude: -121 },
    { stationTriplet: 'F:WA:SNTL', networkCode: 'SNTL', latitude: 47, longitude: 'far' },
    null,
  ];
  expect(parseSnotelStationCatalog(raw)).toEqual([
    { stationTriplet: 'A:WA:SNTL', stationId: 'A', stateCode: 'WA', networkCode: 'SNTL', name: 'Alpha', elevation: 5400, latitude: 47.5, longitude: -121.4 },
    { stationTriplet: 'B:UT:MSNT', stationId: 'B', stateCode: 'UT', networkCode: 'msnt', name: 'Bravo', elevation: 9100, latitude: 40.1, longitude: -111.2 },
    { stationTriplet: 'C:CO:SNTLT', stationId: 'C', stateCode: 'CO', networkCode: 'SNTLT', name: 'Charlie', elevation: null, latitude: 39.2, longitude: -106.1 },
  ]);
  expect(parseSnotelStationCatalog({ error: 'busy' })).toEqual([]);
  expect(parseSnotelStationCatalog(undefined)).toEqual([]);
});

test('the bundled catalog is a complete, current-format snapshot', () => {
  expect(seed.length).toBeGreaterThan(800);
  // Already in the shape the live catalog is reduced to, so a refresh changes only stations.
  expect(parseSnotelStationCatalog(seed)).toEqual(seed);
  expect(new Set(seed.map((station) => station.stationTriplet)).size).toBe(seed.length);
  for (const station of seed) {
    expect(SNOTEL_NETWORK_CODES).toContain(station.networkCode);
    expect(station.stationTriplet).toMatch(/^[^:]+:[A-Z]{2}:(SNTL|SNTLT|MSNT)$/);
    expect(Math.abs(station.latitude)).toBeLessThanOrEqual(90);
    expect(Math.abs(station.longitude)).toBeLessThanOrEqual(180);
  }
  // Reports in the Cascades, Sierra, Wasatch and Rockies all find a station within the search radius.
  const near = (lat, lon) => seed.filter((station) => Math.hypot((station.latitude - lat) * 111, (station.longitude - lon) * 85) < 100).length;
  expect(near(46.85, -121.76)).toBeGreaterThan(0);
  expect(near(37.75, -119.55)).toBeGreaterThan(0);
  expect(near(40.6, -111.6)).toBeGreaterThan(0);
  expect(near(39.6, -105.9)).toBeGreaterThan(0);
});
