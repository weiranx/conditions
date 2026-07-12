import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  HardDrive,
  MonitorCog,
  RefreshCw,
  Server,
  ShieldCheck,
  Wifi,
  XCircle,
} from 'lucide-react';
import { useEffect } from 'react';
import { AppDisclaimer } from '../../app/map-components';
import type { BackendMeta, HealthCheckResult } from '../../app/types';
import type { AppView } from '../../hooks/useUrlState';
import { ProductNav } from './ProductNav';

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
  openTripToolView: () => void;
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
  openTripToolView,
}: StatusViewProps) {
  useEffect(() => {
    if (healthChecks.length === 0 && !healthLoading && !healthError && !healthCheckedAt) {
      void runHealthChecks();
    }
  }, [healthCheckedAt, healthChecks.length, healthError, healthLoading, runHealthChecks]);

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${seconds % 60}s`;
  };

  const downCount = healthChecks.filter((check) => check.status === 'down').length;
  const warningCount = healthChecks.filter((check) => check.status === 'warn').length;
  const okCount = healthChecks.filter((check) => check.status === 'ok').length;
  const overallStatus = healthError || downCount > 0
    ? 'down'
    : warningCount > 0
      ? 'warn'
      : healthChecks.length > 0
        ? 'ok'
        : 'checking';
  const overallCopy = {
    ok: {
      eyebrow: 'All systems operational',
      title: 'Ready for trip planning',
      detail: 'The API is responding normally and this browser supports the features used by the planner.',
    },
    warn: {
      eyebrow: 'Some features degraded',
      title: 'Planning is available with limitations',
      detail: `${warningCount} ${warningCount === 1 ? 'check needs' : 'checks need'} attention. Review the details before relying on affected features.`,
    },
    down: {
      eyebrow: 'Service interruption',
      title: 'Trip planning may be unavailable',
      detail: healthError
        ? 'The health endpoint could not be reached from this device. Check your connection and try again.'
        : `${downCount} critical ${downCount === 1 ? 'check is' : 'checks are'} failing. Try again in a moment.`,
    },
    checking: {
      eyebrow: 'Checking system health',
      title: 'Confirming planner readiness',
      detail: 'Testing the API connection and the browser features used by the planner.',
    },
  }[overallStatus];

  const serviceChecks = healthChecks.filter((check) => ['Backend API', 'API Latency', 'AI Provider'].includes(check.label));
  const browserChecks = healthChecks.filter((check) => !serviceChecks.includes(check));

  const renderCheck = (check: HealthCheckResult) => {
    const pillClass = check.status === 'ok' ? 'go' : check.status === 'warn' ? 'caution' : 'nogo';
    const StatusIcon = check.status === 'ok' ? CheckCircle2 : check.status === 'warn' ? AlertTriangle : XCircle;
    const CheckIcon = check.label === 'Backend API'
      ? Server
      : check.label === 'AI Provider'
        ? Cpu
        : check.label === 'API Latency' || check.label === 'Browser Network'
        ? Wifi
        : check.label === 'Browser Storage'
          ? Database
          : MonitorCog;

    return (
      <article key={check.label} className={`settings-card status-card status-card--${check.status}`}>
        <div className="status-card-icon" aria-hidden><CheckIcon size={18} /></div>
        <div className="status-card-body">
          <div className="status-card-head">
            <h3>{check.label}</h3>
            <span className={`decision-pill ${pillClass}`}>
              <StatusIcon size={11} />
              {check.status === 'ok' ? 'Operational' : check.status === 'warn' ? 'Limited' : 'Down'}
            </span>
          </div>
          <p>{check.detail}</p>
          {check.meta && <p className="status-card-meta">{check.meta}</p>}
        </div>
      </article>
    );
  };

  return (
    <div key="view-status" className={appShellClassName} aria-busy={isViewPending}>
      <section className="settings-shell status-shell">
        <ProductNav
          active="status"
          navigateToView={navigateToView}
          openPlannerView={openPlannerView}
          openTripToolView={openTripToolView}
        />
        <div className="settings-head">
          <div>
            <div className="home-kicker">Backcountry Conditions System Health</div>
            <h1>Status</h1>
            <p>Live service availability and device readiness for the trip-planning tools.</p>
          </div>
          <div className="settings-nav">
            <button className="primary-btn" onClick={() => void runHealthChecks()} disabled={healthLoading}>
              <RefreshCw size={14} className={healthLoading ? 'spin-icon' : undefined} />
              {healthLoading ? 'Checking\u2026' : 'Refresh status'}
            </button>
          </div>
        </div>

        {healthError && (
          <article className="settings-card error-banner">
            <h3>Health Check Error</h3>
            <p>{healthError}</p>
          </article>
        )}

        <section className={`status-overview status-overview--${overallStatus}`} aria-live="polite">
          <div className="status-overview-signal" aria-hidden>
            {overallStatus === 'checking'
              ? <RefreshCw size={28} className="spin-icon" />
              : overallStatus === 'ok'
                ? <CheckCircle2 size={28} />
                : overallStatus === 'warn'
                  ? <AlertTriangle size={28} />
                  : <XCircle size={28} />}
          </div>
          <div className="status-overview-copy">
            <div className="status-overview-eyebrow">{overallCopy.eyebrow}</div>
            <h2>{overallCopy.title}</h2>
            <p>{overallCopy.detail}</p>
          </div>
          {healthChecks.length > 0 && (
            <div className="status-overview-counts" aria-label={`${okCount} operational, ${warningCount} limited, ${downCount} down`}>
              <div><strong>{okCount}</strong><span>Operational</span></div>
              <div><strong>{warningCount}</strong><span>Limited</span></div>
              <div><strong>{downCount}</strong><span>Down</span></div>
            </div>
          )}
        </section>

        {backendMeta && (
          <article className="status-meta-bar" aria-label="Backend details">
            <div className="status-meta-bar-inner">
              <div className="status-meta-stat">
                <Activity size={13} />
                <span className="status-meta-label">Environment</span>
                <strong>{backendMeta.env}</strong>
              </div>
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

        {serviceChecks.length > 0 && (
          <section className="status-check-section" aria-labelledby="service-status-heading">
            <div className="status-section-heading">
              <div>
                <span>Core service</span>
                <h2 id="service-status-heading">Planner API</h2>
              </div>
              <p>Availability and response time from this device.</p>
            </div>
            <div className="status-grid status-grid--service">{serviceChecks.map(renderCheck)}</div>
          </section>
        )}

        {browserChecks.length > 0 && (
          <section className="status-check-section" aria-labelledby="browser-status-heading">
            <div className="status-section-heading">
              <div>
                <span>Device readiness</span>
                <h2 id="browser-status-heading">This browser</h2>
              </div>
              <p>Local capabilities used for preferences, maps, and connectivity.</p>
            </div>
            <div className="status-grid">{browserChecks.map(renderCheck)}</div>
          </section>
        )}

        <div className="status-grid" aria-live="polite">
          {healthLoading && healthChecks.length === 0 && (
            <article className="settings-card status-card settings-card-full status-placeholder-card">
              <div className="status-empty-state">
                <RefreshCw size={24} className="spin-icon status-empty-icon" />
                <h3>Running live checks</h3>
                <p>This usually takes only a moment.</p>
              </div>
            </article>
          )}
          {!healthLoading && healthChecks.length === 0 && !healthError && (
            <article className="settings-card status-card settings-card-full">
              <div className="status-empty-state">
                <ShieldCheck size={28} className="status-empty-icon" />
                <h3>No checks run yet</h3>
                <p>Refresh the page status to verify backend connectivity and browser capabilities.</p>
              </div>
            </article>
          )}
        </div>

        <div className="settings-note status-checked-note">
          <Clock size={13} aria-hidden />
          <span>Last checked {healthCheckedAt ? formatPubTime(healthCheckedAt) : 'never'}</span>
          {healthLoading && healthChecks.length > 0 && <span className="status-refresh-note">Refreshing now&hellip;</span>}
        </div>
        <AppDisclaimer compact />
      </section>
    </div>
  );
}
