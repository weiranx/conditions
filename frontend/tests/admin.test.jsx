import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminStats } from "../src/field/Administration";
import { AdminActivity } from "../src/field/AdminActivity";
import { AdminAnalytics } from "../src/field/AdminAnalytics";
import { AdminControls } from "../src/field/AdminControls";
import { AdminOverview } from "../src/field/AdminOverview";
import { AdminUsers } from "../src/field/AdminUsers";
import { mergeDraft, mergeDraftRecord } from "../src/field/model/model-drafts";
import {
  aiUsageFeatureLabel,
  buildTimeBuckets,
  capitalize,
  formatAccountDate,
  formatCheckIntervalChoice,
  formatDuration,
  formatEstimatedCost,
  formatHealthMonitorAction,
  formatSchedulerTimestamp,
  formatTokenCount,
  schedulerHealthLabel,
} from "../src/field/model/useAdministration";

function model(overrides = {}) {
  return {
    loading: false,
    metrics: { total: 12, healthyRate: 75, p95Duration: 2000 },
    aiMetrics: { calls: 3, pricedCalls: 0, estimatedCostUsd: 0 },
    formatDuration: (n) => `${n} ms`,
    formatEstimatedCost: (n) => `$${n.toFixed(2)}`,
    formatBytes: (n) => `${n} bytes`,
    formatUptime: (n) => `${n}s`,
    schedulerHealthLabel: (s) => s,
    attentionSignals: [],
    health: {
      ok: true,
      uptime: 100,
      env: "test",
      database: { configured: true, connected: true },
    },
    systemResources: {
      memory: { usagePercent: 92, usedBytes: 92, totalBytes: 100 },
      disk: null,
    },
    cacheMetrics: { hitRate: 0, entries: 0 },
    usersTotal: 1,
    users: [],
    filteredUsers: [],
    userSummary: {
      active: 1,
      suspended: 0,
      free: 0,
      premium: 1,
      verified: 1,
      unverified: 0,
      activeSessions: 1,
    },
    userStatusFilter: "all",
    userQuery: "",
    USER_STATUS_FILTERS: [{ value: "all", label: "All accounts" }],
    ...overrides,
  };
}
const renderStats = (a) => renderToStaticMarkup(<AdminStats a={a} />);
test("loading and failed metrics do not report zero usage or stale success", () => {
  for (const a of [
    model({ loading: true }),
    model({ error: "Failed", aiUsageError: "Failed" }),
  ]) {
    const html = renderStats(a);
    assert.equal((html.match(/<strong>—<\/strong>/g) || []).length, 5);
    assert.doesNotMatch(html, /75%|\$0.00/);
  }
});
test("unpriced AI calls are distinct from a measured zero cost", () => {
  assert.doesNotMatch(renderStats(model()), /\$0.00/);
  assert.match(
    renderStats(
      model({ aiMetrics: { calls: 3, pricedCalls: 3, estimatedCostUsd: 0 } }),
    ),
    /\$0.00/,
  );
});
test("failed health and resource refreshes do not present retained data as current", () => {
  const html = renderToStaticMarkup(
    <AdminOverview
      a={model({
        healthError: "Health failed",
        systemResourcesError: "Resources failed",
      })}
    />,
  );
  assert.match(html, /Signals may be incomplete/);
  assert.doesNotMatch(html, />Online<|<dd>Connected<|92% used|<meter/);
});
test("resource meters retain accessible measurements and missing disk is unavailable", () => {
  const html = renderToStaticMarkup(<AdminOverview a={model()} />);
  assert.match(html, /aria-label="Memory usage"/);
  assert.match(html, /value="92"/);
  assert.match(html, /Disk<\/span><strong>Unavailable/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});
test("account load failures do not look like empty search results", () => {
  const html = renderToStaticMarkup(
    <AdminUsers a={model({ usersError: "Directory unavailable" })} />,
  );
  assert.match(html, /Directory unavailable/);
  assert.doesNotMatch(html, /No accounts are available|No accounts match/);
  assert.ok(
    html.indexOf("Search accounts") < html.indexOf("Free account allowances"),
  );
});

// Models below use the real formatters so rendered text matches the app.
const formatters = {
  aiUsageFeatureLabel,
  capitalize,
  formatAccountDate,
  formatCheckIntervalChoice,
  formatDuration,
  formatEstimatedCost,
  formatHealthMonitorAction,
  formatSchedulerTimestamp,
  formatTokenCount,
  schedulerHealthLabel,
  aiProviderLabel: (p) => ({ openai: "OpenAI", anthropic: "Anthropic", gemini: "Gemini" })[p],
  AI_PROVIDERS: ["openai", "anthropic", "gemini"],
};
const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
// Text a reader sees; <time dateTime> attributes rightly keep ISO values.
const visibleText = (html) => html.replace(/<[^>]*>/g, " ");

function operations(overrides = {}) {
  return model({
    ...formatters,
    ADMIN_OPERATIONS_PANELS: [
      { value: "health", label: "Service health" },
      { value: "monitoring", label: "Monitoring" },
    ],
    OBJECTIVE_WATCH_INTERVAL_OPTIONS: [60, 180],
    diagnosticSummary: { total: 0, operational: 0, failed: 0, notConfigured: 0 },
    diagnosticServices: [],
    diagnostics: null,
    healthHistory: null,
    ...overrides,
  });
}

const scheduler = {
  enabled: true,
  configured: true,
  running: false,
  health: "healthy",
  message: "The five-minute scheduler heartbeat is current.",
  lastHeartbeatAt: ago(3),
  lastStartedAt: ago(121),
  lastCompletedAt: ago(120),
  lastStatus: "completed",
  lastError: null,
  lastSummary: { due: 5, checked: 5, changed: 2, failed: 0, notificationsSent: 1 },
  checkIntervalMinutes: 180,
  expectedIntervalMinutes: 5,
  staleAfterMinutes: 15,
  updatedAt: ago(3),
};

test("the watch scheduler reads as a status summary, not a raw record", () => {
  const html = renderToStaticMarkup(
    <AdminControls
      a={operations({
        activeOperationsPanel: "monitoring",
        objectiveWatchScheduler: scheduler,
        objectiveWatchCheckIntervalDraft: "180",
      })}
    />,
  );
  const [summary] = html.split("Scheduler status record");
  assert.match(summary, /data-tone="good">Healthy</);
  assert.match(summary, /3m ago/);
  assert.match(summary, /2h ago/);
  assert.match(summary, /5 checked · 2 changed · 0 failed · 1 alert sent/);
  assert.match(summary, /<dd>Every 3 hours<\/dd>/);
  assert.doesNotMatch(visibleText(summary), ISO_TIMESTAMP);
  // Saving an unchanged cadence would only reschedule every watch.
  assert.match(summary, /<button class="field-button" disabled="">Save cadence<\/button>/);
  const edited = renderToStaticMarkup(
    <AdminControls
      a={operations({
        activeOperationsPanel: "monitoring",
        objectiveWatchScheduler: scheduler,
        objectiveWatchCheckIntervalDraft: "60",
      })}
    />,
  );
  assert.match(edited, /<button class="field-button">Save cadence<\/button>/);
});

test("health-check history shows availability, incidents, and alert emails", () => {
  const entries = [
    { checkedAt: ago(5), healthy: false, summary: "Health endpoint returned 503", statusCode: 503, durationMs: 1200, action: "alert-sent", alertError: null },
    { checkedAt: ago(10), healthy: true, summary: "Backend healthy", statusCode: 200, durationMs: 80, action: "unchanged-healthy", alertError: null },
  ];
  const html = renderToStaticMarkup(
    <AdminControls
      a={operations({
        activeOperationsPanel: "health",
        healthHistory: {
          entries,
          summary: { total: 2, healthy: 1, unhealthy: 1, availabilityPercent: 50, lastCheckAt: entries[0].checkedAt, lastUnhealthyAt: entries[0].checkedAt },
        },
      })}
    />,
  );
  assert.match(html, /50% healthy/);
  assert.match(html, /aria-label="1 of 2 recorded checks were healthy"/);
  assert.equal((html.match(/<i class="is-failed"/g) || []).length, 1);
  assert.match(html, /Alert emailed/);
  assert.match(html, /No email needed/);
  assert.match(html, /HTTP 503 · 1\.2s/);
  assert.doesNotMatch(visibleText(html), ISO_TIMESTAMP);

  const quiet = renderToStaticMarkup(
    <AdminControls
      a={operations({
        activeOperationsPanel: "health",
        healthHistory: {
          entries: [entries[1]],
          summary: { total: 1, healthy: 1, unhealthy: 0, availabilityPercent: 100, lastCheckAt: entries[1].checkedAt, lastUnhealthyAt: null },
        },
      })}
    />,
  );
  assert.match(quiet, /<dd>None recorded<\/dd>/);
});

const usageSettings = {
  persistent: true,
  freeMonthlyAITokenLimit: 100000,
  environmentFreeMonthlyAITokenLimit: 100000,
  freeMonthlyReportUsageLimit: 20,
  environmentFreeMonthlyReportUsageLimit: 20,
  maxMonthlyAITokenLimit: 10000000,
  maxFreeMonthlyUsageLimit: 10000,
};
const freeUser = {
  id: "u1",
  email: "ada@example.test",
  emailVerified: true,
  displayName: "Ada",
  authProvider: "password",
  authMethods: ["password"],
  tier: "free",
  status: "active",
  createdAt: ago(60 * 24 * 30),
  updatedAt: ago(60),
  lastActivityAt: ago(0),
  activeSessions: 1,
  savedReports: 18,
  aiCalls: 3,
  aiTokens: 1200,
  aiTokenLimitOverride: null,
  reportUsageLimitOverride: null,
  isOwner: false,
};
function directory(overrides = {}) {
  return model({
    ...formatters,
    users: [freeUser],
    filteredUsers: [freeUser],
    usageSettings,
    usageLimitDraft: "100000",
    reportLimitDraft: "20",
    userUsageLimitDrafts: {},
    userReportLimitDrafts: {},
    ...overrides,
  });
}

test("accounts show monthly usage against their limits", () => {
  const html = renderToStaticMarkup(<AdminUsers a={directory()} />);
  assert.match(html, /Active just now/);
  assert.match(html, /18 of 20/);
  assert.match(html, /data-tone="warning">Near limit/);
  assert.match(html, /1\.2K of 100K/);
  assert.match(html, /Default limit/);

  const premium = { ...freeUser, tier: "premium", savedReports: 400 };
  const premiumHtml = renderToStaticMarkup(
    <AdminUsers a={directory({ users: [premium], filteredUsers: [premium] })} />,
  );
  assert.match(premiumHtml, /Unlimited on Premium/);
  assert.doesNotMatch(premiumHtml, /Near limit|At limit|Save limit/);
});

test("limits can only be saved once they differ from the saved value", () => {
  const saveButtons = (html) => [...html.matchAll(/<button class="field-button"( disabled="")?>Save limit<\/button>/g)];
  const untouched = saveButtons(renderToStaticMarkup(<AdminUsers a={directory()} />));
  assert.equal(untouched.length, 2);
  assert.ok(untouched.every((match) => match[1]));

  const sameValue = saveButtons(
    renderToStaticMarkup(<AdminUsers a={directory({ userReportLimitDrafts: { u1: "20" } })} />),
  );
  assert.ok(sameValue.every((match) => match[1]));

  const edited = saveButtons(
    renderToStaticMarkup(<AdminUsers a={directory({ userReportLimitDrafts: { u1: "25" } })} />),
  );
  assert.equal(edited.filter((match) => !match[1]).length, 1);

  const html = renderToStaticMarkup(<AdminUsers a={directory()} />);
  assert.match(html, /disabled="">Save allowances/);
  assert.match(html, /disabled="">Restore deployment defaults/);
  assert.doesNotMatch(
    renderToStaticMarkup(<AdminUsers a={directory({ usageLimitDraft: "150000" })} />),
    /disabled="">Save allowances/,
  );
});

/** The opening tag and content of the button whose text ends with `label`. */
function button(html, label) {
  const chunk = html.split("</button>").find((part) => part.endsWith(label));
  assert.ok(chunk, `no "${label}" button`);
  return chunk.slice(chunk.lastIndexOf("<button"));
}

function analytics(overrides = {}) {
  return model({
    ...formatters,
    requestActivityRef: { current: null },
    aiUsageRef: { current: null },
    selectedRange: { label: "Last 7 days" },
    analyticsRange: "7d",
    metrics: { total: 0, healthyRate: null, p95Duration: null },
    aiMetrics: { calls: 0, pricedCalls: 0, estimatedCostUsd: 0, inputTokens: 0, outputTokens: 0, successRate: null, failures: 0 },
    trendData: [],
    aiTrendData: [],
    topLocations: [],
    hourlyDistribution: Array.from({ length: 24 }, (_, hour) => ({ hour, label: `${hour}`, requests: 0 })),
    planningInsights: { leadTime: { items: [] }, startTimes: { items: [] } },
    reliabilityHotspots: [],
    query: "",
    statusFilter: "all",
    STATUS_FILTERS: [{ value: "all", label: "All" }],
    sortKey: "timestamp",
    sortAsc: false,
    filteredAndSorted: [],
    visibleLogs: [],
    LOG_PAGE_SIZE: 10,
    rangeAIUsage: [],
    aiModels: [],
    aiFeatures: [],
    recentAIRequests: [],
    ...overrides,
  });
}

test("an empty period shows empty states instead of blank charts or all-clear claims", () => {
  const html = renderToStaticMarkup(<AdminAnalytics a={analytics()} />);
  assert.match(html, /No report requests in the last 7 days/);
  assert.match(html, /No AI requests in the last 7 days/);
  assert.doesNotMatch(html, /Every objective returned complete data|recharts/);
  assert.match(button(html, "Export requests"), /disabled=""/);
  assert.match(button(html, "Export AI usage"), /disabled=""/);

  const loading = renderToStaticMarkup(<AdminAnalytics a={analytics({ loading: true })} />);
  assert.match(loading, /Loading report requests/);
  assert.doesNotMatch(loading, /No report requests/);
});

test("AI usage breaks down by model and feature with readable names", () => {
  const html = renderToStaticMarkup(
    <AdminAnalytics
      a={analytics({
        aiMetrics: { calls: 4, pricedCalls: 3, estimatedCostUsd: 0.12, inputTokens: 3000, outputTokens: 1510, successRate: 75, failures: 1 },
        rangeAIUsage: [{}],
        aiModels: [
          { provider: "openai", model: "gpt-demo", calls: 3, tokens: 4500, estimatedCostUsd: 0.12, pricedCalls: 3 },
          { provider: "gemini", model: "gemini-demo", calls: 1, tokens: 10, estimatedCostUsd: 0, pricedCalls: 0 },
        ],
        aiFeatures: [
          { feature: "report-brief", calls: 3, errors: 1, tokens: 4500, estimatedCostUsd: 0.12, pricedCalls: 3, averageDurationMs: 2400 },
        ],
        recentAIRequests: [
          { timestamp: ago(1), provider: "openai", model: "gpt-demo", feature: "report-chat", status: "error", durationMs: 900, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: null, pricingMatched: false, pricingVersion: "v1" },
        ],
      })}
    />,
  );
  assert.match(html, /gpt-demo<\/strong><small>OpenAI/);
  assert.match(html, /\$0\.12/);
  // An unpriced model shows no cost rather than a measured $0.00.
  assert.match(html, /gemini-demo[^]*?<td class="is-num">—<\/td>/);
  assert.match(html, /Field briefing/);
  assert.match(html, /class="is-num is-over">1</);
  assert.match(html, /Report chat/);
  assert.match(html, /Failed/);
});

function activity(overrides = {}) {
  return model({
    ...formatters,
    auditQuery: "",
    auditFilter: "all",
    AUDIT_FILTERS: [{ value: "all", label: "All activity" }],
    auditEntries: [],
    filteredAuditEntries: [],
    triggerCsvDownload: () => {},
    ...overrides,
  });
}

test("the audit trail separates no activity, filtered-out activity, and failures", () => {
  assert.match(
    renderToStaticMarkup(<AdminActivity a={activity()} />),
    /No administrative activity yet/,
  );
  const entry = {
    timestamp: ago(2),
    action: "users.status.updated",
    category: "accounts",
    status: "error",
    summary: "Account status could not be updated",
    actorNetwork: "203.0.113.x",
    details: { userId: "u1" },
  };
  assert.match(
    renderToStaticMarkup(
      <AdminActivity a={activity({ auditEntries: [entry], auditQuery: "tier" })} />,
    ),
    /No activity matches these filters/,
  );
  const html = renderToStaticMarkup(
    <AdminActivity a={activity({ auditEntries: [entry], filteredAuditEntries: [entry] })} />,
  );
  assert.match(html, /admin-audit-entry is-failed/);
  assert.match(html, /2m ago/);
  assert.match(html, /<b>Failed<\/b>/);
  assert.doesNotMatch(html, /No administrative activity yet/);
});

test("chart buckets sit on clock boundaries and never repeat an axis label", () => {
  const DAY = 24 * 60 * 60 * 1000;
  for (const now of [
    new Date(2026, 8, 23, 19, 24, 10).getTime(),
    new Date(2026, 8, 23, 7, 5).getTime(),
    new Date(2026, 8, 23, 0, 0).getTime(),
  ]) {
    for (const [range, duration, onBoundary] of [
      ["7d", 7 * DAY, (d) => d.getMinutes() === 0 && d.getHours() % 12 === 0],
      ["24h", DAY, (d) => d.getMinutes() === 0 && d.getHours() % 2 === 0],
      ["6h", DAY / 4, (d) => d.getMinutes() % 30 === 0],
    ]) {
      const buckets = buildTimeBuckets(range, now);
      assert.ok(buckets.every((b) => onBoundary(new Date(b.timestamp))), range);
      assert.ok(buckets[0].timestamp <= now - duration && buckets[0].end > now - duration, range);
      assert.ok(buckets.at(-1).timestamp < now && buckets.at(-1).end >= now, range);
      buckets.slice(1).forEach((b, i) => assert.equal(b.timestamp, buckets[i].end));
      const labels = buckets.map((b) => b.label).filter(Boolean);
      assert.equal(new Set(labels).size, labels.length, `${range}: ${labels}`);
      assert.ok(buckets.every((b) => b.period.includes("–")));
    }
    assert.equal(
      buildTimeBuckets("7d", now).filter((b) => b.label).length,
      7,
    );
  }
});

test("background refreshes keep unsaved form edits", () => {
  // The draft still shows the last saved value: follow the server.
  assert.equal(mergeDraft("100", "100", "150"), "150");
  // The admin typed a new value: keep it.
  assert.equal(mergeDraft("120", "100", "150"), "120");
  // First load: take the server value.
  assert.equal(mergeDraft("", null, "150"), "150");
  assert.deepEqual(
    mergeDraftRecord(
      { URL: "https://edited.example", TIMEOUT: "30" },
      { URL: "https://saved.example", TIMEOUT: "30" },
      { URL: "https://saved.example", TIMEOUT: "45", NEW_KEY: "on" },
    ),
    { URL: "https://edited.example", TIMEOUT: "45", NEW_KEY: "on" },
  );
});
