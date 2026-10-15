#!/usr/bin/env node
'use strict';

// Run locally for OAuth, then import the protected file on your personal server.
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
require('dotenv').config({ quiet: true });
const { createChatGPTService } = require('../src/auth/chatgpt');
const { ChatGPTStore } = require('../src/auth/chatgpt-store');

async function login(service, { newAccount = false, port = 1455, openBrowser = true } = {}) {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const redirectUri = `http://127.0.0.1:${server.address().port}/auth/callback`;
  let timer;
  try {
    const { attempt, url } = await service.begin({ redirectUri, newAccount });
    const completion = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Sign-in timed out. Run the command again.')), 10 * 60 * 1000);
      let handling = false;
      server.on('request', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        const callback = new URL(req.url, redirectUri);
        if (req.method !== 'GET' || callback.pathname !== '/auth/callback') { res.writeHead(404).end(); return; }
        // Ignore unrelated browser visits without consuming a valid pending login.
        if (callback.searchParams.get('state') !== attempt.state || handling) { res.writeHead(400).end('Invalid sign-in request.'); return; }
        handling = true;
        try {
          const result = await service.complete(attempt, callback);
          res.end(result.connected ? 'Connected to Conditions. You can close this tab.' : 'Signed in. Plan usage was not authorized; reconnect and approve plan usage to enable AI.');
          resolve(result);
        } catch (error) {
          res.writeHead(400).end('Sign-in could not be completed. Return to the terminal and try again.');
          reject(error);
        }
      });
    });
    console.log('Continue with ChatGPT. Open this URL on this computer:');
    console.log(url); // No ID-token hint is included in this URL.
    if (openBrowser) {
      const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
      const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
      const child = spawn(command, args, { stdio: 'ignore', detached: true });
      child.on('error', () => {});
      child.unref();
    }
    const result = await completion;
    console.log(result.connected ? `Connected ${result.email || 'your ChatGPT account'}.` : 'Connected identity only. Run login again and approve ChatGPT plan usage.');
    console.log(`Protected credential file: ${service.store.file}`);
    return result;
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main(args = process.argv.slice(2)) {
  const service = createChatGPTService();
  const [command, argument] = args;
  if (command === 'login') {
    return login(service, { newAccount: args.includes('--new-account'), openBrowser: !args.includes('--no-browser') });
  }
  if (command === 'init') {
    await service.store.update(() => {});
    console.log(`Initialized this host: ${service.store.file}`);
  } else if (command === 'import') {
    if (!argument) throw new Error('Provide the path to a transferred Conditions credentials.json file.');
    const source = new ChatGPTStore(path.dirname(path.resolve(argument)));
    if (path.basename(argument) !== 'credentials.json') throw new Error('Transfer the file as credentials.json in a private (0700) directory.');
    const value = source.read();
    const selected = value.registrations.find((record) => record.client_id === value.activeClientId);
    if (!selected?.access_token || !selected.refresh_token || !/^oaiapp_[A-Za-z0-9_-]+$/.test(selected.client_id || '')
      || selected.issuer !== 'https://auth.openai.com' || typeof selected.subject !== 'string'
      || !Array.isArray(selected.scopes) || !Number.isFinite(selected.expiresAt)) {
      throw new Error('No complete Conditions ChatGPT connection found. Complete local login first.');
    }
    await service.store.update((destination) => {
      // Import only the selected account. Never copy the laptop's host ID onto a VM.
      const existing = destination.registrations.findIndex((record) => record.client_id === selected.client_id);
      if (existing >= 0 && destination.registrations[existing].subject !== selected.subject) throw new Error('Account identity changed.');
      if (existing >= 0) destination.registrations[existing] = selected;
      else destination.registrations.push(selected);
      destination.activeClientId = selected.client_id;
    });
    console.log('Imported the selected account; preserved this server’s host ID. Stop using the source session so only the server refreshes it.');
  } else if (command === 'status') {
    console.log(JSON.stringify(service.status(), null, 2));
  } else if (command === 'use') {
    await service.store.update((value) => {
      if (!value.registrations.some((record) => record.client_id === argument)) throw new Error('Unknown saved account. Run status to see registered client IDs.');
      value.activeClientId = argument;
    });
    console.log('Selected saved ChatGPT account.');
  } else if (command === 'logout') {
    const result = await service.disconnect();
    console.log(result.revoked ? 'Disconnected ChatGPT.' : 'Disconnected locally. Remote revocation was not confirmed. Disconnect Conditions in ChatGPT settings.');
  } else {
    console.log('Usage: npm run chatgpt -- login [--new-account] [--no-browser] | init | import <credentials.json> | status | use <client-id> | logout');
  }
}

if (require.main === module) main().catch((error) => {
  // Never print fetch errors, provider responses or JWT-validation diagnostics.
  console.error(error?.name === 'ChatGPTError' ? error.message : 'ChatGPT setup failed. Check the command, file permissions, network access, and whether port 1455 is available.');
  process.exitCode = 1;
});

module.exports = { login, main };
