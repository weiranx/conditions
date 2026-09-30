import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SkyHero } from "../src/field/sky/SkyHero";
import { BriefSections } from "../src/field/sky/BriefSections";
import { TilePopup } from "../src/field/sky/TilePopup";
import { plainHeadline } from "../src/field/sky/plain-headline";
import { WeatherDetail, AlertsDetail, DaylightDetail } from "../src/field/sky/TileDetails";
import { Timing } from "../src/field/Timing";
import { formatClockForStyle } from "../src/app/core";
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
const SECTIONS = ["forecast", "timing", "terrain", "route", "sources", "gear"];
const brief = (w, hours = buildSkyHours([row()], plan), activity = "backcountry", sections = SECTIONS) => renderToStaticMarkup(
  <BriefSections w={w} hours={hours} clock={fmt.clock}
    onOpen={() => {}} onReadAll={() => {}} gearEnabled activity={activity} />);
const cardOrder = (html) => [...html.matchAll(/sky-check[^"]*"><span class="sky-card-head">(?:<svg.*?<\/svg>)?<span>([^<]+)</gs)].map((m) => m[1]);
const checkOrder = cardOrder;
const checkCard = (html, title) => html.slice(html.indexOf(`<span>${title}</span>`), html.indexOf("sky-open", html.indexOf(`<span>${title}</span>`)));
const NO_ALERTS = { alerts: { status: "none", activeCount: 0, alerts: [] } };

test("the checks read in the activity's order and say so", () => {
  const w = briefWorkspace({}, NO_ALERTS);
  assert.deepEqual(checkOrder(brief(w)), ["Weather", "Alerts", "Daylight", "Terrain &amp; snow", "Avalanche", "Air &amp; fire"]);
  const ski = brief(w, undefined, "ski-touring");
  assert.deepEqual(checkOrder(ski), ["Avalanche", "Terrain &amp; snow", "Weather", "Alerts", "Daylight", "Air &amp; fire"]);
  assert.match(ski, /Ordered for ski touring: avalanche and snowpack first/);
  assert.doesNotMatch(brief(w), /Ordered for/);
});

test("every check is a tile with its value up front", () => {
  const html = brief(briefWorkspace({}, NO_ALERTS));
  assert.deepEqual(cardOrder(html), ["Weather", "Alerts", "Daylight", "Terrain &amp; snow", "Avalanche", "Air &amp; fire"]);
  assert.match(checkCard(html, "Terrain &amp; snow"), /sky-status is-ok">.*Mostly dry/);
  assert.match(checkCard(html, "Air &amp; fire"), /AQI 32/);
  assert.match(checkCard(html, "Weather"), /Every planned hour is within your limits/);
  assert.match(html, /sky-card-head"><svg/, "each tile leads with its icon");
});

// A tile's drawing is scaled to the tile: SVG text at 11px rendered at about 7px in a phone's two-column
// grid, and the sunset dot sat on its own label. Labels that must stay readable are plain text.
test("the avalanche tile draws the danger scale as five numbered steps with the current one marked", () => {
  const tile = checkCard(brief(briefWorkspace({}, { ...NO_ALERTS, avalanche: { relevant: true, dangerLevel: 3 } })), "Avalanche");
  const steps = [...tile.matchAll(/<span aria-hidden="true" title="[A-Za-z]+"[^>]*>([1-5])<\/span>/g)].map((step) => step[1]);
  assert.deepEqual(steps, ["1", "2", "3", "4", "5"], "numerals rather than abbreviated words");
  assert.match(tile, /class="is-over">3<\/span>/, "the current step is marked, and Considerable reads as over the line");
  assert.match(tile, /aria-label="Avalanche danger 3 of 5\."/);
  assert.doesNotMatch(tile.match(/<span class="sky-danger".*?<\/span><\/span>/)[0], /<svg|<text/, "no chart text to shrink with the tile");
});

test("the daylight tile puts sunrise and sunset under the arc as text, not inside the drawing", () => {
  const tile = checkCard(brief(briefWorkspace({}, NO_ALERTS)), "Daylight");
  assert.doesNotMatch(tile.match(/<svg.*?<\/svg>/s)[0], /<text/, "no chart text to shrink with the tile");
  assert.match(tile, /class="sky-viz-ends" aria-hidden="true"><span>06:52<\/span><span>19:30<\/span>/);
});

test("a failing check leads whatever the activity puts first", () => {
  const w = briefWorkspace({ returnMinutes: 1200 }, NO_ALERTS);
  assert.equal(checkOrder(brief(w, undefined, "ski-touring"))[0], "Daylight");
});

test("alerts the feed cannot date are not presented as clear", () => {
  const html = brief(briefWorkspace());
  assert.match(html, /Not confirmed/);
  assert.doesNotMatch(html, /None active/);
  assert.match(checkCard(html, "Alerts"), /is-missing/);
  const clear = brief(briefWorkspace({}, NO_ALERTS));
  assert.match(checkCard(clear, "Alerts"), /None active/);
});

test("the brief flags a return after sunset", () => {
  const html = brief(briefWorkspace({ returnMinutes: 1200 }));
  assert.match(html, /Back 30 min after sunset/);
  assert.doesNotMatch(html, /NaN|Infinity|undefined/);
});

test("incomplete weather hours are not described as within limits", () => {
  const html = brief(briefWorkspace(), buildSkyHours([row(), row({ time: "08:00", complete: false, pass: false, gust: NaN })], plan));
  const card = checkCard(html, "Weather");
  assert.match(card, /1 planned hour has incomplete readings/);
  assert.doesNotMatch(card, /Every planned hour is within your limits/);
  assert.doesNotMatch(card, /sky-status is-ok/);
});

test("terrain status follows the hazard code, not whether a label exists", () => {
  const html = (terrainCondition) => brief(briefWorkspace({}, { terrainCondition }));
  assert.match(checkCard(html({ code: "snow_ice", label: "Snow and ice" }), "Terrain &amp; snow"), /is-over/);
  assert.match(checkCard(html({ code: "weather_unavailable", label: "Weather unavailable" }), "Terrain &amp; snow"), /is-missing/);
  assert.match(checkCard(html({ code: "dry_firm", label: "Mostly dry" }), "Terrain &amp; snow"), /is-ok/);
});

test("high fire danger is over the limit even when air quality is unavailable", () => {
  const card = checkCard(brief(briefWorkspace({}, { fireRisk: { level: 3, label: "High" }, airQuality: null })), "Air &amp; fire");
  assert.match(card, /is-over/);
  assert.match(card, /Fire risk high/);
});

test("the overnight refreeze reads in the terrain check on a snow trip, never firm without a measured night", () => {
  const terrain = (signals) => checkCard(
    brief(briefWorkspace({}, { terrainCondition: { code: "snow_ice", label: "Snow", signals } }), undefined, "snow-climbing"), "Terrain &amp; snow");
  const weak = terrain({ refreezeQuality: "weak", freezeThawMinTempF: 36 });
  assert.match(weak, /Overnight refreeze: weak/);
  assert.match(weak, /Night low 36°F/);
  assert.match(weak, /stays above freezing/);
  assert.match(terrain({ refreezeQuality: "strong", freezeThawMinTempF: 20 }), /Overnight refreeze: strong/);
  assert.doesNotMatch(terrain({}), /refreeze|Firm/);
  const hiking = checkCard(brief(briefWorkspace({}, { terrainCondition: { code: "snow_ice", signals: { refreezeQuality: "weak" } } }), undefined, "hiking"), "Terrain &amp; snow");
  assert.doesNotMatch(hiking, /refreeze/, "only snow trips lead with the refreeze");
});

test("the brief links to the full report instead of repeating a section list", () => {
  const w = briefWorkspace({ returnMinutes: 1200, nwsAlertCount: 2 });
  const html = brief(w, undefined, "ski-touring");
  assert.doesNotMatch(html, /sky-sections|sky-section-link|sky-nums/);
  assert.match(html, /Read the full report/);
  assert.match(html, /Ordered for ski touring/);
  const full = renderToStaticMarkup(<BriefSections w={w} hours={buildSkyHours([row()], plan)} clock={fmt.clock}
    onOpen={() => {}} onReadAll={() => {}} gearEnabled activity="hiking" showMore={false} />);
  assert.doesNotMatch(full, /Read the full report/, "the full report already contains every section");
});

test("a tile's popup shows its value, its summary and a way into the section", () => {
  const html = renderToStaticMarkup(<TilePopup detail={{ title: "Daylight", status: "over", value: "Back 1 h after sunset",
    caption: "Back at 8:30 PM, sunset 7:30 PM.", to: "timing" }} onClose={() => {}} onOpen={() => {}} />);
  assert.match(html, /<h2 id="sky-popup-title">Daylight<\/h2>/);
  assert.match(html, /sky-popup-value is-over">Back 1 h after sunset/);
  assert.match(html, /Summary[^]*Back at 8:30 PM, sunset 7:30 PM\./);
  assert.match(html, /Open Timing/);
});

test("the headline names what crosses your limits and when", () => {
  const clock = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
  const over = (time, failedRules) => row({ time, pass: false, failedRules });
  const hours = buildSkyHours([row(), over("08:00", ["gust 40>25 mph", "precip 80%>60%"]), over("09:00", ["gust 38>25 mph"])], plan);
  assert.equal(plainHeadline(hours, clock), "Strong wind and rain during 8:00–10:00");
  const cold = buildSkyHours([over("07:00", ["feels 5°F<15°F"]), row(), over("09:00", ["feels 3°F<15°F"])], plan);
  assert.equal(plainHeadline(cold, clock), "Cold from 7:00");
  const night = buildSkyHours([row({ time: "22:00" }), row({ time: "23:00" }), over("00:00", ["gust 40>25 mph"]), over("01:00", ["gust 41>25 mph"])], { ...plan, start: "22:00" });
  assert.match(plainHeadline(night, (m) => `${Math.floor((m % 1440) / 60)}:00`), /^Strong wind after midnight, 0:00–2:00$/, "an overnight window says it is after midnight");
  assert.equal(plainHeadline(buildSkyHours([row(), row({ time: "08:00" })], plan), clock), null, "nothing over, keep the decision's own headline");
  assert.equal(plainHeadline(buildSkyHours([over("07:00", ["something unusual"])], plan), clock), null, "an unnamed cause is not guessed");
});

test("the weather tile shows the sky, the low and high, and how it feels", () => {
  const hours = buildSkyHours([row({ temp: 41, condition: "Cloudy" }), row({ time: "08:00", temp: 58, condition: "Cloudy" }), row({ time: "09:00", temp: 67, condition: "Sunny" })], plan);
  const html = brief(briefWorkspace({}, { pleasantness: { score: 68, label: "Mixed", summary: "" } }), hours);
  const card = checkCard(html, "Weather");
  assert.match(card, /sky-status is-ok">.*Cloudy/, "the most common sky leads");
  assert.match(card, /L 41°F/);
  assert.match(card, /H 67°F/);
  assert.match(card, /Comfort<\/span><strong>Mixed<\/strong>/);
  assert.match(card, /aria-label="Comfort 68 of 100"/);
  // A rough spell names the sky before the calm hours do, and says when.
  const rough = brief(briefWorkspace(), buildSkyHours([row({ condition: "Sunny" }), row({ time: "08:00", condition: "Rain showers", pass: false, failedRules: ["gust 40>25 mph"] })], plan));
  assert.match(checkCard(rough, "Weather"), /sky-status is-over">.*Rain showers/);
  assert.match(checkCard(rough, "Weather"), /Gusts 40 mph, over your 25 mph limit · 8:00/);
  // No comfort assessment, no comfort line; no temperatures, no range.
  const bare = checkCard(brief(briefWorkspace(), buildSkyHours([row({ temp: NaN, complete: false, pass: false })], plan)), "Weather");
  assert.doesNotMatch(bare, /Comfort|L NaN|undefined/);
});

test("the weather popup charts the planned hours and reads the worst one first", () => {
  const w = briefWorkspace();
  const hours = buildSkyHours([row({ gust: 12 }), row({ time: "08:00", gust: 40, pass: false, failedRules: ["gust 40>25 mph"] })], plan);
  const html = renderToStaticMarkup(<WeatherDetail w={w} hours={hours} />);
  assert.match(html, /aria-pressed="true"[^>]*>Gusts</, "the gust measurement opens first");
  assert.match(html, /Rain chance/);
  assert.match(html, /sky-popup-readout"><strong>40 mph<\/strong>/, "the first hour over a limit is selected");
  assert.match(html, /your limit 25 mph/);
  assert.doesNotMatch(html, /NaN|undefined/);
  assert.match(renderToStaticMarkup(<WeatherDetail w={w} hours={[]} />), /Hourly forecast unavailable/);
});

test("the alerts and daylight popups list what they are based on", () => {
  const w = briefWorkspace({}, { alerts: { status: "ok", activeCount: 1, alerts: [{ event: "Wind Advisory", severity: "Moderate", headline: "Gusts to 45 mph" }] } });
  const alerts = renderToStaticMarkup(<AlertsDetail w={w} />);
  assert.match(alerts, /Wind Advisory/);
  assert.match(alerts, /Gusts to 45 mph/);
  const empty = renderToStaticMarkup(<AlertsDetail w={briefWorkspace({}, { alerts: null })} />);
  assert.match(empty, /feed did not respond/);
  const daylight = renderToStaticMarkup(<DaylightDetail w={briefWorkspace({ alpineStartTime: "07:00", travelWindowHours: 10 })} />);
  assert.match(daylight, /Sunrise/);
  assert.match(daylight, /Spare at return/);
});

test("sunrise and sunset read on the traveler's clock in the daylight chart and the timing chapter", () => {
  const timing = (timeStyle) => renderToStaticMarkup(<Timing hours={[]} workspace={briefWorkspace({
    preferences: { ...getDefaultUserPreferences(), timeStyle },
    formatClockForStyle,
    startTimeScenarios: { comparison: null, loading: false, error: null, canGenerateMore: false, generateMore() {} },
    alpineStartTime: "07:00", travelWindowHours: 10, returnExtendsPastMidnight: false,
  }, { solar: { sunrise: "6:52 AM", sunset: "7:30 PM" }, featureFlags: {} })} />);
  const twelve = timing("ampm");
  assert.match(twelve, /<dt>Sunrise<\/dt><dd>6:52 AM<\/dd>/);
  assert.match(twelve, /<dt>Sunset<\/dt><dd>7:30 PM<\/dd>/);
  assert.match(twelve, /6:52 AM sunrise/);
  const twentyFour = timing("24h");
  assert.match(twentyFour, /<dt>Sunrise<\/dt><dd>06:52<\/dd>/);
  assert.match(twentyFour, /<dt>Sunset<\/dt><dd>19:30<\/dd>/);
  assert.match(twentyFour, /19:30 sunset/);
  assert.doesNotMatch(twentyFour.slice(twentyFour.indexOf("Your day outside")), /[AP]M/);
});

test("when an alert ends reads on the traveler's clock", () => {
  const alert = { event: "Wind Advisory", severity: "Moderate", headline: "Gusts to 45 mph", ends: "2026-09-17T21:00:00Z" };
  const until = (timeStyle) => renderToStaticMarkup(<AlertsDetail w={briefWorkspace({ preferences: { ...getDefaultUserPreferences(), timeStyle } },
    { alerts: { status: "ok", activeCount: 1, alerts: [alert] } })} />).match(/Until [^<]*/)?.[0];
  assert.match(until("ampm"), /\b[AP]M\b/);
  assert.match(until("24h"), /Until \w+,? \d{2}:\d{2}/);
  assert.doesNotMatch(until("24h"), /\b[AP]M\b/);
});

test("the activity's two headline numbers sit above the checks, each against your limit", () => {
  const w = briefWorkspace();
  const tiles = (html) => [...html.matchAll(/sky-number-tile[^"]*"><span class="sky-tile-label">([^<]+)/g)].map((m) => m[1]);
  assert.deepEqual(tiles(brief(w)), ["Peak gust", "Rain expected"]);
  assert.deepEqual(tiles(brief(w, undefined, "ski-touring")), ["Snow expected", "Peak gust"]);
  assert.deepEqual(tiles(brief(w, undefined, "mountaineering")), ["Peak gust", "Coldest feels-like"]);
  assert.deepEqual(tiles(brief(w, undefined, "trail-running")), ["Warmest feels-like", "Rain expected"]);
  assert.deepEqual(tiles(brief(w, undefined, "snow-climbing")), ["Overnight refreeze", "Snow expected"]);
  const over = brief(briefWorkspace(), buildSkyHours([row({ gust: 40 })], plan));
  assert.match(over, /sky-number-tile is-over[^]*40 mph/);
  assert.match(over, /limit 25 mph/);
  const none = brief(briefWorkspace(), buildSkyHours([row({ gust: NaN, complete: false, pass: false })], plan));
  assert.match(none, /Peak gust<\/span><span class="sky-big">—/, "no gust reading is not calm");
  assert.doesNotMatch(none, /NaN|undefined/);
});

test("feels-like numbers are checked against the matching limit", () => {
  const w = briefWorkspace();
  const { minFeelsLikeF, maxFeelsLikeF } = w.preferences;
  const hot = buildSkyHours([row({ feelsLike: maxFeelsLikeF + 6 }), row({ time: "08:00", feelsLike: 60 })], plan);
  assert.match(brief(w, hot, "trail-running"), new RegExp(`sky-number-tile is-over[^]*${maxFeelsLikeF + 6}°F`));
  const cold = buildSkyHours([row({ feelsLike: minFeelsLikeF - 4 }), row({ time: "08:00", feelsLike: 30 })], plan);
  const html = brief(w, cold, "mountaineering");
  assert.match(html, /sky-number-tile is-over[^]*Coldest feels-like/);
  assert.match(html, new RegExp(`floor ${minFeelsLikeF}°F`));
});

test("the pack list and extras wait under More", () => {
  const w = briefWorkspace({ gearRecommendations: [{ title: "Headlamp", category: "Safety", reason: "Dark before you're back" }] });
  const html = brief(w);
  assert.match(html, /sky-fold[^]*<h2 id="sky-more">More<\/h2>[^]*Pack for today[^]*Headlamp/);
  assert.match(html, /<details>/, "closed until asked for");
  assert.doesNotMatch(html, /<details open/);
  const none = brief(briefWorkspace());
  assert.doesNotMatch(none, /sky-more/, "nothing to show, no More");
});

test("a check never reads clear over data it cannot confirm", () => {
  const noAqi = brief(briefWorkspace({}, { airQuality: null }));
  assert.match(checkCard(noAqi, "Air &amp; fire"), /AQI unavailable/);
  assert.doesNotMatch(checkCard(noAqi, "Air &amp; fire"), /sky-status is-ok/);
});

test("the freezing level is not compared with an unknown objective elevation", () => {
  const card = (elevation) => checkCard(brief(briefWorkspace({}, { weather: { elevation }, atmosphere: { freezingLevelFt: 11000 },
    terrainCondition: { code: "snow_ice", signals: { refreezeQuality: "weak", freezeThawMinTempF: 30 } } }), undefined, "snow-climbing"), "Terrain &amp; snow");
  assert.match(card(9000), /freezing level sits above the objective/);
  assert.doesNotMatch(card(null), /freezing level/);
});

test("every brief card names the section it opens", () => {
  const html = brief(briefWorkspace({ returnMinutes: 1200 }));
  const opens = (title) => (checkCard(html, title) + html.slice(html.indexOf("sky-open", html.indexOf(`<span>${title}</span>`))).slice(0, 400))
    .match(/sky-open">Open ([^<]+)/)[1];
  assert.equal(opens("Alerts"), "Checks &amp; sources");
  assert.equal(opens("Daylight"), "Timing");
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
