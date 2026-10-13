const {
  BULLETIN_SOURCE,
  attachBulletinText,
  createAvalancheAiExtraction,
  htmlToBulletinText,
  markBulletinGaps,
  mergeAvalancheExtraction,
  validateAvalancheExtraction,
} = require('../src/utils/avalanche-ai-extraction');
const { fetchAvalanchePipeline } = require('../src/utils/avalanche-pipeline');
const { createCache } = require('../src/utils/cache');

const BULLETIN_TEXT = [
  'Bottom Line: Dangerous avalanche conditions exist on wind-loaded slopes near and above treeline. Avoid steep leeward terrain today.',
  'Above Treeline: 3 - Considerable. Near Treeline: 3 - Considerable. Below Treeline: 2 - Moderate.',
  'Wind Slab: Strong west winds built fresh wind slabs on north and east facing slopes. Human-triggered avalanches are likely, size D1 to D2.',
  'Persistent Slab: A buried weak layer of facets remains reactive on shaded aspects near treeline.',
  'Danger scale: 1 Low, 2 Moderate, 3 Considerable, 4 High, 5 Extreme.',
  'Avalanche problem types: Dry Loose, Wet Loose, Storm Slab, Wind Slab, Persistent Slab, Deep Persistent Slab, Wet Slab, Cornice, Glide.',
].join('\n');

const GOOD_ANSWER = {
  bottomLine: { text: 'Dangerous avalanche conditions exist on wind-loaded slopes near and above treeline. Avoid steep leeward terrain today.' },
  dangerRatings: {
    above: { level: 3, quote: 'Above Treeline: 3 - Considerable.' },
    near: { level: 3, quote: 'Near Treeline: 3 - Considerable.' },
    below: { level: 2, quote: 'Below Treeline: 2 - Moderate.' },
  },
  problems: [
    {
      type: 'Wind Slab',
      aspects: ['N', 'E', 'up'],
      elevations: ['upper', 'middle', 'sky'],
      likelihood: 'likely',
      size: { min: 1, max: 2 },
      quote: 'Strong west winds built fresh wind slabs on north and east facing slopes.',
    },
    {
      type: 'Persistent Slab',
      aspects: [],
      elevations: ['near'],
      likelihood: 'certain',
      size: null,
      quote: 'Persistent Slab: A buried weak layer of facets remains reactive on shaded aspects near treeline.',
    },
  ],
};

// The feed gave only the zone's overall rating (3) and its one-line travel advice.
const feedOnlyAvalanche = (overrides = {}) => {
  const base = {
    center: 'Example Avalanche Center',
    center_id: 'EXAC',
    zone: 'Example Zone',
    risk: 'Considerable',
    dangerLevel: 3,
    dangerUnknown: false,
    coverageStatus: 'reported',
    link: 'https://example.org/forecast',
    bottomLine: 'Dangerous avalanche conditions.',
    problems: [],
    publishedTime: '2026-01-10T14:00:00Z',
    expiresTime: '2026-01-11T14:00:00Z',
    elevations: {
      below: { level: 3, label: 'Considerable' },
      at: { level: 3, label: 'Considerable' },
      above: { level: 3, label: 'Considerable' },
    },
    relevant: true,
    relevanceReason: null,
    ...overrides,
  };
  return markBulletinGaps(attachBulletinText(base, 'page', BULLETIN_TEXT), {
    missing: { problems: true, elevations: true, bottomLine: true },
    feedDangerLevel: base.dangerUnknown ? 0 : base.dangerLevel,
  });
};

const quietLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };

const newService = (askAI, overrides = {}) => createAvalancheAiExtraction({
  askAI,
  isFeatureAvailable: (feature) => feature === 'avalancheExtraction',
  log: quietLog,
  now: () => Date.parse('2026-01-10T15:00:00Z'),
  resultCache: createCache({ name: 'test-avy-ai', ttlMs: 60000 }),
  failureCache: createCache({ name: 'test-avy-ai-failures', ttlMs: 60000 }),
  ...overrides,
});

describe('htmlToBulletinText', () => {
  test('drops markup, styles and scripts but keeps embedded JSON data', () => {
    const html = `<html><head><style>.x{color:red}</style><script>var tracking = "Wind Slab";</script>
      <script id="__NEXT_DATA__" type="application/json">{"bottom_line":"Watch for \\"fresh\\" slabs\\nnear ridges."}</script></head>
      <body><h1>Forecast</h1><p>Above Treeline &amp; Near Treeline: <b>Considerable</b></p></body></html>`;
    const text = htmlToBulletinText(html);
    expect(text).toContain('Above Treeline & Near Treeline: Considerable');
    expect(text).toContain('Watch for "fresh" slabs near ridges.');
    expect(text).not.toContain('tracking');
    expect(text).not.toContain('color:red');
  });
});

