const { calculateSafetyScore } = require('../src/utils/safety-score');
const { selectForecastIntervals } = require('../src/utils/report-evidence');
const { validateBrief, validateBriefing, validateBriefChapters, validateQuestions, validateChapters, validateHero, deterministicBrief } = require('../src/utils/brief-validation');
const start = '2026-09-16T08:30:00-07:00';
const row = (timeIso, extra = {}) => ({ timeIso, temp: 55, feelsLike: 55, wind: 5, gust: 8, precipChance: 0, ...extra });
const base = () => ({
  selectedStartTime: start, selectedTravelWindowHours: 2,
  selectedDate: '2026-09-16', selectedStartClock: '08:30',
  avalancheData: { relevant: false }, alertsData: { status: 'none', alerts: [] },
  weatherData: { temp: 55, feelsLike: 55, windSpeed: 5, windGust: 8, precipChance: 0,
    issuedTime: new Date().toISOString(), forecastStartTime: start,
    sourceDetails: { primary: 'NOAA' },
    trend: [row('2026-09-16T08:00:00-07:00'), row('2026-09-16T09:00:00-07:00'), row('2026-09-16T10:00:00-07:00')] },
});

test('partial boundary hours are clipped and a final partial hour is required', () => {
  const input = base();
  expect(calculateSafetyScore(input).coverage.completeHours).toBe(2);
  expect(calculateSafetyScore(input).assessmentStatus).toBe('supported');
  input.weatherData.trend.pop();
  expect(calculateSafetyScore(input)).toMatchObject({ assessmentStatus: 'insufficient_evidence', coverage: { completeHours: 1.5 } });
});
test('duplicate rows, gaps and missing dimensions never establish complete coverage', () => {
  const input = base();
  const full = calculateSafetyScore(input);
  input.weatherData.trend = [input.weatherData.trend[0], input.weatherData.trend[0], input.weatherData.trend[2]];
  const sparse = calculateSafetyScore(input);
  expect(sparse.coverage.completeHours).toBe(1);
  expect(sparse.assessmentStatus).toBe('insufficient_evidence');
  expect(sparse.confidence).toBeLessThanOrEqual(full.confidence);
  input.weatherData.trend = base().weatherData.trend.map(r => ({ ...r, precipChance: null }));
  expect(calculateSafetyScore(input).coverage.completeHours).toBe(0);
});
test('timestamps are required; outside-window readings and invalid intervals cannot establish coverage', () => {
  const input = base();
  input.weatherData.trend = [row('invalid'), row('2026-09-17T08:00:00-07:00'), row('2026-09-16T08:00:00-07:00', { endTimeIso: '2026-09-16T07:00:00-07:00' })];
  expect(calculateSafetyScore(input).coverage.completeHours).toBe(0);
});
test('elapsed-hour coverage crosses midnight and both DST transitions', () => {
  for (const times of [
    ['2026-09-16T23:00:00-07:00', '2026-09-17T00:00:00-07:00'],
    ['2026-11-01T01:00:00-07:00', '2026-11-01T01:00:00-08:00'],
    ['2026-03-08T01:00:00-08:00', '2026-03-08T03:00:00-07:00'],
  ]) expect(selectForecastIntervals(times.map(t => row(t)), times[0], 2).reduce((n, r) => n + r.hours, 0)).toBe(2);
});
test('stale issuance, alert outage, and avalanche expiry before return gate the assessment', () => {
  for (const change of [
    input => { input.weatherData.issuedTime = '2026-01-01T00:00:00Z'; },
    input => { input.alertsData = { status: 'unavailable' }; },
    input => { input.avalancheData = { relevant: true, dangerLevel: 1, expiresTime: '2026-09-16T09:00:00-07:00' }; },
  ]) { const input = base(); change(input); expect(calculateSafetyScore(input).assessmentStatus).toBe('insufficient_evidence'); }
});
test('fallback and unspecified sources retain their actual attribution', () => {
  const input = base(); input.weatherData.sourceDetails = { primary: 'Open-Meteo' };
  const result = calculateSafetyScore(input);
  expect(result.sourcesUsed).toContain('Open-Meteo hourly forecast');
  expect(result.sourcesUsed).not.toContain('NOAA/NWS hourly forecast');
  delete input.weatherData.sourceDetails;
  expect(calculateSafetyScore(input).weatherProvenance.provider).toBe('Weather provider unspecified');
});
const headings = ['BIG PICTURE', 'WHY IT MATTERS', 'WATCH CLOSELY', 'DATA CONFIDENCE', 'COMFORT CHECK', 'BEST MOVE'];
const brief = text => JSON.stringify({ sections: headings.map(heading => ({ heading, text, evidence: [{ path: 'weather.windGust', value: 8 }] })) });
test('brief validation rejects unsupported quantities, forged references, and permissive recommendations', () => {
  const report = { weather: { windGust: 8 } };
  expect(validateBrief(brief('Forecast gusts are 8 mph.'), report, 'CAUTION')).not.toBeNull();
  expect(validateBrief(brief('Forecast gusts are 80 mph.'), report, 'CAUTION')).toBeNull();
  expect(validateBrief(brief('Proceed with caution.'), report, 'NO-GO')).toBeNull();
  expect(validateBrief(brief('Safe to go.'), report, 'GO')).toBeNull();
  expect(validateBrief(brief('Forecast gusts are 8 mph.'), { weather: { windGust: null } }, 'GO')).toBeNull();
  expect(validateBrief('unstructured answer', report, 'GO')).toBeNull();
  expect(deterministicBrief({ safety: { assessmentStatus: 'insufficient_evidence' } }, 'CAUTION')).toMatch(/insufficient evidence/i);
});

