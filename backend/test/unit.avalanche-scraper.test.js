const fs = require('node:fs');
const path = require('node:path');
const { tryScraperFallback } = require('../src/utils/avalanche-pipeline');

const readFixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

const okTextResponse = (text) => ({ ok: true, status: 200, text: async () => text });
const failedResponse = (status = 503) => ({ ok: false, status, text: async () => '' });

const noopLog = () => {};

describe('tryScraperFallback (avalanche-pipeline.js)', () => {
  test('extracts bottom line, problems, and elevations from a CAIC __NEXT_DATA__ payload', async () => {
    const html = readFixture('caic-next-data.html');
    const props = {
      center_id: 'CAIC',
      name: 'Front Range',
      link: 'https://avalanche.state.co.us/caic/forecast.php?zone_id=8',
      travel_advice: 'Generic travel advice placeholder.',
    };
    const avalancheData = {
      bottomLine: props.travel_advice,
      problems: [],
    };
    const fetchWithTimeout = jest.fn().mockResolvedValue(okTextResponse(html));

    const result = await tryScraperFallback({
      avalancheData,
      props,
      centerNoActiveForecast: false,
      fetchWithTimeout,
      avyLog: noopLog,
    });

    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(result.bottomLine).toMatch(/wind-loaded slopes/i);
    expect(result.bottomLine).not.toBe(props.travel_advice);
    expect(result.problems.map((p) => p.name)).toEqual(
      expect.arrayContaining(['Wind Slab', 'Persistent Slab']),
    );
    expect(result.elevations).toEqual({
      below: { level: 2, label: 'Moderate' },
      at: { level: 3, label: 'Considerable' },
      above: { level: 3, label: 'Considerable' },
    });
  });

  test('extracts a generic "bottom_line" JSON field via regex fallback for non-CAIC centers', async () => {
    const html = readFixture('generic-bottom-line.html');
    const props = {
      center_id: 'NWAC',
      name: 'Snoqualmie Pass',
      link: 'https://nwac.us/avalanche-forecast/#/snoqualmie-pass',
      travel_advice: 'Generic travel advice placeholder.',
    };
    const avalancheData = {
      bottomLine: props.travel_advice,
      problems: [],
    };
    const fetchWithTimeout = jest.fn().mockResolvedValue(okTextResponse(html));

    const result = await tryScraperFallback({
      avalancheData,
      props,
      centerNoActiveForecast: false,
      fetchWithTimeout,
      avyLog: noopLog,
    });

    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(result.bottomLine).toMatch(/cornices a wide margin/i);
    expect(result.problems.map((p) => p.name)).toEqual(['Wind Slab']);
    expect(result.elevations).toEqual({
      below: { level: 1, label: 'Low' },
      at: { level: 2, label: 'Moderate' },
      above: { level: 2, label: 'Moderate' },
    });
  });

  test('skips the network call entirely when the existing data is already detailed', async () => {
    const props = {
      center_id: 'NWAC',
      name: 'Snoqualmie Pass',
      link: 'https://nwac.us/avalanche-forecast/#/snoqualmie-pass',
      travel_advice: 'Generic travel advice placeholder.',
    };
    const avalancheData = {
      bottomLine: 'B'.repeat(150),
      problems: [{ id: 1, name: 'Wind Slab' }],
    };
    const fetchWithTimeout = jest.fn();

    const result = await tryScraperFallback({
      avalancheData,
      props,
      centerNoActiveForecast: false,
      fetchWithTimeout,
      avyLog: noopLog,
    });

    expect(fetchWithTimeout).not.toHaveBeenCalled();
    expect(result).toBe(avalancheData);
  });

  test('leaves avalancheData unchanged when the scrape request fails', async () => {
    const props = {
      center_id: 'NWAC',
      name: 'Snoqualmie Pass',
      link: 'https://nwac.us/avalanche-forecast/#/snoqualmie-pass',
      travel_advice: 'Generic travel advice placeholder.',
    };
    const avalancheData = {
      bottomLine: props.travel_advice,
      problems: [],
    };
    const fetchWithTimeout = jest.fn().mockResolvedValue(failedResponse(503));

    const result = await tryScraperFallback({
      avalancheData,
      props,
      centerNoActiveForecast: false,
      fetchWithTimeout,
      avyLog: noopLog,
    });

    expect(result.bottomLine).toBe(props.travel_advice);
    expect(result.problems).toEqual([]);
  });
});
