import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const cache = `${root}node_modules/.cache/field-ui-tests`;
await mkdir(cache, { recursive: true });
try {
  await build({
    entryPoints: [`${root}tests/field-report.test.jsx`, `${root}tests/report-comparisons.test.jsx`, `${root}tests/chat.test.jsx`, `${root}tests/objective-watches.test.jsx`],
    outdir: cache,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "import.meta.env": '{"DEV":true}' },
    plugins: [
      {
        name: "leaflet-coordinate-only",
        setup(build) {
          // Rendering report controls needs the default coordinate, not a browser map.
          build.onResolve({ filter: /^leaflet$/ }, () => ({
            path: "leaflet",
            namespace: "coordinates",
          }));
          build.onLoad({ filter: /.*/, namespace: "coordinates" }, () => ({
            contents:
              "export default { LatLng: class LatLng { constructor(lat,lng){this.lat=lat;this.lng=lng} } };",
            loader: "js",
          }));
        },
      },
    ],
  });
  const result = spawnSync(
    process.execPath,
    ["--test", `${cache}/field-report.test.mjs`, `${cache}/report-comparisons.test.mjs`, `${cache}/chat.test.mjs`, `${cache}/objective-watches.test.mjs`],
    { stdio: "inherit", cwd: root },
  );
  process.exitCode = result.status ?? 1;
} finally {
  await rm(cache, { recursive: true, force: true });
}
