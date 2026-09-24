import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BriefSections } from "../src/field/sky/BriefSections";
import { RouteNote } from "../src/field/sky/RouteNote";
import { buildSkyHours } from "../src/field/sky/sky-model";
import { getDefaultUserPreferences } from "../src/app/preferences";
import { interpret } from "./evaluation-fixtures";
import {
  buildRouteReportContext,
  checkpointBreaches,
  describeCheckpointBreach,
  summarizePlannedRoute,
} from "../src/field/route-planning";

const limits = { maxWindGustMph: 30, maxPrecipChance: 50, minFeelsLikeF: 10, maxFeelsLikeF: 90 };
const calm = { temp: 40, feelsLike: 35, windSpeed: 8, windGust: 15, precipChance: 10, description: "Clear" };
const stop = (over = {}) => ({
  name: "Trailhead", elev_ft: 6000, etaDate: "2026-09-26", etaTime: "06:00", offsetMinutes: 0,
  dataAvailable: true, score: 80, weather: calm, activeAlerts: 0, ...over,
});
const analysis = (summaries, extra = {}) => ({ waypoints: [], summaries, analysis: "", partialData: false, ...extra });
const summarize = (overrides = {}) => summarizePlannedRoute({
  name: "East Ridge", analysis: null, checking: null, error: null, limits,
  signedIn: true, available: true, saved: false, ...overrides,
});

test("no route is summarized when the plan has neither a route name nor an analysis", () => {
  assert.equal(summarize({ name: "  " }), null);
  assert.equal(summarize({ name: "" , analysis: analysis([stop()]) }).name, "Your route");
});

test("an analysis keeps the route name it was run for when the plan's route is renamed", () => {
  const result = analysis([stop()], { routeName: "East Ridge" });
  assert.equal(summarize({ name: "West Face", analysis: result }).name, "East Ridge");
  assert.equal(buildRouteReportContext("West Face", result).name, "East Ridge");
  assert.equal(summarize({ name: "West Face", checking: { routeName: "East Ridge" } }).name, "East Ridge");
  // Analyses saved before the name was stored fall back to the plan's route.
  assert.equal(summarize({ name: "West Face", analysis: analysis([stop()]) }).name, "West Face");
});

test("an unanalyzed route says whether it is being checked and why it was not", () => {
  assert.deepEqual(summarize({ checking: { checkpointCount: 5 } }), { state: "checking", name: "East Ridge", checkpointCount: 5 });
  assert.equal(summarize({ error: "Timed out" }).reason, "failed");
  assert.equal(summarize({ saved: true }).reason, "saved");
  assert.equal(summarize({ available: false }).reason, "unavailable");
  assert.equal(summarize({ signedIn: false }).reason, "sign-in");
  assert.equal(summarize().reason, "not-run");
});

test("a checked route counts crossings, keeps missing forecasts distinct, and names the first crossing", () => {
  const route = summarize({
    analysis: analysis([
      stop(),
      stop({ name: "Col", elev_ft: 9000, etaTime: "09:30", weather: { ...calm, windGust: 42 } }),
      stop({ name: "Summit", elev_ft: 11000, etaTime: "11:00", dataAvailable: false, weather: {} }),
      stop({ name: "Return to Trailhead", etaTime: "19:45", leg: "return", daylight: "dark", weather: { ...calm, precipChance: 70 } }),
    ], { routeMetadata: { distanceMiles: 9.4, elevationGainFt: 5100 } }),
  });
  assert.equal(route.state, "checked");
  assert.equal(route.tone, "over");
  assert.equal(route.overCount, 2);
  assert.equal(route.missingCount, 1);
  assert.deepEqual(route.firstOver, { name: "Col", eta: "09:30", breach: { kind: "gust", value: 42, limit: 30 } });
  assert.deepEqual(route.finish, { eta: "19:45", dark: true, returnToStart: true });
  assert.equal(route.distanceMiles, 9.4);
  assert.equal(route.gainFt, 5100);
  assert.deepEqual(route.profile.map((p) => Number(p.y.toFixed(2))), [0, 0.6, 1, 0]);
});

test("unknown elevations draw no profile, and a route with no forecasts is not within limits", () => {
  const unknown = summarize({ analysis: analysis([stop(), stop({ name: "Col", elev_ft: null })]) });
  assert.equal(unknown.profile, null);
  assert.equal(unknown.tone, "within");
  assert.equal(summarize({ analysis: analysis([]) }).tone, "missing");
});

