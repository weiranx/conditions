// Synthetic data for the mock admin dashboard: a week of report and AI traffic,
// automated health checks, extra accounts, and provider diagnostics.
// Traffic is laid out on fixed clock slots with a seeded sequence per slot, so
// entries keep their timestamps across refreshes while always covering the
// last seven days. Addresses use the 203.0.113.0/24 documentation range.
import { peaks } from "./mock-data.mjs";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Deterministic numbers in [0, 1) for a seed (mulberry32). */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (next, items) => items[Math.floor(next() * items.length)];
// Planning traffic by local hour: light overnight, busiest in the evening.
const HOURLY_WEIGHT = [
  0.2, 0.1, 0.1, 0.1, 0.3, 0.8, 1.2, 1.4, 1.2, 1, 0.9, 0.9,
  1, 1, 0.9, 1, 1.2, 1.6, 2, 2.2, 1.8, 1.2, 0.7, 0.4,
];
const START_TIMES = ["04:30", "05:00", "06:00", "07:00", "07:30", "08:30", "10:00", "13:00", "15:00"];
const AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) Mobile/15E148",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36",
];

/** Calls `visit(slotStart, next)` for each hourly slot in the last `days`. */
function eachHour(now, days, seed, visit) {
  const first = Math.floor((now - days * DAY) / HOUR);
  for (let slot = first; slot <= Math.floor(now / HOUR); slot += 1)
    visit(slot * HOUR, random(slot * 31 + seed));
}

