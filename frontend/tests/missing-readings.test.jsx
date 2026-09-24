// Missing forecast readings arrive as null. Number(null) is 0, so a gap must
// never be scored or shown as a measured 0 °F, 0 mph gust, 0% chance, or 0 in
// of snow. Scoring and interpretation are covered by the backend
// (unit.plan-evaluation, unit.plan-comparisons, unit.report-interpretation);
// these tests cover what the app shows.
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSkyHours } from "../src/field/sky/sky-model";
import { SkyHero } from "../src/field/sky/SkyHero";
import { evaluate } from "./evaluation-fixtures";

test("the report hour and hero show a missing start reading as unavailable, not 0", () => {
  const data = { safety: { score: 80 }, weather: { temp: null, windSpeed: 5, windGust: 10, trend: [
    { time: "07:00", temp: null, wind: 5, gust: 10, precipChance: null, condition: "Clear" },
    { time: "08:00", temp: 42, wind: 6, gust: 12, precipChance: 10, condition: "Clear" },
  ] } };
  const rows = evaluate(data, { start: "07:00", date: "2026-09-23", travel_window_hours: "2" }).travelWindow.planned.rows;
  assert.ok(Number.isNaN(rows[0].temp) && Number.isNaN(rows[0].feelsLike) && Number.isNaN(rows[0].precipChance));
  assert.deepEqual([rows[1].temp, rows[1].wind, rows[1].precipChance], [42, 6, 10]);

  const hours = buildSkyHours(rows, { start: "07:00", sunriseMinutes: 412, sunsetMinutes: 1170 });
  const format = { temp: (f) => `${f}°F`, wind: (m) => `${m} mph`, clock: (m) => `${Math.floor(m / 60) % 24}:00`, timeStyle: "24h" };
  const html = renderToStaticMarkup(<SkyHero hours={hours} sunrise={412} sunset={1170} kicker="Report" title="Test"
    subtitle="Wed" level="CAUTION" headline="Check" reason="" format={format} />);
  assert.match(html, /sky-readout-big">—</);
  assert.match(html, /Rain chance<\/dt><dd>—</);
  assert.match(html, /7:00: temperature unavailable/);
  assert.doesNotMatch(html, /\b0°F|NaN/);
});