describe('validateAvalancheExtraction', () => {
  test('keeps quoted ratings, known problem types and enum values', () => {
    const result = validateAvalancheExtraction(GOOD_ANSWER, { text: BULLETIN_TEXT });
    expect(result.elevations).toEqual({
      below: { level: 2, label: 'Moderate' },
      at: { level: 3, label: 'Considerable' },
      above: { level: 3, label: 'Considerable' },
    });
    expect(result.bottomLine).toMatch(/^Dangerous avalanche conditions exist/);
    expect(result.problems).toHaveLength(2);
    expect(result.problems[0]).toMatchObject({
      name: 'Wind Slab',
      likelihood: 'likely',
      size: ['1', '2'],
      location: ['north upper', 'east upper', 'north middle', 'east middle'],
    });
    // "certain" is not on the likelihood scale; an unstated aspect stays unstated.
    expect(result.problems[1].likelihood).toBeUndefined();
    expect(result.problems[1].location).toEqual(['middle']);
  });

  test('drops ratings outside 1-5, non-integers and ratings whose quote is not in the text', () => {
    const outOfScale = validateAvalancheExtraction({
      dangerRatings: { ...GOOD_ANSWER.dangerRatings, above: { level: 6, quote: 'Above Treeline: 3 - Considerable.' } },
    }, { text: BULLETIN_TEXT });
    expect(outOfScale.elevations).toBeNull();

    const fractional = validateAvalancheExtraction({
      dangerRatings: { ...GOOD_ANSWER.dangerRatings, below: { level: 2.5, quote: 'Below Treeline: 2 - Moderate.' } },
    }, { text: BULLETIN_TEXT });
    expect(fractional.elevations).toBeNull();

    const invented = validateAvalancheExtraction({
      dangerRatings: { ...GOOD_ANSWER.dangerRatings, above: { level: 4, quote: 'Above Treeline: 4 - High.' } },
    }, { text: BULLETIN_TEXT });
    expect(invented.elevations).toBeNull();
  });

  test('rejects a rating quoted from the danger scale legend or from another band', () => {
    const legend = validateAvalancheExtraction({
      dangerRatings: { ...GOOD_ANSWER.dangerRatings, above: { level: 4, quote: '3 Considerable, 4 High, 5 Extreme.' } },
    }, { text: BULLETIN_TEXT });
    expect(legend.elevations).toBeNull();

    const wrongBand = validateAvalancheExtraction({
      dangerRatings: { ...GOOD_ANSWER.dangerRatings, below: { level: 3, quote: 'Near Treeline: 3 - Considerable.' } },
    }, { text: BULLETIN_TEXT });
    expect(wrongBand.elevations).toBeNull();
  });

  test('drops unknown problem types, unquoted problems and the problem-type legend', () => {
    const result = validateAvalancheExtraction({
      problems: [
        { type: 'Slush Flow', quote: 'Strong west winds built fresh wind slabs on north and east facing slopes.' },
        { type: 'Storm Slab', quote: 'Heavy snowfall built storm slabs overnight.' },
        { type: 'Cornice', quote: 'Dry Loose, Wet Loose, Storm Slab, Wind Slab, Persistent Slab, Deep Persistent Slab, Wet Slab, Cornice, Glide.' },
        { type: 'Wet Slab', quote: 'Strong west winds built fresh wind slabs on north and east facing slopes.' },
      ],
    }, { text: BULLETIN_TEXT });
    expect(result.problems).toEqual([]);
  });

  test('drops a bottom line that is not copied from the text', () => {
    const result = validateAvalancheExtraction({
      bottomLine: { text: 'Avalanche danger is low today and most terrain is safe to ride with normal caution.' },
    }, { text: BULLETIN_TEXT });
    expect(result.bottomLine).toBeNull();
  });
});

describe('mergeAvalancheExtraction', () => {
  const extraction = validateAvalancheExtraction(GOOD_ANSWER, { text: BULLETIN_TEXT });
  const base = () => {
    const { [BULLETIN_SOURCE]: _source, ...rest } = feedOnlyAvalanche();
    return rest;
  };

  test('keeps the feed overall rating when extracted bands disagree with it', () => {
    const merged = mergeAvalancheExtraction(base(), extraction, {
      missing: { problems: false, elevations: true, bottomLine: false },
      feedDangerLevel: 4,
    });
    expect(merged).toEqual(base());
    expect(merged.extraction).toBeUndefined();
  });

  test('never adds bands when the feed rating is unknown', () => {
    const merged = mergeAvalancheExtraction({ ...base(), dangerUnknown: true }, extraction, {
      missing: { problems: false, elevations: true, bottomLine: false },
      feedDangerLevel: 0,
    });
    expect(merged.extraction).toBeUndefined();
  });

  test('fills only missing fields and labels the result', () => {
    const merged = mergeAvalancheExtraction({ ...base(), bottomLine: 'Center written bottom line that is long enough to keep.' }, extraction, {
      missing: { problems: true, elevations: true, bottomLine: false },
      feedDangerLevel: 3,
      origins: ['page'],
      now: () => Date.parse('2026-01-10T15:00:00Z'),
    });
    expect(merged.bottomLine).toBe('Center written bottom line that is long enough to keep.');
    expect(merged.problems.map((p) => p.name)).toEqual(['Wind Slab', 'Persistent Slab']);
    expect(merged.elevations.below.level).toBe(2);
    expect(merged.dangerLevel).toBe(3);
    expect(merged.dangerUnknown).toBe(false);
    expect(merged.extraction).toEqual({
      method: 'ai',
      fields: ['problems', 'elevations'],
      source: 'center-page',
      extractedAt: '2026-01-10T15:00:00.000Z',
      note: 'Read from the Example Avalanche Center bulletin automatically. Verify with the center before relying on it.',
    });
  });
});