test('brief follow-up questions are short, numberless questions and never fail the brief', () => {
  const report = { weather: { windGust: 8 } };
  const withQuestions = (questions) => JSON.stringify({ ...JSON.parse(brief('Forecast gusts are 8 mph.')), questions });
  expect(validateBrief(withQuestions(['When do the gusts build?', 'when do the gusts build?', 'Is it windy at 11 AM?', 'Tell me more.', 'Is the ridge safe to cross?', 42, 'What would make this a no-go?', 'Should I start earlier?']), report, 'CAUTION').questions)
    .toEqual(['When do the gusts build?', 'What would make this a no-go?', 'Should I start earlier?']);
  expect(validateBrief(withQuestions('not a list'), report, 'CAUTION').questions).toEqual([]);
  expect(validateBrief(brief('Forecast gusts are 8 mph.'), report, 'CAUTION').questions).toEqual([]);
  expect(validateQuestions(['  What   changes after   noon? '])).toEqual(['What changes after noon?']);
  expect(validateQuestions([`${'Why '.repeat(40)}?`])).toEqual([]);
});

test('chapter analyses are fact-checked one by one and a failing one is left out', () => {
  const report = { weather: { windGust: 8 }, solar: { sunset: '7:02 PM' }, avalanche: { dangerLevel: 3 } };
  const cite = (path, value) => [{ path, value }];
  const chapters = validateChapters({
    forecast: { text: 'Gusts peak at 8 mph   by noon.', evidence: cite('weather.windGust', 8) },
    timing: { text: 'Sunset is at 7:02 PM, leaving 90 minutes.', evidence: cite('solar.sunset', '7:02 PM') },
    terrain: { text: 'Danger is 3, so it is all clear above treeline.', evidence: cite('avalanche.dangerLevel', 3) },
    sources: { text: 'Checks agree.', evidence: cite('weather.windGust', 9) },
    route: { text: 'Not a chapter the AI writes.', evidence: cite('weather.windGust', 8) },
  }, report, 'CAUTION');
  expect(chapters).toEqual({ forecast: { text: 'Gusts peak at 8 mph by noon.', evidence: cite('weather.windGust', 8) } });
  expect(validateChapters({ forecast: { text: 'Proceed as planned.', evidence: cite('weather.windGust', 8) } }, report, 'NO-GO')).toEqual({});
  expect(validateChapters({ forecast: { text: 'x'.repeat(701), evidence: cite('weather.windGust', 8) } }, report, 'GO')).toEqual({});
  expect(validateChapters('nope', report, 'GO')).toEqual({});
  const withChapters = JSON.stringify({ ...JSON.parse(brief('Forecast gusts are 8 mph.')), chapters: { forecast: { text: 'Gusts stay at 8 mph.', evidence: cite('weather.windGust', 8) }, terrain: { text: 'Gusts hit 80 mph.', evidence: cite('weather.windGust', 8) } } });
  expect(Object.keys(validateBrief(withChapters, report, 'CAUTION').chapters)).toEqual(['forecast']);
});

