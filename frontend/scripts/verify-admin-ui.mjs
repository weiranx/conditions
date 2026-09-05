import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const cache = `${root}node_modules/.cache/admin-ui-tests`;
await mkdir(cache, { recursive: true });
try {
  await build({
    entryPoints: [`${root}tests/admin.test.jsx`],
    outfile: `${cache}/admin.test.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    jsx: "automatic",
    loader: { ".css": "empty" },
    plugins: [
      {
        name: "leaflet-coordinate-only",
        setup(build) {
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
    define: { "import.meta.env": '{"DEV":true}' },
  });
  const result = spawnSync(
    process.execPath,
    ["--test", `${cache}/admin.test.mjs`],
    { stdio: "inherit", cwd: root },
  );
  process.exitCode = result.status ?? 1;
} finally {
  await rm(cache, { recursive: true, force: true });
}
