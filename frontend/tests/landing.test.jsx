import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import Landing from '../src/field/Landing';
import { LANDING_SEEN_KEY, shouldShowLanding } from '../src/app/landing-gate';

async function mount(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://conditions.example/welcome' });
  const old = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(<Landing />));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, old);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
}

test('landing page leads into the planner', async (t) => {
  await mount(t);
  assert.match(document.querySelector('h1').textContent, /Know the mountain/);
  assert.match(document.title, /Backcountry Conditions/);
  const start = [...document.querySelectorAll('a')].find((a) => a.textContent.includes('Start planning'));
  assert.equal(start.getAttribute('href'), '/');
});

test('quick starts open the planner with an objective', async (t) => {
  await mount(t);
  const rainier = [...document.querySelectorAll('.landing-quick a')].find((a) => a.textContent === 'Mount Rainier');
  const url = new URL(rainier.getAttribute('href'), 'https://conditions.example');
  assert.equal(url.pathname, '/planner');
  assert.equal(url.searchParams.get('name'), 'Mount Rainier');
  assert.equal(Number(url.searchParams.get('lat')), 46.8523);
});

test('landing page keeps the planning-aid disclaimer', async (t) => {
  await mount(t);
  assert.match(document.body.textContent, /planning aid, not a guarantee/);
});

const at = (pathname, search = '', hash = '') => ({ pathname, search, hash });
const storageWith = (entries = {}) => ({ getItem: (key) => (key in entries ? entries[key] : null) });

test('first-time visitors to / see the landing page', () => {
  assert.equal(shouldShowLanding(at('/'), storageWith()), true);
  assert.equal(shouldShowLanding(at('/welcome'), storageWith({ [LANDING_SEEN_KEY]: '1' })), true);
  assert.equal(shouldShowLanding(at('/welcome/'), null), true);
});

test('returning visitors and links go straight to the planner', () => {
  assert.equal(shouldShowLanding(at('/'), storageWith({ [LANDING_SEEN_KEY]: '1' })), false);
  assert.equal(shouldShowLanding(at('/'), storageWith({ 'summitsafe:user-preferences:v1': '{}' })), false);
  assert.equal(shouldShowLanding(at('/'), storageWith({ 'summitsafe:persisted-report:v1': '{}' })), false);
  assert.equal(shouldShowLanding(at('/'), storageWith({ 'summitsafe:guest-report-count:v1': '1' })), false);
  assert.equal(shouldShowLanding(at('/', '?lat=46.85&lon=-121.76'), storageWith()), false);
  assert.equal(shouldShowLanding(at('/', '', '#conditions'), storageWith()), false);
  assert.equal(shouldShowLanding(at('/planner'), storageWith()), false);
  assert.equal(shouldShowLanding(at('/report/abcdefghijklmnopqrstuv'), storageWith()), false);
});

test('unreadable storage never traps a visitor on the landing page', () => {
  assert.equal(shouldShowLanding(at('/'), null), false);
  assert.equal(shouldShowLanding(at('/'), { getItem: () => { throw new Error('blocked'); } }), false);
});

test('viewing the landing page remembers the visit', async (t) => {
  await mount(t);
  assert.equal(window.localStorage.getItem(LANDING_SEEN_KEY), '1');
});
