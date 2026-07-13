import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  CalendarRange,
  CheckCircle2,
  Clock3,
  Cpu,
  Database,
  DollarSign,
  Download,
  ExternalLink,
  FileJson,
  Gauge,
  History,
  KeyRound,
  LoaderCircle,
  Lock,
  Layers,
  MessageCircleQuestion,
  Pause,
  Play,
  Power,
  MapPinned,
  RefreshCw,
  Route,
  Satellite,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
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

interface AdminAuditEntry {
  timestamp: string;
  action: string;
  category: 'configuration' | 'maintenance' | 'diagnostics' | string;
  status: 'success' | 'error';
  summary: string;
  actorNetwork: string | null;
  details: Record<string, unknown> | null;
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
] as const satisfies ReadonlyArray<{
  key: ProductFeatureKey;
  label: string;
  description: string;
  icon: typeof Clock3;
}>;

const ADMIN_SESSION_KEY = 'summitsafe:admin-key';
const LEGACY_LOGS_SESSION_KEY = 'summitsafe:logs-key';

interface AdminViewProps {
  navigateToView: (view: AppView) => void;
  openPlannerView: () => void;
  openTripToolView: () => void;
}

export function AdminView({ navigateToView, openPlannerView, openTripToolView }: AdminViewProps) {
  const [secretKey, setSecretKey] = useState<string>(() => (
    sessionStorage.getItem(ADMIN_SESSION_KEY) ?? sessionStorage.getItem(LEGACY_LOGS_SESSION_KEY) ?? ''
  ));
  const [draft, setDraft] = useState('');
  const [rejected, setRejected] = useState(false);

  const lockAdmin = useCallback((wasRejected = false) => {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    sessionStorage.removeItem(LEGACY_LOGS_SESSION_KEY);
    setSecretKey('');
    setRejected(wasRejected);
  }, []);

  const handleSubmit = useCallback((event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    sessionStorage.setItem(ADMIN_SESSION_KEY, trimmed);
    sessionStorage.removeItem(LEGACY_LOGS_SESSION_KEY);
    setSecretKey(trimmed);
    setRejected(false);
    setDraft('');
  }, [draft]);

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
            <h1>Admin console</h1>
            <p>Monitor system health, investigate report issues, and understand AI and request usage from one protected workspace.</p>
          </div>
          {secretKey && (
            <button type="button" className="logs-btn logs-btn-quiet" onClick={() => lockAdmin()}>
              <Lock size={15} aria-hidden /> Lock
            </button>
          )}
        </header>

        {secretKey ? (
          <AdminDashboard secretKey={secretKey} onUnauthorized={() => lockAdmin(true)} />
        ) : (
          <section className="logs-unlock-card" aria-labelledby="admin-unlock-title">
            <div className="logs-unlock-icon"><KeyRound size={22} aria-hidden /></div>
            <div className="logs-unlock-copy">
              <h2 id="admin-unlock-title">Admin access</h2>
              <p>Enter the server’s admin key. It is stored only for this browser session.</p>
            </div>
            <form onSubmit={handleSubmit} className="logs-unlock-form">
              <label htmlFor="logs-key-input">Access key</label>
              <div className="logs-unlock-controls">
                <input
                  id="logs-key-input"
                  type="password"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Enter access key"
                  autoComplete="current-password"
                  aria-invalid={rejected}
                  aria-describedby={rejected ? 'logs-unlock-error' : undefined}
                  autoFocus
                />
                <button type="submit" className="logs-btn logs-btn-primary" disabled={!draft.trim()}>
                  Unlock
                </button>
              </div>
              {rejected && <p id="logs-unlock-error" className="logs-unlock-error">That key was not accepted. Try again.</p>}
            </form>
          </section>
        )}
      </main>
    </>
  );
}

