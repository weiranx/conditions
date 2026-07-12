'use strict';

const { createRouteDataService, nameScore } = require('../src/utils/route-data');
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
});
