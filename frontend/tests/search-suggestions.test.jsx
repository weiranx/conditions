import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { useSearchSuggestions } from "../src/hooks/useSearchSuggestions";
import { getLocalPopularSuggestions, isSameSuggestionPlace, rankAndDeduplicateSuggestions, searchRequestPath } from "../src/lib/search";
import { filterSuggestionBucket, mergeSuggestionBuckets, normalizeStoredSuggestion } from "../src/app/suggestion-storage";
import { SuggestionLabel } from "../src/field/SuggestionLabel";

// The server's catalog places these a few metres from the browser's copy.
const serverWhitney = { name: "Mount Whitney, California", lat: 36.5785, lon: -118.2923, type: "peak", class: "natural" };
const osmTeton = { name: "Grand Teton, Teton County, Wyoming, United States", lat: 43.7412, lon: -110.8022, type: "peak", class: "natural" };

test("the same peak from two catalogs is listed once", () => {
  const merged = mergeSuggestionBuckets(
    [getLocalPopularSuggestions("whitney"), rankAndDeduplicateSuggestions([serverWhitney], "whitney")],
    8,
  );
  assert.deepEqual(merged.map((s) => s.name), ["Mount Whitney, California"]);
  assert.equal(merged[0].class, "popular");
});

test("a recent pick stands for the catalog and map entries of the same summit", () => {
  const recent = { name: "Grand Teton", lat: 43.7417, lon: -110.8024, class: "recent" };
  const merged = mergeSuggestionBuckets([[recent], getLocalPopularSuggestions("grand teton"), [osmTeton]], 8);
  assert.deepEqual(merged.map((s) => s.name), ["Grand Teton"]);
});

test("a catalog name's aside does not split it from the map's entry", () => {
  const catalog = { name: "Mount San Antonio (Mt Baldy), California", lat: 34.2889, lon: -117.6464, class: "natural" };
  const osm = { name: "Mount San Antonio, Los Angeles County, California", lat: 34.2892, lon: -117.6462, elevationFt: 10066 };
  assert.equal(isSameSuggestionPlace(catalog, osm), true);
});

test("different places keep their own rows", () => {
  const southTeton = { name: "South Teton, Wyoming", lat: 43.7194, lon: -110.8167 };
  const tetonPass = { name: "Grand Teton", lat: 43.5, lon: -110.95 };
  const teton = getLocalPopularSuggestions("grand teton")[0];
  assert.equal(isSameSuggestionPlace(teton, southTeton), false);
  assert.equal(isSameSuggestionPlace(teton, tetonPass), false);
  assert.equal(rankAndDeduplicateSuggestions([teton, southTeton, tetonPass], "teton").length, 3);
});

test("the server's order stands among places whose own name matches", () => {
  const volcano = { name: "Mount Rainier, Pierce County, Washington", lat: 46.853, lon: -121.76, kind: "Volcano", elevationFt: 14409 };
  const town = { name: "Rainier, Columbia County, Oregon", lat: 46.089, lon: -122.935, kind: "Town" };
  const byOtherName = { name: "Mount San Antonio, Los Angeles County, California", lat: 34.289, lon: -117.646, kind: "Peak" };
  const baldy = { name: "Mount Baldy, Salt Lake County, Utah", lat: 40.57, lon: -111.63, kind: "Peak" };
  assert.deepEqual(rankAndDeduplicateSuggestions([volcano, town], "rainier").map((s) => s.kind), ["Volcano", "Town"]);
  assert.deepEqual(rankAndDeduplicateSuggestions([byOtherName, baldy], "mt baldy").map((s) => s.name.split(",")[0]), ["Mount Baldy", "Mount San Antonio"]);
});

test("a recent pick takes the elevation the server knows for the same summit", () => {
  const recent = { name: "Grand Teton", lat: 43.7417, lon: -110.8024, class: "recent" };
  const merged = mergeSuggestionBuckets([[recent], [{ ...osmTeton, kind: "Peak", elevationFt: 13775 }]], 8);
  assert.equal(merged.length, 1);
  assert.deepEqual([merged[0].class, merged[0].kind, merged[0].elevationFt], ["recent", "Peak", 13775]);
});

test("words match in any order and Mt stands for Mount", () => {
  assert.equal(getLocalPopularSuggestions("teton grand")[0]?.name, "Grand Teton, Wyoming");
  assert.equal(getLocalPopularSuggestions("mt. whit")[0]?.name, "Mount Whitney, California");
  const recents = [{ name: "Mount Si, King County, Washington", lat: 47.49, lon: -121.73 }];
  assert.equal(filterSuggestionBucket(recents, "si mount").length, 1);
  assert.equal(filterSuggestionBucket(recents, "rainier").length, 0);
});

test("stored picks keep what the place is and its elevation", () => {
  const stored = normalizeStoredSuggestion({ name: "Half Dome", lat: 37.746, lon: -119.533, kind: "Peak", elevationFt: 8839.4 }, "recent");
  assert.deepEqual([stored?.kind, stored?.elevationFt], ["Peak", 8839]);
  assert.equal(normalizeStoredSuggestion({ name: "Old", lat: 1, lon: 2, elevationFt: "high" })?.elevationFt, undefined);
});

test("a result shows its name, then kind, elevation in the chosen unit and region", () => {
  const item = { name: "Mount Si, King County, Washington", lat: 47.49, lon: -121.73, kind: "Peak", elevationFt: 4114, class: "recent" };
  const feet = renderToStaticMarkup(<SuggestionLabel item={item} elevationUnit="ft" />);
  assert.match(feet, /<strong>Mount Si<\/strong><small>Recent · Peak · 4,114 ft · King County, Washington<\/small>/);
  assert.match(renderToStaticMarkup(<SuggestionLabel item={item} elevationUnit="m" />), /1,254 m/);
  const pin = { name: "46.8523, -121.7603", lat: 46.8523, lon: -121.7603, type: "coordinate", class: "recent" };
  assert.match(renderToStaticMarkup(<SuggestionLabel item={pin} elevationUnit="ft" />), /<strong>46.8523, -121.7603<\/strong><small>Recent · Coordinates<\/small>/);
});

