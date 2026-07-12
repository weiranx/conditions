import {
  Activity,
  AlertTriangle,
  CheckCircle2,
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
      detail: 'The API is responding normally and this device supports the features used by the planner.',
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
  const operationalServiceCount = serviceChecks.filter((check) => check.status === 'ok').length;

  const renderCheck = (check: HealthCheckResult, variant: 'service' | 'browser') => {
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
      <article key={check.label} className={`status-card status-card--${variant} status-card--${check.status}`}>
        <div className="status-card-icon" aria-hidden><CheckIcon size={18} /></div>
        <div className="status-card-body">
          <div className="status-card-head"><h3>{check.label}</h3></div>
          <p>{check.detail}</p>
          {check.meta && <p className="status-card-meta">{check.meta}</p>}
        </div>
        <span className={`decision-pill status-card-pill ${pillClass}`}>
          <StatusIcon size={11} />
          {check.status === 'ok' ? 'Operational' : check.status === 'warn' ? 'Limited' : 'Down'}
        </span>
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
        <div className="settings-head status-page-head">
          <div>
            <div className="home-kicker">System health</div>
            <h1>Service status</h1>
            <p>Live availability for Backcountry Conditions and the tools used to plan a trip.</p>
          </div>
          <div className="settings-nav status-page-actions">
            <div className="status-page-updated">
              <span className={`status-live-dot status-live-dot--${overallStatus}`} aria-hidden />
              <span>{healthLoading ? 'Verifying now' : healthCheckedAt ? `Verified ${formatPubTime(healthCheckedAt)}` : 'Not yet verified'}</span>
            </div>
            <button className="primary-btn" onClick={() => void runHealthChecks()} disabled={healthLoading}>
              <RefreshCw size={14} className={healthLoading ? 'spin-icon' : undefined} />
              {healthLoading ? 'Checking\u2026' : 'Run checks'}
            </button>
          </div>
        </div>

        {healthError && (
          <article className="settings-card error-banner">
            <h3>Health check error</h3>
            <p>{healthError}</p>
          </article>
        )}

        <section className={`status-overview status-overview--${overallStatus}`} aria-live="polite">
          <div className="status-overview-main">
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
          </div>
          {healthChecks.length > 0 && (
            <div className="status-overview-counts" aria-label={`${okCount} operational, ${warningCount} limited, ${downCount} down`}>
              <div><strong>{okCount}</strong><span>Operational</span></div>
              <div><strong>{warningCount}</strong><span>Limited</span></div>
              <div><strong>{downCount}</strong><span>Down</span></div>
            </div>
          )}
        </section>

        <div className="status-service-layout">
          <section className="status-panel status-service-panel" aria-labelledby="service-status-heading">
            <div className="status-panel-head">
              <div>
                <span className="status-panel-kicker">Core infrastructure</span>
                <h2 id="service-status-heading">Planner services</h2>
              </div>
              <span className="status-panel-summary">
                {serviceChecks.length > 0 ? `${operationalServiceCount}/${serviceChecks.length} operational` : 'Awaiting checks'}
              </span>
            </div>
            <div className="status-service-list">
              {serviceChecks.map((check) => renderCheck(check, 'service'))}
              {healthLoading && serviceChecks.length === 0 && (
                <div className="status-panel-empty" role="status">
                  <RefreshCw size={18} className="spin-icon" />
                  <span>Checking planner services&hellip;</span>
                </div>
              )}
              {!healthLoading && serviceChecks.length === 0 && !healthError && (
                <div className="status-panel-empty">
                  <ShieldCheck size={18} />
                  <span>Run checks to verify planner services.</span>
                </div>
              )}
              {healthError && serviceChecks.length === 0 && (
                <div className="status-panel-empty status-panel-empty--error">
                  <XCircle size={18} />
                  <span>Service details are unavailable.</span>
                </div>
              )}
            </div>
          </section>

          <aside className="status-panel status-runtime-panel" aria-label="Runtime details">
            <div className="status-panel-head">
              <div>
                <span className="status-panel-kicker">Live diagnostics</span>
                <h2>Runtime</h2>
              </div>
              <Activity size={18} aria-hidden />
            </div>
            {backendMeta ? (
              <div className="status-meta-grid">
                <div className="status-meta-stat"><span className="status-meta-label">Environment</span><strong>{backendMeta.env}</strong></div>
                <div className="status-meta-stat"><span className="status-meta-label">Version</span><strong>{backendMeta.version}</strong></div>
                <div className="status-meta-stat"><span className="status-meta-label">Uptime</span><strong>{formatUptime(backendMeta.uptime)}</strong></div>
                <div className="status-meta-stat"><span className="status-meta-label">Node</span><strong>{backendMeta.nodeVersion}</strong></div>
                <div className="status-meta-stat"><span className="status-meta-label">Heap</span><strong>{backendMeta.heapUsedMb} MB</strong></div>
                <div className="status-meta-stat"><span className="status-meta-label">RSS</span><strong>{backendMeta.rssMb} MB</strong></div>
                <div className="status-meta-stat status-meta-stat--wide"><span className="status-meta-label">Measured latency</span><strong>{backendMeta.latencyMs} ms</strong></div>
              </div>
            ) : (
              <div className="status-runtime-empty">
                <HardDrive size={20} aria-hidden />
                <p>Runtime diagnostics appear after a successful service check.</p>
              </div>
            )}
          </aside>
        </div>

        {(browserChecks.length > 0 || healthLoading) && (
          <section className="status-check-section" aria-labelledby="browser-status-heading">
            <div className="status-section-heading">
              <div>
                <span>Local compatibility</span>
                <h2 id="browser-status-heading">This device</h2>
              </div>
              <p>Browser capabilities used for settings, maps, and network access.</p>
            </div>
            <div className="status-grid">{browserChecks.map((check) => renderCheck(check, 'browser'))}</div>
          </section>
        )}

        <AppDisclaimer compact navigateToView={navigateToView} />
      </section>
    </div>
  );
}
