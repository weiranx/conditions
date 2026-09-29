#!/usr/bin/env node
// Builds backend/regions.json: national forests and parks with a simplified boundary
// (OpenStreetMap via Nominatim) and a lead image (Wikipedia/Commons). A place with no
// photo of its own falls back to the region that contains it.
// Run manually: node scripts/fetch-region-images.mjs
import { writeFile } from 'node:fs/promises';

const OUT_PATH = new URL('../backend/regions.json', import.meta.url);
const HEADERS = { 'User-Agent': 'backcountry-conditions/1.0 (weiranxiong@gmail.com)' };
const THUMB_WIDTH = 640;
const SIMPLIFY_DEGREES = 0.004;
const MIN_RING_AREA = 0.0004; // square degrees; drops slivers and tiny exclaves

// name: what the report calls it; search: Nominatim query; wikipedia: article whose lead image is used.
const REGIONS = [
  { name: 'Inyo National Forest', search: 'Inyo National Forest', wikipedia: 'Inyo National Forest' },
  { name: 'Sierra National Forest', search: 'Sierra National Forest', wikipedia: 'Sierra National Forest' },
  { name: 'Sequoia National Forest', search: 'Sequoia National Forest', wikipedia: 'Sequoia National Forest' },
  { name: 'Eldorado National Forest', search: 'Eldorado National Forest', wikipedia: 'Eldorado National Forest' },
  { name: 'Mount Rainier National Park', search: 'Mount Rainier National Park', wikipedia: 'Mount Rainier National Park' },
  { name: 'North Cascades National Park', search: 'North Cascades National Park', wikipedia: 'North Cascades National Park' },
  { name: 'Olympic National Park', search: 'Olympic National Park', wikipedia: 'Olympic National Park' },
  { name: 'Yosemite National Park', search: 'Yosemite National Park', wikipedia: 'Yosemite National Park' },
  { name: 'Sequoia National Park', search: 'Sequoia National Park', wikipedia: 'Sequoia National Park' },
  { name: 'Kings Canyon National Park', search: 'Kings Canyon National Park', wikipedia: 'Kings Canyon National Park' },
  { name: 'Grand Teton National Park', search: 'Grand Teton National Park', wikipedia: 'Grand Teton National Park' },
  { name: 'Rocky Mountain National Park', search: 'Rocky Mountain National Park', wikipedia: 'Rocky Mountain National Park' },
  { name: 'Glacier National Park', search: 'Glacier National Park Montana', wikipedia: 'Glacier National Park (U.S.)' },
  { name: 'Mount Hood National Forest', search: 'Mount Hood National Forest', wikipedia: 'Mount Hood National Forest' },
  { name: 'White Mountain National Forest', search: 'White Mountain National Forest', wikipedia: 'White Mountain National Forest' },
  { name: 'Uinta-Wasatch-Cache National Forest', search: 'Uinta-Wasatch-Cache National Forest', wikipedia: 'Uinta-Wasatch-Cache National Forest' },
  { name: 'San Bernardino National Forest', search: 'San Bernardino National Forest', wikipedia: 'San Bernardino National Forest' },
  { name: 'John Muir Wilderness', search: 'John Muir Wilderness', wikipedia: 'John Muir Wilderness' },
  { name: 'Ansel Adams Wilderness', search: 'Ansel Adams Wilderness', wikipedia: 'Ansel Adams Wilderness' },
  { name: 'Hoover Wilderness', search: 'Hoover Wilderness', wikipedia: 'Hoover Wilderness' },
  { name: 'Emigrant Wilderness', search: 'Emigrant Wilderness', wikipedia: 'Emigrant Wilderness' },
  { name: 'Desolation Wilderness', search: 'Desolation Wilderness', wikipedia: 'Desolation Wilderness' },
  { name: 'Lassen Volcanic National Park', search: 'Lassen Volcanic National Park', wikipedia: 'Lassen Volcanic National Park' },
  { name: 'Stanislaus National Forest', search: 'Stanislaus National Forest', wikipedia: 'Stanislaus National Forest' },
  { name: 'Tahoe National Forest', search: 'Tahoe National Forest', wikipedia: 'Tahoe National Forest' },
  { name: 'Humboldt-Toiyabe National Forest', search: 'Humboldt-Toiyabe National Forest', wikipedia: 'Humboldt-Toiyabe National Forest' },
  { name: 'Shasta-Trinity National Forest', search: 'Shasta-Trinity National Forest', wikipedia: 'Shasta-Trinity National Forest' },
  { name: 'Mount Baker-Snoqualmie National Forest', search: 'Mount Baker-Snoqualmie National Forest', wikipedia: 'Mount Baker-Snoqualmie National Forest' },
  { name: 'Okanogan-Wenatchee National Forest', search: 'Okanogan-Wenatchee National Forest', wikipedia: 'Okanogan-Wenatchee National Forest' },
  { name: 'Gifford Pinchot National Forest', search: 'Gifford Pinchot National Forest', wikipedia: 'Gifford Pinchot National Forest' },
  { name: 'Deschutes National Forest', search: 'Deschutes National Forest', wikipedia: 'Deschutes National Forest' },
  { name: 'Willamette National Forest', search: 'Willamette National Forest', wikipedia: 'Willamette National Forest' },
  { name: 'Crater Lake National Park', search: 'Crater Lake National Park', wikipedia: 'Crater Lake National Park' },
  { name: 'Denali National Park', search: 'Denali National Park and Preserve', wikipedia: 'Denali National Park and Preserve' },
  { name: 'Bridger-Teton National Forest', search: 'Bridger-Teton National Forest', wikipedia: 'Bridger-Teton National Forest' },
  { name: 'Shoshone National Forest', search: 'Shoshone National Forest', wikipedia: 'Shoshone National Forest' },
  { name: 'Sawtooth National Forest', search: 'Sawtooth National Forest', wikipedia: 'Sawtooth National Forest' },
  { name: 'White River National Forest', search: 'White River National Forest', wikipedia: 'White River National Forest' },
  { name: 'San Juan National Forest', search: 'San Juan National Forest', wikipedia: 'San Juan National Forest' },
  { name: 'Uncompahgre National Forest', search: 'Uncompahgre National Forest', wikipedia: 'Uncompahgre National Forest' },
  { name: 'Arapaho and Roosevelt National Forests', search: 'Arapaho National Forest', wikipedia: 'Arapaho National Forest' },
  { name: 'Manti-La Sal National Forest', search: 'Manti-La Sal National Forest', wikipedia: 'Manti-La Sal National Forest' },
  { name: 'Coconino National Forest', search: 'Coconino National Forest', wikipedia: 'Coconino National Forest' },
  { name: 'Great Smoky Mountains National Park', search: 'Great Smoky Mountains National Park', wikipedia: 'Great Smoky Mountains National Park' },
  { name: 'Acadia National Park', search: 'Acadia National Park', wikipedia: 'Acadia National Park' },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Wikimedia rate-limits bursts: back off on 429.
const json = async (url) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await sleep(300 * (attempt + 1) ** 2);
    const response = await fetch(url, { headers: HEADERS });
    if (response.status === 429) continue;
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return response.json();
  }
  throw new Error(`429 ${url}`);
};
const stripHtml = (value = '') => value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const ringArea = (ring) => {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(sum) / 2;
};

