import { mergeModelDrafts } from "./model-drafts";
import {
  Activity,
  AlertTriangle,
  Ban,
  BarChart3,
  BellRing,
  Bot,
  CalendarRange,
  Clock3,
  FileUp,
  Gauge,
  Grid3X3,
  History,
  KeyRound,
  Layers,
  LayoutDashboard,
  MapPinned,
  MessageCircleQuestion,
  Route,
  Satellite,
  Server,
  Share2,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  publishProductFeatureFlags,
  type ProductFeatureFlags,
  type ProductFeatureKey,
} from "../../contexts/feature-flags";
import { publishAiAvailability } from "../../hooks/useAiAvailability";
import type { AppView } from "../../hooks/useUrlState";
import { fetchApi } from "../../lib/api-client";
export interface ReportLogEntry {
  timestamp: string;
  lat: number | null;
  lon: number | null;
  date: string | null;
  startTime: string | null;
  statusCode: number;
  safetyScore: number | null;
  partialData: boolean | null;
  durationMs: number;
  name: string | null;
  ip: string | null;
  userAgent: string | null;
}
export interface AIUsageEntry {
  timestamp: string;
  provider: string;
  model: string;
  feature: string;
  status: "success" | "error";
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  pricingMatched: boolean;
  pricingVersion: string;
}
export interface AdminHealthSnapshot {
  ok: boolean;
  service: string;
  version: string;
  env: string;
  uptime: number;
  nodeVersion: string;
  memory: {
    heapUsedMb: number;
    rssMb: number;
  };
  database?: {
    configured: boolean;
    connected: boolean;
    latencyMs?: number;
    error?: string;
  };
  caches: Array<{
    name: string;
    size: number;
    hits: number;
    misses: number;
    staleHits: number;
  }>;
  timestamp: string;
}
export interface AdminSystemResources {
  app?: {
    memory: {
      rssBytes: number;
      heapUsedBytes: number;
      heapTotalBytes: number;
      externalBytes: number;
    };
    storage: {
      usedBytes: number | null;
      filesBytes: number | null;
      databaseBytes: number | null;
    };
  };
  memory: ResourceUsageSnapshot;
  disk: ResourceUsageSnapshot | null;
  timestamp: string;
}
export interface AdminHealthHistoryEntry {
  checkedAt: string;
  healthy: boolean;
  summary: string;
  statusCode: number | null;
  durationMs: number | null;
  action: string;
  alertError: string | null;
}
export interface AdminHealthHistoryPayload {
  entries: AdminHealthHistoryEntry[];
  summary: {
    total: number;
    healthy: number;
    unhealthy: number;
    availabilityPercent: number | null;
    lastCheckAt: string | null;
    lastUnhealthyAt: string | null;
  };
}
export interface ObjectiveWatchSchedulerStatus {
  enabled: boolean;
  configured: boolean;
  running: boolean;
  health:
    | "healthy"
    | "running"
    | "waiting"
    | "stopped"
    | "not_configured"
    | "unhealthy"
    | "failed";
  message: string;
  lastHeartbeatAt: string | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastStatus: string;
  lastError: string | null;
  lastSummary: {
    due?: number;
    checked?: number;
    changed?: number;
    failed?: number;
    notificationsSent?: number;
  } | null;
  checkIntervalMinutes: number;
  expectedIntervalMinutes: number;
  staleAfterMinutes: number;
  updatedAt: string | null;
}
export interface ResourceUsageSnapshot {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  availableBytes: number;
  usagePercent: number;
}
export interface AdminAuditEntry {
  timestamp: string;
  action: string;
  category: "configuration" | "maintenance" | "diagnostics" | string;
  status: "success" | "error";
  summary: string;
  actorNetwork: string | null;
  details: Record<string, unknown> | null;
}
export interface AdminUserRecord {
  id: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  authProvider: string;
  authMethods: string[];
  tier: "free" | "premium" | string;
  status: "active" | "suspended" | string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string | null;
  activeSessions: number;
  savedReports: number;
  aiCalls: number;
  aiTokens: number;
  aiTokenLimitOverride: number | null;
  reportUsageLimitOverride: number | null;
  isOwner: boolean;
}
export interface AdminUserDirectory {
  users: AdminUserRecord[];
  total: number;
  summary: {
    active: number;
    suspended: number;
    free: number;
    premium: number;
    verified: number;
    unverified: number;
    activeSessions: number;
  };
  limit: number;
}
export interface AdminUsageSettings {
  persistent: boolean;
  freeMonthlyAITokenLimit: number;
  environmentFreeMonthlyAITokenLimit: number;
  freeMonthlyReportUsageLimit: number;
  environmentFreeMonthlyReportUsageLimit: number;
  maxMonthlyAITokenLimit: number;
  maxFreeMonthlyUsageLimit: number;
}
export interface RuntimeEnvironmentEntry {
  key: string;
  label: string;
  category: string;
  description: string;
  type: "integer" | "boolean" | "enum" | "url" | "text" | "secret";
  options: string[] | null;
  min: number | null;
  max: number | null;
  secret: boolean;
  editable: boolean;
  configured: boolean;
  value: string | null;
  source: "admin override" | "deployment environment" | "not configured";
  overridden: boolean;
  restartRequired: boolean;
}
export interface RuntimeEnvironmentStatus {
  persistent: boolean;
  restartRequired: boolean;
  entries: RuntimeEnvironmentEntry[];
}
export interface BackendRestartStatus {
  available: boolean;
  scheduled: boolean;
  scheduledAt: string | null;
  restartDelayMs: number;
  reason: string | null;
}
export interface ExternalDiagnosticsResult {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  summary: {
    total: number;
    operational: number;
    failed: number;
    notConfigured: number;
  };
  services: Array<{
    id: string;
    name: string;
    category: string;
    status: "operational" | "failed" | "not_configured";
    httpStatus: number | null;
    latencyMs: number | null;
    message: string;
  }>;
}
export type DiagnosticService = ExternalDiagnosticsResult["services"][number];
export type AIProvider = "openai" | "anthropic" | "kimi" | "gemini";
const AI_PROVIDERS: AIProvider[] = ["openai", "anthropic", "kimi", "gemini"];
const aiProviderLabel = (provider: AIProvider) =>
  ({
    openai: "OpenAI",
    anthropic: "Anthropic",
    kimi: "Kimi",
    gemini: "Gemini",
  })[provider];
export interface AIAdminSettings {
  enabled: boolean;
  failoverEnabled: boolean;
  available: boolean;
  persistent: boolean;
  provider: AIProvider;
  defaultProvider: AIProvider;
  primaryModel: string;
  fastModel: string;
  configured: boolean;
  fallbackProvider: AIProvider;
  fallbackConfigured: boolean;
  providers: Record<
    AIProvider,
    {
      primary: string;
      fast: string;
      options: string[];
      configured: boolean;
    }
  >;
  features: Record<
    AIFeatureKey,
    {
      enabled: boolean;
      available: boolean;
    }
  >;
}
export interface AIModelCatalog {
  fetchedAt: string;
  providers: Record<
    AIProvider,
    {
      models: string[];
      source: "provider" | "configured";
      error: string | null;
    }
  >;
}
export type AIFeatureKey =
  | "aiBrief"
  | "reportChat"
  | "routeAnalysis"
  | "snowVision";
const AI_FEATURE_CONTROLS = [
  {
    key: "aiBrief",
    label: "Field briefing",
    description: "Shows the generated AI analysis in the report summary.",
    icon: Sparkles,
  },
  {
    key: "reportChat",
    label: "Report chat",
    description: "Lets users ask follow-up questions about a generated report.",
    icon: MessageCircleQuestion,
  },
  {
    key: "routeAnalysis",
    label: "AI route assistance",
    description:
      "Adds AI route suggestions, waypoint generation, and narrative synthesis to the base route-analysis feature.",
    icon: Route,
  },
  {
    key: "snowVision",
    label: "Satellite snow vision",
    description:
      "Enables AI analysis of satellite imagery and nearby snow measurements.",
    icon: Satellite,
  },
] as const;
export interface ProductFeatureFlagStatus {
  persistent: boolean;
  flags: ProductFeatureFlags;
}
const PRODUCT_FEATURE_CONTROLS = [
  {
    key: "routeAnalysis",
    label: "Route analysis",
    description:
      "Shows route checkpoint analysis, mapped-route matching, and GPX route tools.",
    icon: Route,
  },
  {
    key: "tripPlanning",
    label: "Multi-day trip planning",
    description: "Shows the Trip tool and its multi-day forecast entry points.",
    icon: CalendarRange,
  },
  {
    key: "satelliteImagery",
    label: "Satellite imagery",
    description:
      "Enables the satellite basemap, imagery tiles, and satellite snow analysis.",
    icon: Layers,
  },
  {
    key: "startTimeComparisons",
    label: "Start-time comparisons",
    description:
      "Runs and displays earlier and later departure scenarios in planner reports.",
    icon: Clock3,
  },
  {
    key: "terrainWindow",
    label: "Terrain Window",
    description:
      "Shows relative planning conditions across time, elevation, and aspect.",
    icon: Grid3X3,
  },
  {
    key: "objectiveWatch",
    label: "Objective Watch",
    description:
      "Lets signed-in users save a baseline and compare later reports for the same objective.",
    icon: BellRing,
  },
  {
    key: "gpxImport",
    label: "GPX import",
    description:
      "Lets users upload GPX tracks and analyze supplied route checkpoints.",
    icon: FileUp,
  },
  {
    key: "reportHistory",
    label: "Report history",
    description:
      "Controls saving new report snapshots. Previously generated reports remain available.",
    icon: History,
  },
  {
    key: "reportSharing",
    label: "Report sharing",
    description:
      "Shows share-link controls and allows public read-only report links to open.",
    icon: Share2,
  },
  {
    key: "hourlyWeatherCharts",
    label: "Hourly weather charts",
    description:
      "Shows interactive hourly trend charts in Planner and multi-day trip reports.",
    icon: BarChart3,
  },
  {
    key: "elevationForecast",
    label: "Elevation forecasts",
    description:
      "Shows modeled weather differences across forecast elevation bands.",
    icon: MapPinned,
  },
  {
    key: "heatRiskDetails",
    label: "Heat risk",
    description:
      "Controls heat-risk scoring and the detailed heat assessment and terrain guidance module.",
    icon: Gauge,
  },
  {
    key: "fireRiskDetails",
    label: "Fire risk",
    description:
      "Controls fire-risk scoring and the detailed fire-weather, wildfire, and smoke guidance module.",
    icon: AlertTriangle,
  },
  {
    key: "snowpackDetails",
    label: "Snowpack",
    description:
      "Controls snowpack scoring and the observed depth, water equivalent, and historical context module.",
    icon: Layers,
  },
  {
    key: "fieldObservations",
    label: "Field observations",
    description:
      "Controls scoring from nearby stations, radar, and streamflow plus their observation details.",
    icon: Activity,
  },
  {
    key: "airQualityDetails",
    label: "Air quality",
    description:
      "Controls air-quality scoring and the AQI, pollutant, and observation or model context module.",
    icon: Gauge,
  },
  {
    key: "gearRecommendations",
    label: "Gear recommendations",
    description:
      "Shows the conditions-matched packing and equipment guidance module.",
    icon: ShieldCheck,
  },
  {
    key: "windLoadingDetails",
    label: "Wind loading",
    description:
      "Controls avalanche wind-loading compound scoring and its transport, aspect, and terrain evidence.",
    icon: Route,
  },
  {
    key: "daylightTimeline",
    label: "Daylight",
    description:
      "Controls darkness scoring and planned start and return timing against sunrise and sunset.",
    icon: Clock3,
  },
  {
    key: "scoreBreakdown",
    label: "Score breakdown",
    description:
      "Shows factor impacts, confidence, and grouped deductions behind the planning score.",
    icon: Gauge,
  },
  {
    key: "weatherContextDetails",
    label: "Weather context",
    description:
      "Controls visibility-context scoring and the supporting readings and pressure-trend module.",
    icon: Activity,
  },
  {
    key: "avalancheDetails",
    label: "Avalanche",
    description:
      "Controls avalanche scoring and the dedicated forecast, problem-terrain, and official-center detail module.",
    icon: AlertTriangle,
  },
] as const satisfies ReadonlyArray<{
  key: ProductFeatureKey;
  label: string;
  description: string;
  icon: typeof Clock3;
}>;
export interface AdminViewProps {
  navigateToView: (view: AppView) => void;
  openPlannerView: () => void;
  openTripToolView: () => void;
}
export type LogSortKey =
  | "timestamp"
  | "name"
  | "date"
  | "statusCode"
  | "safetyScore"
  | "durationMs"
  | "ip";
export type StatusFilter =
  | "all"
  | "healthy"
  | "issues"
  | "errors"
  | "partial"
  | "slow";
export type AnalyticsRange = "6h" | "24h" | "7d";
export type AuditFilter =
  | "all"
  | "accounts"
  | "configuration"
  | "maintenance"
  | "diagnostics"
  | "errors";
export type UserStatusFilter =
  | "all"
  | "active"
  | "suspended"
  | "free"
  | "premium"
  | "verified"
  | "unverified";
export type AdminSection =
  | "overview"
  | "users"
  | "operations"
  | "analytics"
  | "activity";
export type AdminOperationsPanel =
  | "health"
  | "monitoring"
  | "ai"
  | "environment"
  | "features";
export type AdminAttentionKey =
  | "reports"
  | "slow"
  | "ai"
  | "diagnostics"
  | "scheduler"
  | "resources"
  | "suspended";
