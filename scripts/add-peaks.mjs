#!/usr/bin/env node
// Appends peaks to backend/peaks.json with coordinates and elevation from Wikipedia/Wikidata
// (no hand-typed numbers), skipping any already listed. Then run scripts/fetch-peak-images.mjs.
// Run manually: node scripts/add-peaks.mjs
import { readFile, writeFile } from 'node:fs/promises';

const PEAKS_PATH = new URL('../backend/peaks.json', import.meta.url);
const HEADERS = { 'User-Agent': 'backcountry-conditions/1.0 (weiranxiong@gmail.com)' };
const FEET_PER_METER = 3.28084;

// [display name "Peak, State", Wikipedia title when it differs from the name before the comma]
const NEW_PEAKS = [
  // Sierra Nevada
  ['Mount Williamson, California'], ['Mount Langley, California'], ['Mount Muir, California'], ['Mount Sill, California'],
  ['Split Mountain, California'], ['Mount Humphreys, California'], ['Mount Tom, California'], ['Mount Agassiz, California'],
  ['Mount Ritter, California'], ['Mount Dana, California'], ['Mount Lyell, California'], ['Cathedral Peak, California'],
  ['Half Dome, California'], ['Mount Conness, California'], ['Mount Tyndall, California'], ['Mount Darwin, California'],
  ['Mount Russell, California'], ['Mount Baxter, California'], ['Mount Gilbert, California'], ['Mount Sill, California'],
  ['Mount Whitney, California'], ['Mount Agassiz, California'], 
  ['Mount Emerson, California'], ['Basin Mountain, California'], ['Mount Goode, California'], ['Mount Wallace, California'],
  ['Mount Whitney, California'], ['Freel Peak, California'], ['Mount Ralston, California'],
  ['Mount Tallac, California'], ['Sonora Peak, California'], ['Lassen Peak, California'], ['Mount Eddy, California'],
  // Cascades
  ['Mount Stuart, Washington'], ['Mount Olympus, Washington'], ['Mount Index, Washington'], ['Sahale Mountain, Washington'],
  ['Forbidden Peak, Washington'], ['Mount Shuksan, Washington'], ['Mount Daniel, Washington'], ['Mount Constance, Washington'],
  ['Three Fingered Jack, Oregon'], ['South Sister, Oregon'], ['Broken Top, Oregon'], ['Mount Thielsen, Oregon'], ['Mount Bachelor, Oregon'],
  ['Mount McLoughlin, Oregon'], ['Mount Washington, Oregon', 'Mount Washington (Oregon)'],
  // Rockies
  ['Grays Peak, Colorado'], ['Torreys Peak, Colorado'], ['Mount Bierstadt, Colorado'], ['Mount Sneffels, Colorado'],
  ['Capitol Peak, Colorado'], ['Crestone Peak, Colorado'], ['Mount of the Holy Cross, Colorado'], ['Quandary Peak, Colorado'],
  ['Mount Blue Sky, Colorado'], ['Uncompahgre Peak, Colorado'], ['Mount Wilson, Colorado', 'Mount Wilson (Colorado)'], ['Mount Massive, Colorado'],
  ['Mount Sopris, Colorado'], ['Cloud Peak, Wyoming'], ['Mount Moran, Wyoming'], ['Middle Teton, Wyoming'], ['Mount Owen, Wyoming'],
  ['Devils Tower, Wyoming'], ['Hallett Peak, Colorado'], ['Mount Timpanogos, Utah'], ['Mount Nebo, Utah'], 
  ['Mount Nebo, Utah'],
  ['Mount Sherman, Colorado'], ['Mount Lindsey, Colorado'], ['Blanca Peak, Colorado'], 
  // Rest of the West and Northeast
  ['Charleston Peak, Nevada'], ['Boundary Peak, Nevada'], ['Mount Whitney, California'], ['Mount Wilson, Arizona', 'Mount Wilson (Arizona)'],
  ['Mount Graham, Arizona'], ['Mount Ellen, Utah'], ['Mount Marcy, New York'], ['Algonquin Peak, New York'], ['Mount Washington, New Hampshire'],
  ['Mount Adams, New Hampshire', 'Mount Adams (New Hampshire)'], ['Mount Monadnock, New Hampshire'], ['Cadillac Mountain, Maine'],
  ['Clingmans Dome, Tennessee'], ['Mount Le Conte, Tennessee', 'Mount Le Conte (Tennessee)'], ['Grandfather Mountain, North Carolina'],
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Wikimedia rate-limits bursts: pace requests and back off on 429.
const api = async (host, params) => {
  const url = `https://${host}/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await sleep(250 * (attempt + 1) ** 2);
    const response = await fetch(url, { headers: HEADERS });
    if (response.status === 429) continue;
    if (!response.ok) throw new Error(`${host} ${response.status}`);
    return response.json();
  }
  throw new Error(`${host} 429`);
};

const elevationFtOf = (entity) => {
  const claim = entity?.claims?.P2044?.[0]?.mainsnak?.datavalue?.value;
  if (!claim) return null;
  const amount = Number(claim.amount);
  if (!Number.isFinite(amount)) return null;
  return Math.round(claim.unit.endsWith('/Q3710') ? amount : amount * FEET_PER_METER);
};

const wikidataCoordinate = (entity) => entity?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;

const lookupTitle = async (title) => {
  const page = (await api('en.wikipedia.org', { action: 'query', titles: title, redirects: '1', prop: 'coordinates|pageprops', ppprop: 'wikibase_item', coprimary: 'primary' })).query.pages[0];
  const id = page?.pageprops?.wikibase_item;
  if (!id || page.missing) return null;
  const entity = (await api('www.wikidata.org', { action: 'wbgetentities', ids: id, props: 'claims' })).entities?.[id];
  const coordinate = page.coordinates?.[0] ? { latitude: page.coordinates[0].lat, longitude: page.coordinates[0].lon } : wikidataCoordinate(entity);
  const elevationFt = elevationFtOf(entity);
  if (!coordinate || elevationFt === null) return null;
  return { lat: Number(Number(coordinate.latitude).toFixed(4)), lon: Number(Number(coordinate.longitude).toFixed(4)), elevationFt };
};

// Guards against a same-named mountain elsewhere in the world (Mount Olympus, Greece).
const inUnitedStates = ({ lat, lon }, state) =>
  state === 'Alaska' ? lat > 51 && lat < 72 && (lon < -129 || lon > 170) : lat > 24 && lat < 50 && lon > -125 && lon < -66;

// The plain name, then "Name (State)" for the ambiguous ones.
const lookup = async (name, override) => {
  const [base, state] = name.split(',').map((part) => part.trim());
  const candidates = override ? [override] : [base, `${base} (${state})`];
  for (const title of candidates) {
    const found = await lookupTitle(title);
    if (found && inUnitedStates(found, state)) return { ...found, wikipedia: title === base ? undefined : title };
  }
  return null;
};

const peaks = JSON.parse(await readFile(PEAKS_PATH, 'utf8'));
const known = new Set(peaks.map((peak) => peak.name));
let added = 0;
for (const [name, wikipedia] of NEW_PEAKS) {
  if (known.has(name)) continue;
  known.add(name);
  try {
    const found = await lookup(name, wikipedia);
    if (!found) { console.log('skipped (no coordinates or elevation):', name); continue; }
    peaks.push({ name, lat: found.lat, lon: found.lon, elevationFt: found.elevationFt, ...(found.wikipedia ? { wikipedia: found.wikipedia } : {}) });
    added += 1;
  } catch (error) {
    console.log('failed:', name, error.message);
  }
}
await writeFile(PEAKS_PATH, `${JSON.stringify(peaks, null, 2)}\n`);
console.log(`${added} peaks added, ${peaks.length} total`);
