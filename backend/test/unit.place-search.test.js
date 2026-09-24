const {
  compactPlaceName,
  matchCatalogPeaks,
  nameMatchesQuery,
  parseElevationFt,
  parseSearchBias,
  rankPlaceResults,
} = require('../src/utils/place-search');

// Trimmed Nominatim `format=json&addressdetails=1&extratags=1` results.
const rainierTown = {
  class: 'boundary', type: 'administrative', addresstype: 'town', importance: 0.41, name: 'Rainier',
  display_name: 'Rainier, Columbia County, Oregon, United States', lat: '46.089', lon: '-122.935',
  address: { town: 'Rainier', county: 'Columbia County', state: 'Oregon', country: 'United States' }, extratags: { ele: '15' },
};
const mountRainier = {
  class: 'natural', type: 'volcano', importance: 0.52, name: 'Mount Rainier',
  display_name: 'Mount Rainier, Pierce County, Washington, United States', lat: '46.853', lon: '-121.760',
  address: { volcano: 'Mount Rainier', county: 'Pierce County', state: 'Washington' }, extratags: { ele: '4392' },
};
const giftShop = {
  class: 'shop', type: 'gift', importance: 0.0001, name: 'Enchantments',
  display_name: 'Enchantments, North Main Street, Pocatello, Bannock County, Idaho, 83204, United States', lat: '42.86', lon: '-112.44',
  address: { shop: 'Enchantments', city: 'Pocatello', county: 'Bannock County', state: 'Idaho', postcode: '83204' },
};
const permitArea = {
  class: 'leisure', type: 'nature_reserve', importance: 0.08, name: 'Core Enchantments Permit Area',
  display_name: 'Core Enchantments Permit Area, Chelan County, Washington, United States', lat: '47.48', lon: '-120.82',
  address: { county: 'Chelan County', state: 'Washington' },
};

const place = (osmClass, type, name, county, state, extra = {}) => ({
  class: osmClass, type, name, importance: 0.1, lat: '47.0', lon: '-121.0',
  display_name: `${name}, ${county}, ${state}, United States`, address: { county, state }, ...extra,
});

