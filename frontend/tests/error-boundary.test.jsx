import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

function Boom() {
  throw new Error('boom');
}

test('a crash shows the recovery screen with a way to reload', async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://conditions.example/planner' });
  const old = { window: globalThis.window, document: globalThis.document, error: console.error };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // React and the boundary both log the error they catch.
  console.error = () => {};
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    console.error = old.error;
    Object.assign(globalThis, { window: old.window, document: old.document });
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  await act(async () => root.render(<ErrorBoundary><Boom /></ErrorBoundary>));

  const screen = document.querySelector('main[role="alert"]');
  assert.ok(screen, 'the crash is announced, not left blank');
  assert.equal(screen.querySelector('h1').textContent, 'Something went wrong');
  assert.match(screen.textContent, /Refreshing the page usually resolves this/);
  assert.equal(screen.querySelector('button').textContent, 'Reload now');
});

// The screens' stylesheets load with the lazily imported app, so a screen that fails to load must
// still be styled by what the entry bundle carries. The classes were once left without any rules
// when the legacy UI's stylesheets were deleted, which left the crash screen as bare browser type.
test('every class the crash screen uses is styled by its own stylesheet', () => {
  const source = readFileSync(path.resolve('src/components/ErrorBoundary.tsx'), 'utf8');
  const css = readFileSync(path.resolve('src/components/error-boundary.css'), 'utf8');
  assert.match(source, /import ['"]\.\/error-boundary\.css['"]/, 'the component imports its stylesheet');
  const classes = new Set((source.match(/app-error-boundary[\w-]*/g) ?? []).filter((name) => name !== 'app-error-boundary-title'));
  assert.ok(classes.size >= 5, 'the boundary, card, icon, eyebrow and copy classes');
  for (const name of classes) assert.ok(css.includes(`.${name}`), `.${name} has rules`);
  assert.ok(css.includes('.is-recovering'), 'the reconnecting state is styled');
  assert.doesNotMatch(css, /var\(--(?:sky|f)-/, 'the palette is its own: the screens\' tokens may not have loaded');
});
