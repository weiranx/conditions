import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { formatAgeFromNow, localizeDistanceText } from "../src/app/core";
import { ContingencyCard } from "../src/field/ContingencyCard";
import { ConditionTrend } from "../src/field/ConditionCharts";

// Decision, travel-window, start-time and day-over-day accuracy are backend
// tests (unit.plan-evaluation, unit.plan-comparisons).

test("distances read in the viewer's unit without a doubled miles note", () => {
  assert.equal(localizeDistanceText("about 8 km (5 mi) away", "ft"), "about 5 mi away");
  assert.equal(localizeDistanceText("about 8 km (5 mi) away", "m"), "about 8 km away");
  assert.equal(localizeDistanceText("within 1.6 km", "ft"), "within 1.0 mi");
  assert.equal(localizeDistanceText("no distance here", "ft"), "no distance here");
});

test("a timestamp for a later forecast hour reads as when it applies, not as fresh", () => {
  const inNineHours = new Date(Date.now() + (9 * 60 + 30) * 60000).toISOString();
  assert.equal(formatAgeFromNow(inNineHours), "valid in 9h 30m");
  assert.equal(formatAgeFromNow(new Date(Date.now() - 95 * 60000).toISOString()), "1h 35m ago");
  assert.equal(formatAgeFromNow(new Date(Date.now() + 60000).toISOString()), "0m ago");
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

test("the late-return card reads event times on the objective's clock across daylight saving", () => {
  // Clocks fall back at 2:00 AM MDT on 1 November 2026. Return at 00:30 MDT;
  // a storm at 02:30 MST is three elapsed hours later, not 03:30 on the clock.
  const contingency = {
    status: "ok",
    plannedReturnIso: "2026-11-01T06:30:00.000Z",
    summary: "",
    delayBuffer: {
      hours: 4, startIso: "2026-11-01T06:30:00.000Z", endIso: "2026-11-01T10:30:00.000Z", coveredHours: 4, complete: true,
      minFeelsLikeF: 30, peakGustMph: 20, peakPrecipChance: 60, nightfall: null, summary: "",
      onsetHazards: [{ key: "storm", label: "Thunderstorms", onsetIso: "2026-11-01T09:30:00.000Z", hoursAfterReturn: 3 }],
    },
    overnight: null,
  };
  const clock = (minute) => `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  const html = renderToStaticMarkup(<ContingencyCard contingency={contingency} returnMinutes={30} clock={clock} timeZone="America/Denver"
    formatTemp={(v) => `${v}°F`} formatWind={(v) => `${v} mph`} />);
  assert.match(html, /Thunderstorms from 02:30/);
  assert.match(html, /back by 03:30/);
});

test("a trailhead-to-summit chart's range covers both ends", () => {
  const html = renderToStaticMarkup(<ConditionTrend label="Temperature, trailhead to summit" values={[34, 42]} format={(v) => `${v}°F`}
    start="5 AM" end="6 AM" compare={{ label: "Summit", primaryLabel: "Trailhead", values: [22, 30] }} />);
  assert.match(html, /<strong>22°F–42°F<\/strong>/);
  const single = renderToStaticMarkup(<ConditionTrend label="Temperature at the summit" values={[22, 30]} format={(v) => `${v}°F`} start="5 AM" end="6 AM" />);
  assert.match(single, /<strong>22°F–30°F<\/strong>/);
});
