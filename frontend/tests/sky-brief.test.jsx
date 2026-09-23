import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SkyHero } from "../src/field/sky/SkyHero";
import { BriefSections } from "../src/field/sky/BriefSections";
import { getDefaultUserPreferences } from "../src/app/preferences";
import { buildSkyHours, skyRuns, sunProgress, shortHour, spanLabel, isOverHour } from "../src/field/sky/sky-model";

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

function briefWorkspace(overrides = {}) {
  const preferences = getDefaultUserPreferences();
  return {
    preferences,
    safetyData: {
      safety: { score: 74, tier: "Low risk", evidenceQuality: null },
      alerts: { status: "ok", activeCount: 0, alerts: [] },
      airQuality: { usAqi: 32, category: "Good" },
      rainfall: { expected: { rainWindowIn: 0.07, snowWindowIn: null } },
      solar: { sunrise: "06:52", sunset: "19:30" },
      terrainCondition: { label: "Mostly dry" },
    },
    formatWindDisplay: (v) => `${v} mph`, formatTempDisplay: (v) => `${v}°F`, formatElevationDisplay: (v) => `${v} ft`,
    formatClockForStyle: (v) => v || "—", localizeUnitText: (t) => t,
    expectedTravelWindowHours: 12, expectedRainWindowDisplay: "0.07 in", expectedSnowWindowDisplay: "—",
    sunriseMinutesForPlan: 412, sunsetMinutesForPlan: 1170, startMinutesForPlan: 420, returnMinutes: 1140,
    returnTimeDisplay: "19:00", displayStartTime: "07:00",
    sourceFreshnessRows: [{ label: "Alerts", issued: null, staleHours: 6 }],
    nwsAlertCount: 0, nwsTopAlerts: [], overallAvalancheLevel: null, avalancheRelevant: false, avalancheNotApplicableReason: "Off-season",
    elevationForecastBands: [], fireRiskLabel: "Low", fireRiskLevel: 1, gearRecommendations: [],
    snowpackBestDepthDisplay: null, hasFreshnessWarning: false, freshnessWarningSummary: "",
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
  const clear = brief(briefWorkspace({ sourceFreshnessRows: [{ label: "Alerts", issued: null, staleHours: 6, stateOverride: "fresh" }] }));
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
  const status = (terrainCondition) => {
    const w = briefWorkspace();
    return checkCard(brief({ ...w, safetyData: { ...w.safetyData, terrainCondition } }), "Terrain &amp; snow");
  };
  assert.match(status({ code: "snow_ice", label: "Snow and ice" }), /is-over/);
  assert.match(status({ code: "weather_unavailable", label: "Weather unavailable" }), /is-missing/);
  assert.match(status({ code: "dry_firm", label: "Mostly dry" }), /is-ok/);
});

test("high fire danger is over the limit even when air quality is unavailable", () => {
  const w = briefWorkspace({ fireRiskLevel: 3, fireRiskLabel: "High" });
  const card = checkCard(brief({ ...w, safetyData: { ...w.safetyData, airQuality: null } }), "Air &amp; fire");
  assert.match(card, /is-over/);
  assert.match(card, /Fire risk high/);
});

import { plainRule, plainReason, durationLabel, terrainStatus } from "../src/field/sky/status";
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

test("terrain status matches the decision's hazard codes", () => {
  assert.equal(terrainStatus({ terrainCondition: { code: "snow_ice", label: "Snow and ice" } }), "over");
  assert.equal(terrainStatus({ terrainCondition: { code: "weather_unavailable", label: "Unavailable" } }), "missing");
  assert.equal(terrainStatus({ terrainCondition: null }), "missing");
  assert.equal(terrainStatus({ terrainCondition: { code: "dry_firm", label: "Dry" } }), "ok");
});

test("a source without a timestamp is drawn as missing, never current", () => {
  const html = renderToStaticMarkup(<FreshnessChart
    rows={[{ label: "Alerts", issued: null, staleHours: 6 }, { label: "Weather", issued: new Date().toISOString(), staleHours: 12 }]}
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