test('fact checks accept ranges, rounding, converted units and negations, and keep the parts that pass', () => {
  const report = { weather: { windGust: 8.4, windSpeed: 5, temp: 25, sunrise: '7:00 AM' }, terrain: { summitFt: 10000 } };
  const ev = (...paths) => paths.map(path => ({ path, value: path.split('.').reduce((v, k) => v[k], report) }));
  const one = (text, evidence, level = 'CAUTION', units) => validateBrief(JSON.stringify({ sections: headings.map(heading => ({ heading, text, evidence })) }), report, level, { units });
  expect(one('Wind runs 5-8 mph from 7:00-8:00 AM.', ev('weather.windSpeed', 'weather.windGust', 'weather.sunrise'))).not.toBeNull();
  expect(one('Wind runs 5-9 mph.', ev('weather.windSpeed', 'weather.windGust'))).toBeNull();
  expect(one('It is not safe to linger on the ridge; proceed with caution.', ev('weather.windGust'))).not.toBeNull();
  expect(one('Proceed with caution.', ev('weather.windGust'), 'NO-GO')).toBeNull();
  expect(one('It is -4 C at the start with gusts of 14 km/h near 3050 m.', ev('weather.temp', 'weather.windGust', 'terrain.summitFt'), 'CAUTION', { temperature: 'c', wind: 'kph', elevation: 'm' })).not.toBeNull();
  expect(one('It is -4 C at the start.', ev('weather.temp'))).toBeNull();
  const problems = [];
  const mixed = JSON.stringify({ sections: headings.map(heading => ({ heading, text: heading === 'WATCH CLOSELY' ? 'Gusts hit 30 mph.' : 'Gusts near 8 mph.', evidence: ev('weather.windGust') })) });
  const kept = validateBrief(`Here you go:\n${mixed}`, report, 'CAUTION', { problems });
  expect(kept.narrative).not.toMatch(/WATCH CLOSELY/);
  expect(kept.evidence.map(section => section.heading)).not.toContain('WATCH CLOSELY');
  expect(problems).toEqual(['WATCH CLOSELY: states 30, which is not a number in the report', 'OPENING: missing or without a headline and reason']);
  const noLead = JSON.stringify({ sections: headings.map(heading => ({ heading, text: heading === 'BIG PICTURE' ? 'Gusts hit 30 mph.' : 'Gusts near 8 mph.', evidence: ev('weather.windGust') })) });
  expect(validateBrief(noLead, report, 'CAUTION')).toBeNull();
  const truncated = [];
  expect(validateBrief(mixed.slice(0, 80), report, 'CAUTION', { problems: truncated })).toBeNull();
  expect(truncated[0]).toMatch(/not valid JSON/);
});

