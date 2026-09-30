#!/usr/bin/env node
// Builds backend/regions.json: US national forests, parks, monuments, wilderness areas and
// similar federal lands, each with a simplified boundary and a photo. A place with no photo
// of its own falls back to the smallest of these that contains it.
//
//   1. Discover candidates from OpenStreetMap (Overpass) that carry a Wikidata tag.
//   2. Resolve each one's lead image from Wikipedia/Wikidata and its license from Commons.
//      Regions with no usable photo (none, or a map or logo) are dropped: they add nothing.
//   3. Fetch boundaries (Nominatim) only for the ones that remain, and simplify them.
//
// Run manually: node scripts/fetch-region-images.mjs   (takes several minutes)
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT_PATH = new URL('../backend/regions.json', import.meta.url);
const HEADERS = { 'User-Agent': 'backcountry-conditions/1.0 (weiranxiong@gmail.com)' };
const THUMB_WIDTH = 640;
const SIMPLIFY_DEGREES = 0.005;
const MIN_RING_AREA = 0.0004; // square degrees; drops slivers and tiny exclaves
const NAME = 'National Forest|National Park|Wilderness|National Monument|National Recreation Area|National Preserve|National Grassland|National Scenic Area|National Volcanic';
const OPERATOR = /forest service|park service|bureau of land management|^blm$|fish and wildlife/i;
// The US in slices so each Overpass query stays small; Alaska last.
const CHUNKS = [[31, -125, 42, -114], [42, -125, 49.5, -114], [31, -114, 42, -104], [42, -114, 49.5, -104], [24, -104, 37, -93], [37, -104, 49.5, -93], [24, -93, 37, -66], [37, -93, 49.5, -66], [51, -170, 72, -129]];
// Ocean-sized polygons are useless for a mountain app and too big for Nominatim to return.
const EXCLUDED_NAME = /marine|seamount|ocean/i;
const BAD_IMAGE = /map|logo|seal|locator|flag|diagram|coat[_ ]of[_ ]arms|\.svg$/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chunk = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));
const stripHtml = (value = '') => value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// Wikimedia and Overpass rate-limit bursts: pace requests and back off on 429/504.
const request = async (url, options = {}, { attempts = 6, timeoutMs = 90_000 } = {}) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(400 * (attempt + 1) ** 2);
    let response;
    try {
      response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs), ...options });
    } catch {
      continue; // timed out or dropped: back off and retry
    }
    if (response.status === 429 || response.status === 504 || response.status === 503) continue;
    if (!response.ok) throw new Error(`${response.status} ${url.slice(0, 120)}`);
    return response.json();
  }
  throw new Error(`gave up: ${url.slice(0, 120)}`);
};
const wikimedia = (host, params) => request(`https://${host}/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`);

