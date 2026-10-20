import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiChapterNote, AiRead } from '../src/field/AiRead';
import { starterQuestions } from '../src/field/ai-explanation';
import { aiHero, isOutdatedRead, shownAiHero, evidenceChapter, evidenceLabel, evidenceLinks } from '../src/app/ai-evidence';
import { buildPersistedReport, parseAiBriefDetails, parsePersistedReport } from '../src/app/report-storage';
import { makeReport } from '../dev/mock-data.mjs';
import { ApproachNote } from '../src/field/sky/ApproachNote';
import { getDefaultUserPreferences, normalizeUserPreferences } from '../src/app/preferences';

const narrative = [
  'BIG PICTURE: Gusts reach 32 mph on the ridge by early afternoon.',
  'WHY IT MATTERS: Wind on the exposed ridge makes the scramble slower.',
  'WATCH CLOSELY: Watch for gusts building before noon.',
  'DATA CONFIDENCE: The avalanche bulletin is current.',
  'COMFORT CHECK: Cold at the start.',
  'BEST MOVE: Start at dawn and turn around by noon.',
].join('\n');
const details = {
  narrative,
  evidence: [
    { heading: 'BIG PICTURE', evidence: [{ path: 'weather.windGust', value: 32 }, { path: 'safety.score', value: 61 }] },
    { heading: 'WHY IT MATTERS', evidence: [{ path: 'weather.windGust', value: 32 }] },
    { heading: 'WATCH CLOSELY', evidence: [{ path: 'weather.forecast.3.windGust', value: 32 }] },
    { heading: 'DATA CONFIDENCE', evidence: [{ path: 'avalanche.dangerLevel', value: 2 }] },
    { heading: 'COMFORT CHECK', evidence: [{ path: 'weather.feelsLike', value: 20 }] },
    { heading: 'BEST MOVE', evidence: [{ path: 'solar.sunrise', value: '6:40 AM' }] },
  ],
  questions: ['When do the gusts build?', 'What would make this a go?'],
  validation: 'evidence_checked',
};
const props = {
  narrative, details, loading: false, error: null, briefAvailable: true, chatAvailable: true, readOnly: false,
  fallbackQuestions: ['What is driving this decision?'], onRequest() {}, onAsk() {}, onOpen() {},
};
const read = (overrides = {}) => renderToStaticMarkup(<AiRead {...props} {...overrides} />);

test('citations name the field in plain words and open the chapter that shows it', () => {
  assert.equal(evidenceLabel('weather.windGust'), 'Wind gust');
  assert.equal(evidenceLabel('weather.forecast.3.windGust'), 'Wind gust');
  assert.equal(evidenceLabel('avalanche.dangerLevel'), 'Avalanche danger level');
  assert.equal(evidenceLabel('safety.score'), 'Safety score');
  assert.equal(evidenceChapter('avalanche.problems.0.name'), 'terrain');
  assert.equal(evidenceChapter('solar.sunset'), 'timing');
  assert.equal(evidenceChapter('alerts.activeCount'), 'forecast');
  assert.equal(evidenceChapter('safety.score'), 'sources');
  assert.equal(evidenceChapter('mystery.value'), null);
  assert.deepEqual(evidenceLinks([{ path: 'weather.windGust', value: 1 }, { path: 'weather.forecast.0.windGust', value: 1 }, { path: 'mystery.value', value: 1 }]), [
    { label: 'Wind gust', chapter: 'forecast' },
    { label: 'Value', chapter: null },
  ]);
});

test('the AI read leads with the picture and the move, cites its evidence and offers its own questions', () => {
  const html = read();
  assert.match(html, /AI read[^]*What this means for your plan/);
  assert.match(html, /Big picture[^]*Gusts reach 32 mph[^]*Based on[^]*<button[^>]*>Wind gust<\/button>[^]*Best move[^]*Start at dawn/);
  assert.match(html, /<details class="ai-read-more">[^]*Why it matters[^]*Watch closely[^]*Data confidence[^]*Comfort check/);
  assert.match(html, /Suggested questions[^]*When do the gusts build\?[^]*What would make this a go\?/);
  assert.doesNotMatch(html, /What is driving this decision/, 'the read\'s own questions replace the starters');
  assert.match(html, /go\/no-go comes from the report’s checks/);
  assert.doesNotMatch(html, /didn’t pass the report’s fact checks/);
});