test('a cited number converts only the way its kind of value does', () => {
  const report = { weather: { windGust: 8, temp: 25, note: 'Gusts near 20 mph and 30°F at 9000 ft' } };
  const metric = { temperature: 'c', wind: 'kph', elevation: 'm' };
  const hero = (reason, path) => validateHero({ headline: 'Wind sets the pace today', reason, evidence: [{ path, value: report.weather[path.split('.')[1]] }] }, report, 'CAUTION', metric);
  expect(hero('Gusts reach 13 km/h.', 'weather.windGust')).not.toBeNull();
  expect(hero('It is -13 C.', 'weather.windGust')).toBeNull();
  expect(hero('Gusts reach 2 m.', 'weather.windGust')).toBeNull();
  expect(hero('It is -4 C.', 'weather.temp')).not.toBeNull();
  expect(hero('Gusts near 32 km/h, -1 C at 2740 m.', 'weather.note')).not.toBeNull();
  expect(hero('It is -7 C.', 'weather.note')).toBeNull();
});

test('thousands separators and rounded elevations pass; the hero note is checked on its own', () => {
  const report = { approach: { lowestFt: 11487, trailhead: 'estimated', belowObjective: [{ firstHour: '07:00', lastHour: '08:00' }] }, objective: { elevationFt: 13026 }, weather: { windGust: 8 } };
  const cite = (path, value) => ({ path, value });
  const base = { headline: 'Wind sets the pace today', reason: 'The summit sits at 13,026 ft.', evidence: [cite('objective.elevationFt', 13026)] };
  const note = (text, evidence) => validateHero({ ...base, note: { text, evidence } }, report, 'CAUTION');
  expect(validateHero(base, report, 'CAUTION')).not.toBeNull();
  expect(note('From 07:00 to 08:00 you will be near 11,500 ft on the way up, so those hours are judged there.', [cite('approach.lowestFt', 11487), cite('approach.belowObjective.0.firstHour', '07:00'), cite('approach.belowObjective.0.lastHour', '08:00')]).note.text)
    .toMatch(/near 11,500 ft/);
  const bad = note('You will be near 9,000 ft.', [cite('approach.lowestFt', 11487)]);
  expect(bad).not.toBeNull();
  expect(bad.note).toBeUndefined();
  expect(validateHero({ ...base, reason: 'The summit sits at 13,000 ft.' }, report, 'CAUTION')).not.toBeNull();
  expect(validateHero({ ...base, reason: 'The summit sits at 12,000 ft.' }, report, 'CAUTION')).toBeNull();
});

test('the AI hero never names a decision level other than the badge', () => {
  const report = { weather: { windGust: 8 } };
  const hero = (headline, level) => validateHero({ headline, reason: 'Gusts reach 8 mph.', evidence: [{ path: 'weather.windGust', value: 8 }] }, report, level);
  expect(hero('GO is the call today', 'CAUTION')).toBeNull();
  expect(hero('CAUTION on the ridge today', 'GO')).toBeNull();
  expect(hero('CAUTION on the ridge today', 'CAUTION')).not.toBeNull();
  expect(hero('A clear GO for the morning', 'GO')).not.toBeNull();
  expect(hero('A NO-GO on the ridge today', 'NO-GO')).not.toBeNull();
});

test('the checks summary leads with what the evaluation says, not a stock line', () => {
  const text = deterministicBrief({ evaluation: { decision: { headline: 'Wind crosses your limit after noon.' }, verdict: { reason: 'Gusts exceed your limit on the ridge.' } } }, 'CAUTION');
  expect(text).toMatch(/^BIG PICTURE: The checks call this a go with caution\. Wind crosses your limit after noon\. Gusts exceed your limit on the ridge\./);
  expect(text).not.toMatch(/Computed decision/);
});