test("checkpoint breaches read the forecast in °F and mph and ignore missing readings", () => {
  assert.deepEqual(checkpointBreaches(stop({ weather: { ...calm, feelsLike: 2 } }), limits), [{ kind: "cold", value: 2, limit: 10 }]);
  assert.deepEqual(checkpointBreaches(stop({ weather: { temp: 95, windSpeed: 2, precipChance: 60 } }), limits).map((b) => b.kind), ["precip", "heat"]);
  assert.deepEqual(checkpointBreaches(stop({ dataAvailable: false, weather: { windGust: 80 } }), limits), []);
  const format = { temp: (f) => `${f}°F`, wind: (mph) => `${mph} mph` };
  assert.equal(describeCheckpointBreach({ kind: "gust", value: 42, limit: 30 }, format), "gusts 42 mph, over your 30 mph limit");
  assert.equal(describeCheckpointBreach({ kind: "cold", value: 2, limit: 10 }, format), "feels like 2°F, below your 10°F floor");
});

const row = (over = {}) => ({
  time: "07:00", pass: true, complete: true, condition: "Clear", reasonSummary: "", failedRules: [], failedRuleLabels: [],
  temp: 60, feelsLike: 58, wind: 5, gust: 12, precipChance: 0, ...over,
});
const hours = buildSkyHours([row()], { start: "07:00", sunriseMinutes: 412, sunsetMinutes: 1170 });
function workspace() {
  const safetyData = {
    safety: { score: 74, tier: "Low risk", evidenceQuality: null },
    alerts: { status: "ok", activeCount: 0, alerts: [] },
    airQuality: { usAqi: 32, category: "Good" },
    rainfall: { expected: { rainWindowIn: 0.07, snowWindowIn: null } },
    solar: { sunrise: "06:52", sunset: "19:30" },
    terrainCondition: { label: "Mostly dry" },
    fireRisk: { level: 1, label: "Low" },
  };
  return {
    preferences: { ...getDefaultUserPreferences(), timeStyle: "24h" },
    safetyData,
    interpretation: interpret(safetyData, { travel_window_hours: "12" }),
    formatWindDisplay: (v) => `${v} mph`, formatTempDisplay: (v) => `${v}°F`, formatElevationDisplay: (v) => `${v} ft`,
    formatDistanceDisplay: (v) => `${v} mi`, formatElevationDeltaDisplay: (v) => `+${v} ft`,
    formatClockForStyle: (v) => (v ? `@${v}` : "—"), localizeUnitText: (t) => t,
    sunriseMinutesForPlan: 412, sunsetMinutesForPlan: 1170, startMinutesForPlan: 420, returnMinutes: 1140,
    returnTimeDisplay: "19:00", displayStartTime: "07:00",
    nwsAlertCount: 0, nwsTopAlerts: [],
    elevationForecastBands: [], gearRecommendations: [],
  };
}
const brief = (route) => renderToStaticMarkup(
  <BriefSections w={workspace()} hours={hours} clock={(m) => `${m}`} scoreValue={74} insufficient={false} bridge=""
    onOpen={() => {}} onReadAll={() => {}} sections={["forecast", "timing", "terrain", "route", "sources"]} route={route} gearEnabled />);
const routeSection = (html) => html.slice(html.indexOf("<strong>Route</strong>"), html.indexOf("</button>", html.indexOf("<strong>Route</strong>")));
const routeCard = (html) => html.slice(html.indexOf("is-route"), html.indexOf("<span>Weather</span>"));