test('leading the report, the read is its big picture and best move; the rest and the ask wait under one line', () => {
  const html = read({ acrossReport: true });
  const fold = html.indexOf('<details class="ai-read-more ai-read-fold">');
  assert.ok(fold > 0, 'one fold holds the rest');
  const open = html.slice(0, fold);
  const folded = html.slice(fold);
  assert.match(open, /Big picture[^]*Gusts reach 32 mph[^]*Best move[^]*Start at dawn/);
  assert.match(open, /Rewrite/, 'the rewrite stays at hand');
  assert.doesNotMatch(open, /Why it matters|Watch closely|Ask anything|Suggested questions|can be wrong/);
  assert.match(folded, /<summary><span>Ask about this report<\/span>/);
  assert.match(folded, /Why it matters[^]*Watch closely[^]*Ask anything about this plan[^]*Suggested questions[^]*go\/no-go comes from the report’s checks/);
  assert.equal((html.match(/<details/g) || []).length, 1, 'no fold inside the fold');
  // Apart from the report, or before anything is written, the read is laid out in full.
  assert.doesNotMatch(read(), /ai-read-fold/);
  assert.doesNotMatch(read({ acrossReport: true, narrative: null, details: null }), /ai-read-fold/);
  // With the report's chat right below, asking is left to it.
  const withChat = read({ acrossReport: true, chatBelow: true });
  assert.match(withChat, /<summary><span>Why, what to watch, and how sure<\/span>/);
  assert.doesNotMatch(withChat, /Ask anything|Suggested questions/);
});

test('the AI read says when its text came from the checks rather than the model', () => {
  const html = read({ details: { ...details, evidence: [], questions: [], validation: 'deterministic_fallback' } });
  assert.match(html, /didn’t pass the report’s fact checks/);
  assert.doesNotMatch(html, /Based on/);
  assert.match(html, /What is driving this decision\?/, 'starter questions stand in');
});

test('the AI read waits, offers, or steps aside depending on what is available', () => {
  assert.match(read({ narrative: null, details: null, loading: true }), /AI is reading the report[^]*Writing the full read[^]*ai-explanation-skeleton/);
  assert.match(read({ narrative: null, details: null }), /Write the AI read/);
  const askOnly = read({ narrative: null, details: null, briefAvailable: false });
  assert.match(askOnly, /Ask about this plan/);
  assert.doesNotMatch(askOnly, /Write the AI read|go\/no-go comes from/);
  assert.equal(read({ narrative: null, details: null, briefAvailable: false, chatAvailable: false }), '');
  const saved = read({ readOnly: true });
  assert.match(saved, /Gusts reach 32 mph/);
  assert.doesNotMatch(saved, /Rewrite|Ask anything|Suggested questions/);
  assert.equal(read({ narrative: null, details: null, readOnly: true }), '');
  assert.match(read({ error: 'AI usage limit reached' }), /role="alert">AI usage limit reached/);
});

test('each chapter opens with the parts of the read that cite it', () => {
  const note = (chapter, extra = {}) => renderToStaticMarkup(
    <AiChapterNote narrative={narrative} details={details} chapter={chapter} onReadAll={() => {}} {...extra} />,
  );
  const weather = note('forecast');
  assert.match(weather, /AI analysis · weather[^]*Big picture[^]*Why it matters/);
  assert.doesNotMatch(weather, /Comfort check|Data confidence/);
  assert.match(note('terrain'), /Data confidence[^]*avalanche bulletin/);
  assert.match(note('gear'), /Best move[^]*Start at dawn/);
  assert.equal(note('route'), '');
  assert.equal(note('forecast', { details: { ...details, validation: 'deterministic_fallback' } }), '');
  assert.equal(note('forecast', { details: null }), '');
});