test('the AI hero is fact-checked and never names another level or sounds safer', () => {
  const report = { weather: { windGust: 8 }, safety: { score: 62 } };
  const cite = (path, value) => [{ path, value }];
  const hero = (headline, reason, evidence = cite('weather.windGust', 8)) => ({ headline, reason, evidence });
  expect(validateHero(hero('Wind sets the pace today.', 'Gusts reach 8 mph   on the ridge.'), report, 'CAUTION'))
    .toEqual({ headline: 'Wind sets the pace today', reason: 'Gusts reach 8 mph on the ridge.', evidence: cite('weather.windGust', 8) });
  expect(validateHero(hero('Wind sets the pace today', 'Gusts reach 30 mph.'), report, 'CAUTION')).toBeNull();
  expect(validateHero(hero('Proceed with the full ridge', 'Gusts reach 8 mph.'), report, 'NO-GO')).toBeNull();
  expect(validateHero(hero('A no-go on the ridge today', 'Gusts reach 8 mph.'), report, 'CAUTION')).toBeNull();
  expect(validateHero(hero('A no-go on the ridge today', 'Gusts reach 8 mph.'), report, 'NO-GO')).not.toBeNull();
  expect(validateHero(hero('Short', 'Gusts reach 8 mph.'), report, 'GO')).toBeNull();
  expect(validateHero(hero('Wind sets the pace today', 'x'.repeat(321)), report, 'GO')).toBeNull();
  expect(validateHero(hero('Wind sets the pace today', 'Gusts reach 8 mph.', []), report, 'GO')).toBeNull();
  expect(validateHero(null, report, 'GO')).toBeNull();
  const withHero = JSON.stringify({ ...JSON.parse(brief('Forecast gusts are 8 mph.')), hero: hero('Wind sets the pace today', 'Gusts reach 8 mph.') });
  expect(validateBrief(withHero, report, 'CAUTION').hero).toMatchObject({ headline: 'Wind sets the pace today' });
  expect(validateBrief(brief('Forecast gusts are 8 mph.'), report, 'CAUTION').hero).toBeNull();
});

test('saved synthetic sparse-provider fixture remains insufficient on replay', () => {
  const fixture = require('./fixtures/reliability/partial-window.json');
  expect(calculateSafetyScore(fixture)).toMatchObject({ assessmentStatus: 'insufficient_evidence', coverage: { completeHours: 1.5 } });
});
test('provider local time normalization preserves objective timezone and rejects nonexistent DST time', () => {
  const { zonedForecastIso } = require('../src/utils/report-evidence');
  expect(zonedForecastIso('2026-09-16T08:00', 'America/Los_Angeles')).toBe('2026-09-16T08:00:00-07:00');
  expect(zonedForecastIso('2026-03-08T02:00', 'America/Los_Angeles')).toBeNull();
});
test('verification computes forecast errors without combining units, leads or unmatched observations', () => {
  const { verifyForecastPairs } = require('../src/utils/forecast-verification');
  const pair = { provider: 'example', forecastLocationId: 'station-a', observationLocationId: 'station-a', variable: 'temperature', unit: 'F', issuedAt: '2026-09-16T00:00:00Z', validAt: '2026-09-16T12:00:00Z', observedAt: '2026-09-16T12:00:00Z', forecast: 60, observed: 56 };
  const result = verifyForecastPairs([pair, pair, { ...pair, forecastLocationId: 'summit' }, { ...pair, forecast: null }, { ...pair, validAt: '2026-09-16T13:00:00Z', observedAt: '2026-09-16T13:00:00Z', forecast: 54 }]);
  expect(result.rejected).toBe(3);
  expect(result.groups[0]).toMatchObject({ count: 2, bias: 1, mae: 3 });
  expect(result.groups[0].rmse).toBeCloseTo(Math.sqrt(10));
});

test('Open-Meteo outage gaps remain null, genuine zero survives, and retrieval is not issuance', async () => {
  const { createWeatherDataService } = require('../src/utils/weather-data');
  const payload = { timezone: 'America/Los_Angeles', hourly: {
    time: ['2026-09-16T08:00', '2026-09-16T09:00', '2026-09-16T10:00'],
    temperature_2m: [null, 0, 50], wind_speed_10m: [null, 0, 5], wind_gusts_10m: [null, 0, 8],
    precipitation_probability: [null, 0, 0], weather_code: [null, 0, 0],
  } };
  const service = createWeatherDataService({ fetchWithTimeout: jest.fn(async () => ({ ok: true, json: async () => payload, headers: { get: () => 'Wed, 16 Sep 2026 14:00:00 GMT' } })), requestTimeoutMs: 100 });
  const result = await service.fetchOpenMeteoWeatherFallback({ lat: 33.912345, lon: -116.912345, selectedDate: '2026-09-16', startClock: '08:30', trendHours: 2, fetchOptions: {} });
  const weather = JSON.parse(JSON.stringify(result.weatherData));
  expect(weather).toMatchObject({ temp: null, windSpeed: null, windGust: null, precipChance: null, issuedTime: null, fetchedAt: '2026-09-16T14:00:00.000Z', forecastStartTime: '2026-09-16T08:00:00-07:00' });
  expect(weather.trend).toHaveLength(3);
  expect(weather.trend[0]).toMatchObject({ temp: null, wind: null, gust: null, precipChance: null });
  expect(weather.trend[1]).toMatchObject({ temp: 0, wind: 0, gust: 0, precipChance: 0 });
});

