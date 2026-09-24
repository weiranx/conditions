import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AvalancheMountain } from "../src/field/sky/AvalancheMountain";
import { AspectRose } from "../src/field/sky/AspectRose";
import { SnowColumns } from "../src/field/sky/SnowColumns";
import { PrecipMountain } from "../src/field/sky/PrecipMountain";
import { MiniSky } from "../src/field/sky/MiniSky";
import { RouteProfile } from "../src/field/sky/RouteProfile";
import { StartTimeline } from "../src/field/sky/StartTimeline";
import { buildSkyHours } from "../src/field/sky/sky-model";

const row = (over = {}) => ({
  time: "07:00", pass: true, complete: true, condition: "Clear", reasonSummary: "", failedRules: [], failedRuleLabels: [],
  temp: 60, feelsLike: 58, wind: 5, gust: 12, precipChance: 0, ...over,
});
const plan = { start: "07:00", sunriseMinutes: 412, sunsetMinutes: 1170 };
const danger = (n) => ["No Rating", "Low", "Moderate", "Considerable", "High", "Extreme"][n];

test("the avalanche mountain colours each band by its rating and draws a missing or zero rating as unrated", () => {
  const html = renderToStaticMarkup(
    <AvalancheMountain
      rows={[
        { key: "above", label: "Above treeline", rating: 3 },
        { key: "at", label: "Near treeline", rating: 0 },
        { key: "below", label: "Below treeline", rating: null },
      ]}
      problems={[{ name: "Wind slab", bands: ["above"] }]}
      dangerText={danger}
    />,
  );
  assert.match(html, /avy-band is-danger-3/);
  assert.equal((html.match(/avy-band is-unrated/g) || []).length, 2, "0 and null both read as no rating");
  assert.doesNotMatch(html, /is-danger-0|0 · No Rating/);
  assert.match(html, /Above treeline: 3 of 5, Considerable\. Near treeline: no rating\. Below treeline: no rating\./);
  assert.match(html, /Problems: 1, Wind slab \(above treeline\)/);
  assert.match(html, /class="avy-label-rating is-over">3 · Considerable</);
});