const isoDate = (time) => {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function reportLogs(now) {
  const entries = [];
  eachHour(now, 8, 7, (start, next) => {
    const count = Math.round(HOURLY_WEIGHT[new Date(start).getHours()] * (0.3 + next() * 1.4));
    for (let i = 0; i < count; i += 1) {
      const timestamp = start + Math.floor(next() * HOUR);
      if (timestamp > now) continue;
      const peak = pick(next, peaks);
      const roll = next();
      const statusCode = roll < 0.02 ? 400 : roll < 0.05 ? 502 : 200;
      const partial = statusCode === 200 && next() < 0.08;
      const slow = next() < 0.04;
      const lead = next();
      const leadDays = lead < 0.45 ? 0 : lead < 0.75 ? 1 : lead < 0.9 ? 2 + Math.floor(next() * 2) : 4 + Math.floor(next() * 3);
      entries.push({
        timestamp: new Date(timestamp).toISOString(),
        lat: peak.lat,
        lon: peak.lon,
        date: isoDate(timestamp + leadDays * DAY),
        startTime: pick(next, START_TIMES),
        statusCode,
        safetyScore: statusCode === 200 ? 35 + Math.floor(next() * 60) : null,
        partialData: statusCode === 200 ? partial : null,
        durationMs: Math.round(slow ? 10_000 + next() * 14_000 : 1_200 + next() * 6_500),
        name: peak.name,
        ip: `203.0.113.${1 + Math.floor(next() * 40)}`,
        userAgent: pick(next, AGENTS),
      });
    }
  });
  return entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

const AI_FEATURES = [
  ["report-brief", 0.58, "demo-fixture"],
  ["report-chat", 0.2, "demo-fixture"],
  ["report-chat-suggestions", 0.1, "demo-fast"],
  ["route-analysis", 0.06, "demo-fixture"],
  ["snow-vision", 0.04, "demo-reasoning"],
  ["trip-chat", 0.02, "demo-fixture"],
];
// Dollars per million input and output tokens; demo-reasoning is unpriced.
const PRICES = { "demo-fixture": [1.25, 10], "demo-fast": [0.25, 2] };

export function aiUsage(now) {
  const entries = [];
  eachHour(now, 8, 13, (start, next) => {
    const count = Math.round(HOURLY_WEIGHT[new Date(start).getHours()] * next() * 0.9);
    for (let i = 0; i < count; i += 1) {
      const timestamp = start + Math.floor(next() * HOUR);
      if (timestamp > now) continue;
      let roll = next();
      const [feature, , model] =
        AI_FEATURES.find(([, share]) => (roll -= share) < 0) ?? AI_FEATURES[0];
      const failover = next() < 0.05;
      const failed = next() < 0.04;
      const inputTokens = failed ? 0 : 1_500 + Math.floor(next() * 4_500);
      const outputTokens = failed ? 0 : 300 + Math.floor(next() * 1_200);
      const price = PRICES[model];
      entries.push({
        timestamp: new Date(timestamp).toISOString(),
        provider: failover ? "anthropic" : "openai",
        model,
        feature,
        status: failed ? "error" : "success",
        durationMs: Math.round(failed ? 30_000 : 1_500 + next() * 7_500),
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCostUsd: price
          ? (inputTokens * price[0] + outputTokens * price[1]) / 1_000_000
          : null,
        pricingMatched: Boolean(price),
        pricingVersion: "mock-2026-09",
      });
    }
  });
  return entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/** The last 100 checks at 15-minute intervals, newest first, with one short incident. */
export function healthHistory(now) {
  const interval = 15 * MINUTE;
  const latest = Math.floor(now / interval);
  const entries = Array.from({ length: 100 }, (_, index) => {
    const slot = latest - index;
    const next = random(slot);
    // A three-check incident recurs at the same time each day.
    const phase = (slot % 96 + 96) % 96;
    const healthy = !(phase >= 54 && phase <= 56);
    return {
      checkedAt: new Date(slot * interval + 20_000).toISOString(),
      healthy,
      summary: healthy
        ? "Health endpoint responded"
        : "Health endpoint timed out after 10 s",
      statusCode: healthy ? 200 : null,
      durationMs: healthy ? Math.round(60 + next() * 140) : 10_000,
      action:
        phase === 54
          ? "alert-sent"
          : !healthy
            ? "unchanged-unhealthy"
            : phase === 57
              ? "recovery-sent"
              : "unchanged-healthy",
      alertError: null,
    };
  });
  const healthy = entries.filter((entry) => entry.healthy).length;
  return {
    entries,
    summary: {
      total: entries.length,
      healthy,
      unhealthy: entries.length - healthy,
      availabilityPercent: Math.round((healthy / entries.length) * 1000) / 10,
      lastCheckAt: entries[0].checkedAt,
      lastUnhealthyAt: entries.find((entry) => !entry.healthy)?.checkedAt ?? null,
    },
  };
}

/** Accounts besides the signed-in owner; times are offsets from now. */
export const ACCOUNT_FIXTURES = [
  { id: "mock-user-rivera", displayName: "Sam Rivera", email: "sam@example.test", authProvider: "google", authMethods: ["google"], createdDaysAgo: 140, activeMinutesAgo: 95, state: { tier: "premium", status: "active", emailVerified: true, activeSessions: 2, savedReports: 34, aiCalls: 61, aiTokens: 412_300, aiTokenLimitOverride: null, reportUsageLimitOverride: null } },
  { id: "mock-user-chen", displayName: "Mei Chen", email: "mei@example.test", authProvider: "password", authMethods: ["password"], createdDaysAgo: 64, activeMinutesAgo: 25, state: { tier: "free", status: "active", emailVerified: true, activeSessions: 1, savedReports: 18, aiCalls: 22, aiTokens: 64_800, aiTokenLimitOverride: null, reportUsageLimitOverride: null } },
  { id: "mock-user-patel", displayName: "Priya Patel", email: "priya@example.test", authProvider: "google", authMethods: ["google", "password"], createdDaysAgo: 30, activeMinutesAgo: 360, state: { tier: "free", status: "active", emailVerified: true, activeSessions: 1, savedReports: 12, aiCalls: 35, aiTokens: 90_500, aiTokenLimitOverride: 250_000, reportUsageLimitOverride: 40 } },
  { id: "mock-user-okafor", displayName: "Tobi Okafor", email: "tobi@example.test", authProvider: "password", authMethods: ["password"], createdDaysAgo: 3, activeMinutesAgo: 4_300, state: { tier: "free", status: "active", emailVerified: false, activeSessions: 0, savedReports: 2, aiCalls: 0, aiTokens: 0, aiTokenLimitOverride: null, reportUsageLimitOverride: null } },
  { id: "mock-user-lind", displayName: "Erik Lind", email: "erik@example.test", authProvider: "password", authMethods: ["password"], createdDaysAgo: 210, activeMinutesAgo: 17_000, state: { tier: "free", status: "suspended", emailVerified: true, activeSessions: 0, savedReports: 20, aiCalls: 48, aiTokens: 100_000, aiTokenLimitOverride: null, reportUsageLimitOverride: null } },
];

export const DIAGNOSTIC_SERVICES = [
  { id: "mock", name: "Local mock API", category: "Development", status: "operational", httpStatus: 200, latencyMs: 0, message: "Fixture data; no external services called." },
  { id: "noaa", name: "National Weather Service", category: "Weather", status: "operational", httpStatus: 200, latencyMs: 184, message: "Simulated response; not contacted." },
  { id: "avalanche", name: "Avalanche.org", category: "Avalanche", status: "operational", httpStatus: 200, latencyMs: 236, message: "Simulated response; not contacted." },
  { id: "email", name: "Resend email", category: "Email", status: "not_configured", httpStatus: null, latencyMs: null, message: "Mock email goes to the local outbox." },
];

export const CACHE_FIXTURES = [
  { name: "forecast", size: 48, hits: 312, misses: 61, staleHits: 14 },
  { name: "avalanche", size: 12, hits: 96, misses: 18, staleHits: 3 },
  { name: "geocoding", size: 30, hits: 140, misses: 42, staleHits: 0 },
];

/** A few earlier administrative events, including a failed one. */
export function seedAudit(now) {
  return [
    { minutesAgo: 70, action: "product.flags.updated", category: "configuration", summary: "Turned on Terrain Window", details: { terrainWindow: true } },
    { minutesAgo: 300, action: "diagnostics.external.completed", category: "diagnostics", status: "error", summary: "External diagnostics completed with 1 failed service check", details: { total: 4, operational: 3, failed: 1 } },
    { minutesAgo: 1_500, action: "users.usage-limit.updated", category: "accounts", summary: "Set Priya Patel's monthly AI token limit to 250,000", details: { userId: "mock-user-patel", limit: 250_000 } },
    { minutesAgo: 4_400, action: "users.status.updated", category: "accounts", summary: "Suspended Erik Lind", details: { userId: "mock-user-lind", status: "suspended" } },
  ].map(({ minutesAgo, status = "success", ...entry }) => ({
    timestamp: new Date(now - minutesAgo * MINUTE).toISOString(),
    status,
    actorNetwork: "127.0.0.x",
    ...entry,
  }));
}
