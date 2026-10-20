const express = require('express');
const request = require('supertest');

const {
  AI_BRIEF_MAX_TOKENS,
  SYSTEM_PROMPT: AI_BRIEF_SYSTEM_PROMPT,
  registerAiBriefRoute: registerAiBriefRouteWithoutAccount,
} = require('../src/routes/ai-brief');
const {
  SNOW_VISION_MAX_TOKENS,
  SYSTEM_PROMPT: SNOW_VISION_SYSTEM_PROMPT,
  registerSnowVisionRoute: registerSnowVisionRouteWithoutAccount,
} = require('../src/routes/snow-vision');
const { getScoreFeatureSnapshot } = require('../src/utils/report-feature-filter');

const allowAccountAccess = async (req) => {
  req.accountUser = { id: '8c696be4-e175-4b6a-965b-82bdf3758e0c' };
  return true;
};
const registerAiBriefRoute = (options) => registerAiBriefRouteWithoutAccount({
  ...options,
  ensureAccountAccess: options.ensureAccountAccess || allowAccountAccess,
});
const registerSnowVisionRoute = (options) => registerSnowVisionRouteWithoutAccount({
  ...options,
  ensureAccountAccess: options.ensureAccountAccess || allowAccountAccess,
});

// The read is two answers written at once, the briefing and the chapters; these
// tell them apart by what each is asked for, and answer each from its own list
// (the last answer repeats; an Error is thrown).
const isChaptersCall = (options) => /^Return JSON only: \{"chapters"/m.test(options?.system || '');
const callsFor = (mock, part) => mock.mock.calls.filter(([, options]) => isChaptersCall(options) === (part === 'chapters'));
const answerParts = ({ briefing = [], chapters = [] }) => {
  const queues = { briefing: [...briefing], chapters: [...chapters] };
  return jest.fn(async (_prompt, options) => {
    const queue = queues[isChaptersCall(options) ? 'chapters' : 'briefing'];
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    return next;
  });
};
const chaptersAnswer = (gust) => JSON.stringify({ chapters: { forecast: { text: `Gusts reach ${gust} mph through the window.`, evidence: [{ path: 'weather.windGust', value: gust }] } } });

const rejectDisabledFeature = () => {
  const error = new Error('AI features are unavailable');
  error.code = 'AI_FEATURE_DISABLED';
  throw error;
};

test('AI brief requests a detailed decision-ready analysis', () => {
  expect(AI_BRIEF_MAX_TOKENS).toBeGreaterThanOrEqual(8192);
  expect(AI_BRIEF_SYSTEM_PROMPT).toMatch(/WHY IT MATTERS:/);
  expect(AI_BRIEF_SYSTEM_PROMPT).toMatch(/DATA CONFIDENCE:/);
  expect(AI_BRIEF_SYSTEM_PROMPT).toMatch(/actual values, times, elevations, aspects/i);
  expect(AI_BRIEF_SYSTEM_PROMPT).toMatch(/10-15 substantive sentences/i);
});

test('snow vision requests evidence, uncertainty, and practical route implications', () => {
  expect(SNOW_VISION_MAX_TOKENS).toBeGreaterThanOrEqual(8192);
  expect(SNOW_VISION_SYSTEM_PROMPT).toMatch(/TERRAIN PATTERN:/);
  expect(SNOW_VISION_SYSTEM_PROMPT).toMatch(/UNCERTAINTY:/);
  expect(SNOW_VISION_SYSTEM_PROMPT).toMatch(/specific planning implications/i);
  expect(SNOW_VISION_SYSTEM_PROMPT).toMatch(/9-13 substantive sentences/i);
});

test('disabled AI brief is rejected before reading or generating cached output', async () => {
  const app = express();
  app.use(express.json());
  const askAI = jest.fn();
  registerAiBriefRoute({ app, askAI, ensureFeatureEnabled: rejectDisabledFeature });

  const response = await request(app)
    .post('/api/ai-brief')
    .send({ report: { safety: { score: 80 } }, decisionLevel: 'GO' });

  expect(response.status).toBe(503);
  expect(response.body.error).toBe('AI features are unavailable');
  expect(askAI).not.toHaveBeenCalled();
});

test('disabled snow vision is rejected before fetching imagery', async () => {
  const app = express();
  app.use(express.json());
  const fetchWithTimeout = jest.fn();
  const askAIVision = jest.fn();
  registerSnowVisionRoute({
    app,
    fetchWithTimeout,
    askAIVision,
    ensureFeatureEnabled: rejectDisabledFeature,
  });

  const response = await request(app)
    .post('/api/snow-vision')
    .send({ lat: 46.85, lon: -121.76 });

  expect(response.status).toBe(503);
  expect(response.body.error).toBe('AI features are unavailable');
  expect(fetchWithTimeout).not.toHaveBeenCalled();
  expect(askAIVision).not.toHaveBeenCalled();
});

test('AI brief excludes a disabled avalanche domain from the model prompt', async () => {
  const app = express();
  app.use(express.json());
  const flags = { avalancheDetails: false };
  const askAI = jest.fn().mockResolvedValue('BIG PICTURE: Avalanche danger is Considerable. Weather is the enabled concern.');
  registerAiBriefRoute({ app, askAI });

  const response = await request(app)
    .post('/api/ai-brief')
    .send({
      decisionLevel: 'CAUTION',
      report: {
        featureFlags: getScoreFeatureSnapshot(flags),
        weather: { description: 'Cloudy and windy', windGust: 42 },
        avalanche: { risk: 'Considerable', problems: [{ name: 'Deep Persistent Slab' }] },
        gear: [{ id: 'avalanche-kit', title: 'Avalanche rescue kit' }],
        safety: {
          factors: [
            { group: 'avalanche', hazard: 'Avalanche', impact: -25 },
            { group: 'weather', hazard: 'Wind', impact: -5 },
          ],
          explanations: ['Avalanche danger is Considerable.', 'Strong wind is expected.'],
        },
      },
    });

  expect(response.status).toBe(200);
  expect(response.body.validation).toBe('deterministic_fallback');
  expect(response.body.narrative).toContain('Strong wind is expected.');
  expect(response.body.narrative).not.toMatch(/avalanche/i);
  // Each unusable answer, the briefing and the chapters, is retried once, with what failed, before falling back.
  expect(askAI).toHaveBeenCalledTimes(4);
  const briefingCalls = callsFor(askAI, 'briefing');
  expect(briefingCalls).toHaveLength(2);
  expect(briefingCalls[1][0]).toMatch(/failed these fact checks[\s\S]*not valid JSON/);
  expect(callsFor(askAI, 'chapters')[1][0]).toMatch(/failed these fact checks[\s\S]*the chapters answer was not valid JSON[\s\S]*Keep every chapter\.$/);
  expect(response.body.checks.problems[0]).toMatch(/^first answer: the answer was not valid JSON \(\d+ characters, ending "/);
  expect(response.body.checks.problems).toEqual(expect.arrayContaining([expect.stringMatching(/^retry: the answer was not valid JSON/)]));
  expect(response.body.checks.seconds).toHaveLength(4);
  const prompt = briefingCalls[0][0];
  // Both parts read the same report.
  expect(callsFor(askAI, 'chapters')[0][0]).toBe(prompt);
  expect(prompt).toMatch(/Disabled product domains: avalanche/i);
  expect(prompt).toContain('Cloudy and windy');
  expect(prompt).not.toMatch(/Considerable|Deep Persistent Slab|Avalanche rescue kit/);
});

test('AI brief retries once with the failed checks and keeps the corrected read', async () => {
  const app = express();
  app.use(express.json());
  const headings = ['BIG PICTURE', 'WHY IT MATTERS', 'WATCH CLOSELY', 'DATA CONFIDENCE', 'COMFORT CHECK', 'BEST MOVE'];
  const answer = (gust) => JSON.stringify({ sections: headings.map((heading) => ({ heading, text: `Gusts reach ${gust} mph.`, evidence: [{ path: 'weather.windGust', value: 42 }] })) });
  const askAI = answerParts({ briefing: [answer(55), answer(42)], chapters: [chaptersAnswer(42)] });
  registerAiBriefRoute({ app, askAI });

  const response = await request(app)
    .post('/api/ai-brief')
    .send({ decisionLevel: 'CAUTION', report: { weather: { description: 'Windy', windGust: 42 }, safety: { explanations: ['Strong wind.'] } } });

  expect(response.status).toBe(200);
  expect(response.body.validation).toBe('evidence_checked');
  expect(response.body.narrative).toMatch(/^BIG PICTURE: Gusts reach 42 mph\./);
  expect(callsFor(askAI, 'briefing')).toHaveLength(2);
  expect(callsFor(askAI, 'briefing')[1][0]).toContain('BIG PICTURE: states 55, which is not a number in the report');
  // The briefing's retry does not ask for the chapters again.
  expect(callsFor(askAI, 'chapters')).toHaveLength(1);
  expect(response.body.chapters).toEqual({ forecast: { text: 'Gusts reach 42 mph through the window.', evidence: [{ path: 'weather.windGust', value: 42 }] } });
  expect(response.body.checks).toMatchObject({ attempts: 2, seconds: [expect.any(Number), expect.any(Number), expect.any(Number)] });
});

test('AI brief shows a usable read at once, without a second request for the part that failed', async () => {
  const app = express();
  app.use(express.json());
  const headings = ['BIG PICTURE', 'WHY IT MATTERS', 'WATCH CLOSELY', 'DATA CONFIDENCE', 'COMFORT CHECK', 'BEST MOVE'];
  const first = JSON.stringify({ sections: headings.map((heading) => ({ heading, text: heading === 'WATCH CLOSELY' ? 'Gusts reach 99 mph.' : 'Gusts reach 42 mph.', evidence: [{ path: 'weather.windGust', value: 42 }] })) });
  const askAI = answerParts({ briefing: [first], chapters: [chaptersAnswer(42)] });
  registerAiBriefRoute({ app, askAI });

  const response = await request(app)
    .post('/api/ai-brief')
    .send({ decisionLevel: 'CAUTION', report: { weather: { windGust: 42 }, safety: { explanations: ['Strong wind.'] } } });

  expect(response.status).toBe(200);
  expect(response.body.validation).toBe('evidence_checked');
  expect(response.body.narrative).not.toMatch(/WATCH CLOSELY/);
  expect(askAI).toHaveBeenCalledTimes(2);
  // The reader can see why part of the read was left out, and how long each answer took.
  expect(response.body.checks.attempts).toBe(1);
  expect(response.body.checks.seconds).toEqual([expect.any(Number), expect.any(Number)]);
  expect(response.body.checks.problems).toEqual(expect.arrayContaining(['WATCH CLOSELY: states 99, which is not a number in the report']));
});

test('AI brief falls back to the checks summary when the retry request fails', async () => {
  const app = express();
  app.use(express.json());
  const askAI = answerParts({ briefing: ['not json', new Error('timeout')], chapters: [chaptersAnswer(47)] });
  registerAiBriefRoute({ app, askAI });

  const response = await request(app)
    .post('/api/ai-brief')
    .send({ decisionLevel: 'CAUTION', report: { weather: { windGust: 47 }, safety: { explanations: ['Gusty.'] } } });

  expect(response.status).toBe(200);
  expect(response.body.validation).toBe('deterministic_fallback');
  expect(response.body.chapters).toEqual({});
  expect(askAI).toHaveBeenCalledTimes(3);
  expect(response.body.checks.seconds).toHaveLength(3);
  expect(response.body.checks.problems).toEqual(expect.arrayContaining(['retry: the retry request failed: timeout']));
});

test('AI opening is written by the fast model alone and fact-checked like the read', async () => {
  const app = express();
  app.use(express.json());
  const askAI = jest.fn().mockResolvedValueOnce(JSON.stringify({
    hero: { headline: 'Wind builds through the afternoon', reason: 'Gusts reach 38 mph on the ridge.', evidence: [{ path: 'weather.windGust', value: 38 }] },
  }));
  registerAiBriefRoute({ app, askAI });
  const report = { weather: { description: 'Opening fixture', windGust: 38 }, safety: { explanations: ['Gusty ridge.'] } };

  const response = await request(app).post('/api/ai-brief/opening').send({ decisionLevel: 'CAUTION', report });

  expect(response.status).toBe(200);
  expect(response.body.hero).toMatchObject({ headline: 'Wind builds through the afternoon', level: 'CAUTION' });
  expect(response.body.checks).toEqual({ problems: [], seconds: [expect.any(Number)] });
  expect(askAI).toHaveBeenCalledTimes(1);
  // Written from the whole report, the opening needs more than the fast tier's 8s default.
  // Room for the model's thinking as well as the JSON.
  expect(askAI.mock.calls[0][1]).toMatchObject({ tier: 'fast', feature: 'report-opening', timeoutMs: 20000, maxTokens: 6000 });
  expect(askAI.mock.calls[0][1].system).toMatch(/"hero"/);
  expect(askAI.mock.calls[0][1].system).not.toMatch(/"sections"/);
});

const failingOpening = JSON.stringify({
  hero: { headline: 'Gusts top out near 90 mph today', reason: 'Gusts reach 90 mph.', evidence: [{ path: 'weather.windGust', value: 41 }] },
});
const passingOpening = JSON.stringify({
  hero: { headline: 'Gusts build to 41 mph on the ridge', reason: 'Gusts reach 41 mph.', evidence: [{ path: 'weather.windGust', value: 41 }] },
});
const openingBody = (description) => ({ decisionLevel: 'CAUTION', report: { weather: { description, windGust: 41 }, safety: { explanations: ['Gusty.'] } } });

test('AI opening that fails its checks is asked for once more, naming what failed', async () => {
  const app = express();
  app.use(express.json());
  const askAI = jest.fn().mockResolvedValueOnce(failingOpening).mockResolvedValueOnce(passingOpening);
  registerAiBriefRoute({ app, askAI });

  const response = await request(app).post('/api/ai-brief/opening').send(openingBody('Retried opening fixture'));

  expect(response.status).toBe(200);
  expect(response.body.hero).toMatchObject({ headline: 'Gusts build to 41 mph on the ridge' });
  expect(response.body.checks).toEqual({ problems: [], seconds: [expect.any(Number), expect.any(Number)] });
  expect(askAI).toHaveBeenCalledTimes(2);
  expect(askAI.mock.calls[1][0]).toMatch(/failed these fact checks:\n- OPENING: /);
  expect(askAI.mock.calls[1][1]).toMatchObject({ tier: 'fast', feature: 'report-opening' });
});

test('AI opening that fails twice is left out, with the reason', async () => {
  const app = express();
  app.use(express.json());
  const askAI = jest.fn().mockResolvedValue(failingOpening);
  registerAiBriefRoute({ app, askAI });

  const response = await request(app).post('/api/ai-brief/opening').send(openingBody('Failing opening fixture'));

  expect(response.status).toBe(200);
  expect(response.body.hero).toBeNull();
  expect(response.body.checks.problems).toEqual([expect.stringMatching(/^OPENING: /)]);
  expect(askAI).toHaveBeenCalledTimes(2);
});

test('AI opening whose request fails is retried, and a failure is not kept for the report', async () => {
  const app = express();
  app.use(express.json());
  const askAI = jest.fn()
    .mockRejectedValueOnce(new Error('Unexpected response format from Anthropic API (stop_reason: max_tokens)'))
    .mockResolvedValueOnce(passingOpening);
  registerAiBriefRoute({ app, askAI });

  const retried = await request(app).post('/api/ai-brief/opening').send(openingBody('Errored opening fixture'));
  expect(retried.status).toBe(200);
  expect(retried.body.hero).toMatchObject({ headline: 'Gusts build to 41 mph on the ridge' });
  // A failed request is asked again as it was, not as a failed fact check.
  expect(askAI.mock.calls[1][0]).not.toMatch(/failed these fact checks/);

  askAI.mockReset();
  askAI.mockRejectedValue(new Error('Request timed out.'));
  const failed = await request(app).post('/api/ai-brief/opening').send(openingBody('Timed-out opening fixture'));
  expect(failed.status).toBe(503);
  askAI.mockReset();
  askAI.mockResolvedValueOnce(passingOpening);
  const again = await request(app).post('/api/ai-brief/opening').send(openingBody('Timed-out opening fixture'));
  expect(again.body.hero).toMatchObject({ headline: 'Gusts build to 41 mph on the ridge' });
});

test('AI opening reuses a full read already written for the same report', async () => {
  const app = express();
  app.use(express.json());
  const headings = ['BIG PICTURE', 'WHY IT MATTERS', 'WATCH CLOSELY', 'DATA CONFIDENCE', 'COMFORT CHECK', 'BEST MOVE'];
  const askAI = answerParts({
    briefing: [JSON.stringify({
      sections: headings.map((heading) => ({ heading, text: 'Gusts reach 44 mph.', evidence: [{ path: 'weather.windGust', value: 44 }] })),
      hero: { headline: 'Wind sets the pace of the day', reason: 'Gusts reach 44 mph.', evidence: [{ path: 'weather.windGust', value: 44 }] },
    })],
    chapters: [chaptersAnswer(44)],
  });
  registerAiBriefRoute({ app, askAI });
  const body = { decisionLevel: 'CAUTION', report: { weather: { description: 'Cached opening fixture', windGust: 44 }, safety: { explanations: ['Gusty.'] } } };

  await request(app).post('/api/ai-brief').send(body);
  const response = await request(app).post('/api/ai-brief/opening').send(body);

  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ cached: true, hero: { headline: 'Wind sets the pace of the day' } });
  expect(askAI).toHaveBeenCalledTimes(2);
});

test('AI opening rejects a request without a report and answers 503 when AI is off', async () => {
  const app = express();
  app.use(express.json());
  const askAI = jest.fn();
  registerAiBriefRoute({ app, askAI, ensureFeatureEnabled: rejectDisabledFeature });

  expect((await request(app).post('/api/ai-brief/opening').send({ decisionLevel: 'GO' })).status).toBe(400);
  const disabled = await request(app).post('/api/ai-brief/opening').send({ decisionLevel: 'GO', report: { safety: { score: 80 } } });
  expect(disabled.status).toBe(503);
  expect(askAI).not.toHaveBeenCalled();
});

test('AI brief preserves the feature snapshot of a previously generated report', async () => {
  const app = express();
  app.use(express.json());
  const askAI = answerParts({
    briefing: [JSON.stringify({ sections: ['BIG PICTURE', 'WHY IT MATTERS', 'WATCH CLOSELY', 'DATA CONFIDENCE', 'COMFORT CHECK', 'BEST MOVE'].map(heading => ({ heading, text: 'Avalanche conditions remain part of this saved report.', evidence: [{ path: 'avalanche.risk', value: 'Moderate' }] })) })],
    chapters: [JSON.stringify({ chapters: { terrain: { text: 'Avalanche danger is Moderate.', evidence: [{ path: 'avalanche.risk', value: 'Moderate' }] } } })],
  });
  registerAiBriefRoute({ app, askAI });

  const response = await request(app)
    .post('/api/ai-brief')
    .send({
      report: {
        featureFlags: { avalancheDetails: true },
        avalanche: { risk: 'Moderate' },
        safety: { score: 80 },
      },
      decisionLevel: 'GO',
    });

  expect(response.status).toBe(200);
  expect(response.body.narrative).toMatch(/Avalanche conditions/i);
  expect(response.body.chapters.terrain.text).toBe('Avalanche danger is Moderate.');
  expect(askAI).toHaveBeenCalledTimes(2);
  expect(askAI.mock.calls[0][0]).toMatch(/Moderate/);
});

test('AI brief sends the forecast discussion once, without irrelevant sections', async () => {
  const app = express();
  app.use(express.json());
  const askAI = jest.fn().mockResolvedValue('not json');
  registerAiBriefRoute({ app, askAI });

  const response = await request(app)
    .post('/api/ai-brief')
    .send({
      decisionLevel: 'CAUTION',
      report: {
        safety: { score: 61, explanations: ['Rain arrives tonight.'] },
        supplementalEvidence: {
          discussion: {
            text: 'FXUS66 RAW PRODUCT TEXT',
            sections: [
              { title: 'SHORT TERM', kind: 'period', matchesTrip: true, text: 'Rain spreads inland tonight.' },
              { title: 'AVIATION', kind: 'not_relevant', text: 'MVFR ceilings at terminals.' },
            ],
          },
        },
      },
    });

  expect(response.status).toBe(200);
  const prompt = askAI.mock.calls[0][0];
  expect(prompt).toContain('Rain spreads inland tonight.');
  expect(prompt).toContain('"title":"AVIATION"');
  expect(prompt).not.toContain('RAW PRODUCT TEXT');
  expect(prompt).not.toContain('MVFR ceilings');
});

test('AI brief keeps the raw discussion when a relevant section was truncated', async () => {
  const { SECTION_TEXT_LIMIT } = require('../src/utils/forecast-discussion');
  const app = express();
  app.use(express.json());
  const askAI = jest.fn().mockResolvedValue('not json');
  registerAiBriefRoute({ app, askAI });

  const response = await request(app)
    .post('/api/ai-brief')
    .send({
      decisionLevel: 'CAUTION',
      report: {
        safety: { score: 58 },
        supplementalEvidence: {
          discussion: {
            text: 'FULL PRODUCT TEXT with a late thunderstorm mention',
            sections: [{ title: 'LONG TERM', kind: 'period', text: 'x'.repeat(SECTION_TEXT_LIMIT) }],
          },
        },
      },
    });

  expect(response.status).toBe(200);
  expect(askAI.mock.calls[0][0]).toContain('late thunderstorm mention');
});

test('a report over the prompt limit is still explained, with restated tables left out', async () => {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  const askAI = jest.fn().mockResolvedValue('not json');
  registerAiBriefRoute({ app, askAI, ensureFeatureEnabled: () => {} });
  const byAspect = Array.from({ length: 2000 }, (_, i) => ({ aspect: 'N', hour: i, note: 'x'.repeat(100) }));
  const response = await request(app)
    .post('/api/ai-brief')
    .send({ report: { safety: { score: 61 }, evaluation: { decision: { level: 'CAUTION' }, terrain: { byAspect } } }, decisionLevel: 'CAUTION' });
  expect(response.status).toBe(200);
  expect(response.body.validation).toBe('deterministic_fallback');
  const prompt = askAI.mock.calls[0][0];
  expect(prompt).toContain('"omittedForLength":["evaluation.terrain.byAspect"]');
  expect(prompt).not.toContain('"byAspect"');
});

const HEADINGS = ['BIG PICTURE', 'WHY IT MATTERS', 'WATCH CLOSELY', 'DATA CONFIDENCE', 'COMFORT CHECK', 'BEST MOVE'];
const briefingAnswer = (gust) => JSON.stringify({
  sections: HEADINGS.map((heading) => ({ heading, text: `Gusts reach ${gust} mph.`, evidence: [{ path: 'weather.windGust', value: gust }] })),
  questions: ['When do the gusts ease?'],
  hero: { headline: 'Wind sets the pace of the day', reason: `Gusts reach ${gust} mph.`, evidence: [{ path: 'weather.windGust', value: gust }] },
});

test('AI brief asks for the briefing and the chapters at once, each for its own part', async () => {
  const app = express();
  app.use(express.json());
  const pending = [];
  const askAI = jest.fn((_prompt, options) => new Promise((resolve) => { pending.push({ options, resolve }); }));
  registerAiBriefRoute({ app, askAI });

  const response = request(app)
    .post('/api/ai-brief')
    .send({ decisionLevel: 'CAUTION', report: { weather: { description: 'Parallel fixture', windGust: 51 }, safety: { explanations: ['Gusty.'] } } })
    .then((result) => result);
  // Both answers are asked for before either has answered.
  for (let i = 0; i < 50 && pending.length < 2; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(pending).toHaveLength(2);
  const briefing = pending.find(({ options }) => !isChaptersCall(options));
  const chapters = pending.find(({ options }) => isChaptersCall(options));
  expect(briefing.options).toMatchObject({ feature: 'report-brief', maxTokens: AI_BRIEF_MAX_TOKENS });
  expect(briefing.options.system).toContain(AI_BRIEF_SYSTEM_PROMPT);
  expect(briefing.options.system).toMatch(/\{"sections":\[/);
  expect(briefing.options.system).toMatch(/do not return "chapters"/);
  expect(chapters.options.system).toContain(AI_BRIEF_SYSTEM_PROMPT);
  expect(chapters.options.system).not.toMatch(/\{"sections":\[/);
  expect(chapters.options.system).toMatch(/"forecast"[\s\S]*"timing"[\s\S]*"terrain"[\s\S]*"sources"/);
  // The chapters answer first, and the read waits for the briefing.
  chapters.resolve(chaptersAnswer(51));
  briefing.resolve(briefingAnswer(51));
  const { body } = await response;

  expect(body).toMatchObject({
    validation: 'evidence_checked',
    narrative: expect.stringMatching(/^BIG PICTURE: Gusts reach 51 mph\./),
    questions: ['When do the gusts ease?'],
    chapters: { forecast: { text: 'Gusts reach 51 mph through the window.' } },
    hero: { headline: 'Wind sets the pace of the day', level: 'CAUTION' },
    checks: { attempts: 1, problems: [], seconds: [expect.any(Number), expect.any(Number)] },
  });
  expect(askAI).toHaveBeenCalledTimes(2);
});

test('AI brief keeps the briefing when the chapters cannot be written', async () => {
  const app = express();
  app.use(express.json());
  const askAI = answerParts({ briefing: [briefingAnswer(52)], chapters: [new Error('Request timed out.')] });
  registerAiBriefRoute({ app, askAI });

  const response = await request(app)
    .post('/api/ai-brief')
    .send({ decisionLevel: 'CAUTION', report: { weather: { description: 'Chapters fail fixture', windGust: 52 }, safety: { explanations: ['Gusty.'] } } });

  expect(response.status).toBe(200);
  expect(response.body.validation).toBe('evidence_checked');
  expect(response.body.chapters).toEqual({});
  expect(response.body.hero).toMatchObject({ headline: 'Wind sets the pace of the day' });
  // A failed request for the chapters is asked again as it was; the briefing is not asked again.
  expect(callsFor(askAI, 'briefing')).toHaveLength(1);
  const chapterCalls = callsFor(askAI, 'chapters');
  expect(chapterCalls).toHaveLength(2);
  expect(chapterCalls[1][0]).toBe(chapterCalls[0][0]);
  expect(response.body.checks).toMatchObject({ attempts: 2, seconds: [expect.any(Number), expect.any(Number), expect.any(Number)] });
  expect(response.body.checks.problems).toEqual([
    'first answer: the chapters request failed: Request timed out.',
    'retry: the retry chapters request failed: Request timed out.',
  ]);
});

test('AI brief chapters that fail their checks are asked for once more on their own', async () => {
  const app = express();
  app.use(express.json());
  const badChapters = JSON.stringify({ chapters: { forecast: { text: 'Gusts reach 99 mph.', evidence: [{ path: 'weather.windGust', value: 53 }] } } });
  const askAI = answerParts({ briefing: [briefingAnswer(53)], chapters: [badChapters, chaptersAnswer(53)] });
  registerAiBriefRoute({ app, askAI });

  const response = await request(app)
    .post('/api/ai-brief')
    .send({ decisionLevel: 'CAUTION', report: { weather: { description: 'Chapters retry fixture', windGust: 53 }, safety: { explanations: ['Gusty.'] } } });

  expect(response.body.chapters.forecast.text).toBe('Gusts reach 53 mph through the window.');
  expect(callsFor(askAI, 'briefing')).toHaveLength(1);
  expect(callsFor(askAI, 'chapters')[1][0]).toMatch(/failed these fact checks[\s\S]*forecast chapter: states 99/);
  expect(response.body.checks.attempts).toBe(2);
});

test('AI opening is written from a smaller fit of the report, and checked against it', async () => {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  const askAI = jest.fn().mockResolvedValue(JSON.stringify({
    hero: { headline: 'Wind builds through the afternoon', reason: 'Gusts reach 39 mph on the ridge.', evidence: [{ path: 'weather.windGust', value: 39 }] },
  }));
  registerAiBriefRoute({ app, askAI });
  // Restated per-aspect detail: well under the full read's limit, over the opening's.
  const byAspect = Array.from({ length: 300 }, (_, i) => ({ aspect: 'N', hour: i, note: 'x'.repeat(100) }));
  const report = { weather: { description: 'Smaller opening fixture', windGust: 39 }, safety: { explanations: ['Gusty.'] }, evaluation: { terrain: { byAspect } } };

  const response = await request(app).post('/api/ai-brief/opening').send({ decisionLevel: 'CAUTION', report });

  expect(response.status).toBe(200);
  expect(response.body.hero).toMatchObject({ headline: 'Wind builds through the afternoon' });
  const prompt = askAI.mock.calls[0][0];
  expect(prompt).toContain('"omittedForLength":["evaluation.terrain.byAspect"]');
  expect(prompt).not.toContain('"byAspect"');
  expect(prompt.length).toBeLessThan(26000);

  // A citation of a field the opening never saw fails its checks.
  askAI.mockReset();
  askAI.mockResolvedValue(JSON.stringify({
    hero: { headline: 'Wind builds through the afternoon', reason: 'North slopes hold the wind.', evidence: [{ path: 'evaluation.terrain.byAspect.0.aspect', value: 'N' }] },
  }));
  const unseen = await request(app).post('/api/ai-brief/opening').send({ decisionLevel: 'CAUTION', report: { ...report, weather: { ...report.weather, description: 'Unseen citation fixture' } } });
  expect(unseen.body.hero).toBeNull();
  expect(unseen.body.checks.problems).toEqual([expect.stringMatching(/^OPENING: cited path evaluation\.terrain\.byAspect\.0\.aspect is not a value in the report/)]);

  // The full read still reads the whole report.
  const read = answerParts({ briefing: ['not json'], chapters: ['not json'] });
  const readApp = express();
  readApp.use(express.json({ limit: '5mb' }));
  registerAiBriefRoute({ app: readApp, askAI: read });
  await request(readApp).post('/api/ai-brief').send({ decisionLevel: 'CAUTION', report });
  expect(read.mock.calls[0][0]).toContain('"byAspect"');
  expect(read.mock.calls[0][0]).not.toContain('omittedForLength');
});

test('AI opening reads the full fit when the evidence behind the decision alone is too large to shorten', async () => {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  const askAI = jest.fn().mockResolvedValue('not json');
  registerAiBriefRoute({ app, askAI });
  // Safety is never shortened, so the opening's fit cannot be made.
  const report = { weather: { description: 'Protected opening fixture', windGust: 40 }, safety: { explanations: Array.from({ length: 60 }, (_, i) => `Explanation ${i} ${'y'.repeat(500)}`) } };

  await request(app).post('/api/ai-brief/opening').send({ decisionLevel: 'CAUTION', report });

  const prompt = askAI.mock.calls[0][0];
  expect(prompt).toContain('Explanation 59');
  expect(prompt).not.toContain('omittedForLength');
});