test('a chapter leads with the AI\'s own analysis of it when the read wrote one', () => {
  const withChapters = { ...details, chapters: { terrain: { text: 'Wind-loaded north aspects are the concern above the col.', evidence: [{ path: 'avalanche.dangerLevel', value: 2 }, { path: 'weather.windGust', value: 32 }] } } };
  const note = (chapter) => renderToStaticMarkup(
    <AiChapterNote narrative={narrative} details={withChapters} chapter={chapter} onReadAll={() => {}} onOpen={() => {}} />,
  );
  const terrain = note('terrain');
  assert.match(terrain, /AI analysis · terrain &amp; snow[^]*Wind-loaded north aspects/);
  assert.doesNotMatch(terrain, /Data confidence/, 'the chapter analysis replaces the read\'s excerpts');
  assert.match(terrain, /<span>Avalanche danger level<\/span>[^]*<button[^>]*>Wind gust<\/button>/, 'a citation of this chapter is plain text; another chapter\'s opens it');
  assert.match(note('forecast'), /Big picture/, 'chapters without an analysis keep the read\'s excerpts');
});

test('saved chapter analyses keep only the AI chapters and well-formed citations', () => {
  const saved = parseAiBriefDetails({ ...details, chapters: {
    timing: { text: 'Start early.', evidence: [{ path: 'solar.sunrise', value: '6:40 AM' }, { bad: true }] },
    route: { text: 'Not an AI chapter.', evidence: [] },
    terrain: { text: '', evidence: [] },
  } }, narrative);
  assert.deepEqual(saved.chapters, { timing: { text: 'Start early.', evidence: [{ path: 'solar.sunrise', value: '6:40 AM' }] } });
});

test('the AI opening shows only when it passed its checks against a decision no less strict', () => {
  const hero = { headline: 'Wind sets the pace today', reason: 'Gusts reach 8 mph on the ridge.', evidence: [{ path: 'weather.windGust', value: 8 }], level: 'CAUTION' };
  const with_ = (overrides) => ({ ...details, hero, ...overrides });
  assert.equal(aiHero(with_({}), 'CAUTION'), hero);
  assert.equal(aiHero(with_({}), 'GO'), hero);
  assert.equal(aiHero(with_({}), 'NO-GO'), null);
  assert.equal(aiHero(with_({ validation: 'deterministic_fallback' }), 'CAUTION'), null);
  assert.equal(aiHero(with_({ hero: { ...hero, level: undefined } }), 'CAUTION'), null);
  assert.equal(aiHero(with_({ hero: null }), 'CAUTION'), null);
  assert.equal(aiHero(null, 'GO'), null);
  const saved = parseAiBriefDetails({ ...details, hero: { ...hero, evidence: [{ path: 'weather.windGust', value: 8 }, { path: 3 }] } }, details.narrative);
  assert.deepEqual(saved.hero, hero);
  assert.equal(parseAiBriefDetails({ ...details, hero: { headline: 'x' } }, details.narrative).hero, null);
});

test('starter questions read as plain questions and never paste in a check sentence', () => {
  assert.deepEqual(starterQuestions('CAUTION'), [
    'What is driving this decision?',
    'What would have to change to make this a go?',
    'What should I check before I leave?',
  ]);
  assert.equal(starterQuestions('GO')[1], 'What would turn this into a no-go?');
});

test('saved AI read details belong only to the narrative they were written with', () => {
  assert.deepEqual(parseAiBriefDetails(details, narrative), { ...details, chapters: {} });
  assert.equal(parseAiBriefDetails({ ...details, hero: null }, narrative).hero, null);
  assert.equal(parseAiBriefDetails(details, 'another brief'), null);
  assert.equal(parseAiBriefDetails(null, narrative), null);
  const messy = parseAiBriefDetails({
    narrative,
    evidence: [{ heading: 'BIG PICTURE', evidence: [{ path: 'weather.windGust', value: 32 }, { path: 4 }, { path: 'x', value: {} }] }, 'junk'],
    questions: ['Fine?', 7, ''],
    validation: 'whatever',
  }, narrative);
  assert.deepEqual(messy, {
    narrative,
    evidence: [{ heading: 'BIG PICTURE', evidence: [{ path: 'weather.windGust', value: 32 }] }],
    questions: ['Fine?'],
    chapters: {},
    validation: null,
  });
});

