import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Activity,
  AlertTriangle,
  Ban,
  BarChart3,
  BellRing,
  Bot,
  CalendarRange,
  CheckCircle2,
  CircleUserRound,
  Clock3,
  Cpu,
  Crown,
  Database,
  DollarSign,
  Download,
  ExternalLink,
  FileJson,
  FileUp,
  Gauge,
  Grid3X3,
  HardDrive,
  History,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  Layers,
  LogOut,
  MailCheck,
  MessageCircleQuestion,
  MemoryStick,
  Pause,
  Play,
  Power,
  MapPinned,
  RefreshCw,
  Route,
  Satellite,
  Search,
  Send,
  Server,
  Share2,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchApi } from '../../lib/api-client';
import type { AppView } from '../../hooks/useUrlState';
import { publishAiAvailability } from '../../hooks/useAiAvailability';
import {
  publishProductFeatureFlags,
  type ProductFeatureFlags,
  type ProductFeatureKey,
} from '../../contexts/feature-flags';
import { ProductNav } from './ProductNav';

interface ReportLogEntry {
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

interface AIUsageEntry {
  timestamp: string;
  provider: string;
  model: string;
  feature: string;
  status: 'success' | 'error';
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  pricingMatched: boolean;
  pricingVersion: string;
}

interface AdminHealthSnapshot {
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

interface AdminSystemResources {
  memory: ResourceUsageSnapshot;
  disk: ResourceUsageSnapshot | null;
  timestamp: string;
}

interface AdminHealthHistoryEntry {
  checkedAt: string;
  healthy: boolean;
  summary: string;
  statusCode: number | null;
  durationMs: number | null;
  action: string;
  alertError: string | null;
}

interface AdminHealthHistoryPayload {
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

interface ResourceUsageSnapshot {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  availableBytes: number;
  usagePercent: number;
}

interface AdminAuditEntry {
  timestamp: string;
  action: string;
  category: 'configuration' | 'maintenance' | 'diagnostics' | string;
  status: 'success' | 'error';
  summary: string;
  actorNetwork: string | null;
  details: Record<string, unknown> | null;
}

interface AdminUserRecord {
  id: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  authProvider: string;
  authMethods: string[];
  tier: 'free' | 'premium' | string;
  status: 'active' | 'suspended' | string;
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

interface AdminUserDirectory {
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

interface AdminUsageSettings {
  persistent: boolean;
  freeMonthlyAITokenLimit: number;
  environmentFreeMonthlyAITokenLimit: number;
  freeMonthlyReportUsageLimit: number;
  environmentFreeMonthlyReportUsageLimit: number;
  maxMonthlyAITokenLimit: number;
  maxFreeMonthlyUsageLimit: number;
}

interface RuntimeEnvironmentEntry {
  key: string;
  label: string;
  category: string;
  description: string;
  type: 'integer' | 'boolean' | 'enum' | 'url' | 'text' | 'secret';
  options: string[] | null;
  min: number | null;
  max: number | null;
  secret: boolean;
  configured: boolean;
  value: string | null;
  source: 'admin override' | 'deployment environment' | 'not configured';
  overridden: boolean;
  restartRequired: boolean;
}

interface RuntimeEnvironmentStatus {
  persistent: boolean;
  restartRequired: boolean;
  entries: RuntimeEnvironmentEntry[];
}

interface BackendRestartStatus {
  available: boolean;
  scheduled: boolean;
  scheduledAt: string | null;
  restartDelayMs: number;
  reason: string | null;
}

interface ExternalDiagnosticsResult {
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
    status: 'operational' | 'failed' | 'not_configured';
    httpStatus: number | null;
    latencyMs: number | null;
    message: string;
  }>;
}

type DiagnosticService = ExternalDiagnosticsResult['services'][number];

type AIProvider = 'openai' | 'anthropic';

interface AIAdminSettings {
  enabled: boolean;
  available: boolean;
  persistent: boolean;
  provider: AIProvider;
  defaultProvider: AIProvider;
  primaryModel: string;
  fastModel: string;
  configured: boolean;
  fallbackProvider: AIProvider;
  fallbackConfigured: boolean;
  providers: Record<AIProvider, {
    primary: string;
    fast: string;
    options: string[];
    configured: boolean;
  }>;
  features: Record<AIFeatureKey, {
    enabled: boolean;
    available: boolean;
  }>;
}

interface AIModelCatalog {
  fetchedAt: string;
  providers: Record<AIProvider, {
    models: string[];
    source: 'provider' | 'configured';
    error: string | null;
  }>;
}

type AIFeatureKey = 'aiBrief' | 'reportChat' | 'routeAnalysis' | 'snowVision';

const AI_FEATURE_CONTROLS = [
  {
    key: 'aiBrief',
    label: 'Field briefing',
    description: 'Shows the generated AI analysis in the report summary.',
    icon: Sparkles,
  },
  {
    key: 'reportChat',
    label: 'Report chat',
    description: 'Lets users ask follow-up questions about a generated report.',
    icon: MessageCircleQuestion,
  },
  {
    key: 'routeAnalysis',
    label: 'AI route assistance',
    description: 'Adds AI route suggestions, waypoint generation, and narrative synthesis to the base route-analysis feature.',
    icon: Route,
  },
  {
    key: 'snowVision',
    label: 'Satellite snow vision',
    description: 'Enables AI analysis of satellite imagery and nearby snow measurements.',
    icon: Satellite,
  },
] as const;

interface ProductFeatureFlagStatus {
  persistent: boolean;
  flags: ProductFeatureFlags;
}

const PRODUCT_FEATURE_CONTROLS = [
  {
    key: 'routeAnalysis',
    label: 'Route analysis',
    description: 'Shows route checkpoint analysis, mapped-route matching, and GPX route tools.',
    icon: Route,
  },
  {
    key: 'tripPlanning',
    label: 'Multi-day trip planning',
    description: 'Shows the Trip tool and its multi-day forecast entry points.',
    icon: CalendarRange,
  },
  {
    key: 'satelliteImagery',
    label: 'Satellite imagery',
    description: 'Enables the satellite basemap, imagery tiles, and satellite snow analysis.',
    icon: Layers,
  },
  {
    key: 'startTimeComparisons',
    label: 'Start-time comparisons',
    description: 'Runs and displays earlier and later departure scenarios in planner reports.',
    icon: Clock3,
  },
  {
    key: 'terrainWindow',
    label: 'Terrain Window',
    description: 'Shows relative planning conditions across time, elevation, and aspect.',
    icon: Grid3X3,
  },
  {
    key: 'objectiveWatch',
    label: 'Objective Watch',
    description: 'Lets signed-in users save a baseline and compare later reports for the same objective.',
    icon: BellRing,
  },
  {
    key: 'gpxImport',
    label: 'GPX import',
    description: 'Lets users upload GPX tracks and analyze supplied route checkpoints.',
    icon: FileUp,
  },
  {
    key: 'reportHistory',
    label: 'Report history',
    description: 'Shows signed-in users their previously generated report snapshots.',
    icon: History,
  },
  {
    key: 'reportSharing',
    label: 'Report sharing',
    description: 'Shows share-link controls and allows public read-only report links to open.',
    icon: Share2,
  },
  {
    key: 'hourlyWeatherCharts',
    label: 'Hourly weather charts',
    description: 'Shows interactive hourly trend charts in Planner and multi-day trip reports.',
    icon: BarChart3,
  },
  {
    key: 'elevationForecast',
    label: 'Elevation forecasts',
    description: 'Shows modeled weather differences across forecast elevation bands.',
    icon: MapPinned,
  },
  {
    key: 'heatRiskDetails',
    label: 'Heat risk',
    description: 'Controls heat-risk scoring and the detailed heat assessment and terrain guidance module.',
    icon: Gauge,
  },
  {
    key: 'fireRiskDetails',
    label: 'Fire risk',
    description: 'Controls fire-risk scoring and the detailed fire-weather, wildfire, and smoke guidance module.',
    icon: AlertTriangle,
  },
  {
    key: 'snowpackDetails',
    label: 'Snowpack',
    description: 'Controls snowpack scoring and the observed depth, water equivalent, and historical context module.',
    icon: Layers,
  },
  {
    key: 'fieldObservations',
    label: 'Field observations',
    description: 'Controls scoring from nearby stations, radar, and streamflow plus their observation details.',
    icon: Activity,
  },
  {
    key: 'airQualityDetails',
    label: 'Air quality',
    description: 'Controls air-quality scoring and the AQI, pollutant, and observation or model context module.',
    icon: Gauge,
  },
  {
    key: 'gearRecommendations',
    label: 'Gear recommendations',
    description: 'Shows the conditions-matched packing and equipment guidance module.',
    icon: ShieldCheck,
  },
  {
    key: 'windLoadingDetails',
    label: 'Wind loading',
    description: 'Controls avalanche wind-loading compound scoring and its transport, aspect, and terrain evidence.',
    icon: Route,
  },
  {
    key: 'daylightTimeline',
    label: 'Daylight',
    description: 'Controls darkness scoring and planned start and return timing against sunrise and sunset.',
    icon: Clock3,
  },
  {
    key: 'scoreBreakdown',
    label: 'Score breakdown',
    description: 'Shows factor impacts, confidence, and grouped deductions behind the planning score.',
    icon: Gauge,
  },
  {
    key: 'weatherContextDetails',
    label: 'Weather context',
    description: 'Controls visibility-context scoring and the supporting readings and pressure-trend module.',
    icon: Activity,
  },
  {
    key: 'avalancheDetails',
    label: 'Avalanche',
    description: 'Controls avalanche scoring and the dedicated forecast, problem-terrain, and official-center detail module.',
    icon: AlertTriangle,
  },
] as const satisfies ReadonlyArray<{
  key: ProductFeatureKey;
  label: string;
  description: string;
  icon: typeof Clock3;
}>;

interface AdminViewProps {
  navigateToView: (view: AppView) => void;
  openPlannerView: () => void;
  openTripToolView: () => void;
}

export function AdminView({ navigateToView, openPlannerView, openTripToolView }: AdminViewProps) {
  return (
    <>
      <ProductNav
        active="admin"
        navigateToView={navigateToView}
        openPlannerView={openPlannerView}
        openTripToolView={openTripToolView}
      />
      <main className="logs-page">
        <header className="logs-page-head">
          <div>
            <div className="logs-kicker"><ShieldCheck size={14} aria-hidden /> Administration</div>
            <h1>Admin dashboard</h1>
            <p>Run the platform, support users, and spot issues from one protected workspace.</p>
          </div>
        </header>
        <AdminDashboard />
      </main>
    </>
  );
}

type LogSortKey = 'timestamp' | 'name' | 'date' | 'statusCode' | 'safetyScore' | 'durationMs' | 'ip';
type StatusFilter = 'all' | 'healthy' | 'issues' | 'errors' | 'partial' | 'slow';
type AnalyticsRange = '6h' | '24h' | '7d';
type AuditFilter = 'all' | 'accounts' | 'configuration' | 'maintenance' | 'diagnostics' | 'errors';
type UserStatusFilter = 'all' | 'active' | 'suspended' | 'free' | 'premium' | 'verified' | 'unverified';
type AdminSection = 'overview' | 'users' | 'operations' | 'analytics' | 'activity';

const ADMIN_SECTIONS = [
  { value: 'overview', label: 'Overview', description: 'Platform status', icon: LayoutDashboard },
  { value: 'users', label: 'Users', description: 'Accounts and access', icon: Users },
  { value: 'operations', label: 'Operations', description: 'Services and controls', icon: Server },
  { value: 'analytics', label: 'Analytics', description: 'Reports and AI usage', icon: BarChart3 },
  { value: 'activity', label: 'Activity', description: 'Admin audit trail', icon: History },
] as const satisfies ReadonlyArray<{
  value: AdminSection;
  label: string;
  description: string;
  icon: typeof LayoutDashboard;
}>;

const ANALYTICS_RANGES: Array<{
  value: AnalyticsRange;
  label: string;
  durationMs: number;
  bucketDurationMs: number;
  bucketLabel: string;
}> = [
  { value: '6h', label: 'Last 6 hours', durationMs: 6 * 60 * 60 * 1000, bucketDurationMs: 30 * 60 * 1000, bucketLabel: '30-minute' },
  { value: '24h', label: 'Last 24 hours', durationMs: 24 * 60 * 60 * 1000, bucketDurationMs: 2 * 60 * 60 * 1000, bucketLabel: '2-hour' },
  { value: '7d', label: 'Last 7 days', durationMs: 7 * 24 * 60 * 60 * 1000, bucketDurationMs: 12 * 60 * 60 * 1000, bucketLabel: '12-hour' },
];

const CHART_TOOLTIP_STYLE: React.CSSProperties = {
  border: '1px solid var(--ui-line-strong)',
  borderRadius: 8,
  background: 'var(--ui-surface)',
  boxShadow: 'var(--ui-shadow-md)',
  color: 'var(--ui-text)',
  fontSize: 12,
};

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'healthy', label: 'Healthy' },
  { value: 'issues', label: 'Needs attention' },
  { value: 'errors', label: 'Errors' },
  { value: 'partial', label: 'Partial data' },
  { value: 'slow', label: 'Slow (10s+)' },
];

const LOG_PAGE_SIZE = 10;

const AUDIT_FILTERS: Array<{ value: AuditFilter; label: string }> = [
  { value: 'all', label: 'All activity' },
  { value: 'accounts', label: 'Accounts' },
  { value: 'configuration', label: 'Configuration' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'diagnostics', label: 'Diagnostics' },
  { value: 'errors', label: 'Failed' },
];

const USER_STATUS_FILTERS: Array<{ value: UserStatusFilter; label: string }> = [
  { value: 'all', label: 'All accounts' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'free', label: 'Free' },
  { value: 'premium', label: 'Premium' },
  { value: 'verified', label: 'Verified' },
  { value: 'unverified', label: 'Unverified' },
];

function getAnalyticsRange(range: AnalyticsRange) {
  return ANALYTICS_RANGES.find((option) => option.value === range) ?? ANALYTICS_RANGES[1];
}

function getLogSortValue(entry: ReportLogEntry, key: LogSortKey): string | number {
  switch (key) {
    case 'timestamp': return entry.timestamp;
    case 'name': return entry.name ?? '';
    case 'date': return entry.date ?? '';
    case 'statusCode': return entry.statusCode;
    case 'safetyScore': return entry.safetyScore ?? -1;
    case 'durationMs': return entry.durationMs;
    case 'ip': return entry.ip ?? '';
  }
}

function matchesStatus(entry: ReportLogEntry, filter: StatusFilter): boolean {
  if (filter === 'healthy') return entry.statusCode === 200 && entry.partialData !== true;
  if (filter === 'issues') return entry.statusCode !== 200 || entry.partialData === true;
  if (filter === 'errors') return entry.statusCode !== 200;
  if (filter === 'partial') return entry.partialData === true;
  if (filter === 'slow') return entry.durationMs >= 10_000;
  return true;
}

function formatDuration(durationMs: number | null): string {
  if (durationMs == null || !Number.isFinite(durationMs)) return '—';
  if (durationMs > 0 && durationMs < 1) return '<1ms';
  return durationMs >= 1000
    ? `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`
    : `${Math.round(durationMs)}ms`;
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** unitIndex);
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value >= 100 ? 0 : value >= 10 ? 1 : 2,
  }).format(value)} ${units[unitIndex]}`;
}

function formatLogTime(timestamp: string): { primary: string; secondary: string } {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return { primary: 'Unknown', secondary: timestamp };
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return {
    primary: date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }),
    secondary: sameDay ? 'Today' : date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' }),
  };
}

function formatAccountDate(timestamp: string | null): string {
  if (!timestamp) return 'No activity yet';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const elapsedMs = Math.max(0, Date.now() - date.getTime());
  if (elapsedMs < 60_000) return 'Just now';
  if (elapsedMs < 60 * 60_000) return `${Math.floor(elapsedMs / 60_000)}m ago`;
  if (elapsedMs < 24 * 60 * 60_000) return `${Math.floor(elapsedMs / (60 * 60_000))}h ago`;
  if (elapsedMs < 7 * 24 * 60 * 60_000) return `${Math.floor(elapsedMs / (24 * 60 * 60_000))}d ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function formatHealthMonitorAction(action: string): string {
  if (action === 'alert-sent') return 'Alert emailed';
  if (action === 'reminder-sent') return 'Reminder emailed';
  if (action === 'recovery-sent') return 'Recovery emailed';
  if (action === 'processing-failed') return 'Alert processing failed';
  return 'No email needed';
}

function accountInitials(user: AdminUserRecord): string {
  const words = user.displayName.trim().split(/\s+/u).filter(Boolean);
  if (words.length > 1) return `${words[0][0]}${words.at(-1)?.[0] ?? ''}`.toUpperCase();
  return (words[0]?.slice(0, 2) || user.email?.slice(0, 2) || '?').toUpperCase();
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentileValue * sorted.length) - 1));
  return sorted[index];
}

function isHealthyResponse(entry: ReportLogEntry): boolean {
  return entry.statusCode === 200 && entry.partialData !== true;
}

function buildTrendData(entries: ReportLogEntry[], range: AnalyticsRange, now: number) {
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
      label: range !== '7d'
        ? date.toLocaleTimeString([], { hour: 'numeric', minute: range === '6h' ? '2-digit' : undefined })
        : date.toLocaleDateString([], { weekday: 'short' }),
      period: range !== '7d'
        ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric' })
        : date.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' }),
      healthy: 0,
      partial: 0,
      errors: 0,
      durations: [] as number[],
    };
  });

  entries.forEach((entry) => {
    const timestamp = new Date(entry.timestamp).getTime();
    if (!Number.isFinite(timestamp) || timestamp < start || timestamp > now) return;
    const bucket = buckets[Math.min(bucketCount - 1, Math.floor((timestamp - start) / bucketDuration))];
    if (!bucket) return;
    if (entry.statusCode !== 200) bucket.errors += 1;
    else if (entry.partialData === true) bucket.partial += 1;
    else bucket.healthy += 1;
    if (Number.isFinite(entry.durationMs)) bucket.durations.push(entry.durationMs);
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
    label: new Date(2026, 0, 1, hour).toLocaleTimeString([], { hour: 'numeric' }),
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
    const location = entry.name?.trim() || 'Unnamed report';
    counts.set(location, (counts.get(location) ?? 0) + 1);
  });
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count, share: entries.length ? (count / entries.length) * 100 : 0 }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, 6);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateOnlyUtc(value: string | null): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value ?? '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? timestamp
    : null;
}

