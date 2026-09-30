import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AccountContext } from '../src/contexts/account';
import { Account } from '../src/field/Account';
import { getDefaultUserPreferences } from '../src/app/preferences';

async function mountSignedOut(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://conditions.example/planner' });
  const old = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const account = { user: null, available: true, google: { available: false }, loading: false, busy: false };
  const workspace = { preferences: getDefaultUserPreferences(), initialAccountLinkAction: null, guestReportCount: 0, closeAccountAccessPrompt() {} };
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(<AccountContext.Provider value={account}><Account workspace={workspace} /></AccountContext.Provider>));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, old);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  const card = () => document.querySelector('.sky-auth-card');
  const press = (label) => act(async () => [...card().querySelectorAll('button')].find((button) => button.textContent.trim() === label).click());
  return { card, press };
}

// The sign-in dialog shows the card's heading only when the dialog's own "Sign in to continue" title
// stops describing the form. Reset has no Sign in / Create account switch, so the heading is all that names it.
test('the account card names its form and says which mode it is in', async (t) => {
  const { card, press } = await mountSignedOut(t);
  assert.equal(card().dataset.mode, 'signin');
  assert.equal(card().querySelector('h2').textContent, 'Sign in to your account');

  await press('Create account');
  assert.equal(card().dataset.mode, 'create');
  assert.equal(card().querySelector('h2').textContent, 'Create your account');

  await press('Sign in');
  await press('Forgot your password?');
  assert.equal(card().dataset.mode, 'forgot');
  assert.equal(card().querySelector('h2').textContent, 'Reset your password');
  assert.equal(card().querySelector('.sky-auth-modes'), null, 'a reset has no Sign in / Create account switch to name it');
});

test('the sign-in dialog hides the card heading only where it repeats the dialog title', () => {
  const css = readFileSync(path.resolve('src/field/account.css'), 'utf8');
  const hidden = [...css.matchAll(/([^{}]*\.field-dialog[^{}]*h2[^{}]*)\{([^}]*)\}/g)]
    .filter(([, , rules]) => /display:\s*none/.test(rules))
    .map(([, selector]) => selector.trim());
  assert.deepEqual(hidden, ['.field-dialog .sky-auth-card[data-mode="signin"] > h2']);
});