describe('createAvalancheAiExtraction', () => {
  test('feature off: no model call, data unchanged apart from the hidden source', async () => {
    const askAI = jest.fn();
    const service = newService(askAI, { isFeatureAvailable: () => false });
    const input = feedOnlyAvalanche();
    const result = await service.apply(input);
    expect(askAI).not.toHaveBeenCalled();
    expect(result[BULLETIN_SOURCE]).toBeUndefined();
    const { [BULLETIN_SOURCE]: _source, ...expected } = input;
    expect(result).toEqual(expected);
    expect(JSON.parse(JSON.stringify(result))).toEqual(JSON.parse(JSON.stringify(input)));
  });

  test('fills gaps from the model answer once per bulletin', async () => {
    const askAI = jest.fn().mockResolvedValue(`\`\`\`json\n${JSON.stringify(GOOD_ANSWER)}\n\`\`\``);
    const service = newService(askAI);
    const first = await service.apply(feedOnlyAvalanche());
    const second = await service.apply(feedOnlyAvalanche());

    expect(askAI).toHaveBeenCalledTimes(1);
    const [prompt, options] = askAI.mock.calls[0];
    expect(options).toMatchObject({ tier: 'primary', feature: 'avalanche-extraction' });
    expect(prompt).toContain('Example Zone');
    expect(prompt).toContain('2026-01-11T14:00:00Z');
    expect(first.problems.map((p) => p.name)).toEqual(['Wind Slab', 'Persistent Slab']);
    expect(first.bottomLine).toMatch(/^Dangerous avalanche conditions exist/);
    expect(first.elevations.below).toEqual({ level: 2, label: 'Moderate' });
    expect(first.extraction).toMatchObject({ method: 'ai', fields: ['problems', 'elevations', 'bottomLine'] });
    expect(first.dangerLevel).toBe(3);
    expect(first.publishedTime).toBe('2026-01-10T14:00:00Z');
    expect(second).toEqual(first);
  });

  test('a failed call leaves the data as today and is not retried right away', async () => {
    const askAI = jest.fn().mockRejectedValue(new Error('provider down'));
    const service = newService(askAI);
    const input = feedOnlyAvalanche();
    const { [BULLETIN_SOURCE]: _source, ...expected } = input;
    expect(await service.apply(input)).toEqual(expected);
    expect(await service.apply(feedOnlyAvalanche())).toEqual(expected);
    expect(askAI).toHaveBeenCalledTimes(1);
  });

  test('unparseable answers change nothing', async () => {
    const service = newService(jest.fn().mockResolvedValue('I could not read this bulletin.'));
    const result = await service.apply(feedOnlyAvalanche());
    expect(result.extraction).toBeUndefined();
    expect(result.problems).toEqual([]);
  });

  test('a slow model does not hold the report past the budget; the next report gets the answer', async () => {
    let release;
    const askAI = jest.fn(() => new Promise((resolve) => { release = () => resolve(JSON.stringify(GOOD_ANSWER)); }));
    const service = newService(askAI, { budgetMs: 20 });
    const started = Date.now();
    const first = await service.apply(feedOnlyAvalanche());
    expect(Date.now() - started).toBeLessThan(1000);
    expect(first.extraction).toBeUndefined();
    release();
    await new Promise((resolve) => setImmediate(resolve));
    const second = await service.apply(feedOnlyAvalanche());
    expect(second.extraction).toMatchObject({ method: 'ai' });
    expect(askAI).toHaveBeenCalledTimes(1);
  });

  test('a new issue of the bulletin is read again', async () => {
    const askAI = jest.fn().mockResolvedValue(JSON.stringify(GOOD_ANSWER));
    const service = newService(askAI);
    await service.apply(feedOnlyAvalanche());
    await service.apply(feedOnlyAvalanche({ publishedTime: '2026-01-11T14:00:00Z' }));
    expect(askAI).toHaveBeenCalledTimes(2);
  });

  test('skips bulletins with nothing missing, no text, or no current coverage', async () => {
    const askAI = jest.fn().mockResolvedValue(JSON.stringify(GOOD_ANSWER));
    const service = newService(askAI);
    const complete = markBulletinGaps(attachBulletinText({ ...feedOnlyAvalanche() }, 'page', BULLETIN_TEXT), {
      missing: { problems: false, elevations: false, bottomLine: false },
      feedDangerLevel: 3,
    });
    await service.apply(complete);
    await service.apply(markBulletinGaps(attachBulletinText({ coverageStatus: 'reported' }, 'page', 'too short'), {
      missing: { problems: true }, feedDangerLevel: 3,
    }));
    await service.apply(feedOnlyAvalanche({ coverageStatus: 'no_active_forecast' }));
    await service.apply({ coverageStatus: 'reported', problems: [] });
    expect(askAI).not.toHaveBeenCalled();
  });
});

