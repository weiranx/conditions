import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { evaluateBackcountryDecision, trendRowsCoveringWindow } from "../src/app/decision";
import { buildTravelWindowInsights, deriveTravelWindowSpans } from "../src/app/travel-window";
import { buildDayOverDayChanges, formatScoreDelta, scoresComparable } from "../src/app/day-over-day";
import { formatAgeFromNow, localizeDistanceText } from "../src/app/core";
import { buildStartTimeScenario, compareStartTimeScenarios } from "../src/app/start-time-scenarios";
import { avalancheBriefCaption, buildAvalancheDisplayState } from "../src/app/avalanche-display";
import { getDefaultUserPreferences } from "../src/app/preferences";
import { ContingencyCard } from "../src/field/ContingencyCard";
import { ConditionTrend } from "../src/field/ConditionCharts";
import { makeReport } from "../dev/mock-data.mjs";

const preferences = getDefaultUserPreferences();
const clearDay = (start = "07:00", hours = 10) => makeReport({ date: "2026-09-06", start, travel_window_hours: hours }, "clear");

test("a fire decision says what sets the fire risk", () => {
  const data = clearDay();
  data.fireRisk = {
    status: "ok",
    level: 4,
    label: "Extreme",
    reasons: ["The Garda Falls fire (73 acres, 0% contained) is about 8 km (5 mi) away.", "Moderate AQI could affect exertion."],
  };
  const decision = evaluateBackcountryDecision(data, "07:00", preferences);
  assert.equal(decision.level, "NO-GO");
  assert.equal(decision.blockers[0],
    "Fire risk is extreme: The Garda Falls fire (73 acres, 0% contained) is about 5 mi away. Choose another area or time, verify closures, and do not enter fire-affected terrain.");
  const check = decision.checks.find((item) => item.key === "fire-risk");
  assert.equal(check.label, "Fire risk is below High");
  assert.equal(check.detail, "Extreme (L4). The Garda Falls fire (73 acres, 0% contained) is about 5 mi away.");
  const metric = evaluateBackcountryDecision(data, "07:00", { ...preferences, elevationUnit: "m" });
  assert.match(metric.blockers[0], /is about 8 km away\./);
});

test("distances read in the viewer's unit without a doubled miles note", () => {
  assert.equal(localizeDistanceText("about 8 km (5 mi) away", "ft"), "about 5 mi away");
  assert.equal(localizeDistanceText("about 8 km (5 mi) away", "m"), "about 8 km away");
  assert.equal(localizeDistanceText("within 1.6 km", "ft"), "within 1.0 mi");
  assert.equal(localizeDistanceText("no distance here", "ft"), "no distance here");
});

test("fire-weather numbers in the reason follow the viewer's units", () => {
  const data = clearDay();
  data.fireRisk = { status: "ok", level: 3, label: "High", reasons: ["Warm, dry, breezy fire weather (86F, RH 20%, wind 18 mph)."] };
  const decision = evaluateBackcountryDecision(data, "07:00", { ...preferences, temperatureUnit: "c", windSpeedUnit: "kph" });
  assert.match(decision.cautions.join(" "), /Fire risk is high: Warm, dry, breezy fire weather \(30°C, RH 20%, wind 29 kph\)\./);
});

test("an off-the-hour start keeps its last partial hour in the decision", () => {
  assert.equal(trendRowsCoveringWindow("05:30", 10), 11);
  assert.equal(trendRowsCoveringWindow("06:00", 10), 10);
  // As the API returns it: readings from 05:00, the hour that contains the start.
  const data = clearDay("05:00", 11);
  data.weather.trend[10].gust = 40;
  const decision = evaluateBackcountryDecision(data, "05:30", { ...preferences, travelWindowHours: 10 });
  const gust = decision.checks.find((item) => item.key === "wind-gust");
  assert.equal(gust.ok, false, gust.detail);
  assert.match(gust.detail, /Peak 40 mph at 15:00/);
});

test("the best continuous window ends when its last hour ends", () => {
  const rows = ["05:30", "06:30", "07:30"].map((time) => ({ time, pass: true, condition: "Sunny", reasonSummary: "", failedRules: [], failedRuleLabels: [] }));
  assert.deepEqual(deriveTravelWindowSpans(rows), [{ start: "05:30", end: "08:30", length: 3 }]);
  assert.match(buildTravelWindowInsights(rows, "24h").summary, /Best continuous window: 05:30 to 08:30 \(3h\)/);
  const hourLabels = ["1 PM", "2 PM"].map((time) => ({ ...rows[0], time }));
  assert.equal(deriveTravelWindowSpans(hourLabels)[0].end, "15:00");
});

test("score changes round like the scores and skip days without a score", () => {
  assert.equal(formatScoreDelta(38 - 50.6), "-12.6");
  assert.equal(formatScoreDelta(0.04), "0");
  assert.equal(formatScoreDelta(3), "+3");
  const scored = clearDay();
  scored.safety = { ...scored.safety, score: 38.4, assessmentStatus: "supported" };
  const previous = clearDay();
  previous.safety = { ...previous.safety, score: 51, assessmentStatus: "supported" };
  assert.ok(scoresComparable(scored, previous));
  assert.ok(buildDayOverDayChanges(scored, previous, preferences).includes("Safety score -12.6 (51 -> 38.4)."));
  const unscored = { ...scored, safety: { ...scored.safety, assessmentStatus: "insufficient_evidence" } };
  assert.equal(scoresComparable(unscored, previous), false);
  assert.ok(!buildDayOverDayChanges(unscored, previous, preferences).some((line) => /Safety score/.test(line)));
});

