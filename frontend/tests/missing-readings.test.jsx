// Missing forecast readings arrive as null. Number(null) is 0, so a gap must
// never be scored or shown as a measured 0 °F, 0 mph gust, 0% chance, or 0 in
// of snow.
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { makeReport } from "../dev/mock-data.mjs";
import { evaluateBackcountryDecision } from "../src/app/decision";
import { buildStartTimeScenario } from "../src/app/start-time-scenarios";
import { buildSnowpackInterpretation } from "../src/app/snowpack-display";
import { buildFieldBrief } from "../src/app/field-brief";
import { getDefaultUserPreferences } from "../src/app/preferences";
import { buildPlannedReportWeatherRows } from "../src/field/report-weather";
import { buildSkyHours } from "../src/field/sky/sky-model";
import { SkyHero } from "../src/field/sky/SkyHero";

const preferences = getDefaultUserPreferences();
const check = (decision, key) => decision.checks.find((item) => item.key === key);

test("a missing hourly temperature does not invent a cold feels-like", () => {
  const data = makeReport({ start: "07:00" }, "clear");
  data.weather.trend[2] = { ...data.weather.trend[2], temp: null };
  const decision = evaluateBackcountryDecision(data, "07:00", preferences);
  assert.equal(check(decision, "feels-like").ok, true);
  assert.doesNotMatch(check(decision, "feels-like").detail, /-\d+°F|\b0°F/);
  assert.ok(!decision.cautions.some((text) => /Apparent temperature falls/.test(text)));
});

test("missing gust and precipitation are reported as unavailable, not as passing at 0", () => {
  const data = makeReport({ start: "07:00" }, "clear");
  data.weather.windGust = null;
  data.weather.precipChance = null;
  data.weather.trend = data.weather.trend.map((hour) => ({ ...hour, gust: null, precipChance: null }));
  const decision = evaluateBackcountryDecision(data, "07:00", preferences);
  assert.deepEqual(
    [check(decision, "wind-gust"), check(decision, "precipitation")].map(({ ok, detail }) => [ok, detail]),
    [[false, "Wind gust data unavailable."], [false, "Precipitation chance unavailable."]],
  );
});

test("measured calm and dry readings still pass", () => {
  const data = makeReport({ start: "07:00" }, "clear");
  data.weather.windGust = 0;
  data.weather.trend = data.weather.trend.map((hour) => ({ ...hour, gust: 0, precipChance: 0 }));
  const decision = evaluateBackcountryDecision(data, "07:00", preferences);
  assert.equal(check(decision, "wind-gust").ok, true);
  assert.equal(check(decision, "precipitation").ok, true);
  assert.match(check(decision, "precipitation").detail, /0%/);
});

test("departure scenarios keep unknown peaks unknown", () => {
  const data = makeReport({ start: "07:00" }, "clear");
  Object.assign(data.weather, { temp: null, feelsLike: null, windGust: null, precipChance: null });
  data.weather.trend = data.weather.trend.map((hour) => ({ ...hour, temp: null, gust: null, precipChance: null }));
  const decision = evaluateBackcountryDecision(data, "07:00", preferences);
  const scenario = buildStartTimeScenario("07:00", data, decision, preferences);
  assert.deepEqual(
    [scenario.peakGustMph, scenario.peakFeelsLikeF, scenario.peakPrecipChance],
    [null, null, null],
  );

  const measured = buildStartTimeScenario("07:00", makeReport({ start: "07:00" }, "clear"), decision, preferences);
  assert.ok(measured.peakGustMph >= 15);
  assert.equal(measured.peakPrecipChance, 0);
});

test("a station that reports no depth or SWE is not a no-snow signal", () => {
  const snowpack = { snotel: { stationName: "Test", snowDepthIn: null, sweIn: null, distanceKm: 4, elevationFt: 9000 }, nohrsc: null, cdec: null };
  assert.equal(buildSnowpackInterpretation(snowpack, 9500), null);

  const sweOnly = { ...snowpack, snotel: { ...snowpack.snotel, sweIn: 12 }, nohrsc: { snowDepthIn: 40, sweIn: null } };
  const interpretation = buildSnowpackInterpretation(sweOnly, 9500);
  assert.match(interpretation.headline, /Substantial snowpack/);
  assert.ok(!interpretation.bullets.some((text) => /diverge/.test(text)), "an unknown SNOTEL depth is not 0 in");
});

test("an unknown objective elevation is not compared as sea level", () => {
  const snowpack = { snotel: { snowDepthIn: 30, sweIn: 10, distanceKm: 4, elevationFt: 9000 }, nohrsc: { snowDepthIn: 32 }, cdec: null };
  for (const elevation of [null, undefined]) {
    const interpretation = buildSnowpackInterpretation(snowpack, elevation);
    assert.ok(!interpretation.bullets.some((text) => /elevation differs/.test(text)));
  }
  assert.ok(buildSnowpackInterpretation(snowpack, 5000).bullets.some((text) => /elevation differs/.test(text)));
});

test("the field brief says wind and precipitation are unavailable instead of 0", () => {
  const data = makeReport({ start: "07:00" }, "clear");
  Object.assign(data.weather, { windSpeed: null, windGust: null, precipChance: null });
  const brief = buildFieldBrief({
    objectiveName: "Test", forecastDate: "2026-09-16", startTime: "07:00", returnTime: "12:00",
    travelWindowHours: 5, activity: "hiking", safetyData: data,
    decision: evaluateBackcountryDecision(data, "07:00", preferences), actionLine: "",
  });
  assert.match(brief.text, /Wind: Not available · gusts not available/);
  assert.match(brief.text, /Precipitation: Not available/);
  assert.doesNotMatch(brief.text, /0 mph · gusts 0 mph/);
});

test("the report hour and hero show a missing start reading as unavailable, not 0", () => {
  const data = { weather: { temp: null, windSpeed: 5, windGust: 10, trend: [
    { time: "07:00", temp: null, wind: 5, gust: 10, precipChance: null, condition: "Clear" },
    { time: "08:00", temp: 42, wind: 6, gust: 12, precipChance: 10, condition: "Clear" },
  ] } };
  const rows = buildPlannedReportWeatherRows(data, preferences, 2, { start: "07:00", date: "2026-09-23" });
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