describe('fetchAvalanchePipeline bulletin text capture', () => {
  const lat = 40.5;
  const lon = -111.5;
  const feature = {
    id: 999,
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[lon - 0.5, lat - 0.5], [lon + 0.5, lat - 0.5], [lon + 0.5, lat + 0.5], [lon - 0.5, lat + 0.5], [lon - 0.5, lat - 0.5]]],
    },
    properties: {
      name: 'Example Zone',
      center: 'Example Avalanche Center',
      center_id: 'EXAC',
      danger: 'considerable',
      danger_level: 3,
      travel_advice: 'Dangerous avalanche conditions.',
      link: 'https://example.org/forecast/example-zone',
      start_date: new Date(Date.now() - 3600000).toISOString(),
      end_date: new Date(Date.now() + 86400000).toISOString(),
      off_season: false,
    },
  };
  const page = `<html><body><div class="forecast">${BULLETIN_TEXT.split('\n').map((line) => `<p>${line}</p>`).join('')}</div></body></html>`;

  test('a scraped page with prose only is handed to the AI reader, which fills the gaps', async () => {
    const fetchWithTimeout = jest.fn(async (url) => {
      if (url.startsWith('https://api.avalanche.org')) return { ok: false, status: 404, text: async () => '' };
      return { ok: true, status: 200, text: async () => page };
    });
    const data = await fetchAvalanchePipeline({
      avyMapLayerPromise: Promise.resolve({ features: [feature] }),
      parsedLat: lat,
      parsedLon: lon,
      fetchOptions: {},
      fetchWithTimeout,
      avyLog: () => {},
    });

    expect(data.problems).toEqual([]);
    expect(data[BULLETIN_SOURCE].missing).toEqual({ problems: true, elevations: true, bottomLine: true });
    expect(data[BULLETIN_SOURCE].feedDangerLevel).toBe(3);
    expect(data[BULLETIN_SOURCE].texts.page).toContain('Above Treeline: 3 - Considerable.');

    const service = newService(jest.fn().mockResolvedValue(JSON.stringify(GOOD_ANSWER)));
    const filled = await service.apply(data);
    expect(filled.problems.map((p) => p.name)).toEqual(['Wind Slab', 'Persistent Slab']);
    expect(filled.elevations.below.level).toBe(2);
    expect(filled.extraction).toMatchObject({ method: 'ai', source: 'center-page' });
  });

  test('a complete product leaves nothing for the AI reader', async () => {
    const product = {
      id: 1,
      center_id: 'EXAC',
      zone_id: '999',
      published_time: new Date().toISOString(),
      bottom_line: 'A long center-written bottom line that explains wind slabs near ridgelines and how to avoid them today, with plenty of detail for travel.',
      hazard_discussion: 'Discussion text.',
      forecast_avalanche_problems: [{ name: 'Wind Slab', likelihood: 'likely', location: ['north upper'] }],
      danger: [{ valid_day: 'current', lower: 2, middle: 3, upper: 3 }],
    };
    const fetchWithTimeout = jest.fn(async (url) => {
      if (url.startsWith('https://api.avalanche.org')) return { ok: true, status: 200, text: async () => JSON.stringify(product) };
      return { ok: true, status: 200, text: async () => page };
    });
    const data = await fetchAvalanchePipeline({
      avyMapLayerPromise: Promise.resolve({ features: [feature] }),
      parsedLat: lat,
      parsedLon: lon,
      fetchOptions: {},
      fetchWithTimeout,
      avyLog: () => {},
    });
    expect(data[BULLETIN_SOURCE].missing).toEqual({ problems: false, elevations: false, bottomLine: false });
    const askAI = jest.fn();
    const result = await newService(askAI).apply(data);
    expect(askAI).not.toHaveBeenCalled();
    expect(result.extraction).toBeUndefined();
  });
});