test('the AI read is written automatically unless turned off', () => {
  assert.equal(getDefaultUserPreferences().autoAiRead, true);
  assert.equal(normalizeUserPreferences({}).autoAiRead, true);
  assert.equal(normalizeUserPreferences({ autoAiRead: false }).autoAiRead, false);
  assert.equal(normalizeUserPreferences({ autoAiRead: 'no' }).autoAiRead, true);
  assert.equal(getDefaultUserPreferences().aiEnabled, true);
  assert.equal(normalizeUserPreferences({}).aiEnabled, true, 'preferences saved before the switch keep AI on');
  assert.equal(normalizeUserPreferences({ aiEnabled: false }).aiEnabled, false);
});

test('the AI writes the approach note in place of the template, keeping the trailhead button', () => {
  const hours = [{ minute: 420 }, { minute: 480 }];
  const summary = { adjustedHours: 2, lowFt: 11487, highFt: 11600, adjustedRuns: [{ start: 0, end: 1 }], inversionRuns: [{ start: 0, end: 0 }] };
  const props = { hours, summary, source: 'estimated', clock: (m) => `${m / 60}:00`, elevation: (ft) => `${ft} ft`, onEdit: () => {} };
  const template = renderToStaticMarkup(<ApproachNote {...props} />);
  assert.match(template, /is judged lower down/);
  assert.match(template, /Clear, calm conditions/);
  const written = renderToStaticMarkup(<ApproachNote {...props} text="Your first two hours are judged on the way up, near 11,500 ft." />);
  assert.match(written, /Your first two hours are judged on the way up/);
  assert.doesNotMatch(written, /is judged lower down|Clear, calm conditions/);
  assert.match(written, /Set trailhead/);
  const saved = parseAiBriefDetails({ ...details, hero: { headline: 'Wind sets the pace', reason: 'Gusts build.', evidence: [], level: 'CAUTION', note: { text: 'Judged lower down.', evidence: [{ path: 'approach.lowestFt', value: 11487 }, { bad: 1 }] } } }, details.narrative);
  assert.deepEqual(saved.hero.note, { text: 'Judged lower down.', evidence: [{ path: 'approach.lowestFt', value: 11487 }] });
});

test('a read saved before the AI wrote the opening is outdated; one whose opening failed is not', () => {
  assert.equal(isOutdatedRead(null, null), false);
  assert.equal(isOutdatedRead(details.narrative, null), true);
  assert.equal(isOutdatedRead(details.narrative, parseAiBriefDetails(details, details.narrative)), true);
  assert.equal(isOutdatedRead(details.narrative, { ...details, hero: null }), false);
  assert.equal(isOutdatedRead(details.narrative, { ...details, hero: { headline: 'h', reason: 'r', evidence: [] } }), false);
});

test('the AI read shows what the fact checks rejected, and saved reads keep it', () => {
  const checks = { attempts: 2, problems: ['OPENING: states 30 without citing a report field that holds it', 'first answer: the answer was not valid JSON'] };
  const html = read({ details: { ...details, checks } });
  assert.match(html, /Fact-check details · 2 issues across 2 AI answers/);
  assert.match(html, /OPENING: states 30 without citing/);
  assert.doesNotMatch(read(), /Fact-check details/);
  assert.deepEqual(parseAiBriefDetails({ ...details, checks: { attempts: 2, problems: ['a', 3] } }, details.narrative).checks, { attempts: 2, problems: ['a'] });
  // How long the AI took shows even when every check passed.
  assert.match(read({ details: { ...details, checks: { attempts: 1, problems: [], seconds: [23.6] } } }), /Fact-check details · all passed · took 24 s/);
  assert.deepEqual(parseAiBriefDetails({ ...details, checks: { attempts: 1, problems: [], seconds: [12.5, 'x'] } }, details.narrative).checks, { attempts: 1, problems: [], seconds: [12.5] });
});

