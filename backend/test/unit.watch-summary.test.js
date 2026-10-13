const {
  SUMMARY_MAX_CHARS,
  acceptWatchSummary,
  buildWatchSummaryContext,
  buildWatchSummaryPrompt,
  createWatchSummarizer,
  sanitizeWatchSummary,
} = require('../src/utils/watch-summary');

const PLAN = { lat: 46.85, lon: -121.76, forecastDate: '2026-07-17', alpineStartTime: '06:00', travelWindowHours: 12 };
const CHANGE = {
  direction: 'worse',
  reasons: [{ key: 'wind_gust', direction: 'worse', label: 'Peak gusts increased from 20 mph to 42 mph.' }],
  previous: { maxWindGust: 20, score: 80 },
  current: { maxWindGust: 42, score: 78 },
};
const REPORT = {
  weather: { trend: [{ gust: 42 }] },
  alerts: { alerts: [{ event: 'Wind Advisory', severity: 'Moderate', headline: 'Wind Advisory until 18:00' }] },
  avalanche: { dangerLevel: 1, problems: [{ name: 'Wind Slab' }, { size: 2 }] },
  evaluation: {
    decision: { level: 'CAUTION', headline: 'Adjust terrain, timing, or pace before committing.', blockers: [], cautions: ['Gusts exceed your limit after 10:00.'] },
    criticalWindow: { peakTime: '11:00' },
    travelWindow: {
      planned: {
        rows: [
          { time: '06:00', temp: 41.2, feelsLike: 35, wind: 8, gust: 18, precipChance: 10, pass: true, failedRuleLabels: [] },
          { time: '11:00', temp: 48, feelsLike: 40, wind: 25, gust: 42, precipChance: 10, pass: false, failedRuleLabels: ['Gusts above limit'] },
        ],
      },
    },
  },
};

describe('watch summary context', () => {
  test('carries the reasons, plan, planned hours and alerts but no report bulk', () => {
    const context = buildWatchSummaryContext({ title: 'Mount Rainier', plan: PLAN, change: CHANGE, report: REPORT });
    expect(context).toMatchObject({
      objective: 'Mount Rainier',
      plan: { date: '2026-07-17', start: '06:00', travelWindowHours: 12 },
      changes: [{ direction: 'worse', what: 'Peak gusts increased from 20 mph to 42 mph.' }],
      signalsBefore: { maxWindGust: 20 },
      signalsNow: { maxWindGust: 42 },
      decision: { level: 'CAUTION', cautions: ['Gusts exceed your limit after 10:00.'] },
      hourNeedingMostAttention: '11:00',
      alerts: [{ event: 'Wind Advisory', severity: 'Moderate' }],
      avalanche: { dangerLevel: 1, problems: ['Wind Slab'] },
    });
    expect(context.plannedHours[0]).toEqual({ time: '06:00', tempF: 41, feelsLikeF: 35, windMph: 8, gustMph: 18, precipChancePercent: 10, withinLimits: true });
    expect(context.plannedHours[1].failed).toEqual(['Gusts above limit']);
    expect(context).not.toHaveProperty('weather');
    expect(context.decision).not.toHaveProperty('blockers');
    expect(buildWatchSummaryPrompt(context)).toContain('"what":"Peak gusts increased from 20 mph to 42 mph."');
  });

  test('works from the change alone when the report has no evaluation', () => {
    const context = buildWatchSummaryContext({ title: 'Peak', plan: PLAN, change: CHANGE, report: null });
    expect(context.changes).toHaveLength(1);
    expect(context).not.toHaveProperty('plannedHours');
  });
});

describe('sanitizing and accepting the answer', () => {
  test('strips markdown, collapses lines and caps the length at a sentence end', () => {
    expect(sanitizeWatchSummary('## Summary\n- **Gusts** rose to `42 mph`.\n\n* Start _earlier_.')).toBe('Summary Gusts rose to 42 mph. Start earlier.');
    expect(sanitizeWatchSummary('Summary: Gusts rose.')).toBe('Gusts rose.');
    expect(sanitizeWatchSummary(42)).toBeNull();
    const long = `${'Gusts rose sharply along the ridge. '.repeat(30)}`;
    const capped = sanitizeWatchSummary(long);
    expect(capped.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
    expect(capped.endsWith('.')).toBe(true);
  });

  test('rejects numbers that are not in the evidence, refusals and too-short text', () => {
    const context = buildWatchSummaryContext({ title: 'Mount Rainier', plan: PLAN, change: CHANGE, report: REPORT });
    const grounded = 'Peak gusts rose from 20 to 42 mph, worst around 11:00 (11 AM). Starting at 06:00 keeps the early hours below 18 mph.';
    expect(acceptWatchSummary(grounded, context)).toBe(grounded);
    expect(acceptWatchSummary('Peak gusts rose to 55 mph around 11:00, so consider starting earlier than planned.', context)).toBeNull();
    expect(acceptWatchSummary("I'm sorry, I cannot help with that request about the weather.", context)).toBeNull();
    expect(acceptWatchSummary('Gusts rose.', context)).toBeNull();
    expect(acceptWatchSummary('{"summary": "Peak gusts increased from 20 mph to 42 mph today."}', context)).toBeNull();
  });
});

describe('createWatchSummarizer', () => {
  const input = { title: 'Mount Rainier', plan: PLAN, change: CHANGE, report: REPORT, userId: 'user-1' };

  test('asks the fast tier with a small budget and the owner, and returns the cleaned answer', async () => {
    const askAI = jest.fn(async () => 'Peak gusts rose from 20 to 42 mph, peaking around 11:00.\nA 06:00 start stays below 18 mph early on.');
    const summarize = createWatchSummarizer({ askAI, isAvailable: (feature) => feature === 'watchSummary' });
    await expect(summarize(input)).resolves.toBe('Peak gusts rose from 20 to 42 mph, peaking around 11:00. A 06:00 start stays below 18 mph early on.');
    const [prompt, options] = askAI.mock.calls[0];
    expect(prompt).toContain('Mount Rainier');
    expect(options).toMatchObject({ tier: 'fast', feature: 'watch-summary', userId: 'user-1' });
    expect(options.maxTokens).toBeLessThanOrEqual(300);
    expect(options.system).toMatch(/only facts and numbers/u);
  });

  test('resolves null without calling AI when unavailable or there are no reasons', async () => {
    const askAI = jest.fn();
    await expect(createWatchSummarizer({ askAI, isAvailable: () => false })(input)).resolves.toBeNull();
    await expect(createWatchSummarizer({ askAI, isAvailable: () => true })({ ...input, change: { reasons: [] } })).resolves.toBeNull();
    await expect(createWatchSummarizer({ isAvailable: () => true })(input)).resolves.toBeNull();
    expect(askAI).not.toHaveBeenCalled();
  });

  test('resolves null when the provider throws, synchronously or not, or times out', async () => {
    const log = { warn: jest.fn() };
    await expect(createWatchSummarizer({ askAI: async () => { throw new Error('down'); }, isAvailable: () => true, log })(input)).resolves.toBeNull();
    await expect(createWatchSummarizer({ askAI: () => { throw new Error('sync'); }, isAvailable: () => true, log })(input)).resolves.toBeNull();
    await expect(createWatchSummarizer({ askAI: () => { throw new Error('x'); }, isAvailable: () => { throw new Error('flags'); }, log })(input)).resolves.toBeNull();
    const started = Date.now();
    await expect(createWatchSummarizer({ askAI: () => new Promise(() => {}), isAvailable: () => true, timeoutMs: 25, log })(input)).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(log.warn).toHaveBeenCalled();
  });
});
