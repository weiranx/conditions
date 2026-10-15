// The top of the report waits briefly for the AI's opening instead of showing
// the checks' wording and swapping it, but never leaves the headline blank for long.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { OPENING_WAIT_MS, useOpeningHold } from '../src/hooks/useOpeningHold';
import { SkyHero } from '../src/field/sky/SkyHero';
import { ApproachNote } from '../src/field/sky/ApproachNote';

async function mountHold(t, props) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // The page's timers are the test's mocked ones.
  dom.window.setTimeout = setTimeout;
  dom.window.clearTimeout = clearTimeout;
  let current;
  function Probe(input) { current = useOpeningHold(input); return null; }
  const root = createRoot(document.getElementById('root'));
  const render = (input) => act(async () => root.render(<Probe {...input} />));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  await render(props);
  return { get current() { return current; }, render };
}

test('the opening waits only while the AI is expected to write it', async t => {
  const h = await mountHold(t, { expected: false, key: 'report-a' });
  assert.deepEqual(h.current, { holding: false, expired: false });
  await h.render({ expected: true, key: 'report-a' });
  assert.deepEqual(h.current, { holding: true, expired: false });
  // The opening arrived (or the read failed): the hold ends at once.
  await h.render({ expected: false, key: 'report-a' });
  assert.deepEqual(h.current, { holding: false, expired: false });
});

test('a slow opening lets the checks\' wording through, once per report', async t => {
  const h = await mountHold(t, { expected: true, key: 'report-a' });
  await act(async () => t.mock.timers.tick(OPENING_WAIT_MS - 1));
  assert.equal(h.current.holding, true);
  await act(async () => t.mock.timers.tick(1));
  assert.deepEqual(h.current, { holding: false, expired: true });
  // The same report never blanks its headline again.
  await h.render({ expected: false, key: 'report-a' });
  await h.render({ expected: true, key: 'report-a' });
  assert.equal(h.current.holding, false);
  // A new report gets its own wait.
  await h.render({ expected: true, key: 'report-b' });
  assert.deepEqual(h.current, { holding: true, expired: false });
});

test('while the AI writes, the hero holds the shape of a headline instead of the checks\' wording', () => {
  const format = { temp: (f) => `${f}°F`, wind: (m) => `${m} mph`, clock: (m) => `${Math.floor(m / 60)}:00`, timeStyle: '24h' };
  const hero = (writing) => renderToStaticMarkup(<SkyHero hours={[]} sunrise={412} sunset={1170} kicker="Report" title="Test"
    subtitle="Wed" level="CAUTION" headline="Strong wind after noon" reason="Gusts reach 31 mph." writing={writing} format={format} />);
  const writing = hero(true);
  assert.match(writing, /<h2 id="field-verdict-title" class="is-writing"><span class="sr-only">AI is writing the opening<\/span><span class="sky-writing-line"/);
  assert.doesNotMatch(writing, /Strong wind after noon|Gusts reach 31 mph/);
  assert.match(writing, /Caution/, 'the decision badge still shows');
  const written = hero(false);
  assert.match(written, /<h2 id="field-verdict-title">Strong wind after noon<\/h2><p class="sky-lede">Gusts reach 31 mph\.<\/p>/);
});

test('the approach note under the opening waits for the AI too, instead of the template\'s wording', () => {
  const summary = { adjustedRuns: [], inversionRuns: [], adjustedHours: 3, lowFt: 9800, highFt: 11800 };
  const note = (props) => renderToStaticMarkup(<ApproachNote hours={[]} summary={summary} source="estimated"
    clock={(m) => `${m}`} elevation={(ft) => `${ft} ft`} onEdit={() => {}} {...props} />);
  const writing = note({ writing: true });
  assert.match(writing, /AI is writing this note/);
  assert.match(writing, /sky-writing-line/);
  assert.doesNotMatch(writing, /judged lower down|Set trailhead/);
  assert.match(note({}), /is judged lower down/);
  assert.match(note({ text: 'The morning is judged on the way up.' }), /The morning is judged on the way up\./);
});