type LogSortKey = 'timestamp' | 'name' | 'date' | 'statusCode' | 'safetyScore' | 'durationMs' | 'ip';
type StatusFilter = 'all' | 'healthy' | 'issues' | 'errors' | 'partial' | 'slow';
type AnalyticsRange = '6h' | '24h' | '7d';
type AuditFilter = 'all' | 'configuration' | 'maintenance' | 'diagnostics' | 'errors';

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
  { value: 'configuration', label: 'Configuration' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'diagnostics', label: 'Diagnostics' },
  { value: 'errors', label: 'Failed' },
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

function AdminDashboard({ secretKey, onUnauthorized }: { secretKey: string; onUnauthorized: () => void }) {
  const [logs, setLogs] = useState<ReportLogEntry[]>([]);
  const [aiUsage, setAIUsage] = useState<AIUsageEntry[]>([]);
  const [aiSettings, setAISettings] = useState<AIAdminSettings | null>(null);
  const [aiModelCatalog, setAIModelCatalog] = useState<AIModelCatalog | null>(null);
  const [featureFlagStatus, setFeatureFlagStatus] = useState<ProductFeatureFlagStatus | null>(null);
  const [health, setHealth] = useState<AdminHealthSnapshot | null>(null);
  const [healthHttpStatus, setHealthHttpStatus] = useState<number | null>(null);
  const [backendLatencyMs, setBackendLatencyMs] = useState<number | null>(null);
  const [auditEntries, setAuditEntries] = useState<AdminAuditEntry[]>([]);
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
  const [auditError, setAuditError] = useState<string | null>(null);
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
  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsRange>('7d');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [visibleLogCount, setVisibleLogCount] = useState(LOG_PAGE_SIZE);
  const hasLoadedRef = useRef(false);
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

  const fetchAuditTrail = useCallback(async () => {
    try {
      const result = await fetchApi('/api/admin/audit-log', {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      if (result.response.status === 401 || result.response.status === 403) {
        onUnauthorized();
        return;
      }
      if (result.response.ok && Array.isArray(result.payload)) {
        setAuditEntries(result.payload as AdminAuditEntry[]);
        setAuditError(null);
      } else {
        setAuditError('Administrative activity is temporarily unavailable.');
      }
    } catch {
      setAuditError('Could not reach the server to load administrative activity.');
    }
  }, [onUnauthorized, secretKey]);

  const fetchAdminData = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    try {
      const headers = { Authorization: `Bearer ${secretKey}` };
      const [logsResult, aiUsageResult, healthResult, aiSettingsResult, featureFlagsResult, aiModelsResult, auditResult] = await Promise.all([
        fetchApi('/api/report-logs', { headers }),
        fetchApi('/api/ai-usage', { headers }),
        fetchHealthSnapshot(),
        fetchApi('/api/admin/ai-settings', { headers }),
        fetchApi('/api/admin/feature-flags', { headers }),
        fetchApi('/api/admin/ai-models', { headers }),
        fetchApi('/api/admin/audit-log', { headers }),
      ]);
      if ([logsResult.response.status, aiUsageResult.response.status, aiSettingsResult.response.status, featureFlagsResult.response.status, aiModelsResult.response.status, auditResult.response.status].some((status) => status === 401 || status === 403)) {
        onUnauthorized();
        return;
      }
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
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setAIUsageError('AI usage data is temporarily unavailable.');
      setHealthError('System details are temporarily unavailable.');
      setAISettingsError('AI controls are temporarily unavailable.');
      setFeatureFlagsError('Product feature flags are temporarily unavailable.');
      setAIModelCatalogError('Provider model lists are temporarily unavailable.');
      setAuditError('Administrative activity is temporarily unavailable.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [applyHealthSnapshot, fetchHealthSnapshot, secretKey, onUnauthorized]);

  const refreshModelCatalog = useCallback(async () => {
    setAIModelCatalogPending(true);
    setAIModelCatalogError(null);
    try {
      const result = await fetchApi('/api/admin/ai-models/refresh', {
        method: 'POST',
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      if (result.response.status === 401 || result.response.status === 403) {
        onUnauthorized();
        return;
      }
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
  }, [fetchAuditTrail, onUnauthorized, secretKey]);

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
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(settings),
      });
      if (result.response.status === 401 || result.response.status === 403) {
        onUnauthorized();
        return null;
      }
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
  }, [fetchAuditTrail, onUnauthorized, secretKey]);

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

  const toggleProductFeature = async (feature: ProductFeatureKey) => {
    const current = featureFlagStatus?.flags[feature];
    if (typeof current !== 'boolean') return;
    setFeatureFlagsPending(true);
    setFeatureFlagsError(null);
    try {
      const result = await fetchApi('/api/admin/feature-flags', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ flags: { [feature]: !current } }),
      });
      if (result.response.status === 401 || result.response.status === 403) {
        onUnauthorized();
        return;
      }
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
        headers: { Authorization: `Bearer ${secretKey}` },
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
      if (result.response.status === 401 || result.response.status === 403) {
        onUnauthorized();
        return;
      }
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
      uniqueVisitors: new Set(rangeLogs.map((entry) => entry.ip).filter(Boolean)).size,
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

  const downloadOperationsSnapshot = () => {
    triggerJsonDownload(`admin-snapshot-${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}.json`, {
      generatedAt: new Date().toISOString(),
      range: { value: analyticsRange, label: selectedRange.label },
      system: health,
      reportMetrics: metrics,
      aiMetrics,
      aiStatus: aiSettings,
      productFeatures: featureFlagStatus,
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
    window.requestAnimationFrame(() => requestActivityRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
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

      <section className="logs-dashboard-toolbar" aria-label="Admin dashboard controls">
        <div>
          <h2>Overview</h2>
          <p>{rangeLogs.length.toLocaleString()} reports in the selected period</p>
        </div>
        <div className="logs-toolbar-actions">
          <span className="logs-refresh-status" aria-live="polite">
            {refreshing ? 'Refreshing…' : lastRefreshed ? `Updated ${lastRefreshed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
          </span>
          <div className="logs-range-control" aria-label="Analytics date range">
            {ANALYTICS_RANGES.map((option) => (
              <button
                type="button"
                key={option.value}
                className={analyticsRange === option.value ? 'is-active' : ''}
                onClick={() => setAnalyticsRange(option.value)}
                aria-pressed={analyticsRange === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
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

      <section className="admin-operations-grid" aria-label="System operations">
        <article className="logs-chart-card admin-system-card">
          <div className="logs-chart-head">
            <div>
              <h2>System snapshot</h2>
              <p>Live backend, database, runtime, and cache status</p>
            </div>
            <Server size={18} aria-hidden />
          </div>
          {healthError && <div className="logs-inline-note"><AlertTriangle size={15} aria-hidden /> {healthError}</div>}
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
              onClick={() => aiUsageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              disabled={aiMetrics.failures === 0}
            >
              <span className="is-amber"><Bot size={15} aria-hidden /></span>
              <span><strong>AI failures</strong><small>Unsuccessful model calls</small></span>
              <b>{aiMetrics.failures}</b>
            </button>
          </div>
          {metrics.issues === 0 && slowReports === 0 && aiMetrics.failures === 0 && (
            <p className="admin-all-clear"><CheckCircle2 size={15} aria-hidden /> No active signals in this period.</p>
          )}
        </article>
      </section>

      <section className="logs-chart-card admin-diagnostics-card" aria-labelledby="admin-diagnostics-title">
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

      <section className="logs-panel admin-audit-panel" aria-labelledby="admin-audit-title">
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

      <section className="logs-chart-card admin-ai-controls" aria-labelledby="admin-ai-controls-title">
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

      <section className="logs-chart-card admin-ai-controls" aria-labelledby="admin-feature-flags-title">
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

      <section className="logs-metrics" aria-label="Report analytics summary">
        <article className="logs-metric-card">
          <span className="logs-metric-icon"><Activity size={18} aria-hidden /></span>
          <div>
            <strong>{metrics.total.toLocaleString()}</strong>
            <span>Total reports{metrics.volumeDelta != null ? ` · ${metrics.volumeDelta >= 0 ? '+' : ''}${metrics.volumeDelta}% vs prior period` : ''}</span>
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
          <div><strong>{metrics.uniqueVisitors}</strong><span>Unique masked networks</span></div>
        </article>
        <article className="logs-metric-card">
          <span className="logs-metric-icon is-amber"><AlertTriangle size={18} aria-hidden /></span>
          <div><strong>{metrics.issues}</strong><span>Partial or failed responses</span></div>
        </article>
      </section>

      <section className="logs-analytics-grid" aria-label="Report activity charts">
        <article className="logs-chart-card logs-chart-card-wide">
          <div className="logs-chart-head">
            <div>
              <h2>Request health over time</h2>
              <p>Report volume by response outcome · {selectedRange.bucketLabel} intervals</p>
            </div>
            <Activity size={18} aria-hidden />
          </div>
          <div className="logs-chart-wrap">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 500, height: 238 }}>
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
            </ResponsiveContainer>
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
            <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 360, height: 238 }}>
              <LineChart data={trendData} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
                <CartesianGrid vertical={false} stroke="var(--ui-line)" strokeDasharray="3 3" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={28} tick={{ fill: 'var(--ui-text-4)', fontSize: 10 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--ui-text-4)', fontSize: 10 }} tickFormatter={(value) => `${value}s`} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(value, name) => [`${Number(value).toFixed(1)}s`, name]} />
                <Legend iconType="plainline" wrapperStyle={{ color: 'var(--ui-text-3)', fontSize: 11, paddingTop: 8 }} />
                <Line type="monotone" dataKey="p95Seconds" name="P95" stroke="var(--ui-risk-3)" strokeWidth={2} dot={false} connectNulls />
                <Line type="monotone" dataKey="medianSeconds" name="Median" stroke="var(--ui-brand-strong)" strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
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
            <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 360, height: 205 }}>
              <BarChart data={hourlyDistribution} margin={{ top: 8, right: 6, bottom: 0, left: -18 }}>
                <CartesianGrid vertical={false} stroke="var(--ui-line)" strokeDasharray="3 3" />
                <XAxis dataKey="label" interval={2} axisLine={false} tickLine={false} tick={{ fill: 'var(--ui-text-4)', fontSize: 10 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: 'var(--ui-text-4)', fontSize: 10 }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: 'var(--ui-surface-subtle)' }} />
                <Bar dataKey="requests" name="Reports" fill="var(--ui-brand-strong)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section ref={aiUsageRef} className="logs-ai-section" aria-labelledby="logs-ai-title">
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
                <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 500, height: 205 }}>
                  <BarChart data={aiTrendData} margin={{ top: 8, right: 6, bottom: 0, left: -8 }}>
                    <CartesianGrid vertical={false} stroke="var(--ui-line)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={28} tick={{ fill: 'var(--ui-text-4)', fontSize: 10 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--ui-text-4)', fontSize: 10 }} tickFormatter={formatTokenCount} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(value, name) => [Number(value).toLocaleString(), name]} cursor={{ fill: 'var(--ui-surface-subtle)' }} />
                    <Legend iconType="square" iconSize={8} wrapperStyle={{ color: 'var(--ui-text-3)', fontSize: 11, paddingTop: 8 }} />
                    <Bar dataKey="inputTokens" name="Input" stackId="tokens" fill="var(--ui-brand-strong)" />
                    <Bar dataKey="outputTokens" name="Output" stackId="tokens" fill="var(--ui-risk-3)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
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

      <section ref={requestActivityRef} className="logs-panel">
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
  );
}
