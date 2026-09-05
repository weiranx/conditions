import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminStats } from "../src/field/Administration";
import { AdminOverview } from "../src/field/AdminOverview";
import { AdminUsers } from "../src/field/AdminUsers";

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
    userSummary: { active: 1, suspended: 0, unverified: 0, activeSessions: 1 },
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
