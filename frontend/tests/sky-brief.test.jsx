import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SkyHero } from "../src/field/sky/SkyHero";
import { BriefSections } from "../src/field/sky/BriefSections";
import { getDefaultUserPreferences } from "../src/app/preferences";
import { buildSkyHours, skyRuns, sunProgress, shortHour, spanLabel, isOverHour } from "../src/field/sky/sky-model";
import { evaluate, interpret } from "./evaluation-fixtures";

// Planned rows as the backend evaluates them for a 07:00 start.
const plannedRows = (data, hours, params = {}) => evaluate({ safety: { score: 80 }, ...data },
  { start: "07:00", date: "2026-09-23", travel_window_hours: String(hours), ...params }).travelWindow.planned.rows;

const row = (over = {}) => ({
  time: "07:00", pass: true, complete: true, condition: "Clear", reasonSummary: "", failedRules: [], failedRuleLabels: [],
  temp: 60, feelsLike: 58, wind: 5, gust: 12, precipChance: 0, ...over,
});

const plan = { start: "07:00", sunriseMinutes: 412, sunsetMinutes: 1170 };

test("sky hours follow the planned start and keep missing evidence distinct from within-limit hours", () => {
  const hours = buildSkyHours([
    row(),
    row({ time: "08:00", pass: false, failedRules: ["Gust 31 mph above 25 mph"] }),
    row({ time: "09:00", pass: false, complete: false, gust: NaN }),
  ], plan);
  assert.deepEqual(hours.map((h) => h.minute), [420, 480, 540]);
  assert.deepEqual(hours.map((h) => h.tone), ["within", "over", "missing"]);
  assert.ok(hours.every((h) => /^#[0-9a-f]{6}$/.test(h.zenith) && /^#[0-9a-f]{6}$/.test(h.horizon)));
});

test("sky colour reflects night, rain and cloud rather than a fixed gradient", () => {
  const [night] = buildSkyHours([row({ time: "03:00" })], { ...plan, start: "03:00" });
  assert.equal(night.night, true);
  const [storm] = buildSkyHours([row({ time: "12:00", condition: "Rain showers", precipChance: 80 })], { ...plan, start: "12:00" });
  const [clear] = buildSkyHours([row({ time: "12:00" })], { ...plan, start: "12:00" });
  assert.equal(storm.kind, "rain");
  assert.notEqual(storm.zenith, clear.zenith);
  const [unknownLight] = buildSkyHours([row({ time: "03:00" })], { start: "03:00", sunriseMinutes: null, sunsetMinutes: null });
  assert.equal(unknownLight.night, false, "without solar data the sky must not claim it is night");
});

test("runs group consecutive over-limit hours and a measured breach outranks missing evidence", () => {
  const hours = buildSkyHours([
    row(), row({ pass: false, failedRules: ["Precip 80% above 60%"] }),
    row({ pass: false, complete: false, failedRules: ["Gust 30 mph above 25 mph"] }),
    row({ pass: false, complete: false }), row(),
  ], plan);
  assert.deepEqual(skyRuns(hours), [{ start: 1, end: 2, tone: "over" }, { start: 3, end: 3, tone: "missing" }]);
  assert.equal(isOverHour(hours[2]), true);
  assert.equal(isOverHour(hours[3]), false);
  assert.equal(spanLabel(hours, { start: 1, end: 2 }, (m) => `${Math.floor(m / 60)}`), "8–10");
});

test("the sun is only placed between sunrise and sunset", () => {
  assert.equal(sunProgress(412, 412, 1170), 0);
  assert.equal(sunProgress(1170, 412, 1170), 1);
  assert.equal(sunProgress(300, 412, 1170), null);
  assert.equal(sunProgress(700, null, 1170), null);
  assert.ok(Math.abs(sunProgress(791, 412, 1170) - 0.5) < 0.01);
});

test("compact hour labels respect the time style and survive overnight minutes", () => {
  assert.equal(shortHour(420, "12h"), "7a");
  assert.equal(shortHour(720, "12h"), "12p");
  assert.equal(shortHour(1500, "12h"), "1a");
  assert.equal(shortHour(780, "24h"), "13");
  assert.equal(shortHour(NaN, "12h"), "—");
});


const fmt = { temp: (f) => `${f}°F`, wind: (m) => `${m} mph`, clock: (m) => `${Math.floor(m / 60) % 24}:00`, timeStyle: "24h" };
const hero = (hours, extra = {}) => renderToStaticMarkup(
  <SkyHero hours={hours} sunrise={412} sunset={1170} kicker="Conditions report" title="Test Peak" subtitle="Wed"
    level="CAUTION" headline="Adjust timing" reason="Rain at noon" format={fmt} {...extra} />);

test("the sky names the over-limit window and starts on the first hour that needs attention", () => {
  const hours = buildSkyHours([row(), row({ time: "08:00", pass: false, failedRules: ["Gust 31 mph above 25 mph"], gust: 31 }), row({ time: "09:00" })], plan);
  const html = hero(hours);
  assert.match(html, /Outside your limits · 8:00–9:00/);
  assert.match(html, /role="slider"/);
  assert.match(html, /aria-valuenow="1"/);
  assert.match(html, /over your limits: Gust 31 mph above 25 mph/);
  assert.match(html, /Trip decision: <\/span>Caution/);
  assert.doesNotMatch(html, /NaN|Infinity|undefined/);
  assert.doesNotMatch(html, /sky-limiting/);
  assert.match(hero(hours, { limitingChecks: ["Fire danger is elevated (Moderate)", "Check fire locations"] }),
    /<ul class="sky-limiting" aria-label="Checks setting the decision"><li>Fire danger is elevated \(Moderate\)<\/li><li>Check fire locations<\/li><\/ul>/);
});

test("a status shows right under the subtitle, before the decision", () => {
  const hours = buildSkyHours([row({})], plan);
  const html = hero(hours, { status: <div className="sky-passed">This start has passed.</div> });
  assert.ok(html.indexOf("sky-passed") > html.indexOf("sky-subtitle"));
  assert.ok(html.indexOf("sky-passed") < html.indexOf("field-verdict-title"));
});

test("missing hours are never described as within limits", () => {
  const hours = buildSkyHours([row({ complete: false, pass: false, gust: NaN, temp: NaN })], plan);
  const html = hero(hours);
  assert.match(html, /Some hours have incomplete readings/);
  assert.match(html, /Readings incomplete for this hour/);
  assert.doesNotMatch(html, /Within your limits all day/);
  assert.doesNotMatch(html, /NaN/);
});

test("without an hourly forecast the sky is a picture, not a slider", () => {
  const html = hero([]);
  assert.match(html, /Hourly forecast unavailable/);
  assert.doesNotMatch(html, /role="slider"/);
});

function briefWorkspace(overrides = {}, dataOverrides = {}) {
  const preferences = getDefaultUserPreferences();
  const safetyData = {
    safety: { score: 74, tier: "Low risk", evidenceQuality: null },
    alerts: { status: "ok", activeCount: 0, alerts: [] },
    airQuality: { usAqi: 32, category: "Good" },
    rainfall: { expected: { rainWindowIn: 0.07, snowWindowIn: null } },
    solar: { sunrise: "06:52", sunset: "19:30" },
    terrainCondition: { label: "Mostly dry" },
    avalanche: { relevant: false, relevanceReason: "Off-season" },
    fireRisk: { level: 1, label: "Low" },
    ...dataOverrides,
  };
  return {
    preferences,
    safetyData,
    interpretation: interpret(safetyData, { travel_window_hours: "12" }),
    formatWindDisplay: (v) => `${v} mph`, formatTempDisplay: (v) => `${v}°F`, formatElevationDisplay: (v) => `${v} ft`,
    formatClockForStyle: (v) => v || "—", localizeUnitText: (t) => t,
    sunriseMinutesForPlan: 412, sunsetMinutesForPlan: 1170, startMinutesForPlan: 420, returnMinutes: 1140,
    returnTimeDisplay: "19:00", displayStartTime: "07:00",
    nwsAlertCount: 0, nwsTopAlerts: [],
    elevationForecastBands: [], gearRecommendations: [],
    ...overrides,
  };
}
const brief = (w, hours = buildSkyHours([row()], plan)) => renderToStaticMarkup(
  <BriefSections w={w} hours={hours} clock={fmt.clock} scoreValue={74} insufficient={false} bridge=""
    onOpen={() => {}} onReadAll={() => {}} routeEnabled gearEnabled />);

test("alerts the feed cannot date are not presented as clear", () => {
  const html = brief(briefWorkspace());
  assert.match(html, /Not confirmed/);
  assert.doesNotMatch(html, /None active/);
  const clear = brief(briefWorkspace({}, { alerts: { status: "none", activeCount: 0, alerts: [] } }));
  assert.match(clear, /None active/);
});

test("the brief flags a return after sunset and keeps unavailable totals unavailable", () => {
  const html = brief(briefWorkspace({ returnMinutes: 1200 }));
  assert.match(html, /Back 30 min after sunset/);
  assert.match(html, /Expected snow unavailable/);
  assert.doesNotMatch(html, /NaN|Infinity|undefined/);
});

test("peak gust is unavailable rather than calm when no gust was measured", () => {
  const html = brief(briefWorkspace(), buildSkyHours([row({ gust: NaN, complete: false, pass: false })], plan));
  assert.match(html, /Peak gust.*Unavailable/s);
  assert.doesNotMatch(html, /0 mph/);
});

const checkCard = (html, title) => html.slice(html.indexOf(`<span>${title}</span>`), html.indexOf("sky-chev", html.indexOf(`<span>${title}</span>`)));

test("incomplete weather hours are not described as within limits", () => {
  const html = brief(briefWorkspace(), buildSkyHours([row(), row({ time: "08:00", complete: false, pass: false, gust: NaN })], plan));
  const card = checkCard(html, "Weather");
  assert.match(card, /1 planned hour has incomplete readings/);
  assert.doesNotMatch(card, /Every planned hour is within your limits/);
});

test("terrain status follows the hazard code, not whether a label exists", () => {
  const status = (terrainCondition) => checkCard(brief(briefWorkspace({}, { terrainCondition })), "Terrain &amp; snow");
  assert.match(status({ code: "snow_ice", label: "Snow and ice" }), /is-over/);
  assert.match(status({ code: "weather_unavailable", label: "Weather unavailable" }), /is-missing/);
  assert.match(status({ code: "dry_firm", label: "Mostly dry" }), /is-ok/);
});

test("high fire danger is over the limit even when air quality is unavailable", () => {
  const card = checkCard(brief(briefWorkspace({}, { fireRisk: { level: 3, label: "High" }, airQuality: null })), "Air &amp; fire");
  assert.match(card, /is-over/);
  assert.match(card, /Fire risk high/);
});

import { plainRule, plainReason, durationLabel } from "../src/field/sky/status";
import { FreshnessChart } from "../src/field/sky/FreshnessChart";

test("limit breaches read as plain language and unknown text is left alone", () => {
  assert.equal(plainRule("gust 31>25 mph"), "Gusts 31 mph, over your 25 mph limit");
  assert.equal(plainRule("precip 80%>60%"), "Rain chance 80%, over your 60% limit");
  assert.equal(plainRule("feels 12°F<20°F"), "Feels like 12°F, below your 20°F floor");
  assert.equal(plainRule("condition: Thunderstorms"), "Thunderstorms forecast");
  assert.equal(plainRule("Something else"), "Something else");
  assert.equal(plainReason("Hourly evidence is incomplete. gust 31>25 mph", ["gust 31>25 mph"]),
    "Hourly evidence is incomplete. Gusts 31 mph, over your 25 mph limit");
});

test("durations switch to hours without losing minutes", () => {
  assert.equal(durationLabel(30), "30 min");
  assert.equal(durationLabel(210), "3 h 30 min");
  assert.equal(durationLabel(-120), "2 h");
});

test("the freshness chart draws the backend state, and a missing timestamp as missing", () => {
  const html = renderToStaticMarkup(<FreshnessChart
    rows={[{ label: "Alerts", issued: null, staleHours: 6, displayValue: null, state: "missing" }, { label: "Weather", issued: new Date().toISOString(), staleHours: 12, displayValue: null, state: "fresh" }]}
    age={() => "just now"} stamp={() => "today"} />);
  assert.match(html, /is-missing[^]*Alerts[^]*Missing/);
  assert.match(html, /Weather[^]*Current/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

import { MountainSection } from "../src/field/sky/MountainSection";
import { spreadLabels } from "../src/field/sky/spread-labels";

test("spreadLabels keeps order, spacing and bounds", () => {
  assert.deepEqual(spreadLabels([100, 300], 38, 20, 400), [100, 300]);
  const ys = spreadLabels([200, 180, 190], 38, 20, 400);
  const sorted = [...ys].sort((a, b) => a - b);
  assert.deepEqual(ys.map((v) => sorted.indexOf(v)), [2, 0, 1]);
  assert.ok(sorted[1] - sorted[0] >= 38 && sorted[2] - sorted[1] >= 38);
  assert.ok(Math.abs((sorted[0] + sorted[2]) / 2 - 190) < 1e-9);
  assert.deepEqual(spreadLabels([5, 10], 38, 20, 400), [20, 58]);
  assert.deepEqual(spreadLabels([395, 398], 38, 20, 400), [362, 400]);
});

test("MountainSection band labels never overlap when bands are 500 ft apart", () => {
  const band = (label, elevationFt, temp, windGust) => ({ label, elevationFt, temp, feelsLike: temp, windSpeed: 0, windGust });
  const html = renderToStaticMarkup(
    <MountainSection
      bands={[band("Lower Terrain", 4274, 44, 97), band("Mid Terrain", 5074, 41, 99), band("Near Objective", 5774, 39, 101), band("Objective Elevation", 6274, 37, 102)]}
      objectiveFt={6274} objectiveLabel="Objective" target={null}
      levels={[{ label: "Freezing level", ft: 10072, tone: "cold" }]} sky={null}
      format={{ elevation: (ft) => `${ft} ft`, temp: (f) => `${f}°F`, wind: (m) => `${m} mph` }}
    />,
  );
  const ys = [...html.matchAll(/y="([\d.-]+)" class="mt-band-name"/g)].map((m) => Number(m[1]));
  assert.equal(ys.length, 4);
  ys.sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i += 1) assert.ok(ys[i] - ys[i - 1] >= 38, `labels ${ys[i - 1]} and ${ys[i]} overlap`);
});

test("sky hours keep the planned wind reading", () => {
  const [hour] = buildSkyHours([row({ wind: 9 })], plan);
  assert.equal(hour.wind, 9);
});

test("MountainSection names the selected forecast time for screen readers", async () => {
  const { MountainSection } = await import("../src/field/sky/MountainSection");
  const props = {
    bands: [{ label: "Objective Elevation", elevationFt: 9000, deltaFromObjectiveFt: 0, temp: 33, feelsLike: 26, windSpeed: 10, windGust: 20 }],
    objectiveFt: 9000, objectiveLabel: "Objective", target: null, levels: [], sky: null,
    format: { elevation: (ft) => `${ft} ft`, temp: (f) => `${f}°F`, wind: (m) => `${m} mph` },
  };
  assert.match(renderToStaticMarkup(<MountainSection {...props} />), /Conditions by elevation at your start/);
  assert.match(renderToStaticMarkup(<MountainSection {...props} when="at 11:00 AM" />), /Conditions by elevation at 11:00 AM/);
});

test("MountainSection draws the hour's weather: snow above the snow level, rain below", async () => {
  const { MountainSection } = await import("../src/field/sky/MountainSection");
  const props = {
    bands: [
      { label: "Approach Terrain", elevationFt: 6000, deltaFromObjectiveFt: -4000, temp: 40, feelsLike: 36, windSpeed: 6, windGust: 15 },
      { label: "Objective Elevation", elevationFt: 10000, deltaFromObjectiveFt: 0, temp: 28, feelsLike: 20, windSpeed: 10, windGust: 20 },
    ],
    objectiveFt: 10000, objectiveLabel: "Objective", target: null,
    levels: [{ label: "Snow level", ft: 8000, tone: "snow" }], sky: null,
    format: { elevation: (ft) => `${ft} ft`, temp: (f) => `${f}°F`, wind: (m) => `${m} mph` },
  };
  const wet = renderToStaticMarkup(<MountainSection {...props} weather={{ kind: "rain", condition: "Rain Showers Likely", precipChance: 70, night: false }} />);
  assert.match(wet, /class="mt-condition"[^>]*>Rain Showers Likely · 70% precip</);
  assert.match(wet, /mt-flake/, "snow falls above the snow level");
  assert.match(wet, /mt-drop/, "rain falls below the snow level");
  assert.match(wet, /mt-cloud is-heavy/);
  assert.match(wet, /aria-label="Conditions by elevation at your start\. Rain Showers Likely · 70% precip\./);
  const clear = renderToStaticMarkup(<MountainSection {...props} weather={{ kind: "clear", condition: "Sunny", precipChance: 0, night: false }} />);
  assert.match(clear, /mt-sun/);
  assert.doesNotMatch(clear, /mt-cloud|mt-drop|mt-flake/);
  assert.match(clear, />Sunny</);
  assert.doesNotMatch(renderToStaticMarkup(<MountainSection {...props} />), /mt-weather|mt-condition/);
  const unknown = renderToStaticMarkup(<MountainSection {...props} weather={{ kind: "neutral", condition: "Unavailable", precipChance: NaN, night: true }} />);
  assert.doesNotMatch(unknown, /mt-sun|mt-moon|mt-star/, "an unknown sky is not drawn as clear");
  assert.match(unknown, />Unavailable</);
  const long = "Slight Chance Rain And Snow Showers Then Mostly Cloudy";
  const verbose = renderToStaticMarkup(<MountainSection {...props} weather={{ kind: "snow", condition: long, precipChance: 20, night: false }} />);
  assert.match(verbose, /class="mt-condition"[^>]*>Slight Chance Rain And Snow Sho… · 20% precip</);
  assert.ok(verbose.includes(`aria-label="Conditions by elevation at your start. ${long} · 20% precip.`), "screen readers get the full condition");
});

test("an hour missing only precipitation still has elevation inputs; a missing temperature does not", async () => {
  const data = { weather: { temp: 40, windSpeed: 5, windGust: 10, trend: [
    { time: "07:00", temp: 40, wind: 5, gust: 10, precipChance: 10, condition: "Clear" },
    { time: "08:00", temp: 42, wind: 6, gust: 12, precipChance: null, condition: "Clear" },
    { time: "09:00", temp: null, wind: 6, gust: 12, precipChance: 10, condition: "Clear" },
  ] } };
  const rows = plannedRows(data, 4);
  const hours = buildSkyHours(rows, plan);
  assert.deepEqual(hours.map((h) => h.tone === "missing"), [false, true, true, true]);
  assert.deepEqual(hours.map((h) => h.thermalComplete), [true, true, false, false]);
});

test("a hidden sky keeps its last width instead of drawing at zero width", async () => {
  const { JSDOM } = await import("jsdom");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/" });
  // Reduced motion skips the sun's requestAnimationFrame entrance.
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const previous = { window: globalThis.window, document: globalThis.document, ResizeObserver: globalThis.ResizeObserver };
  let resize = null;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.ResizeObserver = class { constructor(callback) { resize = (width) => callback([{ contentRect: { width } }]); } observe() {} disconnect() {} };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.getElementById("root"));
  try {
    const hours = buildSkyHours(Array.from({ length: 12 }, (_, i) =>
      row({ time: `${String(7 + i).padStart(2, "0")}:00`, condition: "Rain showers", precipChance: 60 })), plan);
    await act(async () => root.render(
      <SkyHero hours={hours} sunrise={412} sunset={1170} kicker="Conditions report" title="Test Peak" subtitle="Wed"
        level="CAUTION" headline="Adjust timing" reason="Rain at noon" format={fmt} />));
    await act(async () => resize(640));
    const svg = () => document.querySelector("svg.sky-canvas");
    assert.match(svg().getAttribute("viewBox"), /^0 0 640 /);
    // display: none (or a zero-size viewport) reports a 0-wide content box.
    await act(async () => resize(0));
    assert.match(svg().getAttribute("viewBox"), /^0 0 640 /);
    const offsets = [...svg().querySelectorAll("linearGradient stop")].map((stop) => stop.getAttribute("offset"));
    assert.ok(offsets.every((offset) => Number.isFinite(Number(offset))), offsets.join(" "));
    const radii = [...svg().querySelectorAll("ellipse")].map((ellipse) => Number(ellipse.getAttribute("rx")));
    assert.ok(radii.length > 0 && radii.every((rx) => rx > 0), radii.join(" "));
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, previous);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});

test("missing temperature and rain chance read as unknown, never 0°F or 0%", async () => {
  const data = { weather: { temp: 40, windSpeed: 5, windGust: 10, trend: [
    { time: "07:00", temp: null, wind: 5, gust: null, precipChance: null, condition: "Clear" },
    { time: "08:00", temp: 42, wind: 6, gust: 12, precipChance: 10, condition: "Clear" },
  ] } };
  const rows = plannedRows(data, 2);
  assert.ok(Number.isNaN(rows[0].temp) && Number.isNaN(rows[0].feelsLike) && Number.isNaN(rows[0].precipChance));
  assert.equal(rows[1].temp, 42);
  const html = hero(buildSkyHours(rows, plan));
  assert.match(html, /<div class="sky-readout-big">—<\/div>/);
  assert.match(html, /7:00: temperature unavailable, gust unavailable, rain chance unavailable/);
  assert.doesNotMatch(html, />0°</);

  // A planned hour that straddles a gap keeps the reading that exists.
  const straddle = plannedRows({ weather: { trend: [
    { time: "07:00", temp: null, wind: null, gust: null, precipChance: 20, condition: "Clear" },
    { time: "08:00", temp: 42, wind: 6, gust: 12, precipChance: 70, condition: "Rain" },
  ] } }, 1, { start: "07:30" })[0];
  assert.deepEqual([straddle.temp, straddle.wind, straddle.gust, straddle.precipChance], [42, 6, 12, 70]);
  assert.equal(straddle.complete, false);
});