test('while the AI writes, the read says what it is doing and what it has done', () => {
  const run = { startedAt: Date.now(), opening: 'pending', hero: null, openingSeconds: null, seconds: null };
  const pending = read({ narrative: null, details: null, loading: true, run });
  // The full read waits its turn until the opening is written.
  assert.match(pending, /<li class="is-active">[^]*Rewriting the opening[^]*<li class="is-next">[^]*Then the full read/);
  const written = read({ narrative: null, details: null, loading: true, run: { ...run, opening: 'written', openingSeconds: 3 } });
  assert.match(written, /<li class="is-done">[^]*Rewrote the opening in 3 s[^]*<li class="is-active">[^]*Writing the full read/);
  assert.match(read({ narrative: null, details: null, loading: true, run: { ...run, opening: 'kept' } }), /<li class="is-kept">[^]*The quick opening didn’t pass its checks; the full read writes it/);
  assert.doesNotMatch(read({ narrative: null, details: null, loading: true, run: { ...run, opening: 'off' } }), /opening/);
  // A rewrite keeps the old read on screen, marked stale, under the progress.
  assert.match(read({ loading: true, run }), /ai-read-progress[^]*ai-read-body is-stale[^]*Gusts reach 32 mph/);
});

test('a written read says where the AI changed the report, each place one tap away', () => {
  const chapters = { forecast: { text: 'Wind builds.', evidence: [] }, terrain: { text: 'Firm snow.', evidence: [] } };
  const run = { startedAt: 0, opening: 'written', hero: null, openingSeconds: 3, seconds: 9 };
  const html = read({ details: { ...details, chapters }, acrossReport: true, openingRewritten: true, run });
  assert.match(html, /ai-read-changes[^]*Written in 9 s\. Rewrote the report’s opening and added notes to[^]*<button[^>]*>Weather<\/button>[^]*<button[^>]*>Terrain &amp; snow<\/button>/);
  assert.match(read({ details: { ...details, chapters }, acrossReport: true }), /ai-read-changes[^]*Added notes to/);
  assert.match(read({ acrossReport: true, openingRewritten: true }), /Rewrote the report’s opening\./);
  assert.doesNotMatch(read({ details: { ...details, chapters }, openingRewritten: true }), /ai-read-changes/, 'not when the read sits apart from the report');
  assert.doesNotMatch(read({ details: { ...details, validation: 'deterministic_fallback' }, acrossReport: true, openingRewritten: true }), /ai-read-changes/);
  assert.doesNotMatch(read({ details: { ...details, chapters }, acrossReport: true, loading: true, run }), /ai-read-changes/, 'not while a rewrite is under way');
});

test('the opening a read in progress just wrote leads, beside a decision no stricter', () => {
  const hero = { headline: 'Wind sets the pace today', reason: 'Gusts reach 8 mph on the ridge.', evidence: [], level: 'CAUTION' };
  const fresh = { ...hero, headline: 'A fresh opening from the fast model' };
  const run = { startedAt: 0, opening: 'written', hero: fresh, openingSeconds: 2, seconds: null };
  assert.equal(shownAiHero(run, { ...details, hero }, 'CAUTION'), fresh);
  assert.equal(shownAiHero({ ...run, hero: null }, { ...details, hero }, 'CAUTION'), hero);
  assert.equal(shownAiHero(null, { ...details, hero }, 'CAUTION'), hero);
  assert.equal(shownAiHero(run, null, 'NO-GO'), null);
});

const satellite = {
  text: 'The image from October 8, six days before the trip, shows continuous snow above treeline and bare slopes lower down.',
  evidence: [{ path: 'satelliteImage.acquiredDate', value: '2026-10-08' }],
  image: 'data:image/png;base64,AA==',
  imagery: { acquiredAt: '2026-10-08T18:40:12Z', cloudCover: 4 },
};

