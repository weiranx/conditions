// Bundles and runs frontend/tests/*.test.jsx with node:test.
// With no arguments every test file runs, so new files are never skipped.
// Pass name fragments (e.g. `admin`) to run a subset.
// A test file whose first line is `// @env production` is built with
// import.meta.env.DEV=false; all others build with DEV=true.
import { build } from "esbuild";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const testsDir = `${root}tests/`;
const cache = `${root}node_modules/.cache/ui-tests`;

const filters = process.argv.slice(2);
const files = (await readdir(testsDir))
  .filter((name) => name.endsWith(".test.jsx"))
  .filter((name) => filters.length === 0 || filters.some((f) => name.includes(f)))
  .sort();

if (files.length === 0) {
  console.error(`No UI test files matched: ${filters.join(", ") || "(all)"}`);
  process.exit(1);
}

const leafletCoordinateOnly = {
  name: "leaflet-coordinate-only",
  setup(build) {
    // Rendering report controls needs the default coordinate, not a browser map.
    build.onResolve({ filter: /^leaflet$/ }, () => ({ path: "leaflet", namespace: "coordinates" }));
    build.onLoad({ filter: /.*/, namespace: "coordinates" }, () => ({
      contents:
        "export default { LatLng: class LatLng { constructor(lat,lng){this.lat=lat;this.lng=lng} }, divIcon: (options) => options };",
      loader: "js",
    }));
    // Maps are loaded lazily and never drawn under node, but bundling them would
    // load the real Leaflet, which needs a browser window.
    build.onResolve({ filter: /^react-leaflet$/ }, () => ({ path: "react-leaflet", namespace: "no-map" }));
    build.onLoad({ filter: /.*/, namespace: "no-map" }, () => ({
      contents: [
        "const none = () => null;",
        "export const MapContainer = none, TileLayer = none, Marker = none, Polyline = none, ScaleControl = none, Tooltip = none;",
        "export const useMap = () => ({}), useMapEvents = () => ({});",
      ].join("\n"),
      loader: "js",
    }));
  },
};

await mkdir(cache, { recursive: true });
try {
  const outputs = [];
  for (const name of files) {
    const source = await readFile(`${testsDir}${name}`, "utf8");
    const dev = !source.startsWith("// @env production");
    const outfile = `${cache}/${name.replace(/\.jsx$/, ".mjs")}`;
    await build({
      entryPoints: [`${testsDir}${name}`],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      jsx: "automatic",
      loader: { ".css": "empty" },
      define: { "import.meta.env": JSON.stringify({ DEV: dev }) },
      plugins: [leafletCoordinateOnly],
    });
    outputs.push(outfile);
  }
  const result = spawnSync(process.execPath, ["--test", ...outputs], { stdio: "inherit", cwd: root });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(cache, { recursive: true, force: true });
}
