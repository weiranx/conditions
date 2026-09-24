import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWindLoadingDisplay } from "../src/app/wind-loading-display";
import { buildTerrainWindow, buildTerrainWindowByAspect } from "../src/app/terrain-window";
import { getDefaultUserPreferences } from "../src/app/preferences";
import { buildSnowpackDisplayState } from "../src/app/risk-display";

const windy = { weather: { windDirection: "W", windSpeed: 22, windGust: 34 }, avalanche: { problems: [] } };
const trend = [{ time: "07:00", windDirection: "W", wind: 22, gust: 34 }];
const windLoading = (avalancheRelevant, hasSnowpackSignal) =>
  buildWindLoadingDisplay(windy, trend, avalancheRelevant, hasSnowpackSignal, (v) => `${v} mph`, "24h");

test("wind loading applies only with an avalanche context or measured snow", () => {
  assert.equal(windLoading(false, false).windLoadingApplies, false);
  assert.equal(windLoading(true, false).windLoadingApplies, true);
  assert.equal(windLoading(false, true).windLoadingApplies, true);
  // Direction is still resolved, so the hints stay off only because there is no snow.
  assert.equal(windLoading(false, false).windLoadingHintsRelevant, false);
  assert.ok(windLoading(false, false).leewardAspectHints.length > 0);
});

test("without wind-loading aspects the terrain window keeps its elevation lanes but no lee split", () => {
  const preferences = { ...getDefaultUserPreferences(), maxWindGustMph: 40 };
  const input = {
    travelRows: [{ time: "07:00", pass: true, gust: 34, reasonSummary: "" }],
    elevationBands: [
      { label: "Lower", elevationFt: 8000 },
      { label: "Objective", elevationFt: 11000 },
    ],
    avalancheProblems: [],
    avalancheRelevant: false,
    avalancheUnknown: false,
    avalancheDanger: null,
    preferences,
  };
  const withLee = buildTerrainWindow({ ...input, leewardAspects: ["E", "NE", "SE"], secondaryAspects: [] });
  assert.equal(withLee.lanes.length, 4);
  assert.ok(withLee.lanes.some((lane) => lane.cells[0].reasons.some((r) => /wind-loading/.test(r))));

  const withoutLee = buildTerrainWindow({ ...input, leewardAspects: [], secondaryAspects: [] });
  assert.deepEqual(withoutLee.lanes.map((lane) => lane.aspectLabel), ["All aspects", "All aspects"]);
  assert.ok(withoutLee.lanes.every((lane) => lane.cells[0].reasons.every((r) => !/wind-loading|Cross-loading/.test(r))));
  assert.doesNotMatch(withoutLee.explanation, /avalanche/);
});

test("a CDEC-only snow reading counts as a snowpack signal", () => {
  const fmt = () => "";
  const snowpack = (cdec) => buildSnowpackDisplayState(
    { weather: {}, snowpack: { status: "partial", snotel: null, nohrsc: null, cdec } },
    fmt, fmt, fmt, fmt, fmt, "ft", null, 0, "", 0, "",
  );
  assert.equal(snowpack({ snowDepthIn: 4, sweIn: null }).hasSignal, true);
  assert.equal(snowpack({ snowDepthIn: 0, sweIn: 0 }).hasSignal, false);
});

test("per-aspect terrain keeps a north avalanche problem and a south lee slope apart", () => {
  const input = {
    // Strong enough to load the lee slope (55% of the limit), below the 70% caution for every slope.
    travelRows: [{ time: "07:00", pass: true, gust: 24, reasonSummary: "" }],
    elevationBands: [{ label: "Objective", elevationFt: 11000 }],
    // No elevation stated, so the problem reaches every band on its aspect.
    avalancheProblems: [{ name: "Wind slab", location: ["north"] }],
    avalancheRelevant: true,
    avalancheUnknown: false,
    avalancheDanger: 2,
    leewardAspects: ["S"],
    secondaryAspects: [],
    preferences: { ...getDefaultUserPreferences(), maxWindGustMph: 40 },
  };
  const byAspect = buildTerrainWindowByAspect(input);
  const cell = (aspect) => byAspect.get(aspect).lanes.find((lane) => lane.aspects.includes(aspect)).cells[0];
  assert.match(cell("N").reasons.join(" "), /Wind slab/);
  assert.doesNotMatch(cell("N").reasons.join(" "), /wind-loading/);
  assert.match(cell("S").reasons.join(" "), /wind-loading/);
  assert.doesNotMatch(cell("S").reasons.join(" "), /Wind slab/);
  assert.equal(cell("E").level, "lower");
  // The grouped model, by contrast, puts N and S in one lane with both reasons.
  const shared = buildTerrainWindow(input).lanes.find((lane) => lane.aspects.includes("N"));
  assert.ok(shared.aspects.includes("S"));
});
