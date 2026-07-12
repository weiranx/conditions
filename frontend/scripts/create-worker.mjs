import { mkdir, writeFile } from 'node:fs/promises';

const worker = `function isDocumentRequest(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;

  const fetchMode = request.headers.get('sec-fetch-mode');
  const accept = request.headers.get('accept') || '';
  return fetchMode === 'navigate' || accept.includes('text/html');
}

export default {
  async fetch(request, env) {
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404) return assetResponse;

    if (isDocumentRequest(request)) {
      return env.ASSETS.fetch(new Request(new URL('/', request.url), request));
    }

    return assetResponse;
  },
};
`;

await mkdir('dist/server', { recursive: true });
await writeFile('dist/server/index.js', worker);