const distanceToSegment = (p, a, b) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};

// Douglas-Peucker: iterative to stay safe on long rings.
const simplify = (points, tolerance) => {
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    let far = -1;
    let farDistance = tolerance;
    for (let i = start + 1; i < end; i += 1) {
      const d = distanceToSegment(points[i], points[start], points[end]);
      if (d > farDistance) { far = i; farDistance = d; }
    }
    if (far >= 0) { keep[far] = true; stack.push([start, far], [far, end]); }
  }
  return points.filter((_, i) => keep[i]);
};

const outerRings = (geometry) => {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons
    .map((polygon) => polygon[0])
    .filter((ring) => ringArea(ring) >= MIN_RING_AREA)
    .map((ring) => simplify(ring, SIMPLIFY_DEGREES).map(([lon, lat]) => [Number(lon.toFixed(4)), Number(lat.toFixed(4))]))
    .filter((ring) => ring.length >= 4);
};

const imageFor = async (title) => {
  const wiki = (params) => json(`https://en.wikipedia.org/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`);
  const commons = (params) => json(`https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`);
  const page = (await wiki({ action: 'query', titles: title, redirects: '1', prop: 'pageimages', piprop: 'thumbnail|name', pithumbsize: String(THUMB_WIDTH) })).query.pages[0];
  if (!page?.thumbnail || !page.pageimage || /map|logo|seal|locator|flag|diagram/i.test(page.pageimage) || /\.svg$/i.test(page.pageimage)) return null;
  const file = (await commons({ action: 'query', titles: `File:${page.pageimage}`, prop: 'imageinfo', iiprop: 'extmetadata|url' })).query.pages[0]?.imageinfo?.[0];
  const meta = file?.extmetadata ?? {};
  return {
    url: page.thumbnail.source,
    width: page.thumbnail.width,
    height: page.thumbnail.height,
    author: stripHtml(meta.Artist?.value) || 'Unknown',
    license: meta.LicenseShortName?.value ?? 'Unknown',
    sourceUrl: file?.descriptionurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
  };
};

const regions = [];
for (const region of REGIONS) {
  try {
    const [hit] = await json(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ format: 'json', q: region.search, polygon_geojson: '1', polygon_threshold: '0.002', limit: '1', countrycodes: 'us' })}`);
    await sleep(1100);
    const rings = hit ? outerRings(hit.geojson) : [];
    const image = await imageFor(region.wikipedia);
    if (!rings.length || !image) { console.log('skipped:', region.name, { rings: rings.length, image: Boolean(image) }); continue; }
    regions.push({ name: region.name, rings, image });
    console.log('ok:', region.name, `${rings.length} rings, ${rings.reduce((n, r) => n + r.length, 0)} points`);
  } catch (error) {
    console.log('failed:', region.name, error.message);
  }
}
await writeFile(OUT_PATH, `${JSON.stringify(regions)}\n`);
console.log(`${regions.length}/${REGIONS.length} regions written`);