export interface AdminAttentionSignal {
  key: AdminAttentionKey;
  label: string;
  detail: string;
  count: number;
  section: AdminSection;
  icon: typeof AlertTriangle;
  tone: "warning" | "critical";
}
const ADMIN_SECTIONS = [
  {
    value: "overview",
    label: "Overview",
    description: "Platform status",
    icon: LayoutDashboard,
  },
  {
    value: "users",
    label: "Users",
    description: "Accounts and access",
    icon: Users,
  },
  {
    value: "operations",
    label: "Operations",
    description: "Services and controls",
    icon: Server,
  },
  {
    value: "analytics",
    label: "Analytics",
    description: "Reports and AI usage",
    icon: BarChart3,
  },
  {
    value: "activity",
    label: "Activity",
    description: "Admin audit trail",
    icon: History,
  },
] as const satisfies ReadonlyArray<{
  value: AdminSection;
  label: string;
  description: string;
  icon: typeof LayoutDashboard;
}>;
const ADMIN_OPERATIONS_PANELS = [
  {
    value: "health",
    label: "Service health",
    description: "Diagnostics and uptime",
    icon: Server,
  },
  {
    value: "monitoring",
    label: "Monitoring",
    description: "Objective Watch scheduler",
    icon: BellRing,
  },
  {
    value: "ai",
    label: "AI controls",
    description: "Providers and models",
    icon: Bot,
  },
  {
    value: "environment",
    label: "Environment",
    description: "Runtime configuration",
    icon: KeyRound,
  },
  {
    value: "features",
    label: "Features",
    description: "Product availability",
    icon: Grid3X3,
  },
] as const satisfies ReadonlyArray<{
  value: AdminOperationsPanel;
  label: string;
  description: string;
  icon: typeof Server;
}>;
const ADMIN_SECTION_STORAGE_KEY = "summitsafe:admin-section:v1";
const ADMIN_RANGE_STORAGE_KEY = "summitsafe:admin-range:v1";
const ADMIN_OPERATIONS_PANEL_STORAGE_KEY =
  "summitsafe:admin-operations-panel:v1";