test('elevation estimates cannot invent calm wind when the baseline is missing', () => {
  const { buildElevationForecastBands } = require('../src/utils/visibility-risk');
  const bands = buildElevationForecastBands({ baseElevationFt: 10000, tempF: 55, windSpeedMph: null, windGustMph: null });
  expect(bands.length).toBeGreaterThan(0);
  expect(bands.every(band => band.windSpeed === null && band.windGust === null)).toBe(true);
});

// The Mount Ritter read (Oct 2026) fell back on both attempts: the model cited
// shortened paths, a list, and numbers it didn't cite. These are its citations.
test('fact checks resolve shortened paths, list items and uncited report numbers, and still reject invented ones', () => {
  const report = {
    weather: { temperatureContext24h: { daytimeHighF: 38 }, trend: [{ time: '07:00', feelsLike: 22, temp: 31 }] },
    safety: { score: 64, confidenceReasons: ['Fire activity is near the objective.'] },
    localConditions: {
      access: { closedRoadCount: 4 },
      closures: { alertCount: 1 },
      wildfire: { incidents: [{ name: 'Example Fire', distanceKm: 12.5 }] },
    },
    pleasantness: { score: 100 },
    evaluation: { decisionSummary: { actionLine: 'Make the listed adjustments before leaving.' } },
  };
  const section = (text, evidence) => ({ text, evidence });
  const answer = {
    'BIG PICTURE': section('Highs near 38 F with a fire about 12.5 km away.', [{ path: 'temperatureContext24h.daytimeHighF', value: 38 }, { path: 'wildfire.incidents.0.distanceKm', value: 12.5 }]),
    'WHY IT MATTERS': section('Road access may be limited.', [{ path: 'closures.alertCount', value: 1 }]),
    'WATCH CLOSELY': section('4 roads are closed and it feels like 22 F at the start.', [{ path: 'access.closedRoadCount', value: 4 }, { path: 'weather.trend[0].feelsLike', value: 22 }]),
    'DATA CONFIDENCE': section('Fire activity is near the objective, with 4 closures to verify.', [{ path: 'safety.confidenceReasons', value: 'Fire activity is near the objective.' }]),
    'COMFORT CHECK': section('Comfort scores 100 but it is 31 F at the start.', [{ path: 'weather.trend.0.feelsLike', value: 22 }]),
    'BEST MOVE': section('Make the listed adjustments before leaving.', [{ path: 'decisionSummary.actionLine', value: 'Make the listed adjustments before leaving.' }, { path: 'made.up.path', value: 1 }]),
  };
  const raw = (sections) => JSON.stringify({ sections: Object.entries(sections).map(([heading, value]) => ({ heading, ...value })) });
  const problems = [];
  const read = validateBrief(raw(answer), report, 'CAUTION', { problems });
  expect(problems).toEqual(['OPENING: missing or without a headline and reason']);
  expect(read.evidence.map(({ heading }) => heading)).toEqual(headings);
  // Citations come back as full report paths; an unresolvable extra citation is dropped.
  expect(read.evidence.find(({ heading }) => heading === 'BIG PICTURE').evidence).toEqual([
    { path: 'weather.temperatureContext24h.daytimeHighF', value: 38 },
    { path: 'localConditions.wildfire.incidents.0.distanceKm', value: 12.5 },
  ]);
  expect(read.evidence.find(({ heading }) => heading === 'DATA CONFIDENCE').evidence).toEqual([{ path: 'safety.confidenceReasons.0', value: 'Fire activity is near the objective.' }]);
  expect(read.evidence.find(({ heading }) => heading === 'BEST MOVE').evidence).toEqual([{ path: 'evaluation.decisionSummary.actionLine', value: 'Make the listed adjustments before leaving.' }]);

  const failing = (sections) => { const found = []; validateBrief(raw({ ...answer, ...sections }), report, 'CAUTION', { problems: found }); return found.filter(problem => !problem.startsWith('OPENING')); };
  // A number the report doesn't hold anywhere is still invented.
  expect(failing({ 'COMFORT CHECK': section('It feels like 17 F at the start.', [{ path: 'weather.trend.0.feelsLike', value: 22 }]) }))
    .toEqual(['COMFORT CHECK: states 17, which is not a number in the report']);
  // A shortened path with the wrong value is a misquote.
  expect(failing({ 'WATCH CLOSELY': section('Several roads are closed.', [{ path: 'access.closedRoadCount', value: 6 }]) }))
    .toEqual(['WATCH CLOSELY: cited access.closedRoadCount as 6 but the report has 4']);
  // Text whose only citation names nothing in the report fails.
  expect(failing({ 'WHY IT MATTERS': section('Road access may be limited.', [{ path: 'closures.count', value: 1 }]) }))
    .toEqual(['WHY IT MATTERS: cited path closures.count is not a value in the report']);
});
test('a read written in two answers checks each part on its own', () => {
  const report = { weather: { windGust: 8 }, safety: { score: 80 } };
  const headings = ['BIG PICTURE', 'WHY IT MATTERS', 'WATCH CLOSELY', 'DATA CONFIDENCE', 'COMFORT CHECK', 'BEST MOVE'];
  const cite = [{ path: 'weather.windGust', value: 8 }];
  const briefing = JSON.stringify({
    sections: headings.map(heading => ({ heading, text: 'Forecast gusts are 8 mph.', evidence: cite })),
    questions: ['When do the gusts build?'],
    hero: { headline: 'Light wind through the window', reason: 'Gusts stay near 8 mph.', evidence: cite },
    chapters: { forecast: { text: 'Gusts stay at 8 mph.', evidence: cite } },
  });
  const read = validateBriefing(briefing, report, 'CAUTION');
  expect(read).toMatchObject({ questions: ['When do the gusts build?'], hero: { headline: 'Light wind through the window' } });
  // Chapters belong to the other answer and are not read from this one.
  expect(read.chapters).toBeUndefined();
  expect(validateBriefing(JSON.stringify({ chapters: {} }), report, 'CAUTION')).toBeNull();

  const problems = [];
  const chapters = validateBriefChapters(JSON.stringify({ chapters: { forecast: { text: 'Gusts stay at 8 mph.', evidence: cite }, timing: { text: 'Gusts reach 99 mph.', evidence: cite } } }), report, 'CAUTION', { problems });
  expect(chapters).toEqual({ chapters: { forecast: { text: 'Gusts stay at 8 mph.', evidence: cite } }, satellite: null });
  expect(problems).toEqual(['timing chapter: states 99, which is not a number in the report']);
  // Nothing to show is a failed answer, with why.
  const empty = [];
  expect(validateBriefChapters(JSON.stringify({ sections: [] }), report, 'CAUTION', { problems: empty })).toBeNull();
  expect(empty).toEqual(['the answer had no "chapters" object']);
  const cut = [];
  expect(validateBriefChapters('{"chapters":{"forecast"', report, 'CAUTION', { problems: cut })).toBeNull();
  expect(cut).toEqual([expect.stringMatching(/^the chapters answer was not valid JSON \(\d+ characters/)]);
});