test("the brief's checks lead with the planned route and its section says how it went", () => {
  const route = summarize({
    analysis: analysis([stop(), stop({ name: "Col", etaTime: "09:30", weather: { ...calm, windGust: 42 } }),
      stop({ name: "Return to Trailhead", etaTime: "15:00", leg: "return" })], { routeMetadata: { distanceMiles: 9.4, elevationGainFt: 5100 } }),
  });
  const html = brief(route);
  const card = routeCard(html);
  assert.ok(html.indexOf("is-route") < html.indexOf("<span>Weather</span>"), "the route card comes first");
  assert.match(card, /East Ridge/);
  assert.match(card, /9\.4 mi · \+5100 ft gain · 3 checkpoints/);
  assert.match(card, /sky-status is-over[^>]*>.*1 of 3 over/);
  assert.match(card, /Col at @09:30: gusts 42 mph, over your 30 mph limit\. Back at the start around @15:00\./);
  assert.match(card, /Checkpoints along East Ridge: Trailhead at @06:00, within your limits; Col at @09:30, over your limits/);
  assert.match(card, /Open Route/);
  assert.match(routeSection(html), /1 of 3 over/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test("without a planned route the brief keeps the Route section and no route card", () => {
  const html = brief(null);
  assert.doesNotMatch(html, /is-route/);
  assert.match(routeSection(html), /Check a route’s checkpoints/);
});

test("a route being checked or not checked is never shown as within limits", () => {
  const checking = routeCard(brief(summarize({ checking: { checkpointCount: 4 } })));
  assert.match(checking, /is-missing/);
  assert.match(checking, /Checking 4 checkpoints along the route/);
  const guest = routeCard(brief(summarize({ signedIn: false })));
  assert.match(guest, /Not checked/);
  assert.match(guest, /Sign in to check conditions/);
  const incomplete = routeCard(brief(summarize({ analysis: analysis([stop(), stop({ name: "Col", dataAvailable: false, weather: {} })]) })));
  assert.match(incomplete, /1 incomplete/);
  assert.doesNotMatch(incomplete, /Within limits/);
});

test("the hero note appears only when a checkpoint crosses a limit and says what the decision uses", () => {
  const format = { temp: (f) => `${f}°F`, wind: (mph) => `${mph} mph`, eta: (t) => t };
  const note = (route) => renderToStaticMarkup(<RouteNote route={route} format={format} onOpen={() => {}} />);
  assert.equal(note(summarize({ analysis: analysis([stop()]) })), "");
  assert.equal(note(summarize({ checking: {} })), "");
  const one = note(summarize({ analysis: analysis([stop(), stop({ name: "Col", etaTime: "09:30", weather: { ...calm, precipChance: 80 } })]) }));
  assert.match(one, /Along East Ridge, 1 of 2 checkpoints crosses your limits/);
  assert.match(one, / at Col around 09:30: rain chance 80%, over your 50% limit\./);
  assert.match(one, /The decision uses the objective’s forecast, not these checkpoints\./);
  const two = note(summarize({ analysis: analysis([stop({ weather: { ...calm, windGust: 40 } }), stop({ name: "Col", weather: { ...calm, windGust: 50 } })]) }));
  assert.match(two, /2 of 2 checkpoints cross your limits<\/strong>, first at Trailhead around 06:00/);
});

test("an official hazard within every limit is reported on the card and in the hero note", () => {
  const route = summarize({ analysis: analysis([
    stop(),
    stop({ name: "Col", etaTime: "09:30", avalanche: { risk: "Considerable", dangerLevel: 3 } }),
    stop({ name: "Summit", etaTime: "11:00", activeAlerts: 2 }),
  ]) });
  assert.equal(route.tone, "hazard");
  assert.equal(route.hazardCount, 2);
  assert.equal(route.overCount, 0);
  assert.deepEqual(route.firstHazard, { name: "Col", eta: "09:30", hazard: { kind: "avalanche", level: 3, risk: "Considerable" } });
  const card = routeCard(brief(route));
  assert.match(card, /sky-status is-over[^>]*>.*2 alerts or dangers/);
  assert.match(card, /Within your limits, but Col at @09:30 has Considerable avalanche danger\./);
  const format = { temp: (f) => `${f}°F`, wind: (mph) => `${mph} mph`, eta: (t) => t };
  const note = renderToStaticMarkup(<RouteNote route={route} format={format} />);
  assert.match(note, /2 of 3 checkpoints have an official hazard<\/strong>, first at Col around 09:30: Considerable avalanche danger\./);
  // A crossing still leads the note when both are present.
  const both = summarize({ analysis: analysis([stop({ activeAlerts: 1 }), stop({ name: "Col", weather: { ...calm, windGust: 50 } })]) });
  assert.equal(both.tone, "over");
  assert.match(renderToStaticMarkup(<RouteNote route={both} format={format} />), /crosses your limits/);
});

test("the AI report context keeps unknowns null and omits readings a checkpoint didn't return", () => {
  assert.equal(buildRouteReportContext("East Ridge", null), null);
  const context = buildRouteReportContext(" ", analysis([
    stop({ weather: { ...calm, windGust: undefined } }),
    stop({ name: "Col", elev_ft: null, dataAvailable: false, weather: {} }),
  ], { routeSourceDetails: { matchedName: "East Ridge Trail", sourceLabel: "OpenStreetMap route" }, timing: { basis: "distance" } }));
  assert.equal(context.name, "East Ridge Trail");
  assert.equal(context.source, "OpenStreetMap route");
  assert.equal(context.arrivalTiming, "distance");
  assert.equal(context.distanceMiles, null);
  assert.equal(context.checkpoints[0].windGustMph, null);
  assert.equal(context.checkpoints[0].feelsLikeF, 35);
  assert.equal(context.checkpoints[1].elevationFt, null);
  assert.equal(context.checkpoints[1].forecastAvailable, false);
  assert.equal("tempF" in context.checkpoints[1], false);
});