function withDistributionShares<T extends { count: number }>(items: T[]) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return {
    total,
    items: items.map((item) => ({ ...item, share: total ? (item.count / total) * 100 : 0 })),
  };
}

function buildPlanningInsights(entries: ReportLogEntry[]) {
  const leadTime = [
    { key: 'same-day', label: 'Same day', count: 0 },
    { key: 'next-day', label: 'Next day', count: 0 },
    { key: 'two-three-days', label: '2–3 days ahead', count: 0 },
    { key: 'four-plus-days', label: '4+ days ahead', count: 0 },
  ];
  const startTimes = [
    { key: 'early', label: 'Before 6 AM', count: 0 },
    { key: 'morning', label: '6–9:59 AM', count: 0 },
    { key: 'midday', label: '10 AM–1:59 PM', count: 0 },
    { key: 'late', label: '2 PM or later', count: 0 },
  ];

  entries.filter((entry) => entry.statusCode === 200).forEach((entry) => {
    const selectedDate = parseDateOnlyUtc(entry.date);
    const requestedAt = new Date(entry.timestamp);
    if (selectedDate != null && !Number.isNaN(requestedAt.getTime())) {
      const requestDate = Date.UTC(requestedAt.getUTCFullYear(), requestedAt.getUTCMonth(), requestedAt.getUTCDate());
      const leadDays = Math.round((selectedDate - requestDate) / DAY_MS);
      // UTC can be one calendar day ahead of a western-U.S. request in the evening.
      // The product does not generate reports for past dates, so -1 is still same-day intent.
      if (leadDays === 0 || leadDays === -1) leadTime[0].count += 1;
      else if (leadDays === 1) leadTime[1].count += 1;
      else if (leadDays >= 2 && leadDays <= 3) leadTime[2].count += 1;
      else if (leadDays >= 4) leadTime[3].count += 1;
    }

    const startMatch = /^(\d{2}):(\d{2})$/u.exec(entry.startTime ?? '');
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
  const locations = new Map<string, {
    name: string;
    total: number;
    issues: number;
    durations: number[];
  }>();

  entries.forEach((entry) => {
    const name = entry.name?.trim();
    // Validation failures describe bad requests, not destination reliability.
    if (!name || (entry.statusCode >= 400 && entry.statusCode < 500)) return;
    const key = name.toLocaleLowerCase();
    const current = locations.get(key) ?? { name, total: 0, issues: 0, durations: [] };
    current.total += 1;
    if (entry.partialData === true || entry.statusCode >= 500) current.issues += 1;
    if (Number.isFinite(entry.durationMs)) current.durations.push(entry.durationMs);
    locations.set(key, current);
  });

  return [...locations.values()]
    .filter((location) => location.issues > 0)
    .map(({ durations, ...location }) => ({
      ...location,
      issueRate: (location.issues / location.total) * 100,
      p95Duration: durations.length ? percentile(durations, 0.95) : null,
    }))
    .sort((left, right) => right.issues - left.issues || right.issueRate - left.issueRate || right.total - left.total)
    .slice(0, 6);
}

function buildAITrendData(entries: AIUsageEntry[], range: AnalyticsRange, now: number) {
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
      label: range !== '7d'
        ? date.toLocaleTimeString([], { hour: 'numeric', minute: range === '6h' ? '2-digit' : undefined })
        : date.toLocaleDateString([], { weekday: 'short' }),
      inputTokens: 0,
      outputTokens: 0,
    };
  });

  entries.forEach((entry) => {
    const timestamp = new Date(entry.timestamp).getTime();
    if (!Number.isFinite(timestamp) || timestamp < start || timestamp > now) return;
    const bucket = buckets[Math.min(bucketCount - 1, Math.floor((timestamp - start) / bucketDuration))];
    if (!bucket) return;
    bucket.inputTokens += Number.isFinite(entry.inputTokens) ? entry.inputTokens : 0;
    bucket.outputTokens += Number.isFinite(entry.outputTokens) ? entry.outputTokens : 0;
  });

  return buckets;
}

function buildAIModels(entries: AIUsageEntry[]) {
  const models = new Map<string, { provider: string; model: string; calls: number; tokens: number; estimatedCostUsd: number }>();
  entries.forEach((entry) => {
    const key = `${entry.provider}:${entry.model}`;
    const current = models.get(key) ?? { provider: entry.provider, model: entry.model, calls: 0, tokens: 0, estimatedCostUsd: 0 };
    current.calls += 1;
    current.tokens += Number.isFinite(entry.totalTokens) ? entry.totalTokens : 0;
    current.estimatedCostUsd += Number.isFinite(entry.estimatedCostUsd) ? Number(entry.estimatedCostUsd) : 0;
    models.set(key, current);
  });
  return [...models.values()].sort((left, right) => right.tokens - left.tokens || right.calls - left.calls);
}

function buildAIFeatures(entries: AIUsageEntry[]) {
  const features = new Map<string, { feature: string; calls: number; errors: number; tokens: number; estimatedCostUsd: number; totalDurationMs: number }>();
  entries.forEach((entry) => {
    const feature = entry.feature?.trim() || 'unknown';
    const current = features.get(feature) ?? { feature, calls: 0, errors: 0, tokens: 0, estimatedCostUsd: 0, totalDurationMs: 0 };
    current.calls += 1;
    current.errors += entry.status === 'error' ? 1 : 0;
    current.tokens += Number.isFinite(entry.totalTokens) ? entry.totalTokens : 0;
    current.estimatedCostUsd += Number.isFinite(entry.estimatedCostUsd) ? Number(entry.estimatedCostUsd) : 0;
    current.totalDurationMs += Number.isFinite(entry.durationMs) ? entry.durationMs : 0;
    features.set(feature, current);
  });
  return [...features.values()]
    .map((feature) => ({ ...feature, averageDurationMs: feature.calls ? feature.totalDurationMs / feature.calls : 0 }))
    .sort((left, right) => right.calls - left.calls || right.tokens - left.tokens);
}