test("the aspect rose hatches cells to avoid and makes cells buttons only when they can be selected", () => {
  const props = {
    rings: ["Upper", "Lower"],
    label: "Terrain",
    cellClass: (aspect) => (aspect === "N" ? "is-avoid" : "is-lower"),
    cellLabel: (aspect, ring) => `${aspect} ${ring}`,
  };
  const still = renderToStaticMarkup(<AspectRose {...props} />);
  assert.equal((still.match(/class="rose-cell/g) || []).length, 16, "eight aspects by two rings");
  assert.doesNotMatch(still, /role="button"/);
  assert.equal((still.match(/fill:url\(#/g) || []).length, 2, "both north cells are hatched");
  const picker = renderToStaticMarkup(<AspectRose {...props} onSelect={() => {}} selected={{ aspect: "E", ring: 1 }} />);
  assert.equal((picker.match(/role="button"/g) || []).length, 16);
  assert.match(picker, /aria-pressed="true" aria-label="E 1"/);
  assert.match(picker, /rose-outline/);
});

test("snow columns never draw a missing reading as zero snow", () => {
  const html = renderToStaticMarkup(
    <SnowColumns metric={false} columns={[
      { label: "SNOTEL station", sub: "Demo · 9,500 ft", depthIn: 30, sweIn: 8 },
      { label: "NOHRSC model", sub: "Modeled", depthIn: null, sweIn: null },
    ]} />,
  );
  assert.equal((html.match(/class="sc-snow"/g) || []).length, 1);
  assert.match(html, /sc-empty/);
  assert.match(html, />No reading</);
  assert.match(html, /SNOTEL station: 30 in deep, 8 in of water\. NOHRSC model: depth unavailable\./);
  assert.match(html, />Knee</, "body heights below the deepest reading are drawn");
  assert.doesNotMatch(html, />Chest</, "and ones far above it are left out");
});

test("the precipitation mountain opens on the wettest hour and says where rain turns to snow", () => {
  const hours = buildSkyHours([
    row(),
    row({ time: "08:00", condition: "Rain showers", precipChance: 80 }),
    row({ time: "09:00", precipChance: 20 }),
  ], plan);
  const format = { elevation: (ft) => `${ft} ft`, clock: (m) => `${Math.floor(m / 60)}:00` };
  const split = renderToStaticMarkup(
    <PrecipMountain hours={hours} objectiveFt={12000} trailheadFt={7000}
      levels={[{ label: "Snow level", ft: 9500, tone: "snow" }]} format={format} timeStyle="ampm" />,
  );
  assert.match(split, /aria-pressed="true" aria-label="8:00, 80% chance"/);
  assert.match(split, /Snow above about 9500 ft, rain below it\./);
  assert.match(split, /mt-flake/);
  assert.match(split, /mt-drop/);
  const buried = renderToStaticMarkup(
    <PrecipMountain hours={hours} objectiveFt={12000} trailheadFt={7000}
      levels={[{ label: "Snow level", ft: 7000, tone: "snow" }]} format={format} timeStyle="ampm" />,
  );
  assert.match(buried, /at or below your trailhead: anything that falls on your route is likely snow/);
  const unknown = renderToStaticMarkup(
    <PrecipMountain hours={hours} objectiveFt={12000} trailheadFt={null} levels={[]} format={format} timeStyle="ampm" />,
  );
  assert.match(unknown, /rain and snow can(’|&#x27;|')t be separated/);
  assert.doesNotMatch(unknown, />Trailhead</, "no trailhead is invented when none is known");
  // A snow level below the illustrative base says nothing about an unknown, possibly lower, trailhead.
  const lowLevel = renderToStaticMarkup(
    <PrecipMountain hours={hours} objectiveFt={12000} trailheadFt={null}
      levels={[{ label: "Snow level", ft: 8000, tone: "snow" }]} format={format} timeStyle="ampm" />,
  );
  assert.doesNotMatch(lowLevel, /trailhead: anything that falls on your route is likely snow/);
  assert.match(lowLevel, /Snow above about 8000 ft, rain below it\. Set your trailhead/);
});

test("a day's mini sky hatches the hours over your limits and names them for screen readers", () => {
  const hours = buildSkyHours([
    row(),
    row({ time: "08:00", pass: false, failedRules: ["Gust 31 mph above 25 mph"] }),
    row({ time: "09:00", pass: false, complete: false, gust: NaN }),
  ], plan);
  const html = renderToStaticMarkup(<MiniSky hours={hours} sunrise={412} sunset={1170} clock={(m) => `${m / 60}h`} />);
  assert.match(html, /aria-label="7h to 10h\. Over your limits 8h–9h\./);
  assert.equal((html.match(/fill="url\(#[^"]*p\)" stroke="#FF9A4D"/g) || []).length, 1, "one hatched hour");
  assert.match(html, /stroke-dasharray="2 2"/, "the incomplete hour is dashed");
});

test("the route profile draws freezing and snow levels and caps the route in snow above the snow level", () => {
  const html = renderToStaticMarkup(
    <RouteProfile
      points={[{ x: 20, y: 155 }, { x: 500, y: 30 }, { x: 980, y: 155 }]}
      stops={[{ name: "A", eta: "7:00", tone: "within" }, { name: "B", eta: "10:00", tone: "over" }, { name: "C", eta: "13:00", tone: "within" }]}
      selected={0} onSelect={() => {}} caption="Profile"
      levels={[{ y: 90, label: "Snow level 9,000 ft", tone: "snow" }, { y: 400, label: "Far below", tone: "cold" }]}
    />,
  );
  assert.match(html, /rp-level is-snow/);
  assert.match(html, />Snow level 9,000 ft</);
  assert.doesNotMatch(html, /Far below/, "levels far outside the route are left off");
  assert.match(html, /class="rp-snow"/);
});

test("start times are drawn as arcs under the day's sky, with over-limit hours marked on each", () => {
  const good = buildSkyHours([row(), row({ time: "08:00" })], plan);
  const bad = buildSkyHours([row({ time: "09:00" }), row({ time: "10:00", pass: false, failedRules: ["Rain 70% above 60%"] })], { ...plan, start: "09:00" });
  const html = renderToStaticMarkup(
    <StartTimeline sunrise={412} sunset={1170} clock={(m) => `${m}`} caption="Departures"
      rows={[
        { key: "a", label: "7:00", start: 420, hours: good, summit: 480, best: true, note: "ok", noteTone: "ok" },
        { key: "b", label: "9:00", start: 540, hours: bad, summit: 600, current: true, note: "over", noteTone: "over" },
      ]} />,
  );
  assert.match(html, /tl-trip is-best/);
  assert.match(html, /tl-trip is-current/);
  assert.equal((html.match(/tl-trip-over/g) || []).length, 1);
  assert.match(html, /tl-sun-arc/);
});

test("an overnight departure draws the next morning's sunrise and sun arc", () => {
  const night = buildSkyHours(Array.from({ length: 10 }, (_, i) => row({ time: `${String((23 + i) % 24).padStart(2, "0")}:00` })), { ...plan, start: "23:00" });
  const html = renderToStaticMarkup(
    <StartTimeline sunrise={412} sunset={1170} clock={(m) => `m${m % 1440}`} caption="Overnight"
      rows={[{ key: "n", label: "23:00", start: 1380, hours: night, summit: 1680, current: true, note: "", noteTone: "ok" }]} />,
  );
  assert.equal((html.match(/class="tl-sun-arc"/g) || []).length, 1, "the next day's arc is drawn");
  assert.match(html, /↑ m412</, "with that day's sunrise");
});
