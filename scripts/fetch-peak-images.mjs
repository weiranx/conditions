#!/usr/bin/env node
// Adds a lead image (with license and credit) from Wikipedia/Wikimedia Commons to every
// entry in backend/peaks.json. Run manually: node scripts/fetch-peak-images.mjs
import { readFile, writeFile } from 'node:fs/promises';

const PEAKS_PATH = new URL('../backend/peaks.json', import.meta.url);
const HEADERS = { 'User-Agent': 'backcountry-conditions/1.0 (weiranxiong@gmail.com)' };
const THUMB_WIDTH = 640;

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

const stripHtml = (value = '') => value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

async function imageFor(peak) {
  const title = peak.wikipedia ?? peak.name.split(',')[0].trim();
  const page = (await api('en.wikipedia.org', {
    action: 'query', titles: title, redirects: '1', prop: 'pageimages', piprop: 'thumbnail|name', pithumbsize: String(THUMB_WIDTH),
  })).query.pages[0];
  if (!page?.thumbnail || !page.pageimage) return null;

  const file = (await api('commons.wikimedia.org', {
    action: 'query', titles: `File:${page.pageimage}`, prop: 'imageinfo', iiprop: 'extmetadata|url',
  })).query.pages[0]?.imageinfo?.[0];
  const meta = file?.extmetadata ?? {};
  return {
    url: page.thumbnail.source,
    width: page.thumbnail.width,
    height: page.thumbnail.height,
    author: stripHtml(meta.Artist?.value) || 'Unknown',
    license: meta.LicenseShortName?.value ?? 'Unknown',
    sourceUrl: file?.descriptionurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
  };
}

const peaks = JSON.parse(await readFile(PEAKS_PATH, 'utf8'));
let found = 0;
for (const peak of peaks) {
  try {
    const image = await imageFor(peak);
    if (image) { peak.image = image; found += 1; } else { delete peak.image; console.log('no image:', peak.name); }
  } catch (error) {
    console.log('failed:', peak.name, error.message);
  }
}
await writeFile(PEAKS_PATH, `${JSON.stringify(peaks, null, 2)}\n`);
console.log(`${found}/${peaks.length} peaks have an image`);
