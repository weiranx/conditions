import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeJsonBody, encodeJsonText, fetchWithEncodedBody } from '../src/lib/api-client';

const gunzip = async (body) => new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
const report = { decisionLevel: 'CAUTION', report: { weather: { description: 'x'.repeat(20000), windGust: 30 } } };

test('a report body is gzipped where the runtime can, and reads back the same', async () => {
  const { body, headers } = await encodeJsonText(JSON.stringify(report));
  assert.deepEqual(headers, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' });
  assert.ok(body instanceof ArrayBuffer);
  assert.ok(body.byteLength < JSON.stringify(report).length / 10, 'repeated report text compresses well');
  assert.deepEqual(JSON.parse(await gunzip(body)), report);
});

test('without CompressionStream the body is plain JSON', async t => {
  const original = globalThis.CompressionStream;
  t.after(() => { globalThis.CompressionStream = original; });
  globalThis.CompressionStream = undefined;
  assert.deepEqual(await encodeJsonText('{"a":1}'), { body: '{"a":1}', headers: { 'Content-Type': 'application/json' } });
});

test('when gzipping fails the body is sent plain', async t => {
  const original = globalThis.CompressionStream;
  t.after(() => { globalThis.CompressionStream = original; });
  globalThis.CompressionStream = class { constructor() { throw new Error('unsupported'); } };
  assert.deepEqual(await encodeJsonText('{"a":1}'), { body: '{"a":1}', headers: { 'Content-Type': 'application/json' } });
});

test('the same request is encoded once for the opening and the full read', async () => {
  const first = encodeJsonBody(report);
  assert.equal(encodeJsonBody(report), first);
  assert.notEqual(encodeJsonBody({ ...report }), first);
  assert.deepEqual(JSON.parse(await gunzip((await first).body)), report);
});

test('the chat fetch gzips a JSON string body and keeps its other headers', async t => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  const sent = [];
  globalThis.fetch = async (input, init) => { sent.push({ input, init }); return new Response('{}'); };
  await fetchWithEncodedBody('/api/report-chat', { method: 'POST', body: JSON.stringify(report), headers: { 'Content-Type': 'application/json', 'X-Test': '1' }, credentials: 'include' });
  const headers = new Headers(sent[0].init.headers);
  assert.equal(headers.get('Content-Encoding'), 'gzip');
  assert.equal(headers.get('Content-Type'), 'application/json');
  assert.equal(headers.get('X-Test'), '1');
  assert.equal(sent[0].init.credentials, 'include');
  assert.deepEqual(JSON.parse(await gunzip(sent[0].init.body)), report);
  // Anything but a string body goes as it is.
  const form = new FormData();
  await fetchWithEncodedBody('/api/upload', { method: 'POST', body: form });
  assert.equal(sent[1].init.body, form);
});
