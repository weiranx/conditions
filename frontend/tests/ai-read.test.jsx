import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiChapterNote, AiRead } from '../src/field/AiRead';
import { starterQuestions } from '../src/field/ai-explanation';
import { evidenceChapter, evidenceLabel, evidenceLinks } from '../src/app/ai-evidence';
import { parseAiBriefDetails } from '../src/app/report-storage';
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

test('the AI read says when its text came from the checks rather than the model', () => {
  const html = read({ details: { ...details, evidence: [], questions: [], validation: 'deterministic_fallback' } });
  assert.match(html, /didn’t pass the report’s fact checks/);
  assert.doesNotMatch(html, /Based on/);
  assert.match(html, /What is driving this decision\?/, 'starter questions stand in');
});

test('the AI read waits, offers, or steps aside depending on what is available', () => {
  assert.match(read({ narrative: null, details: null, loading: true }), /Reading the report…[^]*ai-explanation-skeleton/);
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

test('starter questions name the check that sets the decision', () => {
  assert.deepEqual(starterQuestions(['Wind gusts over your limit'], 'CAUTION'), [
    'Why does wind gusts over your limit set the decision?',
    'What would have to change to make this a go?',
    'What should I check before I leave?',
  ]);
  assert.equal(starterQuestions([], 'GO')[0], 'What is driving this decision?');
  assert.equal(starterQuestions([], 'GO')[1], 'What would turn this into a no-go?');
});

test('saved AI read details belong only to the narrative they were written with', () => {
  assert.deepEqual(parseAiBriefDetails(details, narrative), { ...details, chapters: {} });
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
});
