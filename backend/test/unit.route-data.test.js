'use strict';

const { createRouteDataService, nameScore, stitchLines } = require('../src/utils/route-data');
const { haversineKm } = require('../src/utils/geo');

const responseWith = (payload) => ({
  ok: true,
  json: jest.fn().mockResolvedValue(payload),
});

describe('mapped route data', () => {
  test('ignores generic route words when ranking names', () => {
    expect(nameScore('North Dome Trail', 'Mist Trail', 'Half Dome')).toBe(4);
    expect(nameScore('Mist Trail', 'Mist Trail', 'Half Dome')).toBe(100);
  });

  test('preserves sampled NPS geometry and places the objective last', async () => {
    const fetchWithTimeout = jest.fn().mockResolvedValue(responseWith({
      features: [{
        attributes: { TRLNAME: 'Mist Trail', TRLSTATUS: 'Open' },
        geometry: {
          paths: [[
            [-119.558, 37.726],
            [-119.548, 37.733],
            [-119.539, 37.741],
          ]],
        },
      }],
    }));
    const service = createRouteDataService({ fetchWithTimeout, haversineKm });

    const result = await service.fetchNpsRoute({
      route: 'Mist Trail',
      peak: 'Half Dome',
      lat: 37.7459,
      lon: -119.5332,
    });

    expect(result.source).toBe('nps');
    expect(result.waypoints.length).toBeGreaterThanOrEqual(3);
    expect(result.waypoints.at(-1)).toMatchObject({
      lat: 37.7459,
      lon: -119.5332,
      progress_percent: 100,
    });
  });

  test('rejects an NPS candidate that matches only the peak name', async () => {
    const fetchWithTimeout = jest.fn().mockResolvedValue(responseWith({
      features: [{
        attributes: { TRLNAME: 'North Dome Trail' },
        geometry: { paths: [[[-119.6, 37.7], [-119.5, 37.8]]] },
      }],
    }));
    const service = createRouteDataService({ fetchWithTimeout, haversineKm });

    await expect(service.fetchNpsRoute({
      route: 'Mist Trail',
      peak: 'Half Dome',
      lat: 37.7459,
      lon: -119.5332,
    })).resolves.toBeNull();
  });

  test('joins trail pieces end to end, reversing pieces drawn the other way', () => {
    const a = [{ lat: 40, lon: -105 }, { lat: 40.01, lon: -105 }];
    const b = [{ lat: 40.02, lon: -105 }, { lat: 40.01, lon: -105 }]; // reversed, touches a's end
    const c = [{ lat: 39.99, lon: -105 }, { lat: 40, lon: -105 }]; // touches a's start
    const far = [{ lat: 41, lon: -105 }, { lat: 41.01, lon: -105 }];
    expect(stitchLines(a, [a, b, c, far], haversineKm).map((point) => point.lat)).toEqual([39.99, 40, 40.01, 40.02]);
  });

  test('joins OpenStreetMap ways of the same trail and measures distance along it to the objective', async () => {
    // Two ways of "Lake Trail" meet end to end; the trail runs past the objective.
    const ways = [
      { tags: { name: 'Lake Trail' }, geometry: [{ lat: 40.0, lon: -105.0 }, { lat: 40.01, lon: -105.0 }, { lat: 40.02, lon: -105.0 }] },
      { tags: { name: 'Lake Trail' }, geometry: [{ lat: 40.04, lon: -105.0 }, { lat: 40.03, lon: -105.0 }, { lat: 40.02, lon: -105.0 }] },
      { tags: { name: 'Other Path' }, geometry: [{ lat: 40.5, lon: -105.0 }, { lat: 40.51, lon: -105.0 }] },
    ];
    const fetchWithTimeout = jest.fn().mockResolvedValue(responseWith({ elements: ways }));
    const service = createRouteDataService({ fetchWithTimeout, haversineKm });
    const result = await service.fetchOsmRoute({ route: 'Lake Trail', peak: 'Lake Peak', lat: 40.03, lon: -105.0 });

    expect(result.source).toBe('openstreetmap');
    expect(result.gapKm).toBeLessThan(0.01);
    // From the far end to the objective, not past it.
    expect(result.waypoints[0]).toMatchObject({ lat: 40.0, distance_miles: 0, progress_percent: 0 });
    expect(result.waypoints.at(-1)).toMatchObject({ lat: 40.03, lon: -105.0, progress_percent: 100 });
    // About 3.3 km of trail, measured along it.
    expect(result.waypoints.at(-1).distance_miles).toBeCloseTo(2.07, 1);
    expect(result.lengthMiles).toBeCloseTo(2.07, 1);
    const distances = result.waypoints.map((waypoint) => waypoint.distance_miles);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(result.geometry.length).toBeGreaterThanOrEqual(4);
  });

  test('a mapped trail that stops short of the objective adds the objective and reports the gap', async () => {
    const fetchWithTimeout = jest.fn().mockResolvedValue(responseWith({
      features: [{ attributes: { TRLNAME: 'Mist Trail' }, geometry: { paths: [[[-119.558, 37.726], [-119.548, 37.733]]] } }],
    }));
    const service = createRouteDataService({ fetchWithTimeout, haversineKm });
    const result = await service.fetchNpsRoute({ route: 'Mist Trail', peak: 'Half Dome', lat: 37.7459, lon: -119.5332 });
    expect(result.gapKm).toBeGreaterThan(1.5);
    expect(result.waypoints.at(-1)).toMatchObject({ lat: 37.7459, lon: -119.5332 });
  });
});

