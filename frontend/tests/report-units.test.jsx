import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  formatRainAmountForElevationUnit,
  formatSnowDepthForElevationUnit,
  formatSnowfallAmountForElevationUnit,
  formatWindForUnit,
  localizeUnitText,
} from "../src/app/core";
import travelWindow from "../../backend/src/utils/travel-window.js";
import planContext from "../../backend/src/utils/plan-context.js";
import { plainRule } from "../src/field/sky/status";
import { SurfacePrediction } from "../src/field/SurfacePrediction";

const imperial = { temperatureUnit: "f", windSpeedUnit: "mph", elevationUnit: "ft" };
const metric = { temperatureUnit: "c", windSpeedUnit: "kph", elevationUnit: "m" };

test("wind speeds read km/h, the label Settings uses", () => {
  assert.equal(formatWindForUnit(25, "kph"), "40 km/h");
  assert.equal(formatWindForUnit(25, "mph"), "25 mph");
});

test("rain and snow amounts share one precision in both unit systems", () => {
  assert.equal(formatRainAmountForElevationUnit(0.25, null, "ft"), "0.25 in");
  assert.equal(formatRainAmountForElevationUnit(0.25, null, "m"), "6.3 mm");
  assert.equal(formatRainAmountForElevationUnit(0.01, null, "m"), "0.3 mm");
  assert.equal(formatSnowfallAmountForElevationUnit(0.37, null, "ft"), "0.4 in");
  assert.equal(formatSnowfallAmountForElevationUnit(2, null, "m"), "5.1 cm");
  assert.equal(formatSnowDepthForElevationUnit(40, "m"), "102 cm");
  assert.equal(formatSnowDepthForElevationUnit(0.4, "ft"), "0.4 in");
});

test("both ends of a range are converted", () => {
  assert.equal(
    localizeUnitText("Feels-like temperatures span 20–35°F.", metric),
    "Feels-like temperatures span -7–2°C.",
  );
  assert.equal(localizeUnitText("10–25 mph sustained wind", metric), "16–40 km/h sustained wind");
  assert.equal(localizeUnitText("Gusts at 12,000-13,000 ft", metric), "Gusts at 3,658-3,962 m");
});

test("elevations with thousands separators convert as one number", () => {
  assert.equal(localizeUnitText("between the objective and 13,775 ft", metric), "between the objective and 4,199 m");
  assert.equal(localizeUnitText("between the objective and 13775 ft", imperial), "between the objective and 13,775 ft");
  assert.equal(localizeUnitText("adjustments per 1,000 ft.", metric), "adjustments per 1,000 ft.");
});

test("temperatures convert with or without a degree sign, and differences scale without the offset", () => {
  assert.equal(localizeUnitText("Surface temperature 31°F near freezing.", metric), "Surface temperature -1°C near freezing.");
  assert.equal(localizeUnitText("Temperature near 28F.", metric), "Temperature near -2°C.");
  assert.equal(localizeUnitText("Temperature near 28F.", imperial), "Temperature near 28°F.");
  assert.equal(localizeUnitText("Temperature increased from 30°F to 36°F.", metric), "Temperature increased from -1°C to 2°C.");
  assert.equal(localizeUnitText("direct sun adds up to 9°F", metric), "direct sun adds up to 5°C");
  assert.equal(localizeUnitText("temperature swing (30F) suggests", metric), "temperature swing (17°C) suggests");
  assert.equal(localizeUnitText("A station reads 9F warmer than forecast.", metric), "A station reads 5°C warmer than forecast.");
});

test("miles convert for metric readers", () => {
  assert.equal(
    localizeUnitText("within about 10 mi of the objective (nearest about 6.5 mi)", metric),
    "within about 16 km of the objective (nearest about 10.5 km)",
  );
  assert.equal(localizeUnitText("within about 10 mi", imperial), "within about 10 mi");
});

test("rain, snowfall, depth and SWE in inches take their own metric unit", () => {
  assert.equal(
    localizeUnitText("Snowpack signal near objective: depth 40.0 in, SWE 12.0 in.", metric),
    "Snowpack signal near objective: depth 102 cm, SWE 305 mm.",
  );
  assert.equal(
    localizeUnitText("Recent rainfall: 0.10 in (12h), 0.25 in (24h).", metric),
    "Recent rainfall: 2.5 mm (12h), 6.3 mm (24h).",
  );
  assert.equal(
    localizeUnitText("Recent snowfall is substantial (6.0 in in 24h).", metric),
    "Recent snowfall is substantial (15.2 cm in 24h).",
  );
  assert.equal(localizeUnitText("observed 0.40 in of rain in the last 24h", metric), "observed 10.2 mm of rain in the last 24h");
  assert.equal(localizeUnitText("4 in of new snow", metric), "10.2 cm of new snow");
  assert.equal(localizeUnitText("Snowpack of 18 in depth.", metric), "Snowpack of 46 cm depth.");
  assert.equal(localizeUnitText("SWE ~3.0 in", metric), "SWE ~76 mm");
});

test("a count followed by the word 'in' is left alone", () => {
  assert.equal(localizeUnitText("2 in the full feed; 3 alerts in effect.", metric), "2 in the full feed; 3 alerts in effect.");
  assert.equal(localizeUnitText("Feels like up to 85F in daylight", metric), "Feels like up to 29°C in daylight");
});

test("the deep-snow rule reads in the viewer's depth unit", () => {
  // The backend writes the rule; the app turns it into plain words.
  const context = planContext.buildPlanContext({ elevation_unit: "m", approach: "off" }, null);
  const [row] = travelWindow.buildTravelWindowRows([{ time: "7:00 AM", temp: 30, wind: 5, gust: 10, precipChance: 0, condition: "Clear" }], context, { snowDepthIn: 20 });
  const rule = row.failedRules.find((item) => item.startsWith("snow depth"));
  assert.equal(rule, "snow depth 51 cm");
  assert.equal(plainRule(rule), "51 cm of snow on the ground");
});

test("surface prediction text follows the viewer's units", () => {
  const html = renderToStaticMarkup(
    <SurfacePrediction
      condition={{ moisture: { summary: "Recent rainfall: 0.25 in (24h)." }, confidenceReasons: ["Temperature near 28F."] }}
      localize={(text) => localizeUnitText(text, metric)}
    />,
  );
  assert.match(html, /6\.3 mm \(24h\)/);
  assert.match(html, /-2°C/);
});
