'use strict';

const {
  convertQuantity,
  parseArcGisRasterValue,
  parseProductTime,
  parseCsvRows,
  parseGlmKeyTime,
} = require('../src/utils/environmental-observations');
const { nameScore, sampleCoordinates, buildRouteTerrainProfile } = require('../src/utils/route-data');

describe('environmental observation normalization', () => {
  test('converts NWS quantities without treating missing values as zero', () => {
    expect(convertQuantity({ value: 0, unitCode: 'wmoUnit:degC' }, 'tempF')).toBe(32);
    expect(convertQuantity({ value: 10, unitCode: 'wmoUnit:m_s-1' }, 'speedMph')).toBe(22.4);
    expect(convertQuantity({ value: null, unitCode: 'wmoUnit:degC' }, 'tempF')).toBeNull();
  });

  test('parses ArcGIS raster values and product timestamps', () => {
    expect(parseArcGisRasterValue({ attributes: { 'Service Pixel Value': '0.42' } })).toBe(0.42);
    expect(parseArcGisRasterValue({ attributes: { 'Service Pixel Value': 'NoData' } })).toBeNull();
    expect(parseProductTime({ name: 'CONUS_L2_BREF_QCD_20260712_210613' })).toBe('2026-07-12T21:06:13Z');
  });

  test('parses FIRMS CSV with quoted fields', () => {
    const rows = parseCsvRows('latitude,longitude,confidence,satellite\n39.1,-105.2,"nominal, reviewed",N\n');
    expect(rows).toEqual([{ latitude: '39.1', longitude: '-105.2', confidence: 'nominal, reviewed', satellite: 'N' }]);
  });

  test('parses GOES GLM product start time from the public object key', () => {
    expect(parseGlmKeyTime('OR_GLM-L2-LCFA_G19_s20261932106130_e20261932106330_c.nc')).toBe('2026-07-12T21:06:13.000Z');
  });
});

describe('mapped route helpers', () => {
  test('prefers exact route names and samples long geometries evenly', () => {
    expect(nameScore('Keyhole Route', 'Keyhole Route', 'Longs Peak')).toBe(100);
    const coordinates = Array.from({ length: 100 }, (_, index) => [index, index + 1]);
    const sampled = sampleCoordinates(coordinates, 8);
    expect(sampled).toHaveLength(8);
    expect(sampled[0]).toEqual({ lon: 0, lat: 1 });
    expect(sampled[7]).toEqual({ lon: 99, lat: 100 });
  });

  test('builds terrain profile from resolved waypoint elevations', () => {
    const haversineKm = (_lat1, lon1, _lat2, lon2) => Math.abs(lon2 - lon1);
    const profile = buildRouteTerrainProfile([
      { lat: 40, lon: -106, elev_ft: 5000 },
      { lat: 40, lon: -105.9, elev_ft: 6000 },
      { lat: 40, lon: -105.8, elev_ft: 6500 },
    ], haversineKm);
    expect(profile.sampledPointCount).toBe(3);
    expect(profile.sampledElevationGainFt).toBe(1500);
    expect(profile.dominantTravelAspects).toContain('E');
  });
});