test("searches lean toward the plan's area, sent only to the whole degree", () => {
  assert.equal(searchRequestPath("snow lake", { lat: 47.4912, lon: -121.7311 }), "/api/search?q=snow+lake&near=47%2C-122");
  assert.equal(searchRequestPath("snow lake", null), "/api/search?q=snow+lake");
  assert.equal(searchRequestPath("x", { lat: Number.NaN, lon: 1 }), "/api/search?q=x");
});

test("a saved place shows the name it was given, commas and all", () => {
  const camp = { name: "Camp Muir, upper snowfield", lat: 46.8358, lon: -121.7318, class: "saved", elevationFt: 10188 };
  assert.match(
    renderToStaticMarkup(<SuggestionLabel item={camp} elevationUnit="ft" />),
    /<strong>Camp Muir, upper snowfield<\/strong><small>Saved · 10,188 ft<\/small>/,
  );
});

const SAVED_KEY = "summitsafe-saved-places";
const RECENT_KEY = "summitsafe-recent-searches";

// The search hook in a page whose local storage starts as given.
async function mountSearch(t, storage = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/" });
  for (const [key, value] of Object.entries(storage)) dom.window.localStorage.setItem(key, JSON.stringify(value));
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = () => new Promise(() => {});
  const box = {};
  function Probe() {
    box.hook = useSearchSuggestions({ initialSearchQuery: "", updateObjectivePosition: () => {} });
    return null;
  }
  const root = createRoot(document.getElementById("root"));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  await act(async () => root.render(<Probe />));
  return { box, stored: (key) => JSON.parse(dom.window.localStorage.getItem(key) ?? "null") };
}

test("a place can be saved, is recognised at the same spot, and toggling removes it", async (t) => {
  const { box, stored } = await mountSearch(t);
  const si = { name: "Mount Si, King County, Washington", lat: 47.4912, lon: -121.7311, elevationFt: 4167 };
  assert.equal(box.hook.isPlaceSaved(si), false);
  await act(async () => box.hook.toggleSavedPlace(si));
  assert.equal(box.hook.isPlaceSaved({ lat: 47.4914, lon: -121.7313 }), true, "a few metres away is the same spot");
  assert.equal(box.hook.isPlaceSaved({ lat: 47.5, lon: -121.7311 }), false, "a kilometre away is not");
  assert.deepEqual(stored(SAVED_KEY).map((place) => [place.name, place.elevationFt]), [["Mount Si, King County, Washington", 4167]]);

  await act(async () => box.hook.toggleSavedPlace({ ...si, name: "Si", lat: 47.4913 }));
  assert.equal(box.hook.isPlaceSaved(si), false);
  assert.deepEqual(stored(SAVED_KEY), []);
});

test("renaming the plan's place renames its saved copy, and only that", async (t) => {
  const { box, stored } = await mountSearch(t);
  await act(async () => box.hook.toggleSavedPlace({ name: "46.8523, -121.7603", lat: 46.8523, lon: -121.7603 }));
  await act(async () => box.hook.toggleSavedPlace({ name: "Elsewhere", lat: 40, lon: -110 }));
  await act(async () => box.hook.renameSavedPlace({ lat: 46.8523, lon: -121.7603 }, "Camp Muir, upper snowfield"));
  assert.deepEqual(stored(SAVED_KEY).map((place) => place.name), ["Elsewhere", "Camp Muir, upper snowfield"]);

  await act(async () => box.hook.renameSavedPlace({ lat: 1, lon: 1 }, "Nowhere"));
  assert.deepEqual(stored(SAVED_KEY).map((place) => place.name), ["Elsewhere", "Camp Muir, upper snowfield"]);
});

test("saved places lead the list, and a recent pick of the same place is not listed twice", async (t) => {
  const saved = { name: "Camp Muir, Pierce County, Washington", lat: 46.8358, lon: -121.7318 };
  const sameAsRecent = { name: "Camp Muir", lat: 46.8359, lon: -121.7319 };
  const other = { name: "Mount Si", lat: 47.4912, lon: -121.7311 };
  const { box } = await mountSearch(t, { [SAVED_KEY]: [saved], [RECENT_KEY]: [other, sameAsRecent] });
  assert.deepEqual(box.hook.savedPlaces.map((place) => place.class), ["saved"], "a place loaded from storage is a saved one");

  await act(async () => box.hook.fetchSuggestions(""));
  const listed = box.hook.suggestions;
  assert.deepEqual([listed[0].name, listed[0].class], [saved.name, "saved"]);
  assert.equal(listed.filter((item) => item.name.startsWith("Camp Muir")).length, 1);
  assert.ok(listed.some((item) => item.name === "Mount Si" && item.class === "recent"));
});

test("no more than 50 places are kept, the newest first", async (t) => {
  const { box, stored } = await mountSearch(t);
  for (let i = 0; i < 52; i += 1) {
    await act(async () => box.hook.toggleSavedPlace({ name: `Place ${i}`, lat: 30 + i * 0.1, lon: -100 }));
  }
  assert.equal(box.hook.savedPlaces.length, 50);
  assert.equal(stored(SAVED_KEY).length, 50);
  assert.equal(box.hook.savedPlaces[0].name, "Place 51");
  assert.equal(box.hook.savedPlaces.at(-1).name, "Place 2");
});
