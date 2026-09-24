import assert from "node:assert/strict";
import { test } from "node:test";
import { getLocalPopularSuggestions, isSameSuggestionPlace, rankAndDeduplicateSuggestions } from "../src/lib/search";
import { mergeSuggestionBuckets } from "../src/app/suggestion-storage";

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

test("different places keep their own rows", () => {
  const southTeton = { name: "South Teton, Wyoming", lat: 43.7194, lon: -110.8167 };
  const tetonPass = { name: "Grand Teton", lat: 43.5, lon: -110.95 };
  const teton = getLocalPopularSuggestions("grand teton")[0];
  assert.equal(isSameSuggestionPlace(teton, southTeton), false);
  assert.equal(isSameSuggestionPlace(teton, tetonPass), false);
  assert.equal(rankAndDeduplicateSuggestions([teton, southTeton, tetonPass], "teton").length, 3);
});
