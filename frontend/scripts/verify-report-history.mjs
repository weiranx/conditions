import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const cache = `${root}node_modules/.cache/report-history-tests`;
await mkdir(cache, { recursive: true });
try {
  await build({
    entryPoints: [`${root}tests/report-history.test.jsx`],
    outdir: cache, outExtension: { '.js': '.mjs' }, bundle: true,
    platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic',
    plugins: [{
      name: 'leaflet-coordinate-only',
      setup(build) {
        build.onResolve({ filter: /^leaflet$/ }, () => ({ path: 'leaflet', namespace: 'coordinates' }));
        build.onLoad({ filter: /.*/, namespace: 'coordinates' }, () => ({
          contents: 'export default { LatLng: class LatLng { constructor(lat,lng){this.lat=lat;this.lng=lng} } };', loader: 'js',
        }));
      },
    }],
    loader: { '.css': 'empty' }, define: { 'import.meta.env': '{"DEV":false}' },
  });
  const result = spawnSync(process.execPath, ['--test', `${cache}/report-history.test.mjs`], { stdio: 'inherit', cwd: root });
  process.exitCode = result.status ?? 1;
} finally { await rm(cache, { recursive: true, force: true }); }