test('where snow shapes the trip, the AI read shows the satellite image it looked at, with its date and what it saw', () => {
  const html = read({ details: { ...details, satellite } });
  assert.match(html, /Best move[^]*ai-read-snow[^]*<img class="ai-read-snow-image" src="data:image\/png;base64,AA=="[^>]*alt="[^"]*taken Oct 8, 2026[^]*Satellite snow cover[^]*Imaged <strong>Oct 8, 2026[^]*4% cloud[^]*continuous snow above treeline[^]*Based on[^]*Satellite image date[^]*ai-read-more/);
  assert.match(read({ details: { ...details, satellite: { ...satellite, text: null, evidence: [] } } }), /ai-read-snow[^]*didn’t pass the report’s fact checks, so only the image is shown/);
  assert.doesNotMatch(read(), /ai-read-snow/, 'no image when snow does not shape the trip');
});

test('while the AI writes a read where snow matters, it says it is looking at satellite imagery', () => {
  const run = { startedAt: Date.now(), opening: 'off', hero: null, openingSeconds: null, seconds: null };
  assert.match(read({ narrative: null, details: null, loading: true, run, readsSatellite: true }), /<li class="is-active">[^]*Looking at a recent satellite image of the snow[^]*<li class="is-active">[^]*Writing the full read/);
  assert.doesNotMatch(read({ narrative: null, details: null, loading: true, run }), /satellite/);
});

test('a saved read keeps the satellite image it looked at, and drops a malformed one', () => {
  assert.deepEqual(parseAiBriefDetails({ ...details, satellite }, narrative).satellite, satellite);
  assert.equal(parseAiBriefDetails({ ...details, satellite: { ...satellite, image: 'https://example.com/x.png' } }, narrative).satellite, undefined);
  assert.equal(parseAiBriefDetails(details, narrative).satellite, undefined);
  assert.deepEqual(parseAiBriefDetails({ ...details, satellite: { image: satellite.image, imagery: { acquiredAt: 'nope' } } }, narrative).satellite,
    { text: null, evidence: [], image: satellite.image, imagery: { acquiredAt: null, cloudCover: null } });
  assert.equal(evidenceLabel('satelliteImage.acquiredDate'), 'Satellite image date');
  assert.equal(evidenceChapter('satelliteImage.acquiredDate'), null);
});

test('a saved report keeps the date of the satellite pass its snow analysis read', () => {
  const snowText = 'SNOW COVERAGE: About 70% snow above 9,000 ft. TRAVEL TAKEAWAY: Carry traction above treeline.';
  const plan = { lat: 46.85, lon: -121.76, forecastDate: '2026-10-14', alpineStartTime: '07:00', travelWindowHours: 10, objectiveName: 'Rainier', searchQuery: '', targetElevationInput: '' };
  const data = makeReport({ lat: plan.lat, lon: plan.lon, date: plan.forecastDate, start: plan.alpineStartTime, travel_window_hours: 10 }, 'clear');
  const ai = { aiBriefNarrative: null, snowVisionAnalysis: snowText, snowVisionImage: null, reportChatMessages: [] };
  const roundTrip = (fields) => parsePersistedReport(JSON.parse(JSON.stringify(buildPersistedReport(plan, data, { ...ai, ...fields })))).ai.snowVisionImagery;
  assert.deepEqual(roundTrip({ snowVisionImagery: { acquiredAt: '2026-10-03T18:40:00Z', cloudCover: 4 } }), { acquiredAt: '2026-10-03T18:40:00Z', cloudCover: 4 });
  assert.equal(roundTrip({}), null, 'older saves have no date');
  assert.deepEqual(roundTrip({ snowVisionImagery: { acquiredAt: 'not a date', cloudCover: 'x' } }), { acquiredAt: null, cloudCover: null });
  assert.equal(roundTrip({ snowVisionAnalysis: null, snowVisionImagery: { acquiredAt: '2026-10-03T18:40:00Z' } }), null, 'no analysis, no date');
});