test("a timestamp for a later forecast hour reads as when it applies, not as fresh", () => {
  const inNineHours = new Date(Date.now() + (9 * 60 + 30) * 60000).toISOString();
  assert.equal(formatAgeFromNow(inNineHours), "valid in 9h 30m");
  assert.equal(formatAgeFromNow(new Date(Date.now() - 95 * 60000).toISOString()), "1h 35m ago");
  assert.equal(formatAgeFromNow(new Date(Date.now() + 60000).toISOString()), "0m ago");
});

const scenario = (startTime, level, score, daylightRemainingMinutes) => ({
  ...buildStartTimeScenario(startTime, clearDay(startTime), { level, headline: "", blockers: [], cautions: [], checks: [] }, preferences),
  score,
  daylightRemainingMinutes,
});

test("start-time comparison suggests nothing when every departure is a no-go", () => {
  const comparison = compareStartTimeScenarios([scenario("04:00", "NO-GO", 30, 313), scenario("08:00", "NO-GO", 40, 73)], preferences);
  assert.equal(comparison.allNoGo, true);
  assert.match(comparison.recommendationReason, /Every departure compared here is a no-go/);
  assert.doesNotMatch(comparison.recommendationReason, /strongest|margin/);
});

test("start-time comparison claims the most daylight only when it is true", () => {
  const tiedLater = compareStartTimeScenarios([scenario("04:00", "GO", 90, 313), scenario("08:00", "GO", 90.5, 73)], preferences);
  assert.equal(tiedLater.bestStartTime, "08:00");
  assert.equal(tiedLater.allNoGo, false);
  assert.doesNotMatch(tiedLater.recommendationReason, /daylight/);
  const tiedEarlier = compareStartTimeScenarios([scenario("04:00", "GO", 90.5, 313), scenario("08:00", "GO", 90, 73)], preferences);
  assert.match(tiedEarlier.recommendationReason, /leaves the most daylight/);
});

test("the avalanche card gives the rating, or why there is none", () => {
  const caption = (avalanche) => avalancheBriefCaption(avalanche, buildAvalancheDisplayState({ avalanche }, (text) => text));
  assert.equal(caption({ relevant: true, dangerLevel: 3, coverageStatus: "reported", center: "Northwest Avalanche Center" }),
    "Considerable (3 of 5) is the highest rating in the Northwest Avalanche Center forecast.");
  assert.equal(caption({ relevant: true, dangerLevel: 0, dangerUnknown: true, coverageStatus: "no_active_forecast", center: "Northwest Avalanche Center", relevanceReason: "Forecast includes wintry signals (snow/ice/freezing conditions)." }),
    "Northwest Avalanche Center has no current forecast for this zone. Forecast includes wintry signals (snow/ice/freezing conditions).");
  assert.equal(caption({ relevant: false, relevanceReason: "No snow on the ground." }), "No snow on the ground.");
  assert.equal(caption(null), "No avalanche information is available for this plan.");
});

test("the late-return card prints the exact sunset, not a rounded offset", () => {
  const contingency = {
    status: "ok",
    plannedReturnIso: "2026-09-24T22:30:00.000Z",
    summary: "",
    delayBuffer: {
      hours: 4, startIso: null, endIso: null, coveredHours: 4, complete: true,
      minFeelsLikeF: 40, peakGustMph: 10, peakPrecipChance: 0, onsetHazards: [],
      // Sunset 7:13 PM, 3 h 43 min after a 3:30 PM return (3.7 h rounded).
      nightfall: { onsetIso: "2026-09-25T02:13:00.000Z", hoursAfterReturn: 3.7 },
      summary: "",
    },
    overnight: null,
  };
  const clock = (minute) => `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  const html = renderToStaticMarkup(<ContingencyCard contingency={contingency} returnMinutes={15 * 60 + 30} clock={clock}
    formatTemp={(v) => `${v}°F`} formatWind={(v) => `${v} mph`} />);
  assert.match(html, /Dark by 19:13/);
});

test("a trailhead-to-summit chart's range covers both ends", () => {
  const html = renderToStaticMarkup(<ConditionTrend label="Temperature, trailhead to summit" values={[34, 42]} format={(v) => `${v}°F`}
    start="5 AM" end="6 AM" compare={{ label: "Summit", primaryLabel: "Trailhead", values: [22, 30] }} />);
  assert.match(html, /<strong>22°F–42°F<\/strong>/);
  const single = renderToStaticMarkup(<ConditionTrend label="Temperature at the summit" values={[22, 30]} format={(v) => `${v}°F`} start="5 AM" end="6 AM" />);
  assert.match(single, /<strong>22°F–30°F<\/strong>/);
});