describe('place search', () => {
  test('trailheads, passes, lakes, meadows and destinations are labeled and ranked as outdoor places', () => {
    const results = rankPlaceResults([
      place('place', 'hamlet', 'Snow Lake', 'Desha County', 'Arkansas', { importance: 0.4 }),
      place('water', 'lake', 'Snow Lake', 'King County', 'Washington'),
      place('highway', 'trailhead', 'Snow Lake Trailhead', 'King County', 'Washington'),
      place('mountain_pass', 'yes', 'Cascade Pass', 'Skagit County', 'Washington', { extratags: { ele: '1643' } }),
      place('natural', 'wetland', 'Tuolumne Meadows', 'Tuolumne County', 'California'),
      place('waterway', 'waterfall', 'Havasu Falls', 'Coconino County', 'Arizona'),
      place('tourism', 'camp_site', 'Sahale Glacier Camp', 'Chelan County', 'Washington'),
      place('tourism', 'attraction', 'Snow Lake Overlook', 'King County', 'Washington'),
    ]);
    expect(results.map((result) => [result.kind, result.name.split(',')[0]])).toEqual([
      ['Lake', 'Snow Lake'],
      ['Trailhead', 'Snow Lake Trailhead'],
      ['Pass', 'Cascade Pass'],
      ['Meadow', 'Tuolumne Meadows'],
      ['Waterfall', 'Havasu Falls'],
      ['Campground', 'Sahale Glacier Camp'],
      ['Town', 'Snow Lake'],
      ['Attraction', 'Snow Lake Overlook'],
    ]);
    expect(results[2].elevationFt).toBe(5390);
  });

  test('streets and subdivisions named after a pass are left out', () => {
    const results = rankPlaceResults([
      place('highway', 'residential', 'Cascade Pass', 'Olmsted County', 'Minnesota'),
      place('landuse', 'residential', 'Cascade Pass', 'Dallas County', 'Texas'),
      place('mountain_pass', 'yes', 'Cascade Pass', 'Skagit County', 'Washington'),
    ]);
    expect(results.map((result) => result.name)).toEqual(['Cascade Pass, Skagit County, Washington']);
  });

  test('a biased search keeps the order Nominatim gave, which puts the area first', () => {
    const far = place('water', 'lake', 'Snow Lake', 'Kent County', 'Michigan', { importance: 0.13 });
    const near = place('water', 'lake', 'Snow Lake', 'King County', 'Washington', { importance: 0.11 });
    expect(rankPlaceResults([near, far], { biased: true })[0].name).toBe('Snow Lake, King County, Washington');
    expect(rankPlaceResults([near, far])[0].name).toBe('Snow Lake, Kent County, Michigan');
  });

  test('the search bias is a box around the nearest whole degree', () => {
    expect(parseSearchBias('47.49,-121.73')).toEqual({ key: '47,-122', viewbox: '-124,48.5,-120,45.5' });
    expect(parseSearchBias(' 37 , -119 ')?.key).toBe('37,-119');
    expect(parseSearchBias('near seattle')).toBeNull();
    expect(parseSearchBias('95,10')).toBeNull();
    expect(parseSearchBias(undefined)).toBeNull();
  });

  test('outdoor features come before towns, whatever order OpenStreetMap sent', () => {
    const results = rankPlaceResults([rainierTown, mountRainier]);
    expect(results.map((result) => result.name)).toEqual([
      'Mount Rainier, Pierce County, Washington',
      'Rainier, Columbia County, Oregon',
    ]);
    expect(results[0]).toMatchObject({ kind: 'Volcano', elevationFt: 14409, lat: 46.853, lon: -121.76 });
    expect(results[1].kind).toBe('Town');
  });

  test('businesses are left out', () => {
    expect(rankPlaceResults([giftShop, permitArea]).map((result) => result.name)).toEqual([
      'Core Enchantments Permit Area, Chelan County, Washington',
    ]);
  });

  test('names drop postcodes, streets and country', () => {
    expect(compactPlaceName(giftShop)).toBe('Enchantments, Bannock County, Idaho');
    expect(compactPlaceName({ display_name: 'Somewhere, United States', address: {} })).toBe('Somewhere, United States');
  });

  test('elevation tags are metres unless marked in feet', () => {
    expect(parseElevationFt('4392')).toBe(14409);
    expect(parseElevationFt('3373.5')).toBe(11068);
    expect(parseElevationFt('14,411 ft')).toBe(14411);
    expect(parseElevationFt("6288'")).toBe(6288);
    expect(parseElevationFt('about 4000')).toBeNull();
    expect(parseElevationFt('99999')).toBeNull();
    expect(parseElevationFt('0')).toBeNull();
    expect(parseElevationFt(undefined)).toBeNull();
  });

  test('catalog peaks match on word starts in any order and on Mt', () => {
    expect(nameMatchesQuery('Grand Teton, Wyoming', 'teton grand')).toBe(true);
    expect(nameMatchesQuery('Mount San Antonio (Mt Baldy), California', 'mt baldy')).toBe(true);
    expect(nameMatchesQuery('Mount Rainier, Washington', 'rainer')).toBe(false);
    const peaks = [{ name: 'Mount Rainier, Washington', lat: 46.85, lon: -121.76, elevationFt: 14411 }];
    expect(matchCatalogPeaks(peaks, 'mt. rain')).toEqual([{ ...peaks[0], type: 'peak', class: 'natural', kind: 'Peak' }]);
  });
});

describe('search route cache', () => {
  test('a query that spells out a bias does not share results with the biased search', async () => {
    const { registerSearchRoutes } = require('../src/routes/search');
    let handler;
    const app = { get: (_path, fn) => { handler = fn; } };
    const urls = [];
    const fetchWithTimeout = async (url) => {
      urls.push(url);
      const county = url.includes('viewbox') ? 'King County' : 'Kent County';
      return { ok: true, json: async () => [place('water', 'lake', 'Snow Lake', county, 'Washington')] };
    };
    registerSearchRoutes({ app, fetchWithTimeout, defaultFetchHeaders: {}, peaks: [] });
    const search = (query) => new Promise((resolve) => handler({ query }, { json: resolve }));

    const unbiased = await search({ q: 'cachekeyprobe@47,-122' });
    const biased = await search({ q: 'cachekeyprobe', near: '47,-122' });
    expect(urls).toHaveLength(2);
    expect(unbiased[0].name).toContain('Kent County');
    expect(biased[0].name).toContain('King County');
  });
});
