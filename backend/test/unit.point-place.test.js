const { describePoint } = require('../src/utils/point-place');

const peaks = [{ name: 'Mount Rainier, Washington', lat: 46.8523, lon: -121.7603, elevationFt: 14411 }];
const reverse = (place) => {
  const calls = [];
  const fetchWithTimeout = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => place };
  };
  return { calls, fetchWithTimeout };
};

describe('describePoint', () => {
  test('a pin on a catalog summit takes the summit name without searching for landmarks', async () => {
    const { calls, fetchWithTimeout } = reverse(null);
    const point = await describePoint({
      lat: 46.853, lon: -121.761, peaks, fetchWithTimeout,
      fetchElevationFt: async () => ({ elevationFt: 14380.4 }),
    });
    expect(point).toEqual({ name: 'Mount Rainier', elevationFt: 14380 });
    expect(calls.filter((url) => url.includes('nationalmap'))).toHaveLength(0);
  });

  test('elsewhere the named map feature on or near the point', async () => {
    const lake = { name: 'Snow Lake', category: 'natural', lat: '47.4480', lon: '-121.4520' };
    const on = await describePoint({ lat: 47.4481, lon: -121.4521, peaks, ...reverse(lake) });
    expect(on).toEqual({ name: 'Snow Lake', elevationFt: null });
    const near = await describePoint({ lat: 47.4500, lon: -121.4520, peaks, ...reverse(lake) });
    expect(near.name).toBe('Near Snow Lake');
  });

  test('roads, far features and failed lookups leave the point unnamed', async () => {
    const road = await describePoint({ lat: 47.1, lon: -121.1, peaks, ...reverse({ name: 'Forest Road 49', category: 'highway', lat: '47.1', lon: '-121.1' }) });
    expect(road.name).toBeNull();
    const far = await describePoint({ lat: 47.2, lon: -121.2, peaks, ...reverse({ name: 'Far Lake', category: 'natural', lat: '47.25', lon: '-121.2' }) });
    expect(far.name).toBeNull();
    const failed = await describePoint({
      lat: 47.3, lon: -121.3, peaks,
      fetchWithTimeout: async () => { throw new Error('offline'); },
      fetchElevationFt: async () => { throw new Error('offline'); },
    });
    expect(failed).toEqual({ name: null, elevationFt: null });
  });

  test('away from named features, the nearest landmark, then a nearby catalog summit, then the town or county', async () => {
    const county = { name: 'Pierce County', category: 'boundary', lat: '47.0', lon: '-122.2', address: { county: 'Pierce County', state: 'Washington' } };
    const answer = (gnis, place = county) => async (url) => ({
      ok: true,
      json: async () => (String(url).includes('nationalmap') ? gnis : place),
    });
    const landmark = await describePoint({ lat: 46.95, lon: -121.5, peaks,
      fetchWithTimeout: answer({ features: [
        { attributes: { gaz_name: 'Far Point' }, geometry: { points: [[-121.5, 46.96]] } },
        { attributes: { gaz_name: 'Sluiskin Mountain' }, geometry: { points: [[-121.49, 46.97], [-121.501, 46.951]] } },
        { attributes: { gaz_name: 'Mystic Lake' }, geometry: { x: -121.52, y: 46.94 } },
      ] }) });
    expect(landmark.name).toBe('Near Sluiskin Mountain');

    const summit = await describePoint({ lat: 46.88, lon: -121.73, peaks, fetchWithTimeout: answer({ features: [] }) });
    expect(summit.name).toBe('Near Mount Rainier');

    const town = await describePoint({ lat: 46.6, lon: -121.67, peaks,
      fetchWithTimeout: answer({ features: [] }, { ...county, address: { village: 'Packwood', county: 'Lewis County' } }) });
    expect(town.name).toBe('Near Packwood');
    const countyOnly = await describePoint({ lat: 46.9, lon: -121.4, peaks, fetchWithTimeout: answer({ features: [] }) });
    expect(countyOnly.name).toBe('Pierce County backcountry');
  });

  test('when the place-name service fails, the county still names the point', async () => {
    const county = { name: 'Chelan County', category: 'boundary', lat: '47.8', lon: '-120.6', address: { county: 'Chelan County' } };
    const urls = [];
    const fetchWithTimeout = async (url) => {
      urls.push(String(url));
      if (String(url).includes('nationalmap')) return { ok: false, status: 504 };
      return { ok: true, json: async () => county };
    };
    const point = await describePoint({ lat: 47.5, lon: -120.9, peaks, fetchWithTimeout });
    expect(point.name).toBe('Chelan County backcountry');
    expect(urls.filter((url) => url.includes('nationalmap'))).toHaveLength(2);
  });
});