function formatUptime(seconds: number | undefined): string {
  if (!Number.isFinite(seconds)) return '—';
  const totalMinutes = Math.floor((seconds ?? 0) / 60);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatTokenCount(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value < 1000) return value.toLocaleString();
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function formatEstimatedCost(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '$0.00';
  if (value < 0.001) return `$${value.toFixed(6)}`;
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}

function escapeCsv(value: string | number | boolean | null): string {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function triggerCsvDownload(filename: string, headers: string[], rows: Array<Array<string | number | boolean | null>>) {
  const csv = [headers.join(','), ...rows.map((row) => row.map(escapeCsv).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function triggerJsonDownload(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadReportCsv(entries: ReportLogEntry[]) {
  const keys: Array<keyof ReportLogEntry> = ['timestamp', 'name', 'lat', 'lon', 'date', 'startTime', 'statusCode', 'safetyScore', 'partialData', 'durationMs', 'ip', 'userAgent'];
  triggerCsvDownload(
    `report-logs-${new Date().toISOString().slice(0, 10)}.csv`,
    keys,
    entries.map((entry) => keys.map((key) => entry[key])),
  );
}

function downloadAIUsageCsv(entries: AIUsageEntry[]) {
  const keys: Array<keyof AIUsageEntry> = ['timestamp', 'provider', 'model', 'feature', 'status', 'durationMs', 'inputTokens', 'outputTokens', 'totalTokens', 'estimatedCostUsd', 'pricingMatched', 'pricingVersion'];
  triggerCsvDownload(
    `ai-usage-${new Date().toISOString().slice(0, 10)}.csv`,
    keys,
    entries.map((entry) => keys.map((key) => entry[key])),
  );
}

function SortButton({ sortKey, activeKey, ascending, onSort, children }: {
  sortKey: LogSortKey;
  activeKey: LogSortKey;
  ascending: boolean;
  onSort: (key: LogSortKey) => void;
  children: React.ReactNode;
}) {
  const active = sortKey === activeKey;
  return (
    <button type="button" className={active ? 'logs-sort is-active' : 'logs-sort'} onClick={() => onSort(sortKey)}>
      {children}<span aria-hidden>{active ? (ascending ? '↑' : '↓') : '↕'}</span>
    </button>
  );
}

function AdminDashboard() {
  const [logs, setLogs] = useState<ReportLogEntry[]>([]);
  const [aiUsage, setAIUsage] = useState<AIUsageEntry[]>([]);
  const [aiSettings, setAISettings] = useState<AIAdminSettings | null>(null);
  const [aiModelCatalog, setAIModelCatalog] = useState<AIModelCatalog | null>(null);
  const [featureFlagStatus, setFeatureFlagStatus] = useState<ProductFeatureFlagStatus | null>(null);
  const [health, setHealth] = useState<AdminHealthSnapshot | null>(null);
  const [systemResources, setSystemResources] = useState<AdminSystemResources | null>(null);
  const [healthHistory, setHealthHistory] = useState<AdminHealthHistoryPayload | null>(null);
  const [healthHttpStatus, setHealthHttpStatus] = useState<number | null>(null);
  const [backendLatencyMs, setBackendLatencyMs] = useState<number | null>(null);
  const [auditEntries, setAuditEntries] = useState<AdminAuditEntry[]>([]);
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [userSummary, setUserSummary] = useState({ active: 0, suspended: 0, free: 0, premium: 0, verified: 0, unverified: 0, activeSessions: 0 });
  const [usageSettings, setUsageSettings] = useState<AdminUsageSettings | null>(null);
  const [runtimeEnvironment, setRuntimeEnvironment] = useState<RuntimeEnvironmentStatus | null>(null);
  const [backendRestartStatus, setBackendRestartStatus] = useState<BackendRestartStatus | null>(null);
  const [runtimeEnvironmentDrafts, setRuntimeEnvironmentDrafts] = useState<Record<string, string>>({});
  const [usageLimitDraft, setUsageLimitDraft] = useState('');
  const [reportLimitDraft, setReportLimitDraft] = useState('');
  const [userUsageLimitDrafts, setUserUsageLimitDrafts] = useState<Record<string, string>>({});
  const [userReportLimitDrafts, setUserReportLimitDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiUsageError, setAIUsageError] = useState<string | null>(null);
  const [aiSettingsError, setAISettingsError] = useState<string | null>(null);
  const [aiSettingsPending, setAISettingsPending] = useState(false);
  const [aiModelCatalogPending, setAIModelCatalogPending] = useState(false);
  const [aiModelCatalogError, setAIModelCatalogError] = useState<string | null>(null);
  const [modelDrafts, setModelDrafts] = useState<Record<AIProvider, { primary: string; fast: string }>>({
    openai: { primary: '', fast: '' },
    anthropic: { primary: '', fast: '' },
  });
  const [featureFlagsError, setFeatureFlagsError] = useState<string | null>(null);
  const [featureFlagsPending, setFeatureFlagsPending] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [systemResourcesError, setSystemResourcesError] = useState<string | null>(null);
  const [healthHistoryError, setHealthHistoryError] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersNotice, setUsersNotice] = useState<string | null>(null);
  const [usageSettingsError, setUsageSettingsError] = useState<string | null>(null);
  const [usageSettingsPending, setUsageSettingsPending] = useState(false);
  const [runtimeEnvironmentError, setRuntimeEnvironmentError] = useState<string | null>(null);
  const [runtimeEnvironmentNotice, setRuntimeEnvironmentNotice] = useState<string | null>(null);
  const [runtimeEnvironmentPendingKey, setRuntimeEnvironmentPendingKey] = useState<string | null>(null);
  const [backendRestartPending, setBackendRestartPending] = useState(false);
  const [userActionPending, setUserActionPending] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<ExternalDiagnosticsResult | null>(null);
  const [diagnosticsPending, setDiagnosticsPending] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [sortKey, setSortKey] = useState<LogSortKey>('timestamp');
  const [sortAsc, setSortAsc] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [auditFilter, setAuditFilter] = useState<AuditFilter>('all');
  const [auditQuery, setAuditQuery] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState<UserStatusFilter>('all');
  const [activeSection, setActiveSection] = useState<AdminSection>('overview');
  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsRange>('7d');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [visibleLogCount, setVisibleLogCount] = useState(LOG_PAGE_SIZE);
  const hasLoadedRef = useRef(false);
  const dashboardContentRef = useRef<HTMLDivElement>(null);
  const requestActivityRef = useRef<HTMLElement>(null);
  const aiUsageRef = useRef<HTMLElement>(null);

  const fetchHealthSnapshot = useCallback(async () => {
    const startedAt = performance.now();
    const result = await fetchApi('/api/healthz');
    return {
      ...result,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  }, []);

  const applyHealthSnapshot = useCallback((result: Awaited<ReturnType<typeof fetchHealthSnapshot>>) => {
    const payload = result.payload;
    if (payload && typeof payload === 'object' && 'service' in payload && 'memory' in payload) {
      setHealth(payload as AdminHealthSnapshot);
      setHealthHttpStatus(result.response.status);
      setBackendLatencyMs(result.latencyMs);
      setHealthError(null);
      return true;
    }
    setHealthError('System details are temporarily unavailable.');
    return false;
  }, []);

  const applyUserDirectory = useCallback((payload: unknown) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    const directory = payload as Partial<AdminUserDirectory>;
    if (!Array.isArray(directory.users) || !directory.summary || typeof directory.summary !== 'object') return false;
    setUsers(directory.users);
    setUsersTotal(Number.isFinite(directory.total) ? Number(directory.total) : directory.users.length);
    setUserSummary({
      active: Number.isFinite(directory.summary.active) ? Number(directory.summary.active) : 0,
      suspended: Number.isFinite(directory.summary.suspended) ? Number(directory.summary.suspended) : 0,
      free: Number.isFinite(directory.summary.free) ? Number(directory.summary.free) : 0,
      premium: Number.isFinite(directory.summary.premium) ? Number(directory.summary.premium) : 0,
      verified: Number.isFinite(directory.summary.verified) ? Number(directory.summary.verified) : 0,
      unverified: Number.isFinite(directory.summary.unverified) ? Number(directory.summary.unverified) : 0,
      activeSessions: Number.isFinite(directory.summary.activeSessions) ? Number(directory.summary.activeSessions) : 0,
    });
    setUsersError(null);
    return true;
  }, []);

  const applyRuntimeEnvironment = useCallback((payload: unknown) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !('entries' in payload)) return false;
    const status = payload as RuntimeEnvironmentStatus;
    if (!Array.isArray(status.entries)) return false;
    setRuntimeEnvironment(status);
    setRuntimeEnvironmentDrafts(Object.fromEntries(status.entries.map((entry) => [
      entry.key,
      entry.secret ? '' : entry.value ?? '',
    ])));
    setRuntimeEnvironmentError(null);
    return true;
  }, []);

  const fetchAuditTrail = useCallback(async () => {
    try {
      const result = await fetchApi('/api/admin/audit-log');
      if (result.response.ok && Array.isArray(result.payload)) {
        setAuditEntries(result.payload as AdminAuditEntry[]);
        setAuditError(null);
      } else {
        setAuditError('Administrative activity is temporarily unavailable.');
      }
    } catch {
      setAuditError('Could not reach the server to load administrative activity.');
    }
  }, []);

  const fetchUserDirectory = useCallback(async () => {
    try {
      const result = await fetchApi('/api/admin/users?limit=500');
      if (result.response.ok && applyUserDirectory(result.payload)) return true;
      setUsersError('The account directory is temporarily unavailable.');
    } catch {
      setUsersError('Could not reach the server to load accounts.');
    }
    return false;
  }, [applyUserDirectory]);

  const fetchAdminData = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    try {
      const [logsResult, aiUsageResult, healthResult, systemResourcesResult, healthHistoryResult, aiSettingsResult, featureFlagsResult, aiModelsResult, auditResult, usersResult, usageSettingsResult, runtimeEnvironmentResult, backendRestartResult] = await Promise.all([
        fetchApi('/api/report-logs'),
        fetchApi('/api/ai-usage'),
        fetchHealthSnapshot(),
        fetchApi('/api/admin/system-resources'),
        fetchApi('/api/admin/health-monitor-history'),
        fetchApi('/api/admin/ai-settings'),
        fetchApi('/api/admin/feature-flags'),
        fetchApi('/api/admin/ai-models'),
        fetchApi('/api/admin/audit-log'),
        fetchApi('/api/admin/users?limit=500'),
        fetchApi('/api/admin/usage-settings'),
        fetchApi('/api/admin/runtime-environment'),
        fetchApi('/api/admin/maintenance/backend-restart'),
      ]);
      if (logsResult.response.ok && Array.isArray(logsResult.payload)) {
        setLogs(logsResult.payload as ReportLogEntry[]);
        setError(null);
        setLastRefreshed(new Date());
      } else {
        setError('The server could not load report logs.');
      }
      if (aiUsageResult.response.ok && Array.isArray(aiUsageResult.payload)) {
        setAIUsage(aiUsageResult.payload as AIUsageEntry[]);
        setAIUsageError(null);
      } else {
        setAIUsageError('AI usage data is temporarily unavailable.');
      }
      applyHealthSnapshot(healthResult);
      if (systemResourcesResult.response.ok && systemResourcesResult.payload && typeof systemResourcesResult.payload === 'object' && 'memory' in systemResourcesResult.payload) {
        setSystemResources(systemResourcesResult.payload as AdminSystemResources);
        setSystemResourcesError(null);
      } else {
        setSystemResourcesError('Disk and RAM usage are temporarily unavailable.');
      }
      if (
        healthHistoryResult.response.ok
        && healthHistoryResult.payload
        && typeof healthHistoryResult.payload === 'object'
        && 'entries' in healthHistoryResult.payload
        && Array.isArray(healthHistoryResult.payload.entries)
      ) {
        setHealthHistory(healthHistoryResult.payload as AdminHealthHistoryPayload);
        setHealthHistoryError(null);
      } else {
        setHealthHistoryError('Automated health-check history is temporarily unavailable.');
      }
      if (aiSettingsResult.response.ok && aiSettingsResult.payload && typeof aiSettingsResult.payload === 'object') {
        setAISettings(aiSettingsResult.payload as AIAdminSettings);
        setAISettingsError(null);
      } else {
        setAISettingsError('AI controls are temporarily unavailable.');
      }
      if (featureFlagsResult.response.ok && featureFlagsResult.payload && typeof featureFlagsResult.payload === 'object') {
        setFeatureFlagStatus(featureFlagsResult.payload as ProductFeatureFlagStatus);
        setFeatureFlagsError(null);
      } else {
        setFeatureFlagsError('Product feature flags are temporarily unavailable.');
      }
      if (aiModelsResult.response.ok && aiModelsResult.payload && typeof aiModelsResult.payload === 'object') {
        setAIModelCatalog(aiModelsResult.payload as AIModelCatalog);
        setAIModelCatalogError(null);
      } else {
        setAIModelCatalogError('Provider model lists are temporarily unavailable.');
      }
      if (auditResult.response.ok && Array.isArray(auditResult.payload)) {
        setAuditEntries(auditResult.payload as AdminAuditEntry[]);
        setAuditError(null);
      } else {
        setAuditError('Administrative activity is temporarily unavailable.');
      }
      if (!usersResult.response.ok || !applyUserDirectory(usersResult.payload)) {
        setUsersError('The account directory is temporarily unavailable.');
      }
      if (usageSettingsResult.response.ok && usageSettingsResult.payload && typeof usageSettingsResult.payload === 'object') {
        const nextUsageSettings = usageSettingsResult.payload as AdminUsageSettings;
        setUsageSettings(nextUsageSettings);
        setUsageLimitDraft(String(nextUsageSettings.freeMonthlyAITokenLimit));
        setReportLimitDraft(String(nextUsageSettings.freeMonthlyReportUsageLimit));
        setUsageSettingsError(null);
      } else {
        setUsageSettingsError('Usage limits are temporarily unavailable.');
      }
      if (!runtimeEnvironmentResult.response.ok || !applyRuntimeEnvironment(runtimeEnvironmentResult.payload)) {
        setRuntimeEnvironmentError('Runtime environment settings are temporarily unavailable.');
      }
      if (backendRestartResult.response.ok && backendRestartResult.payload && typeof backendRestartResult.payload === 'object') {
        setBackendRestartStatus(backendRestartResult.payload as BackendRestartStatus);
      } else {
        setBackendRestartStatus(null);
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setAIUsageError('AI usage data is temporarily unavailable.');
      setHealthError('System details are temporarily unavailable.');
      setSystemResourcesError('Disk and RAM usage are temporarily unavailable.');
      setHealthHistoryError('Automated health-check history is temporarily unavailable.');
      setAISettingsError('AI controls are temporarily unavailable.');
      setFeatureFlagsError('Product feature flags are temporarily unavailable.');
      setAIModelCatalogError('Provider model lists are temporarily unavailable.');
      setAuditError('Administrative activity is temporarily unavailable.');
      setUsersError('The account directory is temporarily unavailable.');
      setUsageSettingsError('Usage limits are temporarily unavailable.');
      setRuntimeEnvironmentError('Runtime environment settings are temporarily unavailable.');
      setBackendRestartStatus(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [applyHealthSnapshot, applyRuntimeEnvironment, applyUserDirectory, fetchHealthSnapshot]);

  const refreshModelCatalog = useCallback(async () => {
    setAIModelCatalogPending(true);
    setAIModelCatalogError(null);
    try {
      const result = await fetchApi('/api/admin/ai-models/refresh', {
        method: 'POST',
      });
      if (result.response.ok && result.payload && typeof result.payload === 'object') {
        setAIModelCatalog(result.payload as AIModelCatalog);
        void fetchAuditTrail();
        return;
      }
      setAIModelCatalogError('Provider model lists could not be refreshed.');
    } catch {
      setAIModelCatalogError('Could not reach the server to refresh provider models.');
    } finally {
      setAIModelCatalogPending(false);
    }
  }, [fetchAuditTrail]);

  const updateAIControl = useCallback(async (settings: {
    enabled?: boolean;
    provider?: AIProvider;
    features?: Partial<Record<AIFeatureKey, boolean>>;
    models?: Partial<Record<AIProvider, { primary?: string; fast?: string }>>;
  }) => {
    setAISettingsPending(true);
    setAISettingsError(null);
    try {
      const result = await fetchApi('/api/admin/ai-settings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(settings),
      });
      if (result.response.ok && result.payload && typeof result.payload === 'object') {
        const nextSettings = result.payload as AIAdminSettings;
        setAISettings(nextSettings);
        publishAiAvailability(nextSettings);
        void fetchAuditTrail();
        return nextSettings;
      }
      const message = result.payload && typeof result.payload === 'object' && 'error' in result.payload
        ? String(result.payload.error)
        : 'The server could not update AI controls.';
      setAISettingsError(message);
      return null;
    } catch {
      setAISettingsError('Could not reach the server to update AI controls.');
      return null;
    } finally {
      setAISettingsPending(false);
    }
  }, [fetchAuditTrail]);

  useEffect(() => {
    if (!aiSettings) return;
    setModelDrafts({
      openai: {
        primary: aiSettings.providers.openai.primary,
        fast: aiSettings.providers.openai.fast,
      },
      anthropic: {
        primary: aiSettings.providers.anthropic.primary,
        fast: aiSettings.providers.anthropic.fast,
      },
    });
  }, [aiSettings]);

  const toggleAIEnabled = () => {
    if (!aiSettings) return;
    if (aiSettings.enabled && !window.confirm('Stop all AI features and switch every individual AI feature off?')) return;
    void updateAIControl({ enabled: !aiSettings.enabled });
  };

  const toggleAIFeature = (feature: AIFeatureKey) => {
    const current = aiSettings?.features?.[feature]?.enabled;
    if (typeof current !== 'boolean') return;
    void updateAIControl({ features: { [feature]: !current } });
  };

  const saveProviderModels = async (provider: AIProvider) => {
    const draft = modelDrafts[provider];
    const primary = draft.primary.trim();
    const fast = draft.fast.trim();
    if (!primary || !fast) return;
    await updateAIControl({ models: { [provider]: { primary, fast } } });
  };

  const updateManagedUserStatus = async (user: AdminUserRecord, status: 'active' | 'suspended') => {
    if (user.isOwner) return;
    if (status === 'suspended' && !window.confirm(
      `Suspend ${user.displayName}? This immediately signs them out and blocks future sign-ins until the account is reactivated.`,
    )) return;
    setUserActionPending(`${user.id}:status`);
    setUsersError(null);
    try {
      const result = await fetchApi(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!result.response.ok) {
        const message = result.payload && typeof result.payload === 'object' && 'error' in result.payload
          ? String(result.payload.error)
          : 'The account status could not be updated.';
        setUsersError(message);
        return;
      }
      await fetchUserDirectory();
      void fetchAuditTrail();
    } catch {
      setUsersError('Could not reach the server to update this account.');
    } finally {
      setUserActionPending(null);
    }
  };

  const updateManagedUserTier = async (user: AdminUserRecord, tier: 'free' | 'premium') => {
    if (user.tier === tier) return;
    if (tier === 'free' && !window.confirm(
      `Move ${user.displayName} to Free? Premium limits and features will stop applying immediately.`,
    )) return;
    setUserActionPending(`${user.id}:tier`);
    setUsersError(null);
    try {
      const result = await fetchApi(`/api/admin/users/${encodeURIComponent(user.id)}/tier`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      });
      if (!result.response.ok) {
        const message = result.payload && typeof result.payload === 'object' && 'error' in result.payload
          ? String(result.payload.error)
          : 'The account tier could not be updated.';
        setUsersError(message);
        return;
      }
      await fetchUserDirectory();
      void fetchAuditTrail();
    } catch {
      setUsersError('Could not reach the server to update this account tier.');
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
    const maxAITokenLimit = usageSettings?.maxMonthlyAITokenLimit ?? 100_000_000;
    const maxReportLimit = usageSettings?.maxFreeMonthlyUsageLimit ?? 10_000;
    if (!Number.isFinite(aiLimit) || aiLimit <= 0 || aiLimit > maxAITokenLimit) {
      setUsageSettingsError(`Enter an AI token limit between 1 and ${maxAITokenLimit.toLocaleString()}.`);
      return;
    }
    if (!Number.isFinite(reportLimit) || reportLimit <= 0 || reportLimit > maxReportLimit) {
      setUsageSettingsError(`Enter a generated report limit between 1 and ${maxReportLimit.toLocaleString()}.`);
      return;
    }
    setUsageSettingsPending(true);
    setUsageSettingsError(null);
    try {
      const result = await fetchApi('/api/admin/usage-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          freeMonthlyAITokenLimit: Math.round(aiLimit),
          freeMonthlyReportUsageLimit: Math.round(reportLimit),
        }),
      });
      if (!result.response.ok || !result.payload || typeof result.payload !== 'object') {
        const message = result.payload && typeof result.payload === 'object' && 'error' in result.payload
          ? String(result.payload.error)
          : 'The default monthly limits could not be updated.';
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
      setUsageSettingsError('Could not reach the server to update usage limits.');
    } finally {
      setUsageSettingsPending(false);
    }
  };

  const updateManagedUserUsageLimit = async (user: AdminUserRecord, limit: number | null) => {
    const maxLimit = usageSettings?.maxMonthlyAITokenLimit ?? 100_000_000;
    if (limit !== null && (!Number.isFinite(limit) || limit <= 0 || limit > maxLimit)) {
      setUsersError(`Enter a monthly AI token limit between 1 and ${maxLimit.toLocaleString()}.`);
      return;
    }
    setUserActionPending(`${user.id}:usage-limit`);
    setUsersError(null);
    try {
      const result = await fetchApi(`/api/admin/users/${encodeURIComponent(user.id)}/usage-limit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: limit === null ? null : Math.round(limit) }),
      });
      if (!result.response.ok) {
        const message = result.payload && typeof result.payload === 'object' && 'error' in result.payload
          ? String(result.payload.error)
          : 'The account usage limit could not be updated.';
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
      setUsersError('Could not reach the server to update this account usage limit.');
    } finally {
      setUserActionPending(null);
    }
  };

  const updateManagedUserReportUsageLimit = async (user: AdminUserRecord, limit: number | null) => {
    const maxLimit = usageSettings?.maxFreeMonthlyUsageLimit ?? 10_000;
    if (limit !== null && (!Number.isFinite(limit) || limit <= 0 || limit > maxLimit)) {
      setUsersError(`Enter a monthly generated report limit between 1 and ${maxLimit.toLocaleString()}.`);
      return;
    }
    setUserActionPending(`${user.id}:report-usage-limit`);
    setUsersError(null);
    try {
      const result = await fetchApi(`/api/admin/users/${encodeURIComponent(user.id)}/report-usage-limit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: limit === null ? null : Math.round(limit) }),
      });
      if (!result.response.ok) {
        const message = result.payload && typeof result.payload === 'object' && 'error' in result.payload
          ? String(result.payload.error)
          : 'The account generated report limit could not be updated.';
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
      setUsersError('Could not reach the server to update this account generated report limit.');
    } finally {
      setUserActionPending(null);
    }
  };

  const resetManagedUserUsage = async (user: AdminUserRecord) => {
    if (!window.confirm(`Reset ${user.displayName}'s AI and report usage for the current month? Saved reports will not be deleted.`)) return;
    setUserActionPending(`${user.id}:usage-reset`);
    setUsersError(null);
    try {
      const result = await fetchApi(`/api/admin/users/${encodeURIComponent(user.id)}/reset-usage`, {
        method: 'POST',
      });
      if (!result.response.ok) {
        const message = result.payload && typeof result.payload === 'object' && 'error' in result.payload
          ? String(result.payload.error)
          : 'The account usage meter could not be reset.';
        setUsersError(message);
        return;
      }
      await fetchUserDirectory();
      void fetchAuditTrail();
    } catch {
      setUsersError('Could not reach the server to reset this account usage.');
    } finally {
      setUserActionPending(null);
    }
  };

  const resetAllManagedUserUsage = async () => {
    if (!window.confirm('Reset current-month AI and report usage for every account? Saved reports will not be deleted.')) return;
    setUserActionPending('all:usage-reset');
    setUsersError(null);
    try {
      const result = await fetchApi('/api/admin/users/reset-usage', { method: 'POST' });
      if (!result.response.ok) {
        const message = result.payload && typeof result.payload === 'object' && 'error' in result.payload
          ? String(result.payload.error)
          : 'Monthly usage could not be reset.';
        setUsersError(message);
        return;
      }
      await fetchUserDirectory();
      void fetchAuditTrail();
    } catch {
      setUsersError('Could not reach the server to reset monthly usage.');
    } finally {
      setUserActionPending(null);
    }
  };

  const resetAllManagedUserUsageLimits = async () => {
    if (!window.confirm('Restore the default AI and generated report limits for every account? Current usage will not be reset.')) return;
    setUserActionPending('all:usage-limit-reset');
    setUsersError(null);
    try {
      const result = await fetchApi('/api/admin/users/reset-usage-limits', { method: 'POST' });
      if (!result.response.ok) {
        const message = result.payload && typeof result.payload === 'object' && 'error' in result.payload
          ? String(result.payload.error)
          : 'Custom account limits could not be reset.';
        setUsersError(message);
        return;
      }
      setUserUsageLimitDrafts({});
      setUserReportLimitDrafts({});
      await fetchUserDirectory();
      void fetchAuditTrail();
    } catch {
      setUsersError('Could not reach the server to reset custom account limits.');
    } finally {
      setUserActionPending(null);
    }
  };

  const revokeManagedUserSessions = async (user: AdminUserRecord) => {
    if (user.isOwner || user.activeSessions === 0) return;
    if (!window.confirm(`Sign ${user.displayName} out of all active sessions?`)) return;
    setUserActionPending(`${user.id}:sessions`);
    setUsersError(null);
    try {
      const result = await fetchApi(`/api/admin/users/${encodeURIComponent(user.id)}/revoke-sessions`, {
        method: 'POST',
      });
      if (!result.response.ok) {
        const message = result.payload && typeof result.payload === 'object' && 'error' in result.payload
          ? String(result.payload.error)
          : 'The account could not be signed out.';
        setUsersError(message);
        return;
      }
      await fetchUserDirectory();
      void fetchAuditTrail();
    } catch {
      setUsersError('Could not reach the server to sign this account out.');
    } finally {
      setUserActionPending(null);
    }
  };

  const sendManagedUserVerification = async (user: AdminUserRecord) => {
    if (user.emailVerified || user.status !== 'active' || !user.email) return;
    if (!window.confirm(`Send a new verification link to ${user.email}? Any older verification link will stop working.`)) return;
    setUserActionPending(`${user.id}:verification`);
    setUsersError(null);
    setUsersNotice(null);
    try {
      const result = await fetchApi(`/api/admin/users/${encodeURIComponent(user.id)}/send-verification`, {
        method: 'POST',
      });
      if (!result.response.ok) {
        const message = result.payload && typeof result.payload === 'object' && 'error' in result.payload
          ? String(result.payload.error)
          : 'The verification email could not be sent.';
        setUsersError(message);
        return;
      }
      const message = result.payload && typeof result.payload === 'object' && 'message' in result.payload
        ? String(result.payload.message)
        : `Verification email sent to ${user.email}.`;
      setUsersNotice(message);
      await fetchUserDirectory();
      void fetchAuditTrail();
    } catch {
      setUsersError('Could not reach the server to send a verification email.');
    } finally {
      setUserActionPending(null);
    }
  };

  const updateRuntimeEnvironmentEntry = async (entry: RuntimeEnvironmentEntry, reset = false) => {
    const draft = runtimeEnvironmentDrafts[entry.key] ?? '';
    if (!reset && !draft.trim()) {
      setRuntimeEnvironmentError(`${entry.label} cannot be empty; reset the override to use the deployment value.`);
      return;
    }
    setRuntimeEnvironmentPendingKey(entry.key);
    setRuntimeEnvironmentError(null);
    setRuntimeEnvironmentNotice(null);
    try {
      const result = await fetchApi('/api/admin/runtime-environment', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: { [entry.key]: reset ? null : draft } }),
      });
      if (result.response.ok && applyRuntimeEnvironment(result.payload)) {
        setRuntimeEnvironmentNotice(`${entry.key} ${reset ? 'restored to its deployment value' : 'saved'}. Restart the backend to apply it everywhere.`);
        void fetchAuditTrail();
        return;
      }
      const message = result.payload && typeof result.payload === 'object' && 'error' in result.payload
        ? String(result.payload.error)
        : 'The server could not update the runtime environment.';
      setRuntimeEnvironmentError(message);
    } catch {
      setRuntimeEnvironmentError('Could not reach the server to update the runtime environment.');
    } finally {
      setRuntimeEnvironmentPendingKey(null);
    }
  };

  const waitForBackendAfterRestart = async (previousUptime: number | undefined) => {
    await new Promise((resolve) => window.setTimeout(resolve, 1800));
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const healthResult = await fetchHealthSnapshot();
        const nextHealth = healthResult.payload as Partial<AdminHealthSnapshot> | null;
        const uptimeReset = previousUptime == null
          || (typeof nextHealth?.uptime === 'number' && nextHealth.uptime + 2 < previousUptime)
          || attempt >= 5;
        if (healthResult.response.ok && uptimeReset && applyHealthSnapshot(healthResult)) {
          const statusResult = await fetchApi('/api/admin/maintenance/backend-restart');
          if (statusResult.response.ok && statusResult.payload && typeof statusResult.payload === 'object') {
            setBackendRestartStatus(statusResult.payload as BackendRestartStatus);
          }
          setRuntimeEnvironmentNotice('Backend restart completed and the health check is responding.');
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
    setRuntimeEnvironmentError('The restart was requested, but the backend did not become healthy within 30 seconds.');
  };

  const restartBackend = async () => {
    if (!backendRestartStatus?.available || backendRestartPending) return;
    if (!window.confirm('Restart the backend now? Requests may be unavailable briefly while Docker starts a fresh process. This does not recreate the container or reread the host .env file.')) return;
    setBackendRestartPending(true);
    setRuntimeEnvironmentError(null);
    setRuntimeEnvironmentNotice(null);
    try {
      const result = await fetchApi('/api/admin/maintenance/backend-restart', { method: 'POST' });
      if (result.response.ok && result.payload && typeof result.payload === 'object') {
        setBackendRestartStatus(result.payload as BackendRestartStatus);
        setRuntimeEnvironmentNotice('Backend restart requested. Waiting for the health check to return…');
        void waitForBackendAfterRestart(health?.uptime);
        return;
      }
      const message = result.payload && typeof result.payload === 'object' && 'error' in result.payload
        ? String(result.payload.error)
        : 'The backend restart could not be scheduled.';
      setRuntimeEnvironmentError(message);
    } catch {
      setRuntimeEnvironmentError('Could not reach the backend to schedule a restart.');
    }
    setBackendRestartPending(false);
  };

  const toggleProductFeature = async (feature: ProductFeatureKey) => {
    const current = featureFlagStatus?.flags[feature];
    if (typeof current !== 'boolean') return;
    setFeatureFlagsPending(true);
    setFeatureFlagsError(null);
    try {
      const result = await fetchApi('/api/admin/feature-flags', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ flags: { [feature]: !current } }),
      });
      if (result.response.ok && result.payload && typeof result.payload === 'object') {
        const nextStatus = result.payload as ProductFeatureFlagStatus;
        setFeatureFlagStatus(nextStatus);
        publishProductFeatureFlags(nextStatus.flags);
        void fetchAuditTrail();
        return;
      }
      const message = result.payload && typeof result.payload === 'object' && 'error' in result.payload
        ? String(result.payload.error)
        : 'The server could not update product feature flags.';
      setFeatureFlagsError(message);
    } catch {
      setFeatureFlagsError('Could not reach the server to update product feature flags.');
    } finally {
      setFeatureFlagsPending(false);
    }
  };

  const runServiceDiagnostics = async () => {
    setDiagnosticsPending(true);
    setDiagnosticsError(null);
    const [healthResult, externalResult] = await Promise.allSettled([
      fetchHealthSnapshot(),
      fetchApi('/api/admin/diagnostics', {
        method: 'POST',
      }),
    ]);

    if (healthResult.status === 'fulfilled') {
      applyHealthSnapshot(healthResult.value);
    } else {
      setHealthError('Could not reach the backend server to run its health check.');
    }

    try {
      if (externalResult.status === 'rejected') throw externalResult.reason;
      const result = externalResult.value;
      if (result.response.ok && result.payload && typeof result.payload === 'object') {
        setDiagnostics(result.payload as ExternalDiagnosticsResult);
        void fetchAuditTrail();
        return;
      }
      const message = result.payload && typeof result.payload === 'object' && 'error' in result.payload
        ? String(result.payload.error)
        : 'The server could not run provider diagnostics.';
      setDiagnosticsError(message);
    } catch {
      setDiagnosticsError('Could not reach the server to run provider diagnostics.');
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
    const interval = window.setInterval(() => void fetchAdminData(true), 30_000);
    return () => window.clearInterval(interval);
  }, [autoRefresh, fetchAdminData]);

  const referenceTime = lastRefreshed?.getTime() ?? Date.now();
  const selectedRange = getAnalyticsRange(analyticsRange);

  const rangeLogs = useMemo(() => {
    const cutoff = referenceTime - selectedRange.durationMs;
    return logs.filter((entry) => {
      const timestamp = new Date(entry.timestamp).getTime();
      return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= referenceTime;
    });
  }, [logs, referenceTime, selectedRange.durationMs]);

  const rangeAIUsage = useMemo(() => {
    const cutoff = referenceTime - selectedRange.durationMs;
    return aiUsage.filter((entry) => {
      const timestamp = new Date(entry.timestamp).getTime();
      return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= referenceTime;
    });
  }, [aiUsage, referenceTime, selectedRange.durationMs]);

  const metrics = useMemo(() => {
    const healthy = rangeLogs.filter(isHealthyResponse).length;
    const issues = rangeLogs.length - healthy;
    const durations = rangeLogs.map((entry) => entry.durationMs).filter(Number.isFinite);
    const networkCounts = new Map<string, number>();
    rangeLogs.forEach((entry) => {
      if (entry.ip) networkCounts.set(entry.ip, (networkCounts.get(entry.ip) ?? 0) + 1);
    });
    const networkedReports = [...networkCounts.values()].reduce((sum, count) => sum + count, 0);
    const repeatNetworks = [...networkCounts.values()].filter((count) => count > 1).length;
    const previousStart = referenceTime - selectedRange.durationMs * 2;
    const previousEnd = referenceTime - selectedRange.durationMs;
    const previousLogs = analyticsRange !== '7d'
      ? logs.filter((entry) => {
        const timestamp = new Date(entry.timestamp).getTime();
        return Number.isFinite(timestamp) && timestamp >= previousStart && timestamp < previousEnd;
      })
      : [];
    const previousCount = previousLogs.length;
    const previousHealthy = previousLogs.filter(isHealthyResponse).length;
    const previousDurations = previousLogs.map((entry) => entry.durationMs).filter(Number.isFinite);
    const healthyRate = rangeLogs.length ? Math.round((healthy / rangeLogs.length) * 1000) / 10 : null;
    const previousHealthyRate = previousCount ? Math.round((previousHealthy / previousCount) * 1000) / 10 : null;
    const p95Duration = durations.length ? percentile(durations, 0.95) : null;
    const previousP95Duration = previousDurations.length ? percentile(previousDurations, 0.95) : null;
    const volumeDelta = previousCount > 0
      ? Math.round(((rangeLogs.length - previousCount) / previousCount) * 100)
      : null;
    return {
      total: rangeLogs.length,
      healthyRate,
      healthyRateDelta: healthyRate != null && previousHealthyRate != null
        ? Math.round((healthyRate - previousHealthyRate) * 10) / 10
        : null,
      p95Duration,
      p95DurationDelta: p95Duration != null && previousP95Duration != null
        ? p95Duration - previousP95Duration
        : null,
      medianDuration: durations.length ? percentile(durations, 0.5) : null,
      uniqueVisitors: networkCounts.size,
      reportsPerNetwork: networkCounts.size ? networkedReports / networkCounts.size : null,
      repeatNetworkRate: networkCounts.size ? Math.round((repeatNetworks / networkCounts.size) * 100) : null,
      issues,
      volumeDelta,
    };
  }, [analyticsRange, logs, rangeLogs, referenceTime, selectedRange.durationMs]);

  const trendData = useMemo(
    () => buildTrendData(rangeLogs, analyticsRange, referenceTime),
    [analyticsRange, rangeLogs, referenceTime],
  );
  const hourlyDistribution = useMemo(() => buildHourlyDistribution(rangeLogs), [rangeLogs]);
  const topLocations = useMemo(() => buildTopLocations(rangeLogs), [rangeLogs]);
  const planningInsights = useMemo(() => buildPlanningInsights(rangeLogs), [rangeLogs]);
  const reliabilityHotspots = useMemo(() => buildReliabilityHotspots(rangeLogs), [rangeLogs]);
  const aiTrendData = useMemo(
    () => buildAITrendData(rangeAIUsage, analyticsRange, referenceTime),
    [analyticsRange, rangeAIUsage, referenceTime],
  );
  const aiModels = useMemo(() => buildAIModels(rangeAIUsage), [rangeAIUsage]);
  const aiFeatures = useMemo(() => buildAIFeatures(rangeAIUsage), [rangeAIUsage]);
  const aiMetrics = useMemo(() => {
    const successful = rangeAIUsage.filter((entry) => entry.status === 'success').length;
    return {
      calls: rangeAIUsage.length,
      inputTokens: rangeAIUsage.reduce((sum, entry) => sum + (Number.isFinite(entry.inputTokens) ? entry.inputTokens : 0), 0),
      outputTokens: rangeAIUsage.reduce((sum, entry) => sum + (Number.isFinite(entry.outputTokens) ? entry.outputTokens : 0), 0),
      successRate: rangeAIUsage.length ? Math.round((successful / rangeAIUsage.length) * 1000) / 10 : null,
      failures: rangeAIUsage.length - successful,
      estimatedCostUsd: rangeAIUsage.reduce((sum, entry) => sum + (Number.isFinite(entry.estimatedCostUsd) ? Number(entry.estimatedCostUsd) : 0), 0),
      pricedCalls: rangeAIUsage.filter((entry) => Number.isFinite(entry.estimatedCostUsd)).length,
    };
  }, [rangeAIUsage]);
  const slowReports = useMemo(() => rangeLogs.filter((entry) => entry.durationMs >= 10_000).length, [rangeLogs]);
  const cacheMetrics = useMemo(() => {
    const caches = health?.caches ?? [];
    const hits = caches.reduce((sum, cache) => sum + cache.hits + cache.staleHits, 0);
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
      : healthError || 'No health response received';
    const databaseStatus = health?.database;
    const databaseDiagnostic: DiagnosticService = !health
      ? {
        id: 'postgresql',
        name: 'PostgreSQL database',
        category: 'Infrastructure',
        status: 'failed',
        httpStatus: null,
        latencyMs: null,
        message: healthError || 'Waiting for backend health data',
      }
      : !databaseStatus || !databaseStatus.configured
        ? {
          id: 'postgresql',
          name: 'PostgreSQL database',
          category: 'Infrastructure',
          status: 'not_configured',
          httpStatus: null,
          latencyMs: databaseStatus?.latencyMs ?? null,
          message: databaseStatus ? 'DATABASE_URL is not configured' : 'Database health is not reported by this server',
        }
        : {
          id: 'postgresql',
          name: 'PostgreSQL database',
          category: 'Infrastructure',
          status: databaseStatus.connected ? 'operational' : 'failed',
          httpStatus: null,
          latencyMs: databaseStatus.latencyMs ?? null,
          message: databaseStatus.connected ? 'Live query succeeded' : 'Live query failed',
        };

    return [
      {
        id: 'backend-server',
        name: 'Backend server',
        category: 'Infrastructure',
        status: health ? 'operational' : 'failed',
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
  const diagnosticSummary = useMemo(() => ({
    total: diagnosticServices.length,
    operational: diagnosticServices.filter((service) => service.status === 'operational').length,
    failed: diagnosticServices.filter((service) => service.status === 'failed').length,
    notConfigured: diagnosticServices.filter((service) => service.status === 'not_configured').length,
  }), [diagnosticServices]);
  const busiestHour = useMemo(
    () => hourlyDistribution.reduce((busiest, current) => current.requests > busiest.requests ? current : busiest, hourlyDistribution[0]),
    [hourlyDistribution],
  );
  const dashboardAttentionCount = metrics.issues + slowReports + aiMetrics.failures + diagnosticSummary.failed + userSummary.suspended;
  const sectionCounts: Record<AdminSection, number> = {
    overview: dashboardAttentionCount,
    users: usersTotal,
    operations: diagnosticSummary.failed,
    analytics: rangeLogs.length,
    activity: auditEntries.length,
  };

  const filteredAndSorted = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const result = rangeLogs.filter((entry) => {
      if (!matchesStatus(entry, statusFilter)) return false;
      if (!normalizedQuery) return true;
      return [entry.name, entry.lat, entry.lon, entry.date, entry.startTime, entry.statusCode, entry.safetyScore, entry.durationMs, entry.ip, entry.userAgent]
        .some((value) => String(value ?? '').toLowerCase().includes(normalizedQuery));
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
      if (auditFilter === 'errors' && entry.status !== 'error') return false;
      if (auditFilter !== 'all' && auditFilter !== 'errors' && entry.category !== auditFilter) return false;
      if (!normalizedQuery) return true;
      return [entry.summary, entry.action, entry.category, entry.status, entry.actorNetwork]
        .some((value) => String(value ?? '').toLowerCase().includes(normalizedQuery));
    });
  }, [auditEntries, auditFilter, auditQuery]);

  const filteredUsers = useMemo(() => {
    const normalizedQuery = userQuery.trim().toLowerCase();
    return users.filter((user) => {
      if (userStatusFilter === 'verified' && !user.emailVerified) return false;
      if (userStatusFilter === 'unverified' && user.emailVerified) return false;
      if (
        userStatusFilter !== 'all'
        && userStatusFilter !== 'verified'
        && userStatusFilter !== 'unverified'
        && user.status !== userStatusFilter
        && user.tier !== userStatusFilter
      ) return false;
      if (!normalizedQuery) return true;
      return [
        user.displayName,
        user.email,
        user.authProvider,
        ...user.authMethods,
        user.status,
        user.tier,
        user.emailVerified ? 'verified' : 'unverified',
      ]
        .some((value) => String(value ?? '').toLowerCase().includes(normalizedQuery));
    });
  }, [userQuery, users, userStatusFilter]);

  const runtimeEnvironmentGroups = useMemo(() => {
    const groups = new Map<string, RuntimeEnvironmentEntry[]>();
    (runtimeEnvironment?.entries ?? []).forEach((entry) => {
      groups.set(entry.category, [...(groups.get(entry.category) ?? []), entry]);
    });
    return [...groups.entries()];
  }, [runtimeEnvironment]);

  const downloadOperationsSnapshot = () => {
    triggerJsonDownload(`admin-snapshot-${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}.json`, {
      generatedAt: new Date().toISOString(),
      range: { value: analyticsRange, label: selectedRange.label },
      system: health,
      systemResources,
      automatedHealthChecks: healthHistory,
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
    });
  };

  const handleSort = (key: LogSortKey) => {
    if (key === sortKey) setSortAsc((current) => !current);
    else {
      setSortKey(key);
      setSortAsc(key === 'name' || key === 'date' || key === 'ip');
    }
  };

  const showRequestFilter = (filter: StatusFilter) => {
    setStatusFilter(filter);
    setActiveSection('analytics');
    window.setTimeout(() => requestActivityRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const showAIUsage = () => {
    setActiveSection('analytics');
    window.setTimeout(() => aiUsageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const selectAdminSection = (section: AdminSection) => {
    setActiveSection(section);
    window.setTimeout(() => dashboardContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  if (loading) {
    return <div className="logs-state-card"><LoaderCircle className="logs-spin" size={20} aria-hidden /><span>Loading report activity…</span></div>;
  }

  return (
    <div className="logs-dashboard">
      {error && (
        <div className="logs-alert" role="alert">
          <AlertTriangle size={17} aria-hidden />
          <span>{error}</span>
          <button type="button" onClick={() => void fetchAdminData()}>Try again</button>
        </div>
      )}

      <nav className="admin-dashboard-nav" aria-label="Admin dashboard sections">
        {ADMIN_SECTIONS.map((section) => {
          const Icon = section.icon;
          const count = sectionCounts[section.value];
          const selected = activeSection === section.value;
          return (
            <button
              type="button"
              key={section.value}
              className={selected ? 'is-active' : ''}
              onClick={() => selectAdminSection(section.value)}
              aria-current={selected ? 'page' : undefined}
            >
              <span className="admin-dashboard-nav-icon"><Icon size={17} aria-hidden /></span>
              <span><strong>{section.label}</strong><small>{section.description}</small></span>
              <b className={section.value === 'overview' && count === 0 ? 'is-clear' : ''}>
                {section.value === 'overview' && count === 0 ? <CheckCircle2 size={14} aria-label="All clear" /> : count.toLocaleString()}
              </b>
            </button>
          );
        })}
      </nav>

      <section className="logs-dashboard-toolbar" aria-label="Admin dashboard controls">
        <div>
          <h2>{ADMIN_SECTIONS.find((section) => section.value === activeSection)?.label}</h2>
          <p>{ADMIN_SECTIONS.find((section) => section.value === activeSection)?.description}</p>
        </div>
        <div className="logs-toolbar-actions">
          <span className="logs-refresh-status" aria-live="polite">
            {refreshing ? 'Refreshing…' : lastRefreshed ? `Updated ${lastRefreshed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
          </span>
          {(activeSection === 'overview' || activeSection === 'analytics') && (
            <div className="logs-range-control" aria-label="Analytics date range">
              {ANALYTICS_RANGES.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  className={analyticsRange === option.value ? 'is-active' : ''}
                  onClick={() => setAnalyticsRange(option.value)}
                  aria-pressed={analyticsRange === option.value}
                >
                  {option.label.replace('Last ', '')}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="logs-btn logs-btn-quiet" onClick={downloadOperationsSnapshot} title="Export a JSON snapshot of current admin data">
            <FileJson size={15} aria-hidden /> Export snapshot
          </button>
          <button
            type="button"
            className={autoRefresh ? 'logs-icon-btn is-active' : 'logs-icon-btn'}
            onClick={() => setAutoRefresh((current) => !current)}
            title={autoRefresh ? 'Pause auto-refresh' : 'Resume auto-refresh'}
            aria-label={autoRefresh ? 'Pause auto-refresh' : 'Resume auto-refresh'}
            aria-pressed={autoRefresh}
          >
            {autoRefresh ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
          </button>
          <button type="button" className="logs-icon-btn" onClick={() => void fetchAdminData(true)} disabled={refreshing} title="Refresh admin data" aria-label="Refresh admin data">
            <RefreshCw className={refreshing ? 'logs-spin' : ''} size={16} aria-hidden />
          </button>
        </div>
      </section>

      <div ref={dashboardContentRef} className="admin-dashboard-content">
      {activeSection === 'overview' && (
        <header className="admin-workspace-heading">
          <div>
            <span>Today at a glance</span>
            <h2>{dashboardAttentionCount === 0 ? 'Everything looks ready' : `${dashboardAttentionCount} ${dashboardAttentionCount === 1 ? 'signal needs' : 'signals need'} attention`}</h2>
            <p>Live status and usage for {selectedRange.label.toLowerCase()}.</p>
          </div>
          <span className={dashboardAttentionCount === 0 ? 'is-clear' : 'is-attention'}>
            {dashboardAttentionCount === 0 ? <CheckCircle2 size={16} aria-hidden /> : <AlertTriangle size={16} aria-hidden />}
            {dashboardAttentionCount === 0 ? 'All systems normal' : 'Review action center'}
          </span>
        </header>
      )}

      <section className="admin-dashboard-kpis" aria-label="Dashboard summary" hidden={activeSection !== 'overview'}>
        <button type="button" onClick={() => selectAdminSection('operations')}>
          <span className={health ? 'admin-kpi-icon is-green' : 'admin-kpi-icon is-red'}><Server size={18} aria-hidden /></span>
          <span><small>Platform</small><strong>{health ? 'Online' : 'Unavailable'}</strong><em>{backendLatencyMs == null ? 'Health status' : `${formatDuration(backendLatencyMs)} response`}</em></span>
        </button>
        <button type="button" onClick={() => selectAdminSection('analytics')}>
          <span className={metrics.issues === 0 ? 'admin-kpi-icon is-green' : 'admin-kpi-icon is-amber'}><Activity size={18} aria-hidden /></span>
          <span><small>Report health</small><strong>{metrics.healthyRate == null ? '—' : `${metrics.healthyRate}%`}</strong><em>{metrics.total.toLocaleString()} reports analyzed</em></span>
        </button>
        <button type="button" onClick={() => selectAdminSection('users')}>
          <span className="admin-kpi-icon"><Users size={18} aria-hidden /></span>
          <span><small>Active accounts</small><strong>{userSummary.active.toLocaleString()}</strong><em>{userSummary.activeSessions.toLocaleString()} live sessions</em></span>
        </button>
        <button type="button" onClick={() => selectAdminSection('analytics')}>
          <span className={aiMetrics.failures === 0 ? 'admin-kpi-icon' : 'admin-kpi-icon is-amber'}><Sparkles size={18} aria-hidden /></span>
          <span><small>AI usage</small><strong>{formatEstimatedCost(aiMetrics.estimatedCostUsd)}</strong><em>{aiMetrics.calls.toLocaleString()} model calls</em></span>
        </button>
      </section>

      <section className="admin-operations-grid" aria-label="System operations" hidden={activeSection !== 'overview'}>
        <article className="logs-chart-card admin-system-card">
          <div className="logs-chart-head">
            <div>
              <h2>System snapshot</h2>
              <p>Live backend, database, runtime, and cache status</p>
            </div>
            <Server size={18} aria-hidden />
          </div>
          {healthError && <div className="logs-inline-note"><AlertTriangle size={15} aria-hidden /> {healthError}</div>}
          {systemResourcesError && <div className="logs-inline-note"><AlertTriangle size={15} aria-hidden /> {systemResourcesError}</div>}
          <div className="admin-system-grid">
            <div>
              <span><Server size={14} aria-hidden /> Service</span>
              <strong className={health ? 'is-healthy' : 'is-unavailable'}>{health ? 'Online' : 'Unavailable'}</strong>
              <small>{health ? `${health.env} · v${health.version}${backendLatencyMs == null ? '' : ` · ${formatDuration(backendLatencyMs)}`}` : 'Waiting for health data'}</small>
            </div>
            <div>
              <span><Clock3 size={14} aria-hidden /> Uptime</span>
              <strong>{formatUptime(health?.uptime)}</strong>
              <small>{health?.timestamp ? `Checked ${new Date(health.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '—'}</small>
            </div>
            <div>
              <span><Cpu size={14} aria-hidden /> Runtime</span>
              <strong>{health?.nodeVersion ?? '—'}</strong>
              <small>{health ? `${health.memory.rssMb} MB RSS · ${health.memory.heapUsedMb} MB heap` : 'Memory unavailable'}</small>
            </div>
            <div>
              <span><MemoryStick size={14} aria-hidden /> RAM</span>
              <strong>{systemResources ? `${systemResources.memory.usagePercent}% used` : '—'}</strong>
              <small>{systemResources ? `${formatBytes(systemResources.memory.usedBytes)} of ${formatBytes(systemResources.memory.totalBytes)}` : 'Usage unavailable'}</small>
            </div>
            <div>
              <span><HardDrive size={14} aria-hidden /> Disk</span>
              <strong className={systemResources && !systemResources.disk ? 'is-unavailable' : undefined}>
                {systemResources?.disk ? `${systemResources.disk.usagePercent}% used` : '—'}
              </strong>
              <small>{systemResources?.disk ? `${formatBytes(systemResources.disk.usedBytes)} of ${formatBytes(systemResources.disk.totalBytes)}` : 'Usage unavailable'}</small>
            </div>
            <div>
              <span><Database size={14} aria-hidden /> Database</span>
              <strong className={health?.database?.connected ? 'is-healthy' : health?.database?.configured ? 'is-unavailable' : undefined}>
                {!health ? '—' : health.database?.connected ? 'Connected' : health.database?.configured ? 'Unavailable' : 'Not configured'}
              </strong>
              <small>{health?.database?.latencyMs == null ? 'PostgreSQL' : `${formatDuration(health.database.latencyMs)} query latency`}</small>
            </div>
            <div>
              <span><Layers size={14} aria-hidden /> Cache</span>
              <strong>{cacheMetrics.hitRate == null ? '—' : `${cacheMetrics.hitRate}% hit rate`}</strong>
              <small>{cacheMetrics.entries.toLocaleString()} active entries</small>
            </div>
            <div>
              <span><Bot size={14} aria-hidden /> AI provider</span>
              <strong>{aiSettings?.enabled === false ? 'Stopped' : aiSettings?.provider ?? '—'}</strong>
              <small>{aiSettings ? `${aiSettings.primaryModel} · ${aiSettings.configured ? 'configured' : 'key missing'}` : 'Provider unavailable'}</small>
            </div>
          </div>
        </article>

        <article className="logs-chart-card admin-action-card">
          <div className="logs-chart-head">
            <div>
              <h2>Action center</h2>
              <p>Signals that may need investigation</p>
            </div>
            <AlertTriangle size={18} aria-hidden />
          </div>
          <div className="admin-action-list">
            <button type="button" onClick={() => showRequestFilter('issues')} disabled={metrics.issues === 0}>
              <span className="is-amber"><AlertTriangle size={15} aria-hidden /></span>
              <span><strong>Report issues</strong><small>Failed or partial responses</small></span>
              <b>{metrics.issues}</b>
            </button>
            <button type="button" onClick={() => showRequestFilter('slow')} disabled={slowReports === 0}>
              <span><Clock3 size={15} aria-hidden /></span>
              <span><strong>Slow reports</strong><small>Responses taking 10 seconds or longer</small></span>
              <b>{slowReports}</b>
            </button>
            <button
              type="button"
              onClick={showAIUsage}
              disabled={aiMetrics.failures === 0}
            >
              <span className="is-amber"><Bot size={15} aria-hidden /></span>
              <span><strong>AI failures</strong><small>Unsuccessful model calls</small></span>
              <b>{aiMetrics.failures}</b>
            </button>
            <button type="button" onClick={() => selectAdminSection('users')} disabled={userSummary.suspended === 0}>
              <span className="is-amber"><Ban size={15} aria-hidden /></span>
              <span><strong>Suspended accounts</strong><small>Users without platform access</small></span>
              <b>{userSummary.suspended}</b>
            </button>
          </div>
          {metrics.issues === 0 && slowReports === 0 && aiMetrics.failures === 0 && userSummary.suspended === 0 && (
            <p className="admin-all-clear"><CheckCircle2 size={15} aria-hidden /> No active signals in this period.</p>
          )}
        </article>
      </section>

      {activeSection === 'users' && (
        <header className="admin-workspace-heading">
          <div><span>Accounts</span><h2>Manage who can use the platform</h2><p>Find users, review access, and resolve account issues.</p></div>
          <span className="is-neutral"><Users size={16} aria-hidden /> {usersTotal.toLocaleString()} total</span>
        </header>
      )}

      <section className="logs-panel admin-users-panel" aria-labelledby="admin-users-title" hidden={activeSection !== 'users'}>
        <div className="logs-panel-head">
          <div className="admin-users-heading">
            <span className="logs-section-icon"><Users size={17} aria-hidden /></span>
            <div>
              <h2 id="admin-users-title">User management</h2>
              <p>Manage identity verification, tiers, monthly allowances, access, and active sessions</p>
            </div>
          </div>
          <span className="admin-users-total">{usersTotal.toLocaleString()} {usersTotal === 1 ? 'account' : 'accounts'}</span>
        </div>

        <div className="admin-user-summary" aria-label="Account summary">
          <article>
            <span><CircleUserRound size={15} aria-hidden /> Total accounts</span>
            <strong>{usersTotal.toLocaleString()}</strong>
          </article>
          <article>
            <span><UserCheck size={15} aria-hidden /> Active</span>
            <strong>{userSummary.active.toLocaleString()}</strong>
          </article>
          <article>
            <span><Ban size={15} aria-hidden /> Suspended</span>
            <strong>{userSummary.suspended.toLocaleString()}</strong>
          </article>
          <article>
            <span><CircleUserRound size={15} aria-hidden /> Free</span>
            <strong>{userSummary.free.toLocaleString()}</strong>
          </article>
          <article>
            <span><Crown size={15} aria-hidden /> Premium</span>
            <strong>{userSummary.premium.toLocaleString()}</strong>
          </article>
          <article>
            <span><MailCheck size={15} aria-hidden /> Verified</span>
            <strong>{userSummary.verified.toLocaleString()}</strong>
          </article>
          <article className={userSummary.unverified > 0 ? 'is-attention' : undefined}>
            <span><AlertTriangle size={15} aria-hidden /> Needs verification</span>
            <strong>{userSummary.unverified.toLocaleString()}</strong>
          </article>
          <article>
            <span><KeyRound size={15} aria-hidden /> Active sessions</span>
            <strong>{userSummary.activeSessions.toLocaleString()}</strong>
          </article>
        </div>

        <div className="admin-usage-policy">
          <div className="admin-usage-policy-copy">
            <span><Gauge size={16} aria-hidden /></span>
            <div>
              <strong>Default Free monthly allowances</strong>
              <small>{usageSettings?.persistent ? 'Saved in PostgreSQL and applied immediately' : 'Applied for this server session'}</small>
            </div>
          </div>
          <div className="admin-usage-policy-fields">
            <label className="admin-usage-limit-field">
              <span>AI</span>
              <input
                type="number"
                min="1"
                max={usageSettings?.maxMonthlyAITokenLimit ?? 100_000_000}
                step="10000"
                inputMode="numeric"
                value={usageLimitDraft}
                onChange={(event) => setUsageLimitDraft(event.target.value)}
                disabled={usageSettingsPending || !usageSettings}
                aria-label="Default Free monthly AI token limit"
              />
              <span>tokens</span>
            </label>
            <label className="admin-usage-limit-field">
              <span>Reports</span>
              <input
                type="number"
                min="1"
                max={usageSettings?.maxFreeMonthlyUsageLimit ?? 10_000}
                step="1"
                inputMode="numeric"
                value={reportLimitDraft}
                onChange={(event) => setReportLimitDraft(event.target.value)}
                disabled={usageSettingsPending || !usageSettings}
                aria-label="Default Free monthly generated report limit"
              />
            </label>
          </div>
          <div className="admin-usage-policy-actions">
            <button
              type="button"
              className="logs-btn"
              onClick={() => void updateDefaultUsageLimits()}
              disabled={usageSettingsPending || !usageSettings || (
                Number(usageLimitDraft) === usageSettings.freeMonthlyAITokenLimit
                && Number(reportLimitDraft) === usageSettings.freeMonthlyReportUsageLimit
              )}
            >
              {usageSettingsPending ? <LoaderCircle className="logs-spin" size={14} aria-hidden /> : <Gauge size={14} aria-hidden />}
              Save limits
            </button>
            <button
              type="button"
              className="logs-btn"
              onClick={() => usageSettings && void updateDefaultUsageLimits(
                usageSettings.environmentFreeMonthlyAITokenLimit,
                usageSettings.environmentFreeMonthlyReportUsageLimit,
              )}
              disabled={usageSettingsPending || !usageSettings || (
                usageSettings.freeMonthlyAITokenLimit === usageSettings.environmentFreeMonthlyAITokenLimit
                && usageSettings.freeMonthlyReportUsageLimit === usageSettings.environmentFreeMonthlyReportUsageLimit
              )}
            >
              Restore defaults
            </button>
            <button
              type="button"
              className="logs-btn"
              onClick={() => void resetAllManagedUserUsageLimits()}
              disabled={Boolean(userActionPending)}
              title="Remove every per-user override and use the default Free allowances"
            >
              {userActionPending === 'all:usage-limit-reset' ? <LoaderCircle className="logs-spin" size={14} aria-hidden /> : <Gauge size={14} aria-hidden />}
              Default all users
            </button>
            <button
              type="button"
              className="logs-btn admin-usage-reset-all"
              onClick={() => void resetAllManagedUserUsage()}
              disabled={Boolean(userActionPending)}
              title="Reset current AI and generated report usage for every account"
            >
              {userActionPending === 'all:usage-reset' ? <LoaderCircle className="logs-spin" size={14} aria-hidden /> : <RefreshCw size={14} aria-hidden />}
              Reset usage
            </button>
          </div>
          {usageSettingsError && <p className="admin-usage-policy-error" role="alert"><AlertTriangle size={14} aria-hidden /> {usageSettingsError}</p>}
        </div>

        <div className="logs-controls admin-users-controls">
          <label className="logs-search">
            <Search size={16} aria-hidden />
            <span className="sr-only">Search accounts</span>
            <input
              value={userQuery}
              onChange={(event) => setUserQuery(event.target.value)}
              placeholder="Search name, email, tier, or sign-in method…"
            />
            {userQuery && <button type="button" onClick={() => setUserQuery('')} aria-label="Clear account search"><X size={15} aria-hidden /></button>}
          </label>
          <div className="logs-filter-tabs" aria-label="Filter accounts">
            {USER_STATUS_FILTERS.map((filter) => (
              <button
                type="button"
                key={filter.value}
                className={userStatusFilter === filter.value ? 'is-active' : ''}
                onClick={() => setUserStatusFilter(filter.value)}
                aria-pressed={userStatusFilter === filter.value}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {usersError && (
          <div className="admin-users-error" role="alert">
            <AlertTriangle size={15} aria-hidden />
            <span>{usersError}</span>
            <button type="button" onClick={() => void fetchUserDirectory()}>Try again</button>
          </div>
        )}
        {usersNotice && (
          <div className="admin-users-notice" role="status">
            <MailCheck size={15} aria-hidden />
            <span>{usersNotice}</span>
            <button type="button" onClick={() => setUsersNotice(null)} aria-label="Dismiss account notice"><X size={14} aria-hidden /></button>
          </div>
        )}
        {users.length === 0 && usersError ? null : users.length === 0 ? (
          <div className="logs-empty"><Users size={26} aria-hidden /><h3>No accounts yet</h3><p>New registered accounts will appear here.</p></div>
        ) : filteredUsers.length === 0 ? (
          <div className="logs-empty"><Search size={26} aria-hidden /><h3>No matching accounts</h3><p>Try another status or search.</p><button type="button" onClick={() => { setUserQuery(''); setUserStatusFilter('all'); }}>Clear filters</button></div>
        ) : (
          <div className="admin-users-table-scroll">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Identity</th>
                  <th>Tier</th>
                  <th>Monthly usage</th>
                  <th>Recent activity</th>
                  <th>Status</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => {
                  const statusPending = userActionPending === `${user.id}:status`;
                  const sessionsPending = userActionPending === `${user.id}:sessions`;
                  const verificationPending = userActionPending === `${user.id}:verification`;
                  const tierPending = userActionPending === `${user.id}:tier`;
                  const usageLimitPending = userActionPending === `${user.id}:usage-limit`;
                  const reportUsageLimitPending = userActionPending === `${user.id}:report-usage-limit`;
                  const usageResetPending = userActionPending === `${user.id}:usage-reset`;
                  const isActive = user.status === 'active';
                  const tier = user.tier === 'premium' ? 'premium' : 'free';
                  const effectiveAIUsageLimit = tier === 'premium'
                    ? null
                    : user.aiTokenLimitOverride ?? usageSettings?.freeMonthlyAITokenLimit ?? 250_000;
                  const usageLimitDraftForUser = userUsageLimitDrafts[user.id] ?? String(effectiveAIUsageLimit ?? '');
                  const parsedUsageLimitDraft = Number(usageLimitDraftForUser);
                  const effectiveReportUsageLimit = tier === 'premium'
                    ? null
                    : user.reportUsageLimitOverride ?? usageSettings?.freeMonthlyReportUsageLimit ?? 50;
                  const reportLimitDraftForUser = userReportLimitDrafts[user.id] ?? String(effectiveReportUsageLimit ?? '');
                  const parsedReportLimitDraft = Number(reportLimitDraftForUser);
                  return (
                    <tr key={user.id}>
                      <td data-label="Account">
                        <div className="admin-user-person">
                          <span className="admin-user-avatar" aria-hidden>{accountInitials(user)}</span>
                          <div>
                            <strong>{user.displayName}</strong>
                            <small>{user.email || 'No email address'}{user.isOwner && <span className="admin-owner-badge">Owner</span>}</small>
                          </div>
                        </div>
                      </td>
                      <td data-label="Identity">
                        <span className="admin-user-primary">{(user.authMethods?.length ? user.authMethods : [user.authProvider]).map((method) => method === 'password' ? 'Email & password' : method.replaceAll('-', ' ')).join(' + ')}</span>
                        <small className={`admin-user-verification is-${user.emailVerified ? 'verified' : 'unverified'}`}>
                          {user.emailVerified ? <MailCheck size={11} aria-hidden /> : <AlertTriangle size={11} aria-hidden />}
                          {user.emailVerified ? 'Verified email' : 'Email not verified'}
                        </small>
                        <small>{user.activeSessions.toLocaleString()} active {user.activeSessions === 1 ? 'session' : 'sessions'}</small>
                      </td>
                      <td data-label="Tier">
                        <label className={`admin-user-tier is-${tier}`}>
                          {tier === 'premium' ? <Crown size={13} aria-hidden /> : <CircleUserRound size={13} aria-hidden />}
                          <span className="sr-only">Change {user.displayName} tier</span>
                          <select
                            value={tier}
                            onChange={(event) => void updateManagedUserTier(user, event.target.value as 'free' | 'premium')}
                            disabled={Boolean(userActionPending)}
                            aria-label={`Change ${user.displayName} tier`}
                          >
                            <option value="free">Free</option>
                            <option value="premium">Premium</option>
                          </select>
                          {tierPending && <LoaderCircle className="logs-spin" size={13} aria-label="Saving tier" />}
                        </label>
                      </td>
                      <td data-label="Monthly usage">
                        <div className="admin-user-usage">
                          <div className="admin-user-usage-metrics">
                            <span><strong>AI</strong> {formatTokenCount(user.aiTokens)}{effectiveAIUsageLimit === null ? ' tokens' : ` / ${formatTokenCount(effectiveAIUsageLimit)}`}</span>
                            <span><strong>Reports</strong> {user.savedReports.toLocaleString()}{effectiveReportUsageLimit === null ? ' generated' : ` / ${effectiveReportUsageLimit.toLocaleString()}`}</span>
                          </div>
                          {tier === 'premium' ? (
                            <small><Crown size={11} aria-hidden /> Unlimited on Premium</small>
                          ) : (
                            <div className="admin-user-quota-controls">
                              <div className="admin-user-quota-row">
                                <span>AI</span>
                                <div className="admin-user-limit-controls">
                                  <input
                                    type="number"
                                    min="1"
                                    max={usageSettings?.maxMonthlyAITokenLimit ?? 100_000_000}
                                    step="10000"
                                    inputMode="numeric"
                                    value={usageLimitDraftForUser}
                                    onChange={(event) => setUserUsageLimitDrafts((current) => ({ ...current, [user.id]: event.target.value }))}
                                    disabled={Boolean(userActionPending)}
                                    aria-label={`${user.displayName} monthly AI token limit`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => void updateManagedUserUsageLimit(user, parsedUsageLimitDraft)}
                                    disabled={Boolean(userActionPending) || !Number.isFinite(parsedUsageLimitDraft) || parsedUsageLimitDraft <= 0 || parsedUsageLimitDraft === effectiveAIUsageLimit}
                                  >
                                    {usageLimitPending ? <LoaderCircle className="logs-spin" size={12} aria-hidden /> : 'Set'}
                                  </button>
                                  {user.aiTokenLimitOverride != null && (
                                    <button
                                      type="button"
                                      onClick={() => void updateManagedUserUsageLimit(user, null)}
                                      disabled={Boolean(userActionPending)}
                                      title="Use the default Free AI token limit"
                                    >
                                      Default
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div className="admin-user-quota-row">
                                <span>Reports</span>
                                <div className="admin-user-limit-controls">
                                  <input
                                    type="number"
                                    min="1"
                                    max={usageSettings?.maxFreeMonthlyUsageLimit ?? 10_000}
                                    step="1"
                                    inputMode="numeric"
                                    value={reportLimitDraftForUser}
                                    onChange={(event) => setUserReportLimitDrafts((current) => ({ ...current, [user.id]: event.target.value }))}
                                    disabled={Boolean(userActionPending)}
                                    aria-label={`${user.displayName} monthly generated report limit`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => void updateManagedUserReportUsageLimit(user, parsedReportLimitDraft)}
                                    disabled={Boolean(userActionPending) || !Number.isFinite(parsedReportLimitDraft) || parsedReportLimitDraft <= 0 || parsedReportLimitDraft === effectiveReportUsageLimit}
                                  >
                                    {reportUsageLimitPending ? <LoaderCircle className="logs-spin" size={12} aria-hidden /> : 'Set'}
                                  </button>
                                  {user.reportUsageLimitOverride != null && (
                                    <button
                                      type="button"
                                      onClick={() => void updateManagedUserReportUsageLimit(user, null)}
                                      disabled={Boolean(userActionPending)}
                                      title="Use the default Free generated report limit"
                                    >
                                      Default
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                          <div className="admin-user-usage-foot">
                            <small>
                              {formatTokenCount(user.aiTokens)} AI tokens
                              {(user.aiTokenLimitOverride != null || user.reportUsageLimitOverride != null) && tier !== 'premium' ? ' · Custom limits' : ''}
                            </small>
                            <button
                              type="button"
                              className="logs-icon-btn"
                              onClick={() => void resetManagedUserUsage(user)}
                              disabled={Boolean(userActionPending) || (user.aiTokens === 0 && user.savedReports === 0)}
                              title={user.aiTokens === 0 && user.savedReports === 0 ? 'Usage is already at zero' : 'Reset current-month AI and generated report usage'}
                              aria-label={`Reset ${user.displayName} current-month AI and report usage`}
                            >
                              {usageResetPending ? <LoaderCircle className="logs-spin" size={13} aria-hidden /> : <RefreshCw size={13} aria-hidden />}
                            </button>
                          </div>
                        </div>
                      </td>
                      <td data-label="Recent activity">
                        <span className="admin-user-primary" title={user.lastActivityAt ? new Date(user.lastActivityAt).toLocaleString() : undefined}>{formatAccountDate(user.lastActivityAt)}</span>
                        <small>Joined {new Date(user.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</small>
                      </td>
                      <td data-label="Status">
                        <span className={`admin-user-status is-${isActive ? 'active' : 'suspended'}`}><span aria-hidden />{isActive ? 'Active' : 'Suspended'}</span>
                      </td>
                      <td data-label="Actions">
                        <div className="admin-user-actions">
                          {!user.emailVerified && (
                            <button
                              type="button"
                              className="logs-icon-btn admin-user-verify"
                              onClick={() => void sendManagedUserVerification(user)}
                              disabled={Boolean(userActionPending) || user.status !== 'active' || !user.email}
                              title={user.status !== 'active' ? 'Reactivate this account before sending email' : 'Send a new verification email'}
                              aria-label={`Send ${user.displayName} a verification email`}
                            >
                              {verificationPending ? <LoaderCircle className="logs-spin" size={14} aria-hidden /> : <Send size={14} aria-hidden />}
                            </button>
                          )}
                          {user.isOwner ? (
                            <span className="admin-user-protected"><ShieldCheck size={14} aria-hidden /> Protected</span>
                          ) : (
                            <>
                            <button
                              type="button"
                              className={isActive ? 'logs-btn admin-user-suspend' : 'logs-btn admin-user-reactivate'}
                              onClick={() => void updateManagedUserStatus(user, isActive ? 'suspended' : 'active')}
                              disabled={Boolean(userActionPending)}
                            >
                              {isActive ? <Ban size={14} aria-hidden /> : <UserCheck size={14} aria-hidden />}
                              {statusPending ? 'Saving…' : isActive ? 'Suspend' : 'Reactivate'}
                            </button>
                            <button
                              type="button"
                              className="logs-icon-btn"
                              onClick={() => void revokeManagedUserSessions(user)}
                              disabled={Boolean(userActionPending) || user.activeSessions === 0}
                              title={user.activeSessions === 0 ? 'No active sessions' : 'Sign out all active sessions'}
                              aria-label={`Sign ${user.displayName} out of all sessions`}
                            >
                              {sessionsPending ? <LoaderCircle className="logs-spin" size={14} aria-hidden /> : <LogOut size={14} aria-hidden />}
                            </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <footer className="logs-panel-foot">
          <span>Showing {filteredUsers.length.toLocaleString()} of {users.length.toLocaleString()} loaded accounts</span>
          <span>Verification emails expire after 24 hours · tier and limit changes apply immediately</span>
        </footer>
      </section>

      {activeSection === 'operations' && (
        <header className="admin-workspace-heading">
          <div><span>Operations</span><h2>Services and product controls</h2><p>Diagnose providers, configure AI, and manage feature availability.</p></div>
          <span className={diagnosticSummary.failed === 0 ? 'is-clear' : 'is-attention'}>
            {diagnosticSummary.failed === 0 ? <CheckCircle2 size={16} aria-hidden /> : <AlertTriangle size={16} aria-hidden />}
            {diagnosticSummary.failed === 0 ? 'Core services ready' : `${diagnosticSummary.failed} failed`}
          </span>
        </header>
      )}

      <section className="logs-chart-card admin-diagnostics-card" aria-labelledby="admin-diagnostics-title" hidden={activeSection !== 'operations'}>
        <div className="logs-chart-head">
          <div>
            <h2 id="admin-diagnostics-title">Service diagnostics</h2>
            <p>Check the backend server, PostgreSQL database, and all upstream data providers</p>
          </div>
          <button
            type="button"
            className="logs-btn logs-btn-primary"
            onClick={() => void runServiceDiagnostics()}
            disabled={diagnosticsPending}
          >
            <RefreshCw className={diagnosticsPending ? 'logs-spin' : ''} size={15} aria-hidden />
            {diagnosticsPending ? 'Running…' : diagnostics ? 'Run again' : 'Run all diagnostics'}
          </button>
        </div>

        {diagnosticsError && (
          <div className="logs-inline-note" role="alert"><AlertTriangle size={15} aria-hidden /> {diagnosticsError}</div>
        )}

        {diagnostics ? (
          <>
            <div className="admin-diagnostics-summary" aria-label="Diagnostic summary">
              <span className="is-operational"><CheckCircle2 size={14} aria-hidden /><strong>{diagnosticSummary.operational}</strong> operational</span>
              <span className={diagnosticSummary.failed ? 'is-failed' : ''}><AlertTriangle size={14} aria-hidden /><strong>{diagnosticSummary.failed}</strong> failed</span>
              <span><KeyRound size={14} aria-hidden /><strong>{diagnosticSummary.notConfigured}</strong> not configured</span>
              <small>Completed in {formatDuration(diagnostics.durationMs)} at {new Date(diagnostics.completedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small>
            </div>
            <div className="admin-diagnostics-grid">
              {diagnosticServices.map((service) => (
                <article key={service.id} className={`admin-diagnostic-row is-${service.status.replace('_', '-')}`}>
                  <span className="admin-diagnostic-indicator" aria-hidden />
                  <div>
                    <strong>{service.name}</strong>
                    <small>{service.category}</small>
                  </div>
                  <div className="admin-diagnostic-result">
                    <strong>{service.status === 'operational' ? 'Operational' : service.status === 'failed' ? 'Failed' : 'Not configured'}</strong>
                    <small>{service.latencyMs == null ? service.message : `${formatDuration(service.latencyMs)} · ${service.httpStatus == null ? service.message : `HTTP ${service.httpStatus}`}`}</small>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="admin-diagnostics-summary" aria-label="Infrastructure diagnostic summary">
              <span className="is-operational"><CheckCircle2 size={14} aria-hidden /><strong>{diagnosticSummary.operational}</strong> operational</span>
              <span className={diagnosticSummary.failed ? 'is-failed' : ''}><AlertTriangle size={14} aria-hidden /><strong>{diagnosticSummary.failed}</strong> failed</span>
              <span><KeyRound size={14} aria-hidden /><strong>{diagnosticSummary.notConfigured}</strong> not configured</span>
              <small>{health?.timestamp ? `Checked ${new Date(health.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Waiting for a server response'}</small>
            </div>
            <div className="admin-diagnostics-grid">
              {infrastructureDiagnostics.map((service) => (
                <article key={service.id} className={`admin-diagnostic-row is-${service.status.replace('_', '-')}`}>
                  <span className="admin-diagnostic-indicator" aria-hidden />
                  <div>
                    <strong>{service.name}</strong>
                    <small>{service.category}</small>
                  </div>
                  <div className="admin-diagnostic-result">
                    <strong>{service.status === 'operational' ? 'Operational' : service.status === 'failed' ? 'Failed' : 'Not configured'}</strong>
                    <small>{service.latencyMs == null ? service.message : `${formatDuration(service.latencyMs)} · ${service.httpStatus == null ? service.message : `HTTP ${service.httpStatus}`}`}</small>
                  </div>
                </article>
              ))}
            </div>
            {!diagnosticsPending && !diagnosticsError && (
              <p className="admin-diagnostics-empty"><Activity size={16} aria-hidden /> Run all diagnostics to add live upstream provider checks.</p>
            )}
          </>
        )}
      </section>

      <section className="logs-panel admin-health-history-panel" aria-labelledby="admin-health-history-title" hidden={activeSection !== 'operations'}>
        <div className="logs-panel-head">
          <div className="admin-audit-heading">
            <span className="logs-section-icon"><History size={17} aria-hidden /></span>
            <div>
              <h2 id="admin-health-history-title">Automated health checks</h2>
              <p>Persistent checks from the production monitor, including alert and recovery activity</p>
            </div>
          </div>
          <div className="admin-health-history-summary" aria-label="Automated health-check summary">
            <span className="is-healthy"><CheckCircle2 size={13} aria-hidden /> {healthHistory?.summary.healthy.toLocaleString() ?? 0} healthy</span>
            <span className={healthHistory?.summary.unhealthy ? 'is-unhealthy' : undefined}><AlertTriangle size={13} aria-hidden /> {healthHistory?.summary.unhealthy.toLocaleString() ?? 0} unhealthy</span>
            <strong>{healthHistory?.summary.availabilityPercent == null ? '—' : `${healthHistory.summary.availabilityPercent}%`} availability</strong>
          </div>
        </div>
        {healthHistoryError && <div className="admin-audit-error" role="alert"><AlertTriangle size={15} aria-hidden /> {healthHistoryError}</div>}
        {!healthHistoryError && (
          !healthHistory || healthHistory.entries.length === 0 ? (
            <div className="logs-empty"><Activity size={26} aria-hidden /><h3>No automated checks logged yet</h3><p>History appears after the production health-monitor worker completes its next interval.</p></div>
          ) : (
            <ol className="admin-health-history-list">
              {healthHistory.entries.slice(0, 50).map((entry) => {
                const time = formatLogTime(entry.checkedAt);
                return (
                  <li key={`${entry.checkedAt}-${entry.action}`} className={entry.healthy ? 'is-healthy' : 'is-unhealthy'}>
                    <span className="admin-health-history-indicator" aria-hidden />
                    <time dateTime={entry.checkedAt}><strong>{time.primary}</strong><small>{time.secondary}</small></time>
                    <span className="admin-health-history-status">{entry.healthy ? 'Healthy' : 'Unhealthy'}</span>
                    <span className="admin-health-history-detail"><strong>{entry.summary}</strong><small>{entry.statusCode == null ? 'No HTTP response' : `HTTP ${entry.statusCode}`} · {formatDuration(entry.durationMs)}</small></span>
                    <span className="admin-health-history-action"><BellRing size={13} aria-hidden /> {entry.alertError || formatHealthMonitorAction(entry.action)}</span>
                  </li>
                );
              })}
            </ol>
          )
        )}
        {healthHistory && healthHistory.entries.length > 50 && (
          <footer className="logs-panel-foot"><span>Showing the latest 50 of {healthHistory.summary.total.toLocaleString()} retained checks</span><span>Seven days retained at the default interval</span></footer>
        )}
      </section>

      {activeSection === 'activity' && (
        <header className="admin-workspace-heading">
          <div><span>Audit trail</span><h2>Recent administrative activity</h2><p>Review account, configuration, maintenance, and diagnostic changes.</p></div>
          <span className="is-neutral"><History size={16} aria-hidden /> {auditEntries.length.toLocaleString()} events</span>
        </header>
      )}

      <section className="logs-panel admin-audit-panel" aria-labelledby="admin-audit-title" hidden={activeSection !== 'activity'}>
        <div className="logs-panel-head">
          <div className="admin-audit-heading">
            <span className="logs-section-icon"><History size={17} aria-hidden /></span>
            <div>
              <h2 id="admin-audit-title">Administrative activity</h2>
              <p>Protected record of configuration changes, maintenance actions, and diagnostic runs</p>
            </div>
          </div>
          <div className="logs-panel-actions">
            <button
              type="button"
              className="logs-btn logs-btn-quiet"
              onClick={() => triggerCsvDownload(
                `admin-activity-${new Date().toISOString().slice(0, 10)}.csv`,
                ['timestamp', 'category', 'status', 'action', 'summary', 'actorNetwork'],
                filteredAuditEntries.map((entry) => [entry.timestamp, entry.category, entry.status, entry.action, entry.summary, entry.actorNetwork]),
              )}
              disabled={filteredAuditEntries.length === 0}
            >
              <Download size={15} aria-hidden /> Export activity
            </button>
          </div>
        </div>
        <div className="logs-controls admin-audit-controls">
          <label className="logs-search">
            <Search size={16} aria-hidden />
            <span className="sr-only">Search administrative activity</span>
            <input value={auditQuery} onChange={(event) => setAuditQuery(event.target.value)} placeholder="Search changes, actions, or network…" />
            {auditQuery && <button type="button" onClick={() => setAuditQuery('')} aria-label="Clear activity search"><X size={15} aria-hidden /></button>}
          </label>
          <div className="logs-filter-tabs" aria-label="Filter administrative activity">
            {AUDIT_FILTERS.map((filter) => (
              <button
                type="button"
                key={filter.value}
                className={auditFilter === filter.value ? 'is-active' : ''}
                onClick={() => setAuditFilter(filter.value)}
                aria-pressed={auditFilter === filter.value}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
        {auditError && <div className="admin-audit-error" role="alert"><AlertTriangle size={15} aria-hidden /> {auditError}</div>}
        {auditEntries.length === 0 ? (
          <div className="logs-empty"><History size={26} aria-hidden /><h3>No administrative activity yet</h3><p>New changes and maintenance actions will appear here.</p></div>
        ) : filteredAuditEntries.length === 0 ? (
          <div className="logs-empty"><Search size={26} aria-hidden /><h3>No matching activity</h3><p>Try another activity type or search.</p><button type="button" onClick={() => { setAuditQuery(''); setAuditFilter('all'); }}>Clear filters</button></div>
        ) : (
          <ol className="admin-audit-list">
            {filteredAuditEntries.slice(0, 100).map((entry, index) => {
              const time = formatLogTime(entry.timestamp);
              return (
                <li key={`${entry.timestamp}-${entry.action}-${index}`} className={entry.status === 'error' ? 'is-error' : ''}>
                  <span className="admin-audit-marker" aria-hidden>{entry.status === 'error' ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}</span>
                  <div className="admin-audit-copy">
                    <div><strong>{entry.summary}</strong><span>{entry.category}</span></div>
                    <small>{entry.action.replaceAll('.', ' ')}{entry.actorNetwork ? ` · ${entry.actorNetwork}` : ''}</small>
                  </div>
                  <time dateTime={entry.timestamp}><strong>{time.primary}</strong><span>{time.secondary}</span></time>
                </li>
              );
            })}
          </ol>
        )}
        <footer className="logs-panel-foot">
          <span>Showing {Math.min(filteredAuditEntries.length, 100)} of {filteredAuditEntries.length} matching events</span>
          <span>Retained for up to 30 days</span>
        </footer>
      </section>

      <section className="logs-chart-card admin-ai-controls" aria-labelledby="admin-ai-controls-title" hidden={activeSection !== 'operations'}>
        <div className="logs-chart-head">
          <div>
            <h2 id="admin-ai-controls-title">AI controls</h2>
            <p>{aiSettings?.persistent === false
              ? 'Changes apply immediately but persistence is unavailable in this environment'
              : 'Changes apply immediately and persist across backend restarts'}</p>
          </div>
          <div className="admin-ai-head-actions">
            <button
              type="button"
              className="logs-icon-btn"
              onClick={() => void refreshModelCatalog()}
              disabled={aiModelCatalogPending}
              title="Fetch the latest provider model lists"
              aria-label="Refresh AI model lists"
            >
              <RefreshCw size={15} className={aiModelCatalogPending ? 'is-spinning' : ''} aria-hidden />
            </button>
            <span className={aiSettings?.enabled ? 'admin-ai-status is-enabled' : 'admin-ai-status is-stopped'}>
              <span aria-hidden /> {aiSettings ? (aiSettings.enabled ? 'AI enabled' : 'AI stopped') : 'Status unavailable'}
            </span>
          </div>
        </div>

        {aiSettingsError && <div className="logs-inline-note"><AlertTriangle size={15} aria-hidden /> {aiSettingsError}</div>}
        {aiModelCatalogError && <div className="logs-inline-note"><AlertTriangle size={15} aria-hidden /> {aiModelCatalogError}</div>}

        <div className="admin-ai-control-grid">
          <div className="admin-ai-setting">
            <span className="admin-ai-setting-icon"><Power size={18} aria-hidden /></span>
            <div>
              <strong>AI feature kill switch</strong>
              <p>{aiSettings?.enabled ? 'AI briefs, chat, AI-assisted route analysis, and vision features can make model calls.' : 'All model calls and individual AI feature flags are switched off.'}</p>
            </div>
            <button
              type="button"
              className={aiSettings?.enabled ? 'admin-kill-switch is-enabled' : 'admin-kill-switch is-stopped'}
              onClick={toggleAIEnabled}
              disabled={!aiSettings || aiSettingsPending}
              role="switch"
              aria-checked={aiSettings?.enabled ?? false}
            >
              {aiSettingsPending ? 'Saving…' : aiSettings?.enabled ? 'Stop AI' : 'Enable AI'}
            </button>
          </div>

          <div className="admin-ai-setting admin-provider-setting">
            <span className="admin-ai-setting-icon"><Bot size={18} aria-hidden /></span>
            <div>
              <strong>Preferred provider</strong>
              <p>New requests use this provider first and retain the other configured provider as fallback.</p>
            </div>
            <div className="admin-provider-options" role="radiogroup" aria-label="Preferred AI provider">
              {(['openai', 'anthropic'] as const).map((provider) => {
                const providerConfig = aiSettings?.providers[provider];
                const selected = aiSettings?.provider === provider;
                return (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={selected ? 'is-selected' : ''}
                    key={provider}
                    disabled={!providerConfig?.configured || aiSettingsPending}
                    onClick={() => void updateAIControl({ provider })}
                    title={providerConfig?.configured ? `Use ${provider}` : `${provider} key is not configured`}
                  >
                    <span>{provider === 'openai' ? 'OpenAI' : 'Anthropic'}</span>
                    <small>{providerConfig?.configured ? providerConfig.primary : 'Key not configured'}</small>
                  </button>
                );
              })}
            </div>
          </div>

          {(['openai', 'anthropic'] as const).map((provider) => {
            const providerConfig = aiSettings?.providers[provider];
            const draft = modelDrafts[provider];
            const changed = Boolean(providerConfig)
              && (draft.primary.trim() !== providerConfig?.primary || draft.fast.trim() !== providerConfig?.fast);
            const providerLabel = provider === 'openai' ? 'OpenAI models' : 'Claude models';
            const catalogProvider = aiModelCatalog?.providers?.[provider];
            const modelOptions = Array.from(new Set([
              ...(catalogProvider?.models ?? []),
              ...(providerConfig?.options ?? []),
              providerConfig?.primary,
              providerConfig?.fast,
            ].filter((model): model is string => Boolean(model)))).sort((left, right) => left.localeCompare(right));
            return (
              <div className="admin-model-card" key={`${provider}-models`}>
                <div className="admin-model-card-head">
                  <span className="admin-ai-setting-icon"><Cpu size={18} aria-hidden /></span>
                  <div>
                    <strong>{providerLabel}</strong>
                    <p>Choose the primary model for deeper work and the fast model for latency-sensitive requests.</p>
                  </div>
                  <span className={providerConfig?.configured ? 'is-configured' : ''}>
                    {providerConfig?.configured
                      ? `${modelOptions.length.toLocaleString()} ${catalogProvider?.source === 'provider' ? 'available' : 'configured'}`
                      : 'API key missing'}
                  </span>
                </div>
                <div className="admin-model-fields">
                  <label>
                    <span>Primary model</span>
                    <select
                      value={draft.primary}
                      onChange={(event) => setModelDrafts((current) => ({
                        ...current,
                        [provider]: { ...current[provider], primary: event.target.value },
                      }))}
                      disabled={!providerConfig || aiSettingsPending}
                      aria-label={`${providerLabel} primary model`}
                    >
                      {modelOptions.map((model) => <option value={model} key={model}>{model}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Fast model</span>
                    <select
                      value={draft.fast}
                      onChange={(event) => setModelDrafts((current) => ({
                        ...current,
                        [provider]: { ...current[provider], fast: event.target.value },
                      }))}
                      disabled={!providerConfig || aiSettingsPending}
                      aria-label={`${providerLabel} fast model`}
                    >
                      {modelOptions.map((model) => <option value={model} key={model}>{model}</option>)}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="logs-btn logs-btn-primary"
                    onClick={() => void saveProviderModels(provider)}
                    disabled={!changed || !draft.primary.trim() || !draft.fast.trim() || aiSettingsPending}
                  >
                    {aiSettingsPending ? 'Saving…' : 'Save models'}
                  </button>
                </div>
                {catalogProvider?.error && (
                  <p className="admin-model-catalog-note"><AlertTriangle size={13} aria-hidden /> {catalogProvider.error}; showing configured models.</p>
                )}
              </div>
            );
          })}

          {AI_FEATURE_CONTROLS.map((feature) => {
            const featureSettings = aiSettings?.features?.[feature.key];
            const enabled = featureSettings?.enabled ?? false;
            const Icon = feature.icon;
            return (
              <div className="admin-ai-setting" key={feature.key}>
                <span className="admin-ai-setting-icon"><Icon size={18} aria-hidden /></span>
                <div>
                  <strong>{feature.label}</strong>
                  <p>{feature.description}</p>
                </div>
                <button
                  type="button"
                  className={enabled ? 'admin-kill-switch is-enabled' : 'admin-kill-switch is-stopped'}
                  onClick={() => toggleAIFeature(feature.key)}
                  disabled={!featureSettings || !aiSettings?.enabled || aiSettingsPending}
                  role="switch"
                  aria-checked={enabled}
                  aria-label={`${enabled ? 'Disable' : 'Enable'} ${feature.label}`}
                >
                  {aiSettingsPending ? 'Saving…' : enabled ? 'Disable' : aiSettings?.enabled ? 'Enable' : 'Off'}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="logs-chart-card admin-runtime-environment" aria-labelledby="admin-runtime-environment-title" hidden={activeSection !== 'operations'}>
        <div className="logs-chart-head">
          <div>
            <h2 id="admin-runtime-environment-title">Runtime environment</h2>
            <p>View deployment values and save persistent backend overrides. Restarting applies saved overrides, but does not reread the host .env file.</p>
          </div>
          <div className="admin-runtime-head-actions">
            <span className="admin-runtime-restart"><RefreshCw size={13} aria-hidden /> Restart required after changes</span>
            <button
              type="button"
              className="logs-btn admin-runtime-restart-button"
              onClick={() => void restartBackend()}
              disabled={!backendRestartStatus?.available || backendRestartStatus.scheduled || backendRestartPending}
              title={backendRestartStatus?.reason ?? 'Gracefully restart the Docker-managed backend'}
            >
              <RefreshCw className={backendRestartPending ? 'logs-spin' : ''} size={14} aria-hidden />
              {backendRestartPending ? 'Restarting…' : backendRestartStatus?.scheduled ? 'Restart scheduled' : backendRestartStatus?.available ? 'Restart backend' : 'Restart unavailable'}
            </button>
          </div>
        </div>

        {runtimeEnvironmentError && <div className="logs-inline-note" role="alert"><AlertTriangle size={15} aria-hidden /> {runtimeEnvironmentError}</div>}
        {runtimeEnvironmentNotice && <div className="logs-inline-note is-success" role="status"><CheckCircle2 size={15} aria-hidden /> {runtimeEnvironmentNotice}</div>}

        {runtimeEnvironmentGroups.length === 0 && !runtimeEnvironmentError ? (
          <div className="logs-empty"><Server size={26} aria-hidden /><h3>No runtime variables available</h3><p>The backend did not return any editable environment settings.</p></div>
        ) : (
          <div className="admin-runtime-groups">
            {runtimeEnvironmentGroups.map(([category, entries]) => (
              <section className="admin-runtime-group" aria-labelledby={`admin-runtime-${category.replaceAll(' ', '-').toLowerCase()}`} key={category}>
                <div className="admin-runtime-group-head">
                  <h3 id={`admin-runtime-${category.replaceAll(' ', '-').toLowerCase()}`}>{category}</h3>
                  <span>{entries.length} {entries.length === 1 ? 'variable' : 'variables'}</span>
                </div>
                <div className="admin-runtime-list">
                  {entries.map((entry) => {
                    const draft = runtimeEnvironmentDrafts[entry.key] ?? '';
                    const unchanged = !entry.secret && draft.trim() === (entry.value ?? '');
                    const pending = runtimeEnvironmentPendingKey === entry.key;
                    const inputId = `runtime-env-${entry.key.toLowerCase().replaceAll('_', '-')}`;
                    return (
                      <article className="admin-runtime-entry" key={entry.key}>
                        <div className="admin-runtime-entry-copy">
                          <label htmlFor={inputId}>{entry.label}</label>
                          <code>{entry.key}</code>
                          <p>{entry.description}</p>
                          <span className={entry.overridden ? 'is-override' : ''}>{entry.source}</span>
                        </div>
                        <div className="admin-runtime-field">
                          {entry.type === 'boolean' || entry.type === 'enum' ? (
                            <select
                              id={inputId}
                              value={draft}
                              onChange={(event) => setRuntimeEnvironmentDrafts((current) => ({ ...current, [entry.key]: event.target.value }))}
                              disabled={runtimeEnvironmentPendingKey !== null}
                            >
                              {!draft && <option value="">Choose a value</option>}
                              {(entry.type === 'boolean' ? ['true', 'false'] : entry.options ?? []).map((option) => (
                                <option value={option} key={option}>{option}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              id={inputId}
                              type={entry.secret ? 'password' : entry.type === 'integer' ? 'number' : entry.type === 'url' ? 'url' : 'text'}
                              value={draft}
                              min={entry.min ?? undefined}
                              max={entry.max ?? undefined}
                              autoComplete={entry.secret ? 'new-password' : 'off'}
                              placeholder={entry.secret
                                ? entry.configured ? 'Configured — enter a replacement' : 'Not configured — enter a value'
                                : 'Not configured'}
                              onChange={(event) => setRuntimeEnvironmentDrafts((current) => ({ ...current, [entry.key]: event.target.value }))}
                              disabled={runtimeEnvironmentPendingKey !== null}
                            />
                          )}
                          <div className="admin-runtime-actions">
                            <button
                              type="button"
                              className="logs-btn logs-btn-primary"
                              onClick={() => void updateRuntimeEnvironmentEntry(entry)}
                              disabled={runtimeEnvironmentPendingKey !== null || !draft.trim() || unchanged}
                            >
                              {pending ? 'Saving…' : entry.secret && entry.configured ? 'Replace' : 'Save'}
                            </button>
                            {entry.overridden && (
                              <button
                                type="button"
                                className="logs-btn logs-btn-quiet"
                                onClick={() => void updateRuntimeEnvironmentEntry(entry, true)}
                                disabled={runtimeEnvironmentPendingKey !== null}
                              >
                                Reset
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>

      <section className="logs-chart-card admin-ai-controls" aria-labelledby="admin-feature-flags-title" hidden={activeSection !== 'operations'}>
        <div className="logs-chart-head">
          <div>
            <h2 id="admin-feature-flags-title">Product feature flags</h2>
            <p>{featureFlagStatus?.persistent === false
              ? 'Changes apply immediately but persistence is unavailable in this environment'
              : 'Changes apply immediately and persist across backend restarts'}</p>
          </div>
        </div>

        {featureFlagsError && <div className="logs-inline-note"><AlertTriangle size={15} aria-hidden /> {featureFlagsError}</div>}

        <div className="admin-ai-control-grid">
          {PRODUCT_FEATURE_CONTROLS.map((feature) => {
            const enabled = featureFlagStatus?.flags[feature.key] ?? false;
            const Icon = feature.icon;
            return (
              <div className="admin-ai-setting" key={feature.key}>
                <span className="admin-ai-setting-icon"><Icon size={18} aria-hidden /></span>
                <div>
                  <strong>{feature.label}</strong>
                  <p>{feature.description}</p>
                </div>
                <button
                  type="button"
                  className={enabled ? 'admin-kill-switch is-enabled' : 'admin-kill-switch is-stopped'}
                  onClick={() => void toggleProductFeature(feature.key)}
                  disabled={!featureFlagStatus || featureFlagsPending}
                  role="switch"
                  aria-checked={enabled}
                  aria-label={`${enabled ? 'Disable' : 'Enable'} ${feature.label}`}
                >
                  {featureFlagsPending ? 'Saving…' : enabled ? 'Disable' : 'Enable'}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {activeSection === 'analytics' && (
        <header className="admin-workspace-heading">
          <div><span>Analytics</span><h2>Reports and AI usage</h2><p>Understand demand, reliability, speed, and model cost for {selectedRange.label.toLowerCase()}.</p></div>
          <span className={metrics.issues === 0 ? 'is-clear' : 'is-attention'}>
            {metrics.issues === 0 ? <CheckCircle2 size={16} aria-hidden /> : <AlertTriangle size={16} aria-hidden />}
            {metrics.issues === 0 ? 'Reports healthy' : `${metrics.issues} report issues`}
          </span>
        </header>
      )}

      <section className="logs-metrics" aria-label="Report analytics summary" hidden={activeSection !== 'analytics'}>
        <article className="logs-metric-card">
          <span className="logs-metric-icon"><Activity size={18} aria-hidden /></span>
          <div>
            <strong>{metrics.total.toLocaleString()}</strong>
            <span>Total reports{metrics.volumeDelta != null ? ` · ${metrics.volumeDelta >= 0 ? '+' : ''}${metrics.volumeDelta}% vs prior period` : ''}{metrics.reportsPerNetwork != null ? ` · ${metrics.reportsPerNetwork.toFixed(1)} per network` : ''}</span>
          </div>
        </article>
        <article className="logs-metric-card">
          <span className="logs-metric-icon is-green"><CheckCircle2 size={18} aria-hidden /></span>
          <div><strong>{metrics.healthyRate == null ? '—' : `${metrics.healthyRate}%`}</strong><span>Fully healthy{metrics.healthyRateDelta != null ? ` · ${metrics.healthyRateDelta >= 0 ? '+' : ''}${metrics.healthyRateDelta} pts` : ''}</span></div>
        </article>
        <article className="logs-metric-card">
          <span className="logs-metric-icon"><Gauge size={18} aria-hidden /></span>
          <div><strong>{formatDuration(metrics.p95Duration)}</strong><span>P95 response · median {formatDuration(metrics.medianDuration)}{metrics.p95DurationDelta != null ? ` · ${formatDuration(Math.abs(metrics.p95DurationDelta))} ${metrics.p95DurationDelta <= 0 ? 'faster' : 'slower'}` : ''}</span></div>
        </article>
        <article className="logs-metric-card">
          <span className="logs-metric-icon"><Users size={18} aria-hidden /></span>
          <div><strong>{metrics.uniqueVisitors}</strong><span>Masked networks{metrics.repeatNetworkRate != null ? ` · ${metrics.repeatNetworkRate}% generated 2+ reports` : ''}</span></div>
        </article>
        <article className="logs-metric-card">
          <span className="logs-metric-icon is-amber"><AlertTriangle size={18} aria-hidden /></span>
          <div><strong>{metrics.issues}</strong><span>Partial or failed responses</span></div>
        </article>
      </section>

      <section className="logs-analytics-grid" aria-label="Report activity charts" hidden={activeSection !== 'analytics'}>
        <article className="logs-chart-card logs-chart-card-wide">
          <div className="logs-chart-head">
            <div>
              <h2>Request health over time</h2>
              <p>Report volume by response outcome · {selectedRange.bucketLabel} intervals</p>
            </div>
            <Activity size={18} aria-hidden />
          </div>
          <div className="logs-chart-wrap">
            {activeSection === 'analytics' && <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 500, height: 238 }}>
              <BarChart data={trendData} margin={{ top: 8, right: 6, bottom: 0, left: -18 }}>
                <CartesianGrid vertical={false} stroke="var(--ui-line)" strokeDasharray="3 3" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={28} tick={{ fill: 'var(--ui-text-4)', fontSize: 10 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: 'var(--ui-text-4)', fontSize: 10 }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: 'var(--ui-surface-subtle)' }} />
                <Legend iconType="square" iconSize={8} wrapperStyle={{ color: 'var(--ui-text-3)', fontSize: 11, paddingTop: 8 }} />
                <Bar dataKey="healthy" name="Healthy" stackId="responses" fill="var(--ui-brand-strong)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="partial" name="Partial" stackId="responses" fill="var(--ui-risk-3)" />
                <Bar dataKey="errors" name="Failed" stackId="responses" fill="var(--ui-risk-4)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>}
          </div>
        </article>

        <article className="logs-chart-card">
          <div className="logs-chart-head">
            <div>
              <h2>Response time</h2>
              <p>Median and 95th percentile · seconds</p>
            </div>
            <Clock3 size={18} aria-hidden />
          </div>
          <div className="logs-chart-wrap">
            {activeSection === 'analytics' && <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 360, height: 238 }}>
              <LineChart data={trendData} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
                <CartesianGrid vertical={false} stroke="var(--ui-line)" strokeDasharray="3 3" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={28} tick={{ fill: 'var(--ui-text-4)', fontSize: 10 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--ui-text-4)', fontSize: 10 }} tickFormatter={(value) => `${value}s`} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(value, name) => [`${Number(value).toFixed(1)}s`, name]} />
                <Legend iconType="plainline" wrapperStyle={{ color: 'var(--ui-text-3)', fontSize: 11, paddingTop: 8 }} />
                <Line type="monotone" dataKey="p95Seconds" name="P95" stroke="var(--ui-risk-3)" strokeWidth={2} dot={false} connectNulls />
                <Line type="monotone" dataKey="medianSeconds" name="Median" stroke="var(--ui-brand-strong)" strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>}
          </div>
        </article>

        <article className="logs-chart-card">
          <div className="logs-chart-head">
            <div>
              <h2>Top report locations</h2>
              <p>Highest request volume in the selected period</p>
            </div>
            <MapPinned size={18} aria-hidden />
          </div>
          {topLocations.length ? (
            <ol className="logs-location-list">
              {topLocations.map((location, index) => (
                <li key={location.name}>
                  <span className="logs-location-rank">{index + 1}</span>
                  <div>
                    <div className="logs-location-label"><strong>{location.name}</strong><span>{location.count.toLocaleString()}</span></div>
                    <span className="logs-location-track"><span style={{ width: `${location.share}%` }} /></span>
                  </div>
                  <span className="logs-location-share">{Math.round(location.share)}%</span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="logs-chart-empty">No location activity in this period.</div>
          )}
        </article>

        <article className="logs-chart-card">
          <div className="logs-chart-head">
            <div>
              <h2>Requests by hour</h2>
              <p>{rangeLogs.length ? `Local request time · busiest at ${busiestHour.label}` : 'Local request time · no requests in this period'}</p>
            </div>
            <BarChart3 size={18} aria-hidden />
          </div>
          <div className="logs-chart-wrap logs-chart-wrap-compact">
            {activeSection === 'analytics' && <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 360, height: 205 }}>
              <BarChart data={hourlyDistribution} margin={{ top: 8, right: 6, bottom: 0, left: -18 }}>
                <CartesianGrid vertical={false} stroke="var(--ui-line)" strokeDasharray="3 3" />
                <XAxis dataKey="label" interval={2} axisLine={false} tickLine={false} tick={{ fill: 'var(--ui-text-4)', fontSize: 10 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: 'var(--ui-text-4)', fontSize: 10 }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: 'var(--ui-surface-subtle)' }} />
                <Bar dataKey="requests" name="Reports" fill="var(--ui-brand-strong)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>}
          </div>
        </article>
      </section>

      <section className="admin-insights-grid" aria-label="Planning and reliability insights" hidden={activeSection !== 'analytics'}>
        <article className="logs-chart-card admin-planning-card">
          <div className="logs-chart-head">
            <div>
              <h2>Planning behavior</h2>
              <p>When successful reports are planned for and intended to start</p>
            </div>
            <CalendarRange size={18} aria-hidden />
          </div>
          <div className="admin-planning-splits">
            <div>
              <div className="admin-insight-subhead"><strong>Planning horizon</strong><span>{planningInsights.leadTime.total.toLocaleString()} dated reports</span></div>
              <ul className="admin-breakdown-list">
                {planningInsights.leadTime.items.map((item) => (
                  <li key={item.key}>
                    <div><strong>{item.label}</strong><span>{item.count.toLocaleString()} · {Math.round(item.share)}%</span></div>
                    <span className="admin-breakdown-track"><span style={{ width: `${item.share}%` }} /></span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="admin-insight-subhead"><strong>Planned start time</strong><span>{planningInsights.startTimes.total.toLocaleString()} timed reports</span></div>
              <ul className="admin-breakdown-list">
                {planningInsights.startTimes.items.map((item) => (
                  <li key={item.key}>
                    <div><strong>{item.label}</strong><span>{item.count.toLocaleString()} · {Math.round(item.share)}%</span></div>
                    <span className="admin-breakdown-track"><span style={{ width: `${item.share}%` }} /></span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </article>

        <article className="logs-chart-card admin-hotspots-card">
          <div className="logs-chart-head">
            <div>
              <h2>Reliability hotspots</h2>
              <p>Named locations with partial or server-failed reports</p>
            </div>
            <AlertTriangle size={18} aria-hidden />
          </div>
          {reliabilityHotspots.length ? (
            <ol className="admin-hotspot-list">
              {reliabilityHotspots.map((location) => (
                <li key={location.name}>
                  <div>
                    <strong>{location.name}</strong>
                    <span>{location.issues} of {location.total} affected · {Math.round(location.issueRate)}%</span>
                  </div>
                  <span><strong>{formatDuration(location.p95Duration)}</strong><small>P95</small></span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="logs-chart-empty admin-hotspots-empty"><CheckCircle2 size={20} aria-hidden /> No named location has a report issue in this period.</div>
          )}
        </article>
      </section>

      <section ref={aiUsageRef} className="logs-ai-section" aria-labelledby="logs-ai-title" hidden={activeSection !== 'analytics'}>
        <div className="logs-section-head">
          <div>
            <span className="logs-section-icon"><Sparkles size={17} aria-hidden /></span>
            <div>
              <h2 id="logs-ai-title">AI usage</h2>
              <p>Model calls, billed token volume, and estimated cost for {selectedRange.label.toLowerCase()}</p>
            </div>
          </div>
          <div className="logs-section-actions">
            <span>{rangeAIUsage.length.toLocaleString()} calls</span>
            <button type="button" className="logs-btn logs-btn-quiet" onClick={() => downloadAIUsageCsv(rangeAIUsage)} disabled={rangeAIUsage.length === 0}>
              <Download size={15} aria-hidden /> Export AI CSV
            </button>
          </div>
        </div>

        {aiUsageError && <div className="logs-inline-note"><AlertTriangle size={15} aria-hidden /> {aiUsageError}</div>}

        <div className="logs-ai-metrics" aria-label="AI usage summary">
          <article className="logs-metric-card">
            <span className="logs-metric-icon"><Sparkles size={18} aria-hidden /></span>
            <div><strong>{aiMetrics.calls.toLocaleString()}</strong><span>Model calls</span></div>
          </article>
          <article className="logs-metric-card">
            <span className="logs-metric-icon"><Download size={18} aria-hidden /></span>
            <div><strong title={aiMetrics.inputTokens.toLocaleString()}>{formatTokenCount(aiMetrics.inputTokens)}</strong><span>Input tokens</span></div>
          </article>
          <article className="logs-metric-card">
            <span className="logs-metric-icon"><Activity size={18} aria-hidden /></span>
            <div><strong title={aiMetrics.outputTokens.toLocaleString()}>{formatTokenCount(aiMetrics.outputTokens)}</strong><span>Output tokens</span></div>
          </article>
          <article className="logs-metric-card">
            <span className="logs-metric-icon is-amber"><DollarSign size={18} aria-hidden /></span>
            <div><strong title={`Estimated USD ${aiMetrics.estimatedCostUsd.toFixed(8)}`}>{formatEstimatedCost(aiMetrics.estimatedCostUsd)}</strong><span>Estimated cost</span></div>
          </article>
        </div>

        <div className="logs-inline-note">
          <DollarSign size={14} aria-hidden />
          Based on standard direct-provider token rates for {aiMetrics.pricedCalls.toLocaleString()} of {aiMetrics.calls.toLocaleString()} calls. Actual billing may vary with service tiers, discounts, regional processing, and separately billed tools.
        </div>

        <div className="logs-ai-grid">
          <article className="logs-chart-card">
            <div className="logs-chart-head">
              <div>
                <h2>Token activity</h2>
                <p>Input and output tokens · {selectedRange.bucketLabel} intervals</p>
              </div>
              <Activity size={18} aria-hidden />
            </div>
            {rangeAIUsage.length ? (
              <div className="logs-chart-wrap logs-chart-wrap-compact">
                {activeSection === 'analytics' && <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 500, height: 205 }}>
                  <BarChart data={aiTrendData} margin={{ top: 8, right: 6, bottom: 0, left: -8 }}>
                    <CartesianGrid vertical={false} stroke="var(--ui-line)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={28} tick={{ fill: 'var(--ui-text-4)', fontSize: 10 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--ui-text-4)', fontSize: 10 }} tickFormatter={formatTokenCount} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(value, name) => [Number(value).toLocaleString(), name]} cursor={{ fill: 'var(--ui-surface-subtle)' }} />
                    <Legend iconType="square" iconSize={8} wrapperStyle={{ color: 'var(--ui-text-3)', fontSize: 11, paddingTop: 8 }} />
                    <Bar dataKey="inputTokens" name="Input" stackId="tokens" fill="var(--ui-brand-strong)" />
                    <Bar dataKey="outputTokens" name="Output" stackId="tokens" fill="var(--ui-risk-3)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>}
              </div>
            ) : (
              <div className="logs-chart-empty">No AI calls in this period.</div>
            )}
          </article>

          <article className="logs-chart-card">
            <div className="logs-chart-head">
              <div>
                <h2>Models</h2>
                <p>Call and token volume by provider</p>
              </div>
              <Sparkles size={18} aria-hidden />
            </div>
            {aiModels.length ? (
              <ol className="logs-model-list">
                {aiModels.map((model, index) => (
                  <li key={`${model.provider}:${model.model}`}>
                    <span className="logs-location-rank">{index + 1}</span>
                    <div>
                      <strong title={model.model}>{model.model}</strong>
                      <span>{model.provider} · {model.calls.toLocaleString()} {model.calls === 1 ? 'call' : 'calls'}</span>
                    </div>
                    <span title={`${model.tokens.toLocaleString()} tokens · estimated ${model.estimatedCostUsd.toFixed(8)} USD`}>
                      {formatEstimatedCost(model.estimatedCostUsd)} · {formatTokenCount(model.tokens)}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="logs-chart-empty">No model activity in this period.</div>
            )}
          </article>

          <article className="logs-chart-card logs-ai-feature-card">
            <div className="logs-chart-head">
              <div>
                <h2>Features</h2>
                <p>Reliability, latency, and tokens by AI workflow</p>
              </div>
              <Bot size={18} aria-hidden />
            </div>
            {aiFeatures.length ? (
              <ul className="logs-feature-list">
                {aiFeatures.map((feature) => (
                  <li key={feature.feature}>
                    <div>
                      <strong>{feature.feature.replaceAll('-', ' ')}</strong>
                      <span>{feature.calls.toLocaleString()} {feature.calls === 1 ? 'call' : 'calls'} · avg {formatDuration(feature.averageDurationMs)}</span>
                    </div>
                    <div>
                      <strong>{formatEstimatedCost(feature.estimatedCostUsd)} · {formatTokenCount(feature.tokens)} tokens</strong>
                      <span className={feature.errors ? 'has-errors' : ''}>{feature.errors ? `${feature.errors} failed` : '100% successful'}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="logs-chart-empty">No AI feature activity in this period.</div>
            )}
          </article>
        </div>
      </section>

      <section ref={requestActivityRef} className="logs-panel" hidden={activeSection !== 'analytics'}>
        <div className="logs-panel-head">
          <div>
            <h2>Request activity</h2>
            <p>Raw report details for {selectedRange.label.toLowerCase()}</p>
          </div>
          <div className="logs-panel-actions">
            <button type="button" className="logs-btn logs-btn-quiet" onClick={() => downloadReportCsv(filteredAndSorted)} disabled={filteredAndSorted.length === 0}>
              <Download size={15} aria-hidden /> Export CSV
            </button>
          </div>
        </div>

        <div className="logs-controls">
          <label className="logs-search">
            <Search size={16} aria-hidden />
            <span className="sr-only">Search logs</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search location, date, status, network…" />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={15} aria-hidden /></button>}
          </label>
          <div className="logs-filter-tabs" aria-label="Filter by response status">
            {STATUS_FILTERS.map((filter) => (
              <button
                type="button"
                key={filter.value}
                className={statusFilter === filter.value ? 'is-active' : ''}
                onClick={() => setStatusFilter(filter.value)}
                aria-pressed={statusFilter === filter.value}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {logs.length === 0 ? (
          <div className="logs-empty"><ShieldCheck size={26} aria-hidden /><h3>No report requests yet</h3><p>New safety reports will appear here automatically.</p></div>
        ) : rangeLogs.length === 0 ? (
          <div className="logs-empty"><Clock3 size={26} aria-hidden /><h3>No requests in this period</h3><p>Choose a longer date range to see retained report activity.</p></div>
        ) : filteredAndSorted.length === 0 ? (
          <div className="logs-empty"><Search size={26} aria-hidden /><h3>No matching requests</h3><p>Try a different search or status filter.</p><button type="button" onClick={() => { setQuery(''); setStatusFilter('all'); }}>Clear filters</button></div>
        ) : (
          <div className="logs-table-scroll">
            <table className="logs-table">
              <thead>
                <tr>
                  <th><SortButton sortKey="timestamp" activeKey={sortKey} ascending={sortAsc} onSort={handleSort}>Received</SortButton></th>
                  <th><SortButton sortKey="name" activeKey={sortKey} ascending={sortAsc} onSort={handleSort}>Report</SortButton></th>
                  <th><SortButton sortKey="date" activeKey={sortKey} ascending={sortAsc} onSort={handleSort}>Plan</SortButton></th>
                  <th><SortButton sortKey="statusCode" activeKey={sortKey} ascending={sortAsc} onSort={handleSort}>Response</SortButton></th>
                  <th><SortButton sortKey="safetyScore" activeKey={sortKey} ascending={sortAsc} onSort={handleSort}>Score</SortButton></th>
                  <th><SortButton sortKey="durationMs" activeKey={sortKey} ascending={sortAsc} onSort={handleSort}>Duration</SortButton></th>
                  <th><SortButton sortKey="ip" activeKey={sortKey} ascending={sortAsc} onSort={handleSort}>Network</SortButton></th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleLogs.map((entry, index) => {
                  const time = formatLogTime(entry.timestamp);
                  const plannerHref = entry.lat != null && entry.lon != null
                    ? `/planner?lat=${entry.lat.toFixed(5)}&lon=${entry.lon.toFixed(5)}${entry.date ? `&date=${encodeURIComponent(entry.date)}` : ''}${entry.startTime ? `&start=${encodeURIComponent(entry.startTime)}` : ''}${entry.name ? `&name=${encodeURIComponent(entry.name)}` : ''}`
                    : null;
                  const scoreClass = entry.safetyScore == null ? '' : entry.safetyScore >= 70 ? 'is-good' : entry.safetyScore >= 55 ? 'is-watch' : 'is-risk';
                  return (
                    <tr key={`${entry.timestamp}-${entry.lat}-${entry.lon}-${index}`}>
                      <td data-label="Received"><span className="logs-cell-primary logs-cell-tabular">{time.primary}</span><span className="logs-cell-secondary">{time.secondary}</span></td>
                      <td data-label="Report"><span className="logs-cell-primary">{entry.name ?? 'Unnamed report'}</span><span className="logs-cell-secondary logs-cell-mono">{entry.lat != null && entry.lon != null ? `${entry.lat.toFixed(4)}, ${entry.lon.toFixed(4)}` : 'No coordinates'}</span></td>
                      <td data-label="Plan"><span className="logs-cell-primary">{entry.date ?? 'No date'}</span><span className="logs-cell-secondary">{entry.startTime ? `Starts ${entry.startTime}` : 'No start time'}</span></td>
                      <td data-label="Response">
                        <span className={entry.statusCode === 200 ? 'logs-status-pill is-ok' : 'logs-status-pill is-error'}>{entry.statusCode}</span>
                        {entry.partialData === true && <span className="logs-status-pill is-partial">Partial</span>}
                      </td>
                      <td data-label="Score"><span className={`logs-score ${scoreClass}`}>{entry.safetyScore != null ? entry.safetyScore : '—'}</span></td>
                      <td data-label="Duration" className="logs-cell-tabular">{formatDuration(entry.durationMs)}</td>
                      <td data-label="Network" title={entry.userAgent ?? undefined}><span className="logs-cell-primary logs-cell-mono">{entry.ip ?? '—'}</span><span className="logs-cell-secondary">Masked</span></td>
                      <td data-label="Open">{plannerHref ? <a className="logs-open-link" href={plannerHref} target="_blank" rel="noopener noreferrer" aria-label={`Open ${entry.name ?? 'report'} in planner`}><ExternalLink size={15} aria-hidden /></a> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <footer className="logs-panel-foot">
          <span>Showing {visibleLogs.length} of {filteredAndSorted.length} matching requests</span>
          {visibleLogs.length < filteredAndSorted.length && (
            <button
              type="button"
              className="logs-load-more"
              onClick={() => setVisibleLogCount((current) => current + LOG_PAGE_SIZE)}
            >
              Show {Math.min(LOG_PAGE_SIZE, filteredAndSorted.length - visibleLogs.length)} more
            </button>
          )}
          <span>{autoRefresh ? 'Auto-refreshes every 30 seconds' : 'Auto-refresh paused'}</span>
        </footer>
      </section>
      </div>
    </div>
  );
}