// ---- 1. discovery -------------------------------------------------------------------------
const discover = async () => {
  const found = new Map();
  for (const [south, west, north, east] of CHUNKS) {
    const query = `[out:json][timeout:120];relation["boundary"~"^(protected_area|national_park)$"]["name"~"${NAME}"](${south},${west},${north},${east});out tags;`;
    const data = await request('https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: query }) });
    for (const element of data.elements) {
      const tags = element.tags;
      if (tags.wikidata && OPERATOR.test(tags.operator ?? '') && !EXCLUDED_NAME.test(tags.name)) found.set(tags.wikidata, { osmId: element.id, name: tags.name, wikidata: tags.wikidata });
    }
    console.log(`discovered ${found.size} after chunk ${south},${west}`);
  }
  return [...found.values()];
};

// ---- 2. images ----------------------------------------------------------------------------
const resolveImages = async (regions) => {
  const fileById = new Map();
  for (const ids of chunk(regions.map((r) => r.wikidata), 50)) {
    const entities = (await wikimedia('www.wikidata.org', { action: 'wbgetentities', ids: ids.join('|'), props: 'sitelinks|claims', sitefilter: 'enwiki' })).entities ?? {};
    const titles = new Map();
    for (const id of ids) {
      const title = entities[id]?.sitelinks?.enwiki?.title;
      if (title) titles.set(title, id);
      const p18 = entities[id]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (p18) fileById.set(id, p18);
    }
    // The article's lead image is the curated one; the Wikidata image is the fallback.
    if (titles.size) {
      const result = (await wikimedia('en.wikipedia.org', { action: 'query', titles: [...titles.keys()].join('|'), redirects: '1', prop: 'pageimages', piprop: 'name' })).query;
      const redirected = new Map((result.redirects ?? []).map((r) => [r.to, r.from]));
      for (const page of result.pages ?? []) {
        const id = titles.get(page.title) ?? titles.get(redirected.get(page.title));
        if (id && page.pageimage) fileById.set(id, page.pageimage);
      }
    }
    console.log(`image files for ${fileById.size} regions after ${Math.min(regions.length, ids.length + 0)} lookups`);
  }
  const usable = regions.filter((r) => fileById.has(r.wikidata) && !BAD_IMAGE.test(fileById.get(r.wikidata)));
  const infoByFile = new Map();
  for (const files of chunk([...new Set(usable.map((r) => fileById.get(r.wikidata).replace(/_/g, ' ')))], 40)) {
    const pages = (await wikimedia('commons.wikimedia.org', { action: 'query', titles: files.map((f) => `File:${f}`).join('|'), prop: 'imageinfo', iiprop: 'extmetadata|url', iiurlwidth: String(THUMB_WIDTH) })).query.pages ?? [];
    for (const page of pages) {
      const info = page.imageinfo?.[0];
      if (info?.thumburl) infoByFile.set(page.title.replace(/^File:/, ''), info);
    }
  }
  return usable.flatMap((region) => {
    const info = infoByFile.get(fileById.get(region.wikidata).replace(/_/g, ' '));
    if (!info) return [];
    const meta = info.extmetadata ?? {};
    return [{ ...region, image: { url: info.thumburl, width: info.thumbwidth, height: info.thumbheight, author: stripHtml(meta.Artist?.value) || 'Unknown', license: meta.LicenseShortName?.value ?? 'Unknown', sourceUrl: info.descriptionurl } }];
  });
};

// ---- 3. boundaries ------------------------------------------------------------------------
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
// Douglas-Peucker, iterative so long rings are safe.
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
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons
    .map((polygon) => polygon[0])
    .filter((ring) => ringArea(ring) >= MIN_RING_AREA)
    .map((ring) => simplify(ring, SIMPLIFY_DEGREES).map(([lon, lat]) => [Number(lon.toFixed(3)), Number(lat.toFixed(3))]))
    .filter((ring) => ring.length >= 4);
};

const lookupBoundaries = async (batch) => {
  try {
    return await request(`https://nominatim.openstreetmap.org/lookup?${new URLSearchParams({ osm_ids: batch.map((r) => `R${r.osmId}`).join(','), format: 'json', polygon_geojson: '1', polygon_threshold: '0.003' })}`, {}, { attempts: 2, timeoutMs: 40_000 });
  } catch (error) {
    // A big batch can time out: retry its halves, and give up on a single region rather than the run.
    if (batch.length === 1) { console.log(`skipped ${batch[0].name}: ${error.message.slice(0, 60)}`); return []; }
    const half = Math.ceil(batch.length / 2);
    return [...(await lookupBoundaries(batch.slice(0, half))), ...(await lookupBoundaries(batch.slice(half)))];
  }
};

const withBoundaries = async (regions) => {
  const byOsmId = new Map(regions.map((r) => [r.osmId, r]));
  const output = [];
  for (const batch of chunk(regions, 40)) {
    for (const place of await lookupBoundaries(batch)) {
      const region = byOsmId.get(place.osm_id);
      const rings = region ? outerRings(place.geojson) : [];
      if (rings.length) output.push({ name: region.name, rings, image: region.image });
    }
    await sleep(1200);
    console.log(`boundaries for ${output.length} regions`);
  }
  return output;
};

// Steps 1 and 2 take the longest; a rerun within a day (after a failed boundary fetch) reuses them.
const CACHE_PATH = join(tmpdir(), 'conditions-regions-images.json');
const cached = await readFile(CACHE_PATH, 'utf8').then(JSON.parse).catch(() => null);
let withImages;
if (cached && Date.now() - cached.at < 24 * 60 * 60 * 1000) {
  withImages = cached.regions.filter((region) => !EXCLUDED_NAME.test(region.name));
  console.log(`reusing ${withImages.length} regions with photos from ${CACHE_PATH}`);
} else {
  const candidates = await discover();
  withImages = await resolveImages(candidates);
  await writeFile(CACHE_PATH, JSON.stringify({ at: Date.now(), regions: withImages }));
  console.log(`${withImages.length} of ${candidates.length} candidates have a usable photo`);
}
const regions = await withBoundaries(withImages);
await writeFile(OUT_PATH, `${JSON.stringify(regions)}\n`);
console.log(`${regions.length} regions written`);
