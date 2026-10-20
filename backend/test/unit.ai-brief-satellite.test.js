const express = require('express');
const request = require('supertest');

const { registerAiBriefRoute } = require('../src/routes/ai-brief');
const { assessSnowTravel } = require('../src/utils/snow-travel');
const { validateSatellite } = require('../src/utils/brief-validation');

const allowAccountAccess = async (req) => {
  req.accountUser = { id: '8c696be4-e175-4b6a-965b-82bdf3758e0c' };
  return true;
};
const HEADINGS = ['BIG PICTURE', 'WHY IT MATTERS', 'WATCH CLOSELY', 'DATA CONFIDENCE', 'COMFORT CHECK', 'BEST MOVE'];
const PNG = Buffer.from('fake-png-bytes');
const TILE = { buffer: PNG, metadata: { acquiredAt: '2026-10-08T18:40:12Z', cloudCover: 3.6, selection: 'recent_low_cloud_acquisition' } };

// Each test sends its own gust so the module-level brief cache never answers for another.
const snowReport = (gust, overrides = {}) => ({
  location: { lat: 46.8523, lon: -121.7603 },
  forecast: { selectedDate: '2026-10-14', activity: 'ski-touring' },
  weather: { description: 'Clear and cold', windGust: gust },
  terrainCondition: { code: 'snow_ice' },
  safety: { score: 70 },
  ...overrides,
});
const answer = (gust, satellite) => JSON.stringify({
  sections: HEADINGS.map((heading) => ({ heading, text: `Gusts reach ${gust} mph on the ridge.`, evidence: [{ path: 'weather.windGust', value: gust }] })),
  ...(satellite ? { satellite } : {}),
});
// The chapters answer, written alongside the briefing; with an image it also says what the image shows.
const chaptersAnswer = (gust, satellite) => JSON.stringify({
  chapters: { forecast: { text: `Gusts reach ${gust} mph on the ridge.`, evidence: [{ path: 'weather.windGust', value: gust }] } },
  ...(satellite ? { satellite } : {}),
});
// The read is two answers; the text-only model answers each from its own part.
const isChaptersCall = (options) => /^Return JSON only: \{"chapters"/m.test(options?.system || '');
const answerByPart = (gust) => async (_prompt, options) => (isChaptersCall(options) ? chaptersAnswer(gust) : answer(gust));
const satelliteAnswer = {
  text: 'The image from October 8, six days before the trip, shows continuous snow above treeline and bare slopes lower down. Expect to carry skis at first.',
  evidence: [{ path: 'satelliteImage.acquiredDate', value: '2026-10-08' }],
};

const setup = ({ tile = TILE, satelliteEnabled = true } = {}) => {
  const app = express();
  app.use(express.json());
  const askAI = jest.fn();
  const askAIVision = jest.fn();
  const tileCache = { getOrFetch: jest.fn(async () => { if (tile instanceof Error) throw tile; return tile; }) };
  registerAiBriefRoute({
    app,
    askAI,
    askAIVision,
    fetchWithTimeout: jest.fn(),
    tileCache,
    isSatelliteEnabled: () => satelliteEnabled,
    ensureAccountAccess: allowAccountAccess,
    ensureFeatureEnabled: () => {},
  });
  return { app, askAI, askAIVision, tileCache };
};

describe('snow travel', () => {
  test('snow matters for snow-travel activities, a snow or ice surface, or relevant avalanche terrain', () => {
    expect(assessSnowTravel({ forecast: { activity: 'ski-touring' } })).toEqual({ consequential: true, reasons: ['snow_travel_activity'] });
    expect(assessSnowTravel({ forecast: { activity: 'hiking' }, terrainCondition: { code: 'spring_snow' } }).reasons).toEqual(['snow_surface']);
    expect(assessSnowTravel({ forecast: { activity: 'hiking' }, avalanche: { relevant: true } }).reasons).toEqual(['avalanche_terrain']);
    expect(assessSnowTravel({ forecast: { activity: 'hiking' }, terrainCondition: { code: 'dry_firm' }, avalanche: { relevant: false } }))
      .toEqual({ consequential: false, reasons: [] });
    // The plan's activity wins over the one the report was generated for.
    expect(assessSnowTravel({ forecast: { activity: 'hiking' } }, 'mountaineering').consequential).toBe(true);
  });
});

describe('satellite text checks', () => {
  const report = { satelliteImage: { acquiredDate: '2026-10-08', daysBeforeTrip: 6 }, weather: { windGust: 30 } };
  test('it must cite the image and hold only numbers the report has', () => {
    expect(validateSatellite(satelliteAnswer, report, 'CAUTION')).toEqual({ text: satelliteAnswer.text, evidence: [{ path: 'satelliteImage.acquiredDate', value: '2026-10-08' }] });
    const problems = [];
    expect(validateSatellite({ text: 'Snow covers most slopes.', evidence: [{ path: 'weather.windGust', value: 30 }] }, report, 'CAUTION', undefined, problems)).toBeNull();
    expect(problems).toEqual(['SATELLITE: does not cite the satellite image (satelliteImage.acquiredDate)']);
    expect(validateSatellite({ text: 'About 70 percent of the slopes hold snow.', evidence: satelliteAnswer.evidence }, report, 'CAUTION')).toBeNull();
  });
  test('without an image there is nothing to check', () => {
    expect(validateSatellite(satelliteAnswer, { weather: {} }, 'CAUTION')).toBeNull();
  });
});

describe('AI read with satellite imagery', () => {
  test('a trip where snow matters is read with the satellite image, and the read returns it with its date', async () => {
    const { app, askAI, askAIVision, tileCache } = setup();
    askAI.mockResolvedValue(answer(31));
    askAIVision.mockResolvedValue(chaptersAnswer(31, satelliteAnswer));
    const response = await request(app).post('/api/ai-brief').send({ decisionLevel: 'CAUTION', report: snowReport(31) });

    expect(response.status).toBe(200);
    expect(tileCache.getOrFetch).toHaveBeenCalledWith(expect.stringMatching(/^13\/\d+\/\d+$/), expect.any(Function));
    // Only the chapters answer is shown the image; both read the report with its date.
    expect(askAIVision).toHaveBeenCalledTimes(1);
    const [image, prompt, options] = askAIVision.mock.calls[0];
    expect(image).toBe(PNG.toString('base64'));
    const imageFields = '"satelliteImage":{"source":"Copernicus Sentinel-2 true colour, about 5 by 5 km centred on the objective","acquiredDate":"2026-10-08","daysBeforeTrip":6,"cloudCoverPercent":4}';
    expect(prompt).toContain(imageFields);
    expect(isChaptersCall(options)).toBe(true);
    expect(options.system).toMatch(/A Sentinel-2 true-colour satellite image is attached/);
    expect(options.feature).toBe('report-brief');
    expect(askAI).toHaveBeenCalledTimes(1);
    const [briefingPrompt, briefingOptions] = askAI.mock.calls[0];
    expect(briefingPrompt).toBe(prompt);
    expect(isChaptersCall(briefingOptions)).toBe(false);
    expect(briefingOptions.system).not.toMatch(/satellite image is attached/);
    expect(briefingOptions.system).toMatch(/You have not seen it/);
    expect(response.body.validation).toBe('evidence_checked');
    expect(response.body.chapters.forecast.text).toBe('Gusts reach 31 mph on the ridge.');
    expect(response.body.satellite).toEqual({
      text: satelliteAnswer.text,
      evidence: [{ path: 'satelliteImage.acquiredDate', value: '2026-10-08' }],
      image: `data:image/png;base64,${PNG.toString('base64')}`,
      imagery: { acquiredAt: '2026-10-08T18:40:12Z', cloudCover: 3.6 },
    });
  });

  test('a trip where snow does not matter is read without imagery', async () => {
    const { app, askAI, askAIVision, tileCache } = setup();
    askAI.mockImplementation(answerByPart(32));
    const report = snowReport(32, { forecast: { selectedDate: '2026-10-14', activity: 'hiking' }, terrainCondition: { code: 'dry_firm' } });
    const response = await request(app).post('/api/ai-brief').send({ decisionLevel: 'GO', report });

    expect(response.status).toBe(200);
    expect(askAI).toHaveBeenCalledTimes(2);
    expect(askAIVision).not.toHaveBeenCalled();
    expect(tileCache.getOrFetch).not.toHaveBeenCalled();
    for (const [, options] of askAI.mock.calls) expect(options.system).not.toMatch(/satellite image/);
    expect(response.body.satellite).toBeUndefined();
  });

  test('without satellite imagery enabled, or with its domain off, the read is text only', async () => {
    const off = setup({ satelliteEnabled: false });
    off.askAI.mockResolvedValue(answer(33));
    await request(off.app).post('/api/ai-brief').send({ decisionLevel: 'CAUTION', report: snowReport(33) });
    expect(off.askAIVision).not.toHaveBeenCalled();

    const flagged = setup();
    flagged.askAI.mockResolvedValue(answer(34));
    await request(flagged.app).post('/api/ai-brief').send({ decisionLevel: 'CAUTION', report: snowReport(34, { featureFlags: { satelliteImagery: false } }) });
    expect(flagged.askAIVision).not.toHaveBeenCalled();
    expect(flagged.tileCache.getOrFetch).not.toHaveBeenCalled();
  });

  test('when the image cannot be had, the read is written without it', async () => {
    const { app, askAI, askAIVision } = setup({ tile: new Error('Sentinel Hub is not configured') });
    askAI.mockImplementation(answerByPart(35));
    const response = await request(app).post('/api/ai-brief').send({ decisionLevel: 'CAUTION', report: snowReport(35) });

    expect(response.status).toBe(200);
    expect(askAIVision).not.toHaveBeenCalled();
    expect(askAI).toHaveBeenCalledTimes(2);
    for (const [prompt] of askAI.mock.calls) expect(prompt).not.toContain('"satelliteImage":');
    expect(response.body.satellite).toBeUndefined();
  });

  test('satellite text that fails its checks is left out; the image and its date stay', async () => {
    const { app, askAI, askAIVision } = setup();
    askAI.mockResolvedValue(answer(36));
    askAIVision.mockResolvedValue(chaptersAnswer(36, { text: 'Snow covers about 80 percent of the area.', evidence: satelliteAnswer.evidence }));
    const response = await request(app).post('/api/ai-brief').send({ decisionLevel: 'CAUTION', report: snowReport(36) });

    expect(response.body.validation).toBe('evidence_checked');
    expect(response.body.satellite).toMatchObject({ text: null, evidence: [], imagery: { acquiredAt: '2026-10-08T18:40:12Z' } });
    expect(response.body.checks.problems).toEqual(expect.arrayContaining([expect.stringMatching(/^SATELLITE: states 80/)]));
    // Chapters that pass keep the part from being asked again for the image's text alone.
    expect(askAIVision).toHaveBeenCalledTimes(1);
  });
});
