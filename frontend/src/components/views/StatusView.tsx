import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  HardDrive,
  House,
  RefreshCw,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  Wifi,
  XCircle,
} from 'lucide-react';
import { AppDisclaimer } from '../../app/map-components';
import type { BackendMeta, HealthCheckResult } from '../../app/types';
import type { AppView } from '../../hooks/useUrlState';

export interface StatusViewProps {
  appShellClassName: string;
  isViewPending: boolean;
  healthChecks: HealthCheckResult[];
  healthLoading: boolean;
  healthError: string | null;
  healthCheckedAt: string | null;
  backendMeta: BackendMeta | null;
  formatPubTime: (isoString?: string) => string;
  runHealthChecks: () => Promise<void>;
  navigateToView: (view: AppView) => void;
  openPlannerView: () => void;
}

export function StatusView({
  appShellClassName,
  isViewPending,
  healthChecks,
  healthLoading,
  healthError,
  healthCheckedAt,
  backendMeta,
  formatPubTime,
  runHealthChecks,
  navigateToView,
  openPlannerView,
}: StatusViewProps) {
  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${seconds % 60}s`;
  };

  return (
    <div key="view-status" className={appShellClassName} aria-busy={isViewPending}>
      <section className="settings-shell status-shell">
        <div className="settings-head">
          <div>
            <div className="home-kicker">Backcountry Conditions System Health</div>
            <h2>Status</h2>
            <p>Live health checks for backend availability and browser capabilities.</p>
          </div>
          <div className="settings-nav">
            <button className="settings-btn" onClick={() => navigateToView('home')}>
              <House size={14} /> Homepage
            </button>
            <button className="settings-btn" onClick={openPlannerView}>
              <Route size={14} /> Planner
            </button>
            <button className="settings-btn" onClick={() => navigateToView('settings')}>
              <SlidersHorizontal size={14} /> Settings
            </button>
            <button className="primary-btn" onClick={() => void runHealthChecks()} disabled={healthLoading}>
              <RefreshCw size={14} className={healthLoading ? 'spin-icon' : undefined} />
              {healthLoading ? 'Checking\u2026' : 'Run Checks'}
            </button>
          </div>
        </div>

        {healthError && (
          <article className="settings-card error-banner">
            <h3>Health Check Error</h3>
            <p>{healthError}</p>
          </article>
        )}

        {backendMeta && (
          <article className="settings-card settings-card-full status-meta-bar">
            <div className="status-meta-bar-inner">
              <div className="status-meta-stat">
                <Activity size={13} />
                <span className="status-meta-label">Version</span>
                <strong>{backendMeta.version}</strong>
              </div>
              <div className="status-meta-stat">
                <Clock size={13} />
                <span className="status-meta-label">Uptime</span>
                <strong>{formatUptime(backendMeta.uptime)}</strong>
              </div>
              <div className="status-meta-stat">
                <Cpu size={13} />
                <span className="status-meta-label">Node</span>
                <strong>{backendMeta.nodeVersion}</strong>
              </div>
              <div className="status-meta-stat">
                <HardDrive size={13} />
                <span className="status-meta-label">Heap</span>
                <strong>{backendMeta.heapUsedMb} MB</strong>
              </div>
              <div className="status-meta-stat">
                <HardDrive size={13} />
                <span className="status-meta-label">RSS</span>
                <strong>{backendMeta.rssMb} MB</strong>
              </div>
              <div className="status-meta-stat">
                <Wifi size={13} />
                <span className="status-meta-label">Latency</span>
                <strong>{backendMeta.latencyMs} ms</strong>
              </div>
            </div>
          </article>
        )}

        <div className="status-grid">
          {healthChecks.map((check) => {
            const pillClass = check.status === 'ok' ? 'go' : check.status === 'warn' ? 'caution' : 'nogo';
            const StatusIcon = check.status === 'ok' ? CheckCircle2 : check.status === 'warn' ? AlertTriangle : XCircle;
            return (
              <article key={check.label} className={`settings-card status-card status-card--${check.status}`}>
                <div className="status-card-head">
                  <h3>{check.label}</h3>
                  <span className={`decision-pill ${pillClass}`}>
                    <StatusIcon size={11} />
                    {check.status === 'ok' ? 'OK' : check.status === 'warn' ? 'WARN' : 'DOWN'}
                  </span>
                </div>
                <p>{check.detail}</p>
                {check.meta && <p className="status-card-meta">{check.meta}</p>}
              </article>
            );
          })}
          {healthLoading && healthChecks.length === 0 && (
            <article className="settings-card status-card settings-card-full">
              <div className="status-empty-state">
                <RefreshCw size={24} className="spin-icon status-empty-icon" />
                <p>Running checks\u2026</p>
              </div>
            </article>
          )}
          {!healthLoading && healthChecks.length === 0 && !healthError && (
            <article className="settings-card status-card settings-card-full">
              <div className="status-empty-state">
                <ShieldCheck size={28} className="status-empty-icon" />
                <h3>No checks run yet</h3>
                <p>Click <strong>Run Checks</strong> to verify backend connectivity and browser capabilities.</p>
              </div>
            </article>
          )}
        </div>

        <div className="settings-note">
          Last checked: {healthCheckedAt ? formatPubTime(healthCheckedAt) : 'Never'}
        </div>
        <AppDisclaimer compact />
      </section>
    </div>
  );
}