const readStoredAdminSection = (): AdminSection => {
  if (typeof window === "undefined") return "overview";
  try {
    const stored = window.sessionStorage.getItem(ADMIN_SECTION_STORAGE_KEY);
    return ADMIN_SECTIONS.some((section) => section.value === stored)
      ? (stored as AdminSection)
      : "overview";
  } catch {
    return "overview";
  }
};
const readStoredAnalyticsRange = (): AnalyticsRange => {
  if (typeof window === "undefined") return "7d";
  try {
    const stored = window.sessionStorage.getItem(ADMIN_RANGE_STORAGE_KEY);
    return stored === "6h" || stored === "24h" || stored === "7d"
      ? stored
      : "7d";
  } catch {
    return "7d";
  }
};
const readStoredOperationsPanel = (): AdminOperationsPanel => {
  if (typeof window === "undefined") return "health";
  try {
    const stored = window.sessionStorage.getItem(
      ADMIN_OPERATIONS_PANEL_STORAGE_KEY,
    );
    return ADMIN_OPERATIONS_PANELS.some((panel) => panel.value === stored)
      ? (stored as AdminOperationsPanel)
      : "health";
  } catch {
    return "health";
  }
};
const ANALYTICS_RANGES: Array<{
  value: AnalyticsRange;
  label: string;
  durationMs: number;
  bucketDurationMs: number;
  bucketLabel: string;
}> = [
  {
    value: "6h",
    label: "Last 6 hours",
    durationMs: 6 * 60 * 60 * 1000,
    bucketDurationMs: 30 * 60 * 1000,
    bucketLabel: "30-minute",
  },
  {
    value: "24h",
    label: "Last 24 hours",
    durationMs: 24 * 60 * 60 * 1000,
    bucketDurationMs: 2 * 60 * 60 * 1000,
    bucketLabel: "2-hour",
  },
  {
    value: "7d",
    label: "Last 7 days",
    durationMs: 7 * 24 * 60 * 60 * 1000,
    bucketDurationMs: 12 * 60 * 60 * 1000,
    bucketLabel: "12-hour",
  },
];
const CHART_TOOLTIP_STYLE: React.CSSProperties = {
  border: "1px solid var(--ui-line-strong)",
  borderRadius: 8,
  background: "var(--ui-surface)",
  boxShadow: "var(--ui-shadow-md)",
  color: "var(--ui-text)",
  fontSize: 12,
};
const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "healthy", label: "Healthy" },
  { value: "issues", label: "Needs attention" },
  { value: "errors", label: "Errors" },
  { value: "partial", label: "Partial data" },
  { value: "slow", label: "Slow (10s+)" },
];
const LOG_PAGE_SIZE = 10;
const AUDIT_FILTERS: Array<{ value: AuditFilter; label: string }> = [
  { value: "all", label: "All activity" },
  { value: "accounts", label: "Accounts" },
  { value: "configuration", label: "Configuration" },
  { value: "maintenance", label: "Maintenance" },
  { value: "diagnostics", label: "Diagnostics" },
  { value: "errors", label: "Failed" },
];
const USER_STATUS_FILTERS: Array<{ value: UserStatusFilter; label: string }> = [
  { value: "all", label: "All accounts" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "free", label: "Free" },
  { value: "premium", label: "Premium" },
  { value: "verified", label: "Verified" },
  { value: "unverified", label: "Unverified" },
];
function getAnalyticsRange(range: AnalyticsRange) {
  return (
    ANALYTICS_RANGES.find((option) => option.value === range) ??
    ANALYTICS_RANGES[1]
  );
}
function getLogSortValue(
  entry: ReportLogEntry,
  key: LogSortKey,
): string | number {
  switch (key) {
    case "timestamp":
      return entry.timestamp;
    case "name":
      return entry.name ?? "";
    case "date":
      return entry.date ?? "";
    case "statusCode":
      return entry.statusCode;
    case "safetyScore":
      return entry.safetyScore ?? -1;
    case "durationMs":
      return entry.durationMs;
    case "ip":
      return entry.ip ?? "";
  }
}
function matchesStatus(entry: ReportLogEntry, filter: StatusFilter): boolean {
  if (filter === "healthy")
    return entry.statusCode === 200 && entry.partialData !== true;
  if (filter === "issues")
    return entry.statusCode !== 200 || entry.partialData === true;
  if (filter === "errors") return entry.statusCode !== 200;
  if (filter === "partial") return entry.partialData === true;
  if (filter === "slow") return entry.durationMs >= 10_000;
  return true;
}
function formatDuration(durationMs: number | null): string {
  if (durationMs == null || !Number.isFinite(durationMs)) return "—";
  if (durationMs > 0 && durationMs < 1) return "<1ms";
  return durationMs >= 1000
    ? `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`
    : `${Math.round(durationMs)}ms`;
}
function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** unitIndex;
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value >= 100 ? 0 : value >= 10 ? 1 : 2,
  }).format(value)} ${units[unitIndex]}`;
}
function formatLogTime(timestamp: string): {
  primary: string;
  secondary: string;
} {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime()))
    return { primary: "Unknown", secondary: timestamp };
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return {
    primary: date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }),
    secondary: sameDay
      ? "Today"
      : date.toLocaleDateString([], {
          month: "short",
          day: "numeric",
          year:
            date.getFullYear() === today.getFullYear() ? undefined : "numeric",
        }),
  };
}
const formatSchedulerTimestamp = (value: string | null) => {
  if (!value) return "Not recorded yet";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Invalid timestamp";
};
const schedulerHealthLabel = (
  health: ObjectiveWatchSchedulerStatus["health"],
) =>
  ({
    healthy: "Healthy",
    running: "Check running",
    waiting: "Waiting for heartbeat",
    stopped: "Stopped",
    not_configured: "Not configured",
    unhealthy: "Heartbeat overdue",
    failed: "Latest run failed",
  })[health];
const formatCheckInterval = (minutes: number) => {
  if (minutes < 60) return `${minutes}m cadence`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h cadence`;
};
const OBJECTIVE_WATCH_INTERVAL_OPTIONS = [
  ...Array.from({ length: 12 }, (_, index) => (index + 1) * 5),
  90,
  ...Array.from({ length: 23 }, (_, index) => (index + 2) * 60),
];
const formatCheckIntervalChoice = (minutes: number) => {
  if (minutes < 60) return `Every ${minutes} minutes`;
  const hours = minutes / 60;
  return `Every ${Number.isInteger(hours) ? hours : hours.toFixed(1)} ${hours === 1 ? "hour" : "hours"}`;
};
function formatAccountDate(timestamp: string | null): string {
  if (!timestamp) return "No activity yet";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const elapsedMs = Math.max(0, Date.now() - date.getTime());
  if (elapsedMs < 60_000) return "Just now";
  if (elapsedMs < 60 * 60_000) return `${Math.floor(elapsedMs / 60_000)}m ago`;
  if (elapsedMs < 24 * 60 * 60_000)
    return `${Math.floor(elapsedMs / (60 * 60_000))}h ago`;
  if (elapsedMs < 7 * 24 * 60 * 60_000)
    return `${Math.floor(elapsedMs / (24 * 60 * 60_000))}d ago`;
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}
function formatHealthMonitorAction(action: string): string {
  if (action === "alert-sent") return "Alert emailed";
  if (action === "reminder-sent") return "Reminder emailed";
  if (action === "recovery-sent") return "Recovery emailed";
  if (action === "processing-failed") return "Alert processing failed";
  return "No email needed";
}
function accountInitials(user: AdminUserRecord): string {
  const words = user.displayName.trim().split(/\s+/u).filter(Boolean);
  if (words.length > 1)
    return `${words[0][0]}${words.at(-1)?.[0] ?? ""}`.toUpperCase();
  return (
    words[0]?.slice(0, 2) ||
    user.email?.slice(0, 2) ||
    "?"
  ).toUpperCase();
}
function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(percentileValue * sorted.length) - 1),
  );
  return sorted[index];
}
function isHealthyResponse(entry: ReportLogEntry): boolean {
  return entry.statusCode === 200 && entry.partialData !== true;
}
function buildTrendData(
  entries: ReportLogEntry[],
  range: AnalyticsRange,
  now: number,
) {
  const rangeConfig = getAnalyticsRange(range);
  const rangeDuration = rangeConfig.durationMs;
  const bucketDuration = rangeConfig.bucketDurationMs;
  const start = now - rangeDuration;
  const bucketCount = Math.ceil(rangeDuration / bucketDuration);
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = start + index * bucketDuration;
    const date = new Date(bucketStart);
    return {
      timestamp: bucketStart,
      label:
        range !== "7d"
          ? date.toLocaleTimeString([], {
              hour: "numeric",
              minute: range === "6h" ? "2-digit" : undefined,
            })
          : date.toLocaleDateString([], { weekday: "short" }),
      period:
        range !== "7d"
          ? date.toLocaleString([], {
              month: "short",
              day: "numeric",
              hour: "numeric",
            })
          : date.toLocaleString([], {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
            }),
      healthy: 0,
      partial: 0,
      errors: 0,
      durations: [] as number[],
    };
  });

  entries.forEach((entry) => {
    const timestamp = new Date(entry.timestamp).getTime();
    if (!Number.isFinite(timestamp) || timestamp < start || timestamp > now)
      return;
    const bucket =
      buckets[
        Math.min(
          bucketCount - 1,
          Math.floor((timestamp - start) / bucketDuration),
        )
      ];
    if (!bucket) return;
    if (entry.statusCode !== 200) bucket.errors += 1;
    else if (entry.partialData === true) bucket.partial += 1;
    else bucket.healthy += 1;
    if (Number.isFinite(entry.durationMs))
      bucket.durations.push(entry.durationMs);
  });

  return buckets.map(({ durations, ...bucket }) => ({
    ...bucket,
    total: bucket.healthy + bucket.partial + bucket.errors,
    medianSeconds: durations.length ? percentile(durations, 0.5) / 1000 : null,
    p95Seconds: durations.length ? percentile(durations, 0.95) / 1000 : null,
  }));
}
function buildHourlyDistribution(entries: ReportLogEntry[]) {
  const hours = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: new Date(2026, 0, 1, hour).toLocaleTimeString([], {
      hour: "numeric",
    }),
    requests: 0,
  }));
  entries.forEach((entry) => {
    const date = new Date(entry.timestamp);
    if (!Number.isNaN(date.getTime())) hours[date.getHours()].requests += 1;
  });
  return hours;
}
function buildTopLocations(entries: ReportLogEntry[]) {
  const counts = new Map<string, number>();
  entries.forEach((entry) => {
    const location = entry.name?.trim() || "Unnamed report";
    counts.set(location, (counts.get(location) ?? 0) + 1);
  });
  return [...counts.entries()]
    .map(([name, count]) => ({
      name,
      count,
      share: entries.length ? (count / entries.length) * 100 : 0,
    }))
    .sort(
      (left, right) =>
        right.count - left.count || left.name.localeCompare(right.name),
    )
    .slice(0, 6);
}
const DAY_MS = 24 * 60 * 60 * 1000;
function parseDateOnlyUtc(value: string | null): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value ?? "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? timestamp
    : null;
}
function withDistributionShares<T extends { count: number }>(items: T[]) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return {
    total,
    items: items.map((item) => ({
      ...item,
      share: total ? (item.count / total) * 100 : 0,
    })),
  };
}
function buildPlanningInsights(entries: ReportLogEntry[]) {
  const leadTime = [
    { key: "same-day", label: "Same day", count: 0 },
    { key: "next-day", label: "Next day", count: 0 },
    { key: "two-three-days", label: "2–3 days ahead", count: 0 },
    { key: "four-plus-days", label: "4+ days ahead", count: 0 },
  ];
  const startTimes = [
    { key: "early", label: "Before 6 AM", count: 0 },
    { key: "morning", label: "6–9:59 AM", count: 0 },
    { key: "midday", label: "10 AM–1:59 PM", count: 0 },
    { key: "late", label: "2 PM or later", count: 0 },
  ];

  entries
    .filter((entry) => entry.statusCode === 200)
    .forEach((entry) => {
      const selectedDate = parseDateOnlyUtc(entry.date);
      const requestedAt = new Date(entry.timestamp);
      if (selectedDate != null && !Number.isNaN(requestedAt.getTime())) {
        const requestDate = Date.UTC(
          requestedAt.getUTCFullYear(),
          requestedAt.getUTCMonth(),
          requestedAt.getUTCDate(),
        );
        const leadDays = Math.round((selectedDate - requestDate) / DAY_MS);
        // UTC can be one calendar day ahead of a western-U.S. request in the evening.
        // The product does not generate reports for past dates, so -1 is still same-day intent.
        if (leadDays === 0 || leadDays === -1) leadTime[0].count += 1;
        else if (leadDays === 1) leadTime[1].count += 1;
        else if (leadDays >= 2 && leadDays <= 3) leadTime[2].count += 1;
        else if (leadDays >= 4) leadTime[3].count += 1;
      }

      const startMatch = /^(\d{2}):(\d{2})$/u.exec(entry.startTime ?? "");
      if (!startMatch) return;
      const hour = Number(startMatch[1]);
      const minute = Number(startMatch[2]);
      if (hour > 23 || minute > 59) return;
      if (hour < 6) startTimes[0].count += 1;
      else if (hour < 10) startTimes[1].count += 1;
      else if (hour < 14) startTimes[2].count += 1;
      else startTimes[3].count += 1;
    });

  return {
    leadTime: withDistributionShares(leadTime),
    startTimes: withDistributionShares(startTimes),
  };
}
function buildReliabilityHotspots(entries: ReportLogEntry[]) {
  const locations = new Map<
    string,
    {
      name: string;
      total: number;
      issues: number;
      durations: number[];
    }
  >();

  entries.forEach((entry) => {
    const name = entry.name?.trim();
    // Validation failures describe bad requests, not destination reliability.
    if (!name || (entry.statusCode >= 400 && entry.statusCode < 500)) return;
    const key = name.toLocaleLowerCase();
    const current = locations.get(key) ?? {
      name,
      total: 0,
      issues: 0,
      durations: [],
    };
    current.total += 1;
    if (entry.partialData === true || entry.statusCode >= 500)
      current.issues += 1;
    if (Number.isFinite(entry.durationMs))
      current.durations.push(entry.durationMs);
    locations.set(key, current);
  });

  return [...locations.values()]
    .filter((location) => location.issues > 0)
    .map(({ durations, ...location }) => ({
      ...location,
      issueRate: (location.issues / location.total) * 100,
      p95Duration: durations.length ? percentile(durations, 0.95) : null,
    }))
    .sort(
      (left, right) =>
        right.issues - left.issues ||
        right.issueRate - left.issueRate ||
        right.total - left.total,
    )
    .slice(0, 6);
}
function buildAITrendData(
  entries: AIUsageEntry[],
  range: AnalyticsRange,
  now: number,
) {
  const rangeConfig = getAnalyticsRange(range);
  const rangeDuration = rangeConfig.durationMs;
  const bucketDuration = rangeConfig.bucketDurationMs;
  const start = now - rangeDuration;
  const bucketCount = Math.ceil(rangeDuration / bucketDuration);
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = start + index * bucketDuration;
    const date = new Date(bucketStart);
    return {
      timestamp: bucketStart,
      label:
        range !== "7d"
          ? date.toLocaleTimeString([], {
              hour: "numeric",
              minute: range === "6h" ? "2-digit" : undefined,
            })
          : date.toLocaleDateString([], { weekday: "short" }),
      inputTokens: 0,
      outputTokens: 0,
    };
  });

  entries.forEach((entry) => {
    const timestamp = new Date(entry.timestamp).getTime();
    if (!Number.isFinite(timestamp) || timestamp < start || timestamp > now)
      return;
    const bucket =
      buckets[
        Math.min(
          bucketCount - 1,
          Math.floor((timestamp - start) / bucketDuration),
        )
      ];
    if (!bucket) return;
    bucket.inputTokens += Number.isFinite(entry.inputTokens)
      ? entry.inputTokens
      : 0;
    bucket.outputTokens += Number.isFinite(entry.outputTokens)
      ? entry.outputTokens
      : 0;
  });

  return buckets;
}
function buildAIModels(entries: AIUsageEntry[]) {
  const models = new Map<
    string,
    {
      provider: string;
      model: string;
      calls: number;
      tokens: number;
      estimatedCostUsd: number;
    }
  >();
  entries.forEach((entry) => {
    const key = `${entry.provider}:${entry.model}`;
    const current = models.get(key) ?? {
      provider: entry.provider,
      model: entry.model,
      calls: 0,
      tokens: 0,
      estimatedCostUsd: 0,
    };
    current.calls += 1;
    current.tokens += Number.isFinite(entry.totalTokens)
      ? entry.totalTokens
      : 0;
    current.estimatedCostUsd += Number.isFinite(entry.estimatedCostUsd)
      ? Number(entry.estimatedCostUsd)
      : 0;
    models.set(key, current);
  });
  return [...models.values()].sort(
    (left, right) => right.tokens - left.tokens || right.calls - left.calls,
  );
}
function buildAIFeatures(entries: AIUsageEntry[]) {
  const features = new Map<
    string,
    {
      feature: string;
      calls: number;
      errors: number;
      tokens: number;
      estimatedCostUsd: number;
      totalDurationMs: number;
    }
  >();
  entries.forEach((entry) => {
    const feature = entry.feature?.trim() || "unknown";
    const current = features.get(feature) ?? {
      feature,
      calls: 0,
      errors: 0,
      tokens: 0,
      estimatedCostUsd: 0,
      totalDurationMs: 0,
    };
    current.calls += 1;
    current.errors += entry.status === "error" ? 1 : 0;
    current.tokens += Number.isFinite(entry.totalTokens)
      ? entry.totalTokens
      : 0;
    current.estimatedCostUsd += Number.isFinite(entry.estimatedCostUsd)
      ? Number(entry.estimatedCostUsd)
      : 0;
    current.totalDurationMs += Number.isFinite(entry.durationMs)
      ? entry.durationMs
      : 0;
    features.set(feature, current);
  });
  return [...features.values()]
    .map((feature) => ({
      ...feature,
      averageDurationMs: feature.calls
        ? feature.totalDurationMs / feature.calls
        : 0,
    }))
    .sort(
      (left, right) => right.calls - left.calls || right.tokens - left.tokens,
    );
}
function formatUptime(seconds: number | undefined): string {
  if (!Number.isFinite(seconds)) return "—";
  const totalMinutes = Math.floor((seconds ?? 0) / 60);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
function formatTokenCount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value < 1000) return value.toLocaleString();
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
function formatEstimatedCost(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "$0.00";
  if (value < 0.001) return `$${value.toFixed(6)}`;
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}
function escapeCsv(value: string | number | boolean | null): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function triggerCsvDownload(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | boolean | null>>,
) {
  const csv = [
    headers.join(","),
    ...rows.map((row) => row.map(escapeCsv).join(",")),
  ].join("\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
function triggerJsonDownload(filename: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(value, null, 2)}\n`], {
      type: "application/json;charset=utf-8",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
function downloadReportCsv(entries: ReportLogEntry[]) {
  const keys: Array<keyof ReportLogEntry> = [
    "timestamp",
    "name",
    "lat",
    "lon",
    "date",
    "startTime",
    "statusCode",
    "safetyScore",
    "partialData",
    "durationMs",
    "ip",
    "userAgent",
  ];
  triggerCsvDownload(
    `report-logs-${new Date().toISOString().slice(0, 10)}.csv`,
    keys,
    entries.map((entry) => keys.map((key) => entry[key])),
  );
}
function downloadAIUsageCsv(entries: AIUsageEntry[]) {
  const keys: Array<keyof AIUsageEntry> = [
    "timestamp",
    "provider",
    "model",
    "feature",
    "status",
    "durationMs",
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "estimatedCostUsd",
    "pricingMatched",
    "pricingVersion",
  ];
  triggerCsvDownload(
    `ai-usage-${new Date().toISOString().slice(0, 10)}.csv`,
    keys,
    entries.map((entry) => keys.map((key) => entry[key])),
  );
}
export interface AdminConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "caution";
}
export function useAdministration() {
  const [logs, setLogs] = useState<ReportLogEntry[]>([]);

  const [aiUsage, setAIUsage] = useState<AIUsageEntry[]>([]);

  const [aiSettings, setAISettings] = useState<AIAdminSettings | null>(null);

  const [aiModelCatalog, setAIModelCatalog] = useState<AIModelCatalog | null>(
    null,
  );

  const [featureFlagStatus, setFeatureFlagStatus] =
    useState<ProductFeatureFlagStatus | null>(null);

  const [health, setHealth] = useState<AdminHealthSnapshot | null>(null);

  const [systemResources, setSystemResources] =
    useState<AdminSystemResources | null>(null);

  const [healthHistory, setHealthHistory] =
    useState<AdminHealthHistoryPayload | null>(null);

  const [healthHttpStatus, setHealthHttpStatus] = useState<number | null>(null);

  const [backendLatencyMs, setBackendLatencyMs] = useState<number | null>(null);

  const [auditEntries, setAuditEntries] = useState<AdminAuditEntry[]>([]);

  const [users, setUsers] = useState<AdminUserRecord[]>([]);

  const [usersTotal, setUsersTotal] = useState(0);

  const [userSummary, setUserSummary] = useState({
    active: 0,
    suspended: 0,
    free: 0,
    premium: 0,
    verified: 0,
    unverified: 0,
    activeSessions: 0,
  });

  const [usageSettings, setUsageSettings] = useState<AdminUsageSettings | null>(
    null,
  );

  const [runtimeEnvironment, setRuntimeEnvironment] =
    useState<RuntimeEnvironmentStatus | null>(null);

  const [backendRestartStatus, setBackendRestartStatus] =
    useState<BackendRestartStatus | null>(null);

  const [objectiveWatchScheduler, setObjectiveWatchScheduler] =
    useState<ObjectiveWatchSchedulerStatus | null>(null);

  const [
    objectiveWatchCheckIntervalDraft,
    setObjectiveWatchCheckIntervalDraft,
  ] = useState("180");

  const [runtimeEnvironmentDrafts, setRuntimeEnvironmentDrafts] = useState<
    Record<string, string>
  >({});

  const [usageLimitDraft, setUsageLimitDraft] = useState("");

  const [reportLimitDraft, setReportLimitDraft] = useState("");

  const [userUsageLimitDrafts, setUserUsageLimitDrafts] = useState<
    Record<string, string>
  >({});

  const [userReportLimitDrafts, setUserReportLimitDrafts] = useState<
    Record<string, string>
  >({});

  const [loading, setLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [aiUsageError, setAIUsageError] = useState<string | null>(null);

  const [aiSettingsError, setAISettingsError] = useState<string | null>(null);

  const [aiSettingsPending, setAISettingsPending] = useState(false);

  const [aiModelCatalogPending, setAIModelCatalogPending] = useState(false);

  const [aiModelCatalogError, setAIModelCatalogError] = useState<string | null>(
    null,
  );

  const [modelDrafts, setModelDrafts] = useState<
    Record<AIProvider, { primary: string; fast: string }>
  >({
    openai: { primary: "", fast: "" },
    anthropic: { primary: "", fast: "" },
    kimi: { primary: "", fast: "" },
    gemini: { primary: "", fast: "" },
  });

  const [featureFlagsError, setFeatureFlagsError] = useState<string | null>(
    null,
  );

  const [featureFlagsPending, setFeatureFlagsPending] = useState(false);

  const [healthError, setHealthError] = useState<string | null>(null);

  const [systemResourcesError, setSystemResourcesError] = useState<
    string | null
  >(null);

  const [healthHistoryError, setHealthHistoryError] = useState<string | null>(
    null,
  );

  const [auditError, setAuditError] = useState<string | null>(null);

  const [usersError, setUsersError] = useState<string | null>(null);

  const [usersNotice, setUsersNotice] = useState<string | null>(null);

  const [usageSettingsError, setUsageSettingsError] = useState<string | null>(
    null,
  );

  const [usageSettingsPending, setUsageSettingsPending] = useState(false);

  const [runtimeEnvironmentError, setRuntimeEnvironmentError] = useState<
    string | null
  >(null);

  const [runtimeEnvironmentNotice, setRuntimeEnvironmentNotice] = useState<
    string | null
  >(null);

  const [runtimeEnvironmentPendingKey, setRuntimeEnvironmentPendingKey] =
    useState<string | null>(null);

  const [backendRestartPending, setBackendRestartPending] = useState(false);

  const [objectiveWatchSchedulerError, setObjectiveWatchSchedulerError] =
    useState<string | null>(null);

  const [objectiveWatchSchedulerNotice, setObjectiveWatchSchedulerNotice] =
    useState<string | null>(null);

  const [objectiveWatchSchedulerPending, setObjectiveWatchSchedulerPending] =
    useState(false);

  const [
    objectiveWatchSchedulerRunPending,
    setObjectiveWatchSchedulerRunPending,
  ] = useState(false);

  const [userActionPending, setUserActionPending] = useState<string | null>(
    null,
  );

  const [diagnostics, setDiagnostics] =
    useState<ExternalDiagnosticsResult | null>(null);

  const [diagnosticsPending, setDiagnosticsPending] = useState(false);

  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);

  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const [confirmation, setConfirmation] = useState<AdminConfirmRequest | null>(
    null,
  );

  const [sortKey, setSortKey] = useState<LogSortKey>("timestamp");

  const [sortAsc, setSortAsc] = useState(false);

  const [query, setQuery] = useState("");

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [auditFilter, setAuditFilter] = useState<AuditFilter>("all");

  const [auditQuery, setAuditQuery] = useState("");

  const [userQuery, setUserQuery] = useState("");

  const [userStatusFilter, setUserStatusFilter] =
    useState<UserStatusFilter>("all");

  const [activeSection, setActiveSection] = useState<AdminSection>(
    readStoredAdminSection,
  );

  const [activeOperationsPanel, setActiveOperationsPanel] =
    useState<AdminOperationsPanel>(readStoredOperationsPanel);

  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsRange>(
    readStoredAnalyticsRange,
  );

  const [autoRefresh, setAutoRefresh] = useState(true);

  const [visibleLogCount, setVisibleLogCount] = useState(LOG_PAGE_SIZE);

  const hasLoadedRef = useRef(false);

  const dashboardContentRef = useRef<HTMLDivElement>(null);

  const requestActivityRef = useRef<HTMLElement>(null);

  const aiUsageRef = useRef<HTMLElement>(null);

  const confirmationResolverRef = useRef<((confirmed: boolean) => void) | null>(
    null,
  );

  const requestAdminConfirmation = useCallback(
    (request: AdminConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        confirmationResolverRef.current?.(false);
        confirmationResolverRef.current = resolve;
        setConfirmation(request);
      }),
    [],
  );

  const resolveAdminConfirmation = useCallback((confirmed: boolean) => {
    const resolve = confirmationResolverRef.current;
    confirmationResolverRef.current = null;
    setConfirmation(null);
    resolve?.(confirmed);
  }, []);

  useEffect(
    () => () => {
      confirmationResolverRef.current?.(false);
      confirmationResolverRef.current = null;
    },
    [],
  );

  useEffect(() => {
    try {
      window.sessionStorage.setItem(ADMIN_SECTION_STORAGE_KEY, activeSection);
      window.sessionStorage.setItem(ADMIN_RANGE_STORAGE_KEY, analyticsRange);
      window.sessionStorage.setItem(
        ADMIN_OPERATIONS_PANEL_STORAGE_KEY,
        activeOperationsPanel,
      );
    } catch {
      // Admin navigation remains usable when browser storage is unavailable.
    }
  }, [activeOperationsPanel, activeSection, analyticsRange]);

  const fetchHealthSnapshot = useCallback(async () => {
    const startedAt = performance.now();
    const result = await fetchApi("/api/healthz");
    return {
      ...result,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  }, []);

  const applyHealthSnapshot = useCallback(
    (result: Awaited<ReturnType<typeof fetchHealthSnapshot>>) => {
      const payload = result.payload;
      if (
        payload &&
        typeof payload === "object" &&
        "service" in payload &&
        "memory" in payload
      ) {
        setHealth(payload as AdminHealthSnapshot);
        setHealthHttpStatus(result.response.status);
        setBackendLatencyMs(result.latencyMs);
        setHealthError(null);
        return true;
      }
      setHealthError("System details are temporarily unavailable.");
      return false;
    },
    [],
  );

  const applyUserDirectory = useCallback((payload: unknown) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      return false;
    const directory = payload as Partial<AdminUserDirectory>;
    if (
      !Array.isArray(directory.users) ||
      !directory.summary ||
      typeof directory.summary !== "object"
    )
      return false;
    setUsers(directory.users);
    setUsersTotal(
      Number.isFinite(directory.total)
        ? Number(directory.total)
        : directory.users.length,
    );
    setUserSummary({
      active: Number.isFinite(directory.summary.active)
        ? Number(directory.summary.active)
        : 0,
      suspended: Number.isFinite(directory.summary.suspended)
        ? Number(directory.summary.suspended)
        : 0,
      free: Number.isFinite(directory.summary.free)
        ? Number(directory.summary.free)
        : 0,
      premium: Number.isFinite(directory.summary.premium)
        ? Number(directory.summary.premium)
        : 0,
      verified: Number.isFinite(directory.summary.verified)
        ? Number(directory.summary.verified)
        : 0,
      unverified: Number.isFinite(directory.summary.unverified)
        ? Number(directory.summary.unverified)
        : 0,
      activeSessions: Number.isFinite(directory.summary.activeSessions)
        ? Number(directory.summary.activeSessions)
        : 0,
    });
    setUsersError(null);
    return true;
  }, []);

  const applyRuntimeEnvironment = useCallback((payload: unknown) => {
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      !("entries" in payload)
    )
      return false;
    const status = payload as RuntimeEnvironmentStatus;
    if (!Array.isArray(status.entries)) return false;
    setRuntimeEnvironment(status);
    setRuntimeEnvironmentDrafts(
      Object.fromEntries(
        status.entries.map((entry) => [
          entry.key,
          entry.secret ? "" : (entry.value ?? ""),
        ]),
      ),
    );
    setRuntimeEnvironmentError(null);
    return true;
  }, []);

  const applyObjectiveWatchScheduler = useCallback((payload: unknown) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      return false;
    if (
      !("enabled" in payload) ||
      !("health" in payload) ||
      !("configured" in payload)
    )
      return false;
    const status = payload as ObjectiveWatchSchedulerStatus;
    setObjectiveWatchScheduler(status);
    setObjectiveWatchCheckIntervalDraft(
      String(status.checkIntervalMinutes || 180),
    );
    setObjectiveWatchSchedulerError(null);
    return true;
  }, []);

  const fetchAuditTrail = useCallback(async () => {
    try {
      const result = await fetchApi("/api/admin/audit-log");
      if (result.response.ok && Array.isArray(result.payload)) {
        setAuditEntries(result.payload as AdminAuditEntry[]);
        setAuditError(null);
      } else {
        setAuditError("Administrative activity is temporarily unavailable.");
      }
    } catch {
      setAuditError(
        "Could not reach the server to load administrative activity.",
      );
    }
  }, []);

  const fetchUserDirectory = useCallback(async () => {
    try {
      const result = await fetchApi("/api/admin/users?limit=500");
      if (result.response.ok && applyUserDirectory(result.payload)) return true;
      setUsersError("The account directory is temporarily unavailable.");
    } catch {
      setUsersError("Could not reach the server to load accounts.");
    }
    return false;
  }, [applyUserDirectory]);

  const fetchAdminData = useCallback(
    async (background = false) => {
      if (background) setRefreshing(true);
      try {
        const [
          logsResult,
          aiUsageResult,
          healthResult,
          systemResourcesResult,
          healthHistoryResult,
          aiSettingsResult,
          featureFlagsResult,
          aiModelsResult,
          auditResult,
          usersResult,
          usageSettingsResult,
          runtimeEnvironmentResult,
          backendRestartResult,
          objectiveWatchSchedulerResult,
        ] = await Promise.all([
          fetchApi("/api/report-logs"),
          fetchApi("/api/ai-usage"),
          fetchHealthSnapshot(),
          fetchApi("/api/admin/system-resources"),
          fetchApi("/api/admin/health-monitor-history"),
          fetchApi("/api/admin/ai-settings"),
          fetchApi("/api/admin/feature-flags"),
          fetchApi("/api/admin/ai-models"),
          fetchApi("/api/admin/audit-log"),
          fetchApi("/api/admin/users?limit=500"),
          fetchApi("/api/admin/usage-settings"),
          fetchApi("/api/admin/runtime-environment"),
          fetchApi("/api/admin/maintenance/backend-restart"),
          fetchApi("/api/admin/objective-watch-scheduler"),
        ]);
        if (logsResult.response.ok && Array.isArray(logsResult.payload)) {
          setLogs(logsResult.payload as ReportLogEntry[]);
          setError(null);
          setLastRefreshed(new Date());
        } else {
          setError("The server could not load report logs.");
        }
        if (aiUsageResult.response.ok && Array.isArray(aiUsageResult.payload)) {
          setAIUsage(aiUsageResult.payload as AIUsageEntry[]);
          setAIUsageError(null);
        } else {
          setAIUsageError("AI usage data is temporarily unavailable.");
        }
        applyHealthSnapshot(healthResult);
        if (
          systemResourcesResult.response.ok &&
          systemResourcesResult.payload &&
          typeof systemResourcesResult.payload === "object" &&
          "memory" in systemResourcesResult.payload
        ) {
          setSystemResources(
            systemResourcesResult.payload as AdminSystemResources,
          );
          setSystemResourcesError(null);
        } else {
          setSystemResourcesError(
            "Disk and RAM usage are temporarily unavailable.",
          );
        }
        if (
          healthHistoryResult.response.ok &&
          healthHistoryResult.payload &&
          typeof healthHistoryResult.payload === "object" &&
          "entries" in healthHistoryResult.payload &&
          Array.isArray(healthHistoryResult.payload.entries)
        ) {
          setHealthHistory(
            healthHistoryResult.payload as AdminHealthHistoryPayload,
          );
          setHealthHistoryError(null);
        } else {
          setHealthHistoryError(
            "Automated health-check history is temporarily unavailable.",
          );
        }
        if (
          aiSettingsResult.response.ok &&
          aiSettingsResult.payload &&
          typeof aiSettingsResult.payload === "object"
        ) {
          setAISettings(aiSettingsResult.payload as AIAdminSettings);
          setAISettingsError(null);
        } else {
          setAISettingsError("AI controls are temporarily unavailable.");
        }
        if (
          featureFlagsResult.response.ok &&
          featureFlagsResult.payload &&
          typeof featureFlagsResult.payload === "object"
        ) {
          setFeatureFlagStatus(
            featureFlagsResult.payload as ProductFeatureFlagStatus,
          );
          setFeatureFlagsError(null);
        } else {
          setFeatureFlagsError(
            "Product feature flags are temporarily unavailable.",
          );
        }
        if (
          aiModelsResult.response.ok &&
          aiModelsResult.payload &&
          typeof aiModelsResult.payload === "object"
        ) {
          setAIModelCatalog(aiModelsResult.payload as AIModelCatalog);
          setAIModelCatalogError(null);
        } else {
          setAIModelCatalogError(
            "Provider model lists are temporarily unavailable.",
          );
        }
        if (auditResult.response.ok && Array.isArray(auditResult.payload)) {
          setAuditEntries(auditResult.payload as AdminAuditEntry[]);
          setAuditError(null);
        } else {
          setAuditError("Administrative activity is temporarily unavailable.");
        }
        if (
          !usersResult.response.ok ||
          !applyUserDirectory(usersResult.payload)
        ) {
          setUsersError("The account directory is temporarily unavailable.");
        }
        if (
          usageSettingsResult.response.ok &&
          usageSettingsResult.payload &&
          typeof usageSettingsResult.payload === "object"
        ) {
          const nextUsageSettings =
            usageSettingsResult.payload as AdminUsageSettings;
          setUsageSettings(nextUsageSettings);
          setUsageLimitDraft(String(nextUsageSettings.freeMonthlyAITokenLimit));
          setReportLimitDraft(
            String(nextUsageSettings.freeMonthlyReportUsageLimit),
          );
          setUsageSettingsError(null);
        } else {
          setUsageSettingsError("Usage limits are temporarily unavailable.");
        }
        if (
          !runtimeEnvironmentResult.response.ok ||
          !applyRuntimeEnvironment(runtimeEnvironmentResult.payload)
        ) {
          setRuntimeEnvironmentError(
            "Runtime environment settings are temporarily unavailable.",
          );
        }
        if (
          backendRestartResult.response.ok &&
          backendRestartResult.payload &&
          typeof backendRestartResult.payload === "object"
        ) {
          setBackendRestartStatus(
            backendRestartResult.payload as BackendRestartStatus,
          );
        } else {
          setBackendRestartStatus(null);
        }
        if (
          !objectiveWatchSchedulerResult.response.ok ||
          !applyObjectiveWatchScheduler(objectiveWatchSchedulerResult.payload)
        ) {
          setObjectiveWatchSchedulerError(
            "Objective Watch scheduler status is temporarily unavailable.",
          );
        }
      } catch {
        setError(
          "Could not reach the server. Check your connection and try again.",
        );
        setAIUsageError("AI usage data is temporarily unavailable.");
        setHealthError("System details are temporarily unavailable.");
        setSystemResourcesError(
          "Disk and RAM usage are temporarily unavailable.",
        );
        setHealthHistoryError(
          "Automated health-check history is temporarily unavailable.",
        );
        setAISettingsError("AI controls are temporarily unavailable.");
        setFeatureFlagsError(
          "Product feature flags are temporarily unavailable.",
        );
        setAIModelCatalogError(
          "Provider model lists are temporarily unavailable.",
        );
        setAuditError("Administrative activity is temporarily unavailable.");
        setUsersError("The account directory is temporarily unavailable.");
        setUsageSettingsError("Usage limits are temporarily unavailable.");
        setRuntimeEnvironmentError(
          "Runtime environment settings are temporarily unavailable.",
        );
        setBackendRestartStatus(null);
        setObjectiveWatchSchedulerError(
          "Objective Watch scheduler status is temporarily unavailable.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      applyHealthSnapshot,
      applyObjectiveWatchScheduler,
      applyRuntimeEnvironment,
      applyUserDirectory,
      fetchHealthSnapshot,
    ],
  );

  const refreshModelCatalog = useCallback(async () => {
    setAIModelCatalogPending(true);
    setAIModelCatalogError(null);
    try {
      const result = await fetchApi("/api/admin/ai-models/refresh", {
        method: "POST",
      });
      if (
        result.response.ok &&
        result.payload &&
        typeof result.payload === "object"
      ) {
        setAIModelCatalog(result.payload as AIModelCatalog);
        void fetchAuditTrail();
        return;
      }
      setAIModelCatalogError("Provider model lists could not be refreshed.");
    } catch {
      setAIModelCatalogError(
        "Could not reach the server to refresh provider models.",
      );
    } finally {
      setAIModelCatalogPending(false);
    }
  }, [fetchAuditTrail]);

  const updateAIControl = useCallback(
    async (settings: {
      enabled?: boolean;
      failoverEnabled?: boolean;
      provider?: AIProvider;
      features?: Partial<Record<AIFeatureKey, boolean>>;
      models?: Partial<Record<AIProvider, { primary?: string; fast?: string }>>;
    }) => {
      setAISettingsPending(true);
      setAISettingsError(null);
      try {
        const result = await fetchApi("/api/admin/ai-settings", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(settings),
        });
        if (
          result.response.ok &&
          result.payload &&
          typeof result.payload === "object"
        ) {
          const nextSettings = result.payload as AIAdminSettings;
          setAISettings(nextSettings);
          publishAiAvailability(nextSettings);
          void fetchAuditTrail();
          return nextSettings;
        }
        const message =
          result.payload &&
          typeof result.payload === "object" &&
          "error" in result.payload
            ? String(result.payload.error)
            : "The server could not update AI controls.";
        setAISettingsError(message);
        return null;
      } catch {
        setAISettingsError("Could not reach the server to update AI controls.");
        return null;
      } finally {
        setAISettingsPending(false);
      }
    },
    [fetchAuditTrail],
  );

  const previousSavedModels = useRef<Record<
    AIProvider,
    { primary: string; fast: string }
  > | null>(null);
  useEffect(() => {
    if (!aiSettings) return;
    const next = Object.fromEntries(
      AI_PROVIDERS.map((provider) => [
        provider,
        {
          primary: aiSettings.providers[provider].primary,
          fast: aiSettings.providers[provider].fast,
        },
      ]),
    ) as Record<AIProvider, { primary: string; fast: string }>;
    const previous = previousSavedModels.current;
    previousSavedModels.current = next;
    setModelDrafts((current) => mergeModelDrafts(current, previous, next));
  }, [aiSettings]);

  const toggleAIEnabled = async () => {
    if (!aiSettings) return;
    if (
      aiSettings.enabled &&
      !(await requestAdminConfirmation({
        title: "Stop all AI features?",
        description:
          "Every individual AI feature will be switched off. You can re-enable them later.",
        confirmLabel: "Stop AI features",
      }))
    )
      return;
    void updateAIControl({ enabled: !aiSettings.enabled });
  };

  const toggleAIFailover = () => {
    if (!aiSettings) return;
    void updateAIControl({ failoverEnabled: !aiSettings.failoverEnabled });
  };

  const toggleAIFeature = (feature: AIFeatureKey) => {
    const current = aiSettings?.features?.[feature]?.enabled;
    if (typeof current !== "boolean") return;
    void updateAIControl({ features: { [feature]: !current } });
  };

  const saveProviderModels = async (provider: AIProvider) => {
    const draft = modelDrafts[provider];
    const primary = draft.primary.trim();
    const fast = draft.fast.trim();
    if (!primary || !fast) return;
    await updateAIControl({ models: { [provider]: { primary, fast } } });
  };

  const updateManagedUserStatus = async (
    user: AdminUserRecord,
    status: "active" | "suspended",
  ) => {
    if (user.isOwner) return;
    if (
      status === "suspended" &&
      !(await requestAdminConfirmation({
        title: `Suspend ${user.displayName}?`,
        description:
          "This immediately signs them out and blocks future sign-ins until the account is reactivated.",
        confirmLabel: "Suspend account",
      }))
    )
      return;
    setUserActionPending(`${user.id}:status`);
    setUsersError(null);
    try {
      const result = await fetchApi(
        `/api/admin/users/${encodeURIComponent(user.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      if (!result.response.ok) {
        const message =
          result.payload &&
          typeof result.payload === "object" &&
          "error" in result.payload
            ? String(result.payload.error)
            : "The account status could not be updated.";
        setUsersError(message);
        return;
      }
      await fetchUserDirectory();
      void fetchAuditTrail();
    } catch {
      setUsersError("Could not reach the server to update this account.");
    } finally {
      setUserActionPending(null);
    }
  };

  const updateManagedUserTier = async (
    user: AdminUserRecord,
    tier: "free" | "premium",
  ) => {
    if (user.tier === tier) return;
    if (
      tier === "free" &&
      !(await requestAdminConfirmation({
        title: `Move ${user.displayName} to Free?`,
        description:
          "Premium limits and features will stop applying immediately.",
        confirmLabel: "Move to Free",
      }))
    )
      return;
    setUserActionPending(`${user.id}:tier`);
    setUsersError(null);
    try {
      const result = await fetchApi(
        `/api/admin/users/${encodeURIComponent(user.id)}/tier`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier }),
        },
      );
      if (!result.response.ok) {
        const message =
          result.payload &&
          typeof result.payload === "object" &&
          "error" in result.payload
            ? String(result.payload.error)
            : "The account tier could not be updated.";
        setUsersError(message);
        return;
      }
      await fetchUserDirectory();
      void fetchAuditTrail();
    } catch {
      setUsersError("Could not reach the server to update this account tier.");
    } finally {
      setUserActionPending(null);
    }
  };

  const updateDefaultUsageLimits = async (
    rawAILimit: string | number = usageLimitDraft,
    rawReportLimit: string | number = reportLimitDraft,
  ) => {
    const aiLimit = Number(rawAILimit);
    const reportLimit = Number(rawReportLimit);
    const maxAITokenLimit =
      usageSettings?.maxMonthlyAITokenLimit ?? 100_000_000;
    const maxReportLimit = usageSettings?.maxFreeMonthlyUsageLimit ?? 10_000;
    if (
      !Number.isFinite(aiLimit) ||
      aiLimit <= 0 ||
      aiLimit > maxAITokenLimit
    ) {
      setUsageSettingsError(
        `Enter an AI token limit between 1 and ${maxAITokenLimit.toLocaleString()}.`,
      );
      return;
    }
    if (
      !Number.isFinite(reportLimit) ||
      reportLimit <= 0 ||
      reportLimit > maxReportLimit
    ) {
      setUsageSettingsError(
        `Enter a generated report limit between 1 and ${maxReportLimit.toLocaleString()}.`,
      );
      return;
    }
    setUsageSettingsPending(true);
    setUsageSettingsError(null);
    try {
      const result = await fetchApi("/api/admin/usage-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          freeMonthlyAITokenLimit: Math.round(aiLimit),
          freeMonthlyReportUsageLimit: Math.round(reportLimit),
        }),
      });
      if (
        !result.response.ok ||
        !result.payload ||
        typeof result.payload !== "object"
      ) {
        const message =
          result.payload &&
          typeof result.payload === "object" &&
          "error" in result.payload
            ? String(result.payload.error)
            : "The default monthly limits could not be updated.";
        setUsageSettingsError(message);
        return;
      }
      const nextSettings = result.payload as AdminUsageSettings;
      setUsageSettings(nextSettings);
      setUsageLimitDraft(String(nextSettings.freeMonthlyAITokenLimit));
      setReportLimitDraft(String(nextSettings.freeMonthlyReportUsageLimit));
      await fetchUserDirectory();
      void fetchAuditTrail();
    } catch {
      setUsageSettingsError(
        "Could not reach the server to update usage limits.",
      );
    } finally {
      setUsageSettingsPending(false);
    }
  };

  const updateManagedUserUsageLimit = async (
    user: AdminUserRecord,
    limit: number | null,
  ) => {
    const maxLimit = usageSettings?.maxMonthlyAITokenLimit ?? 100_000_000;
    if (
      limit !== null &&
      (!Number.isFinite(limit) || limit <= 0 || limit > maxLimit)
    ) {
      setUsersError(
        `Enter a monthly AI token limit between 1 and ${maxLimit.toLocaleString()}.`,
      );
      return;
    }
    setUserActionPending(`${user.id}:usage-limit`);
    setUsersError(null);
    try {
      const result = await fetchApi(
        `/api/admin/users/${encodeURIComponent(user.id)}/usage-limit`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            limit: limit === null ? null : Math.round(limit),
          }),
        },
      );
      if (!result.response.ok) {
        const message =
          result.payload &&
          typeof result.payload === "object" &&
          "error" in result.payload
            ? String(result.payload.error)
            : "The account usage limit could not be updated.";
        setUsersError(message);
        return;
      }
      setUserUsageLimitDrafts((current) => {
        const next = { ...current };
        delete next[user.id];
        return next;
      });
      await fetchUserDirectory();
      void fetchAuditTrail();
    } catch {
      setUsersError(
        "Could not reach the server to update this account usage limit.",
      );
    } finally {
      setUserActionPending(null);
    }
  };

  const updateManagedUserReportUsageLimit = async (
    user: AdminUserRecord,
    limit: number | null,
  ) => {
    const maxLimit = usageSettings?.maxFreeMonthlyUsageLimit ?? 10_000;
    if (
      limit !== null &&
      (!Number.isFinite(limit) || limit <= 0 || limit > maxLimit)
    ) {
      setUsersError(
        `Enter a monthly generated report limit between 1 and ${maxLimit.toLocaleString()}.`,
      );
      return;
    }
    setUserActionPending(`${user.id}:report-usage-limit`);
    setUsersError(null);
    try {
      const result = await fetchApi(
        `/api/admin/users/${encodeURIComponent(user.id)}/report-usage-limit`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            limit: limit === null ? null : Math.round(limit),
          }),
        },
      );
      if (!result.response.ok) {
        const message =
          result.payload &&
          typeof result.payload === "object" &&
          "error" in result.payload
            ? String(result.payload.error)
            : "The account generated report limit could not be updated.";
        setUsersError(message);
        return;
      }
      setUserReportLimitDrafts((current) => {
        const next = { ...current };
        delete next[user.id];
        return next;
      });
      await fetchUserDirectory();
      void fetchAuditTrail();
    } catch {
      setUsersError(
        "Could not reach the server to update this account generated report limit.",
      );
    } finally {
      setUserActionPending(null);
    }
  };

  const resetManagedUserUsage = async (user: AdminUserRecord) => {
    if (
      !(await requestAdminConfirmation({
        title: `Reset ${user.displayName}'s monthly usage?`,
        description:
          "Their AI and report usage for the current month will return to zero. Saved reports will not be deleted.",
        confirmLabel: "Reset usage",
      }))
    )
      return;
    setUserActionPending(`${user.id}:usage-reset`);
    setUsersError(null);
    try {
      const result = await fetchApi(
        `/api/admin/users/${encodeURIComponent(user.id)}/reset-usage`,
        {
          method: "POST",
        },
      );
      if (!result.response.ok) {
        const message =
          result.payload &&
          typeof result.payload === "object" &&
          "error" in result.payload
            ? String(result.payload.error)
            : "The account usage meter could not be reset.";
        setUsersError(message);
        return;
      }
      await fetchUserDirectory();
      void fetchAuditTrail();
    } catch {
      setUsersError("Could not reach the server to reset this account usage.");
    } finally {
      setUserActionPending(null);
    }
  };

  const resetAllManagedUserUsage = async () => {
    if (
      !(await requestAdminConfirmation({
        title: "Reset usage for every account?",
        description:
          "Current-month AI and report usage will return to zero for every account. Saved reports will not be deleted.",
        confirmLabel: "Reset all usage",
      }))
    )
      return;
    setUserActionPending("all:usage-reset");
    setUsersError(null);
    try {
      const result = await fetchApi("/api/admin/users/reset-usage", {
        method: "POST",
      });
      if (!result.response.ok) {
        const message =
          result.payload &&
          typeof result.payload === "object" &&
          "error" in result.payload
            ? String(result.payload.error)
            : "Monthly usage could not be reset.";
        setUsersError(message);
        return;
      }
      await fetchUserDirectory();
      void fetchAuditTrail();
    } catch {
      setUsersError("Could not reach the server to reset monthly usage.");
    } finally {
      setUserActionPending(null);
    }
  };

  const resetAllManagedUserUsageLimits = async () => {
    if (
      !(await requestAdminConfirmation({
        title: "Restore default limits for every account?",
        description:
          "All custom AI and generated report limits will be removed. Current usage will not be reset.",
        confirmLabel: "Restore defaults",
      }))
    )
      return;
    setUserActionPending("all:usage-limit-reset");
    setUsersError(null);
    try {
      const result = await fetchApi("/api/admin/users/reset-usage-limits", {
        method: "POST",
      });
      if (!result.response.ok) {
        const message =
          result.payload &&
          typeof result.payload === "object" &&
          "error" in result.payload
            ? String(result.payload.error)
            : "Custom account limits could not be reset.";
        setUsersError(message);
        return;
      }
      setUserUsageLimitDrafts({});
      setUserReportLimitDrafts({});
      await fetchUserDirectory();
      void fetchAuditTrail();
    } catch {
      setUsersError(
        "Could not reach the server to reset custom account limits.",
      );
    } finally {
      setUserActionPending(null);
    }
  };

  const revokeManagedUserSessions = async (user: AdminUserRecord) => {
    if (user.isOwner || user.activeSessions === 0) return;
    if (
      !(await requestAdminConfirmation({
        title: `Sign ${user.displayName} out everywhere?`,
        description:
          "All of their active sessions will end immediately. They can sign in again afterward.",
        confirmLabel: "Sign out all sessions",
      }))
    )
      return;
    setUserActionPending(`${user.id}:sessions`);
    setUsersError(null);
    try {
      const result = await fetchApi(
        `/api/admin/users/${encodeURIComponent(user.id)}/revoke-sessions`,
        {
          method: "POST",
        },
      );
      if (!result.response.ok) {
        const message =
          result.payload &&
          typeof result.payload === "object" &&
          "error" in result.payload
            ? String(result.payload.error)
            : "The account could not be signed out.";
        setUsersError(message);
        return;
      }
      await fetchUserDirectory();
      void fetchAuditTrail();
    } catch {
      setUsersError("Could not reach the server to sign this account out.");
    } finally {
      setUserActionPending(null);
    }
  };

  const sendManagedUserVerification = async (user: AdminUserRecord) => {
    if (user.emailVerified || user.status !== "active" || !user.email) return;
    if (
      !(await requestAdminConfirmation({
        title: "Send a new verification link?",
        description: `A new link will be sent to ${user.email}. Any older verification link will stop working.`,
        confirmLabel: "Send link",
        tone: "caution",
      }))
    )
      return;
    setUserActionPending(`${user.id}:verification`);
    setUsersError(null);
    setUsersNotice(null);
    try {
      const result = await fetchApi(
        `/api/admin/users/${encodeURIComponent(user.id)}/send-verification`,
        {
          method: "POST",
        },
      );
      if (!result.response.ok) {
        const message =
          result.payload &&
          typeof result.payload === "object" &&
          "error" in result.payload
            ? String(result.payload.error)
            : "The verification email could not be sent.";
        setUsersError(message);
        return;
      }
      const message =
        result.payload &&
        typeof result.payload === "object" &&
        "message" in result.payload
          ? String(result.payload.message)
          : `Verification email sent to ${user.email}.`;
      setUsersNotice(message);
      await fetchUserDirectory();
      void fetchAuditTrail();
    } catch {
      setUsersError("Could not reach the server to send a verification email.");
    } finally {
      setUserActionPending(null);
    }
  };

  const updateRuntimeEnvironmentEntry = async (
    entry: RuntimeEnvironmentEntry,
    reset = false,
  ) => {
    const draft = runtimeEnvironmentDrafts[entry.key] ?? "";
    if (!reset && !draft.trim()) {
      setRuntimeEnvironmentError(
        `${entry.label} cannot be empty; reset the override to use the deployment value.`,
      );
      return;
    }
    setRuntimeEnvironmentPendingKey(entry.key);
    setRuntimeEnvironmentError(null);
    setRuntimeEnvironmentNotice(null);
    try {
      const result = await fetchApi("/api/admin/runtime-environment", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: { [entry.key]: reset ? null : draft } }),
      });
      if (result.response.ok && applyRuntimeEnvironment(result.payload)) {
        setRuntimeEnvironmentNotice(
          `${entry.key} ${reset ? "restored to its deployment value" : "saved"}. Restart the backend to apply it everywhere.`,
        );
        void fetchAuditTrail();
        return;
      }
      const message =
        result.payload &&
        typeof result.payload === "object" &&
        "error" in result.payload
          ? String(result.payload.error)
          : "The server could not update the runtime environment.";
      setRuntimeEnvironmentError(message);
    } catch {
      setRuntimeEnvironmentError(
        "Could not reach the server to update the runtime environment.",
      );
    } finally {
      setRuntimeEnvironmentPendingKey(null);
    }
  };

  const waitForBackendAfterRestart = async (
    previousUptime: number | undefined,
  ) => {
    await new Promise((resolve) => window.setTimeout(resolve, 1800));
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const healthResult = await fetchHealthSnapshot();
        const nextHealth =
          healthResult.payload as Partial<AdminHealthSnapshot> | null;
        const uptimeReset =
          previousUptime == null ||
          (typeof nextHealth?.uptime === "number" &&
            nextHealth.uptime + 2 < previousUptime) ||
          attempt >= 5;
        if (
          healthResult.response.ok &&
          uptimeReset &&
          applyHealthSnapshot(healthResult)
        ) {
          const statusResult = await fetchApi(
            "/api/admin/maintenance/backend-restart",
          );
          if (
            statusResult.response.ok &&
            statusResult.payload &&
            typeof statusResult.payload === "object"
          ) {
            setBackendRestartStatus(
              statusResult.payload as BackendRestartStatus,
            );
          }
          setRuntimeEnvironmentNotice(
            "Backend restart completed and the health check is responding.",
          );
          setBackendRestartPending(false);
          void fetchAuditTrail();
          return;
        }
      } catch {
        // A connection failure is expected while Docker replaces the process.
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
    setBackendRestartPending(false);
    setRuntimeEnvironmentError(
      "The restart was requested, but the backend did not become healthy within 30 seconds.",
    );
  };

  const restartBackend = async () => {
    if (!backendRestartStatus?.available || backendRestartPending) return;
    if (
      !window.confirm(
        "Restart the backend now? Requests may be unavailable briefly while Docker starts a fresh process. This does not recreate the container or reread the host .env file.",
      )
    )
      return;
    setBackendRestartPending(true);
    setRuntimeEnvironmentError(null);
    setRuntimeEnvironmentNotice(null);
    try {
      const result = await fetchApi("/api/admin/maintenance/backend-restart", {
        method: "POST",
      });
      if (
        result.response.ok &&
        result.payload &&
        typeof result.payload === "object"
      ) {
        setBackendRestartStatus(result.payload as BackendRestartStatus);
        setRuntimeEnvironmentNotice(
          "Backend restart requested. Waiting for the health check to return…",
        );
        void waitForBackendAfterRestart(health?.uptime);
        return;
      }
      const message =
        result.payload &&
        typeof result.payload === "object" &&
        "error" in result.payload
          ? String(result.payload.error)
          : "The backend restart could not be scheduled.";
      setRuntimeEnvironmentError(message);
    } catch {
      setRuntimeEnvironmentError(
        "Could not reach the backend to schedule a restart.",
      );
    }
    setBackendRestartPending(false);
  };

  const setObjectiveWatchSchedulerEnabled = async (enabled: boolean) => {
    if (objectiveWatchSchedulerPending) return;
    if (
      !enabled &&
      !window.confirm(
        "Stop automatic Objective Watch checks? The host heartbeat will continue so Admin can still report scheduler health.",
      )
    )
      return;
    setObjectiveWatchSchedulerPending(true);
    setObjectiveWatchSchedulerError(null);
    setObjectiveWatchSchedulerNotice(null);
    try {
      const result = await fetchApi("/api/admin/objective-watch-scheduler", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (result.response.ok && applyObjectiveWatchScheduler(result.payload)) {
        setObjectiveWatchSchedulerNotice(
          enabled
            ? "Automatic Objective Watch checks started. Health will become current after the next five-minute heartbeat."
            : "Automatic Objective Watch checks stopped.",
        );
        void fetchAuditTrail();
        return;
      }
      const message =
        result.payload &&
        typeof result.payload === "object" &&
        "error" in result.payload
          ? String(result.payload.error)
          : `Automatic Objective Watch checks could not be ${enabled ? "started" : "stopped"}.`;
      setObjectiveWatchSchedulerError(message);
    } catch {
      setObjectiveWatchSchedulerError(
        `Could not reach the backend to ${enabled ? "start" : "stop"} automatic checks.`,
      );
    } finally {
      setObjectiveWatchSchedulerPending(false);
    }
  };

  const saveObjectiveWatchCheckInterval = async () => {
    if (objectiveWatchSchedulerPending) return;
    const checkIntervalMinutes = Number(objectiveWatchCheckIntervalDraft);
    if (
      !Number.isInteger(checkIntervalMinutes) ||
      checkIntervalMinutes < 5 ||
      checkIntervalMinutes > 1440 ||
      checkIntervalMinutes % 5 !== 0
    ) {
      setObjectiveWatchSchedulerError(
        "Choose an interval from 5 minutes to 24 hours in 5-minute increments.",
      );
      return;
    }
    setObjectiveWatchSchedulerPending(true);
    setObjectiveWatchSchedulerError(null);
    setObjectiveWatchSchedulerNotice(null);
    try {
      const result = await fetchApi("/api/admin/objective-watch-scheduler", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkIntervalMinutes }),
      });
      if (result.response.ok && applyObjectiveWatchScheduler(result.payload)) {
        setObjectiveWatchSchedulerNotice(
          `Standard Objective Watch checks will run ${formatCheckIntervalChoice(checkIntervalMinutes).toLowerCase()}. Active watches were rescheduled to match.`,
        );
        void fetchAuditTrail();
        return;
      }
      const message =
        result.payload &&
        typeof result.payload === "object" &&
        "error" in result.payload
          ? String(result.payload.error)
          : "The Objective Watch check interval could not be updated.";
      setObjectiveWatchSchedulerError(message);
    } catch {
      setObjectiveWatchSchedulerError(
        "Could not reach the backend to update the check interval.",
      );
    } finally {
      setObjectiveWatchSchedulerPending(false);
    }
  };

  const runObjectiveWatchChecksNow = async () => {
    if (objectiveWatchSchedulerRunPending) return;
    setObjectiveWatchSchedulerRunPending(true);
    setObjectiveWatchSchedulerError(null);
    setObjectiveWatchSchedulerNotice(null);
    try {
      const result = await fetchApi(
        "/api/admin/objective-watch-scheduler/run",
        { method: "POST" },
      );
      const payload =
        result.payload &&
        typeof result.payload === "object" &&
        !Array.isArray(result.payload)
          ? (result.payload as Record<string, unknown>)
          : null;
      if (
        result.response.ok &&
        payload &&
        applyObjectiveWatchScheduler(payload)
      ) {
        const manualRun =
          payload.manualRun &&
          typeof payload.manualRun === "object" &&
          !Array.isArray(payload.manualRun)
            ? (payload.manualRun as {
                alreadyRunning?: boolean;
                summary?: ObjectiveWatchSchedulerStatus["lastSummary"];
              })
            : null;
        if (manualRun?.alreadyRunning) {
          setObjectiveWatchSchedulerNotice(
            "An Objective Watch check is already running.",
          );
        } else {
          const summary = manualRun?.summary;
          setObjectiveWatchSchedulerNotice(
            `Manual check completed: ${summary?.checked ?? 0} checked, ${summary?.changed ?? 0} changed, ${summary?.failed ?? 0} failed.`,
          );
        }
        void fetchAuditTrail();
        return;
      }
      const message =
        payload && "error" in payload
          ? String(payload.error)
          : "Objective Watch checks could not be run.";
      setObjectiveWatchSchedulerError(message);
    } catch {
      setObjectiveWatchSchedulerError(
        "Could not reach the backend to run Objective Watch checks.",
      );
    } finally {
      setObjectiveWatchSchedulerRunPending(false);
    }
  };

  const toggleProductFeature = async (feature: ProductFeatureKey) => {
    const current = featureFlagStatus?.flags[feature];
    if (typeof current !== "boolean") return;
    setFeatureFlagsPending(true);
    setFeatureFlagsError(null);
    try {
      const result = await fetchApi("/api/admin/feature-flags", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ flags: { [feature]: !current } }),
      });
      if (
        result.response.ok &&
        result.payload &&
        typeof result.payload === "object"
      ) {
        const nextStatus = result.payload as ProductFeatureFlagStatus;
        setFeatureFlagStatus(nextStatus);
        publishProductFeatureFlags(nextStatus.flags);
        void fetchAuditTrail();
        return;
      }
      const message =
        result.payload &&
        typeof result.payload === "object" &&
        "error" in result.payload
          ? String(result.payload.error)
          : "The server could not update product feature flags.";
      setFeatureFlagsError(message);
    } catch {
      setFeatureFlagsError(
        "Could not reach the server to update product feature flags.",
      );
    } finally {
      setFeatureFlagsPending(false);
    }
  };

  const runServiceDiagnostics = async () => {
    setDiagnosticsPending(true);
    setDiagnosticsError(null);
    const [healthResult, externalResult] = await Promise.allSettled([
      fetchHealthSnapshot(),
      fetchApi("/api/admin/diagnostics", {
        method: "POST",
      }),
    ]);

    if (healthResult.status === "fulfilled") {
      applyHealthSnapshot(healthResult.value);
    } else {
      setHealthError(
        "Could not reach the backend server to run its health check.",
      );
    }

    try {
      if (externalResult.status === "rejected") throw externalResult.reason;
      const result = externalResult.value;
      if (
        result.response.ok &&
        result.payload &&
        typeof result.payload === "object"
      ) {
        setDiagnostics(result.payload as ExternalDiagnosticsResult);
        void fetchAuditTrail();
        return;
      }
      const message =
        result.payload &&
        typeof result.payload === "object" &&
        "error" in result.payload
          ? String(result.payload.error)
          : "The server could not run provider diagnostics.";
      setDiagnosticsError(message);
    } catch {
      setDiagnosticsError(
        "Could not reach the server to run provider diagnostics.",
      );
    } finally {
      setDiagnosticsPending(false);
    }
  };

  useEffect(() => {
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      void fetchAdminData();
    }
    if (!autoRefresh) return undefined;
    const interval = window.setInterval(
      () => void fetchAdminData(true),
      30_000,
    );
    return () => window.clearInterval(interval);
  }, [autoRefresh, fetchAdminData]);

  const referenceTime = lastRefreshed?.getTime() ?? Date.now();

  const selectedRange = getAnalyticsRange(analyticsRange);

  const rangeLogs = useMemo(() => {
    const cutoff = referenceTime - selectedRange.durationMs;
    return logs.filter((entry) => {
      const timestamp = new Date(entry.timestamp).getTime();
      return (
        Number.isFinite(timestamp) &&
        timestamp >= cutoff &&
        timestamp <= referenceTime
      );
    });
  }, [logs, referenceTime, selectedRange.durationMs]);

  const rangeAIUsage = useMemo(() => {
    const cutoff = referenceTime - selectedRange.durationMs;
    return aiUsage.filter((entry) => {
      const timestamp = new Date(entry.timestamp).getTime();
      return (
        Number.isFinite(timestamp) &&
        timestamp >= cutoff &&
        timestamp <= referenceTime
      );
    });
  }, [aiUsage, referenceTime, selectedRange.durationMs]);

  const metrics = useMemo(() => {
    const healthy = rangeLogs.filter(isHealthyResponse).length;
    const issues = rangeLogs.length - healthy;
    const durations = rangeLogs
      .map((entry) => entry.durationMs)
      .filter(Number.isFinite);
    const networkCounts = new Map<string, number>();
    rangeLogs.forEach((entry) => {
      if (entry.ip)
        networkCounts.set(entry.ip, (networkCounts.get(entry.ip) ?? 0) + 1);
    });
    const networkedReports = [...networkCounts.values()].reduce(
      (sum, count) => sum + count,
      0,
    );
    const repeatNetworks = [...networkCounts.values()].filter(
      (count) => count > 1,
    ).length;
    const previousStart = referenceTime - selectedRange.durationMs * 2;
    const previousEnd = referenceTime - selectedRange.durationMs;
    const previousLogs =
      analyticsRange !== "7d"
        ? logs.filter((entry) => {
            const timestamp = new Date(entry.timestamp).getTime();
            return (
              Number.isFinite(timestamp) &&
              timestamp >= previousStart &&
              timestamp < previousEnd
            );
          })
        : [];
    const previousCount = previousLogs.length;
    const previousHealthy = previousLogs.filter(isHealthyResponse).length;
    const previousDurations = previousLogs
      .map((entry) => entry.durationMs)
      .filter(Number.isFinite);
    const healthyRate = rangeLogs.length
      ? Math.round((healthy / rangeLogs.length) * 1000) / 10
      : null;
    const previousHealthyRate = previousCount
      ? Math.round((previousHealthy / previousCount) * 1000) / 10
      : null;
    const p95Duration = durations.length ? percentile(durations, 0.95) : null;
    const previousP95Duration = previousDurations.length
      ? percentile(previousDurations, 0.95)
      : null;
    const volumeDelta =
      previousCount > 0
        ? Math.round(((rangeLogs.length - previousCount) / previousCount) * 100)
        : null;
    return {
      total: rangeLogs.length,
      healthyRate,
      healthyRateDelta:
        healthyRate != null && previousHealthyRate != null
          ? Math.round((healthyRate - previousHealthyRate) * 10) / 10
          : null,
      p95Duration,
      p95DurationDelta:
        p95Duration != null && previousP95Duration != null
          ? p95Duration - previousP95Duration
          : null,
      medianDuration: durations.length ? percentile(durations, 0.5) : null,
      uniqueVisitors: networkCounts.size,
      reportsPerNetwork: networkCounts.size
        ? networkedReports / networkCounts.size
        : null,
      repeatNetworkRate: networkCounts.size
        ? Math.round((repeatNetworks / networkCounts.size) * 100)
        : null,
      issues,
      volumeDelta,
    };
  }, [
    analyticsRange,
    logs,
    rangeLogs,
    referenceTime,
    selectedRange.durationMs,
  ]);

  const trendData = useMemo(
    () => buildTrendData(rangeLogs, analyticsRange, referenceTime),
    [analyticsRange, rangeLogs, referenceTime],
  );

  const hourlyDistribution = useMemo(
    () => buildHourlyDistribution(rangeLogs),
    [rangeLogs],
  );

  const topLocations = useMemo(() => buildTopLocations(rangeLogs), [rangeLogs]);

  const planningInsights = useMemo(
    () => buildPlanningInsights(rangeLogs),
    [rangeLogs],
  );

  const reliabilityHotspots = useMemo(
    () => buildReliabilityHotspots(rangeLogs),
    [rangeLogs],
  );

  const aiTrendData = useMemo(
    () => buildAITrendData(rangeAIUsage, analyticsRange, referenceTime),
    [analyticsRange, rangeAIUsage, referenceTime],
  );

  const aiModels = useMemo(() => buildAIModels(rangeAIUsage), [rangeAIUsage]);

  const aiFeatures = useMemo(
    () => buildAIFeatures(rangeAIUsage),
    [rangeAIUsage],
  );

  const aiMetrics = useMemo(() => {
    const successful = rangeAIUsage.filter(
      (entry) => entry.status === "success",
    ).length;
    return {
      calls: rangeAIUsage.length,
      inputTokens: rangeAIUsage.reduce(
        (sum, entry) =>
          sum + (Number.isFinite(entry.inputTokens) ? entry.inputTokens : 0),
        0,
      ),
      outputTokens: rangeAIUsage.reduce(
        (sum, entry) =>
          sum + (Number.isFinite(entry.outputTokens) ? entry.outputTokens : 0),
        0,
      ),
      successRate: rangeAIUsage.length
        ? Math.round((successful / rangeAIUsage.length) * 1000) / 10
        : null,
      failures: rangeAIUsage.length - successful,
      estimatedCostUsd: rangeAIUsage.reduce(
        (sum, entry) =>
          sum +
          (Number.isFinite(entry.estimatedCostUsd)
            ? Number(entry.estimatedCostUsd)
            : 0),
        0,
      ),
      pricedCalls: rangeAIUsage.filter((entry) =>
        Number.isFinite(entry.estimatedCostUsd),
      ).length,
    };
  }, [rangeAIUsage]);

  const slowReports = useMemo(
    () => rangeLogs.filter((entry) => entry.durationMs >= 10_000).length,
    [rangeLogs],
  );

  const cacheMetrics = useMemo(() => {
    const caches = health?.caches ?? [];
    const hits = caches.reduce(
      (sum, cache) => sum + cache.hits + cache.staleHits,
      0,
    );
    const misses = caches.reduce((sum, cache) => sum + cache.misses, 0);
    const requests = hits + misses;
    return {
      entries: caches.reduce((sum, cache) => sum + cache.size, 0),
      hitRate: requests ? Math.round((hits / requests) * 100) : null,
    };
  }, [health]);

  const infrastructureDiagnostics = useMemo<DiagnosticService[]>(() => {
    const backendMessage = health
      ? `${health.env} · v${health.version} · ${formatUptime(health.uptime)} uptime`
      : healthError || "No health response received";
    const databaseStatus = health?.database;
    const databaseDiagnostic: DiagnosticService = !health
      ? {
          id: "postgresql",
          name: "PostgreSQL database",
          category: "Infrastructure",
          status: "failed",
          httpStatus: null,
          latencyMs: null,
          message: healthError || "Waiting for backend health data",
        }
      : !databaseStatus || !databaseStatus.configured
        ? {
            id: "postgresql",
            name: "PostgreSQL database",
            category: "Infrastructure",
            status: "not_configured",
            httpStatus: null,
            latencyMs: databaseStatus?.latencyMs ?? null,
            message: databaseStatus
              ? "DATABASE_URL is not configured"
              : "Database health is not reported by this server",
          }
        : {
            id: "postgresql",
            name: "PostgreSQL database",
            category: "Infrastructure",
            status: databaseStatus.connected ? "operational" : "failed",
            httpStatus: null,
            latencyMs: databaseStatus.latencyMs ?? null,
            message: databaseStatus.connected
              ? "Live query succeeded"
              : "Live query failed",
          };

    return [
      {
        id: "backend-server",
        name: "Backend server",
        category: "Infrastructure",
        status: health ? "operational" : "failed",
        httpStatus: healthHttpStatus,
        latencyMs: backendLatencyMs,
        message: backendMessage,
      },
      databaseDiagnostic,
    ];
  }, [backendLatencyMs, health, healthError, healthHttpStatus]);

  const diagnosticServices = useMemo(
    () => [...infrastructureDiagnostics, ...(diagnostics?.services ?? [])],
    [diagnostics, infrastructureDiagnostics],
  );

  const diagnosticSummary = useMemo(
    () => ({
      total: diagnosticServices.length,
      operational: diagnosticServices.filter(
        (service) => service.status === "operational",
      ).length,
      failed: diagnosticServices.filter(
        (service) => service.status === "failed",
      ).length,
      notConfigured: diagnosticServices.filter(
        (service) => service.status === "not_configured",
      ).length,
    }),
    [diagnosticServices],
  );

  const busiestHour = useMemo(
    () =>
      hourlyDistribution.reduce(
        (busiest, current) =>
          current.requests > busiest.requests ? current : busiest,
        hourlyDistribution[0],
      ),
    [hourlyDistribution],
  );

  const objectiveWatchSchedulerNeedsAttention = objectiveWatchScheduler
    ? ["not_configured", "unhealthy", "failed"].includes(
        objectiveWatchScheduler.health,
      )
    : false;

  const resourceWarningDetails = [
    systemResources && systemResources.memory.usagePercent >= 85
      ? `RAM ${systemResources.memory.usagePercent}% used`
      : null,
    systemResources?.disk && systemResources.disk.usagePercent >= 85
      ? `Disk ${systemResources.disk.usagePercent}% used`
      : null,
  ].filter((value): value is string => Boolean(value));

  const allAttentionSignals: AdminAttentionSignal[] = [
    {
      key: "reports",
      label: "Report issues",
      detail: "Failed or partial responses",
      count: metrics.issues,
      section: "analytics",
      icon: AlertTriangle,
      tone: "warning",
    },
    {
      key: "slow",
      label: "Slow reports",
      detail: "Responses taking 10 seconds or longer",
      count: slowReports,
      section: "analytics",
      icon: Clock3,
      tone: "warning",
    },
    {
      key: "ai",
      label: "AI failures",
      detail: "Unsuccessful model calls",
      count: aiMetrics.failures,
      section: "analytics",
      icon: Bot,
      tone: "warning",
    },
    {
      key: "diagnostics",
      label: "Service failures",
      detail: "Infrastructure or provider diagnostics failed",
      count: diagnosticSummary.failed,
      section: "operations",
      icon: Server,
      tone: "critical",
    },
    {
      key: "scheduler",
      label: "Objective Watch scheduler",
      detail:
        objectiveWatchScheduler?.message || "Scheduler health is unavailable",
      count: objectiveWatchSchedulerNeedsAttention ? 1 : 0,
      section: "operations",
      icon: BellRing,
      tone:
        objectiveWatchScheduler?.health === "failed" ||
        objectiveWatchScheduler?.health === "unhealthy"
          ? "critical"
          : "warning",
    },
    {
      key: "resources",
      label: "Resource pressure",
      detail:
        resourceWarningDetails.join(" · ") ||
        "RAM and disk usage are below warning levels",
      count: resourceWarningDetails.length,
      section: "operations",
      icon: Gauge,
      tone: "critical",
    },
    {
      key: "suspended",
      label: "Suspended accounts",
      detail: "Users without platform access",
      count: userSummary.suspended,
      section: "users",
      icon: Ban,
      tone: "warning",
    },
  ];

  const attentionSignals = allAttentionSignals.filter(
    (signal) => signal.count > 0,
  );

  const dashboardAttentionCount = attentionSignals.length;

  const operationsAttentionCount = attentionSignals.filter(
    (signal) => signal.section === "operations",
  ).length;

  const sectionCounts: Record<AdminSection, number> = {
    overview: dashboardAttentionCount,
    users: usersTotal,
    operations: operationsAttentionCount,
    analytics: rangeLogs.length,
    activity: auditEntries.length,
  };

  const filteredAndSorted = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const result = rangeLogs.filter((entry) => {
      if (!matchesStatus(entry, statusFilter)) return false;
      if (!normalizedQuery) return true;
      return [
        entry.name,
        entry.lat,
        entry.lon,
        entry.date,
        entry.startTime,
        entry.statusCode,
        entry.safetyScore,
        entry.durationMs,
        entry.ip,
        entry.userAgent,
      ].some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(normalizedQuery),
      );
    });
    return [...result].sort((a, b) => {
      const left = getLogSortValue(a, sortKey);
      const right = getLogSortValue(b, sortKey);
      const comparison = left < right ? -1 : left > right ? 1 : 0;
      return sortAsc ? comparison : -comparison;
    });
  }, [query, rangeLogs, statusFilter, sortKey, sortAsc]);

  const visibleLogs = useMemo(
    () => filteredAndSorted.slice(0, visibleLogCount),
    [filteredAndSorted, visibleLogCount],
  );

  useEffect(() => {
    setVisibleLogCount(LOG_PAGE_SIZE);
  }, [analyticsRange, query, sortAsc, sortKey, statusFilter]);

  const filteredAuditEntries = useMemo(() => {
    const normalizedQuery = auditQuery.trim().toLowerCase();
    return auditEntries.filter((entry) => {
      if (auditFilter === "errors" && entry.status !== "error") return false;
      if (
        auditFilter !== "all" &&
        auditFilter !== "errors" &&
        entry.category !== auditFilter
      )
        return false;
      if (!normalizedQuery) return true;
      return [
        entry.summary,
        entry.action,
        entry.category,
        entry.status,
        entry.actorNetwork,
      ].some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(normalizedQuery),
      );
    });
  }, [auditEntries, auditFilter, auditQuery]);

  const filteredUsers = useMemo(() => {
    const normalizedQuery = userQuery.trim().toLowerCase();
    return users.filter((user) => {
      if (userStatusFilter === "verified" && !user.emailVerified) return false;
      if (userStatusFilter === "unverified" && user.emailVerified) return false;
      if (
        userStatusFilter !== "all" &&
        userStatusFilter !== "verified" &&
        userStatusFilter !== "unverified" &&
        user.status !== userStatusFilter &&
        user.tier !== userStatusFilter
      )
        return false;
      if (!normalizedQuery) return true;
      return [
        user.displayName,
        user.email,
        user.authProvider,
        ...user.authMethods,
        user.status,
        user.tier,
        user.emailVerified ? "verified" : "unverified",
      ].some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(normalizedQuery),
      );
    });
  }, [userQuery, users, userStatusFilter]);

  const runtimeEnvironmentGroups = useMemo(() => {
    const groups = new Map<string, RuntimeEnvironmentEntry[]>();
    (runtimeEnvironment?.entries ?? []).forEach((entry) => {
      groups.set(entry.category, [
        ...(groups.get(entry.category) ?? []),
        entry,
      ]);
    });
    return [...groups.entries()];
  }, [runtimeEnvironment]);

  const runtimeOverrideCount =
    runtimeEnvironment?.entries.filter((entry) => entry.overridden).length ?? 0;

  const enabledFeatureCount = featureFlagStatus
    ? Object.values(featureFlagStatus.flags).filter(Boolean).length
    : 0;

  const operationsPanelStatus = (
    panel: AdminOperationsPanel,
  ): { label: string; tone: "clear" | "attention" | "neutral" } => {
    if (panel === "health") {
      return diagnosticSummary.failed > 0
        ? { label: `${diagnosticSummary.failed} failed`, tone: "attention" }
        : {
            label: `${diagnosticSummary.operational}/${diagnosticSummary.total} ready`,
            tone: "clear",
          };
    }
    if (panel === "monitoring") {
      if (!objectiveWatchScheduler)
        return { label: "Unavailable", tone: "neutral" };
      return {
        label: schedulerHealthLabel(objectiveWatchScheduler.health),
        tone: objectiveWatchSchedulerNeedsAttention
          ? "attention"
          : objectiveWatchScheduler.health === "healthy" ||
              objectiveWatchScheduler.health === "running"
            ? "clear"
            : "neutral",
      };
    }
    if (panel === "ai") {
      if (!aiSettings) return { label: "Unavailable", tone: "neutral" };
      return aiSettings.enabled
        ? { label: aiProviderLabel(aiSettings.provider), tone: "clear" }
        : { label: "Stopped", tone: "neutral" };
    }
    if (panel === "environment") {
      return {
        label: runtimeOverrideCount
          ? `${runtimeOverrideCount} overridden`
          : "Defaults",
        tone: "neutral",
      };
    }
    return {
      label: featureFlagStatus
        ? `${enabledFeatureCount}/${Object.keys(featureFlagStatus.flags).length} enabled`
        : "Unavailable",
      tone: "neutral",
    };
  };

  const downloadOperationsSnapshot = () => {
    triggerJsonDownload(
      `admin-snapshot-${new Date().toISOString().replaceAll(":", "-").slice(0, 19)}.json`,
      {
        generatedAt: new Date().toISOString(),
        range: { value: analyticsRange, label: selectedRange.label },
        system: health,
        systemResources,
        automatedHealthChecks: healthHistory,
        objectiveWatchScheduler,
        reportMetrics: metrics,
        planningInsights,
        reliabilityHotspots,
        aiMetrics,
        aiStatus: aiSettings,
        productFeatures: featureFlagStatus,
        runtimeEnvironment,
        accounts: { total: usersTotal, ...userSummary },
        externalDiagnostics: diagnostics,
        recentAdminActivity: auditEntries.slice(0, 50),
      },
    );
  };

  const handleSort = (key: LogSortKey) => {
    if (key === sortKey) setSortAsc((current) => !current);
    else {
      setSortKey(key);
      setSortAsc(key === "name" || key === "date" || key === "ip");
    }
  };

  const showRequestFilter = (filter: StatusFilter) => {
    setStatusFilter(filter);
    setActiveSection("analytics");
    window.setTimeout(
      () =>
        requestActivityRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      0,
    );
  };

  const showAIUsage = () => {
    setActiveSection("analytics");
    window.setTimeout(
      () =>
        aiUsageRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      0,
    );
  };

  const selectAdminSection = (section: AdminSection) => {
    setActiveSection(section);
    window.setTimeout(
      () =>
        dashboardContentRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      0,
    );
  };

  const selectOperationsPanel = (panel: AdminOperationsPanel) => {
    setActiveOperationsPanel(panel);
    setActiveSection("operations");
    window.setTimeout(
      () =>
        dashboardContentRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      0,
    );
  };

  const reviewAttentionSignal = (key: AdminAttentionKey) => {
    if (key === "reports") return showRequestFilter("issues");
    if (key === "slow") return showRequestFilter("slow");
    if (key === "ai") return showAIUsage();
    if (key === "suspended") return selectAdminSection("users");
    if (key === "scheduler") return selectOperationsPanel("monitoring");
    return selectOperationsPanel("health");
  };

  const runDiagnosticsFromOverview = () => {
    selectOperationsPanel("health");
    void runServiceDiagnostics();
  };

  const sectionCountTitle = (section: AdminSection, count: number) =>
    ({
      overview: `${count} active signal ${count === 1 ? "category" : "categories"}`,
      users: `${count} ${count === 1 ? "account" : "accounts"}`,
      operations: `${count} operational ${count === 1 ? "signal" : "signals"}`,
      analytics: `${count} ${count === 1 ? "report" : "reports"} in range`,
      activity: `${count} audit ${count === 1 ? "event" : "events"}`,
    })[section];
  return {
    logs,
    setLogs,
    aiUsage,
    setAIUsage,
    aiSettings,
    setAISettings,
    aiModelCatalog,
    setAIModelCatalog,
    featureFlagStatus,
    setFeatureFlagStatus,
    health,
    setHealth,
    systemResources,
    setSystemResources,
    healthHistory,
    setHealthHistory,
    healthHttpStatus,
    setHealthHttpStatus,
    backendLatencyMs,
    setBackendLatencyMs,
    auditEntries,
    setAuditEntries,
    users,
    setUsers,
    usersTotal,
    setUsersTotal,
    userSummary,
    setUserSummary,
    usageSettings,
    setUsageSettings,
    runtimeEnvironment,
    setRuntimeEnvironment,
    backendRestartStatus,
    setBackendRestartStatus,
    objectiveWatchScheduler,
    setObjectiveWatchScheduler,
    objectiveWatchCheckIntervalDraft,
    setObjectiveWatchCheckIntervalDraft,
    runtimeEnvironmentDrafts,
    setRuntimeEnvironmentDrafts,
    usageLimitDraft,
    setUsageLimitDraft,
    reportLimitDraft,
    setReportLimitDraft,
    userUsageLimitDrafts,
    setUserUsageLimitDrafts,
    userReportLimitDrafts,
    setUserReportLimitDrafts,
    loading,
    setLoading,
    refreshing,
    setRefreshing,
    error,
    setError,
    aiUsageError,
    setAIUsageError,
    aiSettingsError,
    setAISettingsError,
    aiSettingsPending,
    setAISettingsPending,
    aiModelCatalogPending,
    setAIModelCatalogPending,
    aiModelCatalogError,
    setAIModelCatalogError,
    modelDrafts,
    setModelDrafts,
    featureFlagsError,
    setFeatureFlagsError,
    featureFlagsPending,
    setFeatureFlagsPending,
    healthError,
    setHealthError,
    systemResourcesError,
    setSystemResourcesError,
    healthHistoryError,
    setHealthHistoryError,
    auditError,
    setAuditError,
    usersError,
    setUsersError,
    usersNotice,
    setUsersNotice,
    usageSettingsError,
    setUsageSettingsError,
    usageSettingsPending,
    setUsageSettingsPending,
    runtimeEnvironmentError,
    setRuntimeEnvironmentError,
    runtimeEnvironmentNotice,
    setRuntimeEnvironmentNotice,
    runtimeEnvironmentPendingKey,
    setRuntimeEnvironmentPendingKey,
    backendRestartPending,
    setBackendRestartPending,
    objectiveWatchSchedulerError,
    setObjectiveWatchSchedulerError,
    objectiveWatchSchedulerNotice,
    setObjectiveWatchSchedulerNotice,
    objectiveWatchSchedulerPending,
    setObjectiveWatchSchedulerPending,
    objectiveWatchSchedulerRunPending,
    setObjectiveWatchSchedulerRunPending,
    userActionPending,
    setUserActionPending,
    diagnostics,
    setDiagnostics,
    diagnosticsPending,
    setDiagnosticsPending,
    diagnosticsError,
    setDiagnosticsError,
    lastRefreshed,
    setLastRefreshed,
    confirmation,
    setConfirmation,
    sortKey,
    setSortKey,
    sortAsc,
    setSortAsc,
    query,
    setQuery,
    statusFilter,
    setStatusFilter,
    auditFilter,
    setAuditFilter,
    auditQuery,
    setAuditQuery,
    userQuery,
    setUserQuery,
    userStatusFilter,
    setUserStatusFilter,
    activeSection,
    setActiveSection,
    activeOperationsPanel,
    setActiveOperationsPanel,
    analyticsRange,
    setAnalyticsRange,
    autoRefresh,
    setAutoRefresh,
    visibleLogCount,
    setVisibleLogCount,
    hasLoadedRef,
    dashboardContentRef,
    requestActivityRef,
    aiUsageRef,
    confirmationResolverRef,
    requestAdminConfirmation,
    resolveAdminConfirmation,
    fetchHealthSnapshot,
    applyHealthSnapshot,
    applyUserDirectory,
    applyRuntimeEnvironment,
    applyObjectiveWatchScheduler,
    fetchAuditTrail,
    fetchUserDirectory,
    fetchAdminData,
    refreshModelCatalog,
    updateAIControl,
    toggleAIEnabled,
    toggleAIFailover,
    toggleAIFeature,
    saveProviderModels,
    updateManagedUserStatus,
    updateManagedUserTier,
    updateDefaultUsageLimits,
    updateManagedUserUsageLimit,
    updateManagedUserReportUsageLimit,
    resetManagedUserUsage,
    resetAllManagedUserUsage,
    resetAllManagedUserUsageLimits,
    revokeManagedUserSessions,
    sendManagedUserVerification,
    updateRuntimeEnvironmentEntry,
    waitForBackendAfterRestart,
    restartBackend,
    setObjectiveWatchSchedulerEnabled,
    saveObjectiveWatchCheckInterval,
    runObjectiveWatchChecksNow,
    toggleProductFeature,
    runServiceDiagnostics,
    referenceTime,
    selectedRange,
    rangeLogs,
    rangeAIUsage,
    metrics,
    trendData,
    hourlyDistribution,
    topLocations,
    planningInsights,
    reliabilityHotspots,
    aiTrendData,
    aiModels,
    aiFeatures,
    aiMetrics,
    slowReports,
    cacheMetrics,
    infrastructureDiagnostics,
    diagnosticServices,
    diagnosticSummary,
    busiestHour,
    objectiveWatchSchedulerNeedsAttention,
    resourceWarningDetails,
    allAttentionSignals,
    attentionSignals,
    dashboardAttentionCount,
    operationsAttentionCount,
    sectionCounts,
    filteredAndSorted,
    visibleLogs,
    filteredAuditEntries,
    filteredUsers,
    runtimeEnvironmentGroups,
    runtimeOverrideCount,
    enabledFeatureCount,
    operationsPanelStatus,
    downloadOperationsSnapshot,
    handleSort,
    showRequestFilter,
    showAIUsage,
    selectAdminSection,
    selectOperationsPanel,
    reviewAttentionSignal,
    runDiagnosticsFromOverview,
    sectionCountTitle,
    AI_PROVIDERS,
    aiProviderLabel,
    AI_FEATURE_CONTROLS,
    PRODUCT_FEATURE_CONTROLS,
    ADMIN_SECTIONS,
    ADMIN_OPERATIONS_PANELS,
    ADMIN_SECTION_STORAGE_KEY,
    ADMIN_RANGE_STORAGE_KEY,
    ADMIN_OPERATIONS_PANEL_STORAGE_KEY,
    readStoredAdminSection,
    readStoredAnalyticsRange,
    readStoredOperationsPanel,
    ANALYTICS_RANGES,
    CHART_TOOLTIP_STYLE,
    STATUS_FILTERS,
    LOG_PAGE_SIZE,
    AUDIT_FILTERS,
    USER_STATUS_FILTERS,
    getAnalyticsRange,
    getLogSortValue,
    matchesStatus,
    formatDuration,
    formatBytes,
    formatLogTime,
    formatSchedulerTimestamp,
    schedulerHealthLabel,
    formatCheckInterval,
    OBJECTIVE_WATCH_INTERVAL_OPTIONS,
    formatCheckIntervalChoice,
    formatAccountDate,
    formatHealthMonitorAction,
    accountInitials,
    percentile,
    isHealthyResponse,
    buildTrendData,
    buildHourlyDistribution,
    buildTopLocations,
    DAY_MS,
    parseDateOnlyUtc,
    withDistributionShares,
    buildPlanningInsights,
    buildReliabilityHotspots,
    buildAITrendData,
    buildAIModels,
    buildAIFeatures,
    formatUptime,
    formatTokenCount,
    formatEstimatedCost,
    escapeCsv,
    triggerCsvDownload,
    triggerJsonDownload,
    downloadReportCsv,
    downloadAIUsageCsv,
  };
}
export type Administration = ReturnType<typeof useAdministration>;
