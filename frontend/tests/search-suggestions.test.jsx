import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
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
