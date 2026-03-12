import { useState, useCallback } from 'react';
import { fetchApi, readApiErrorMessage } from '../lib/api-client';
import type { HealthCheckResult, BackendMeta } from '../app/types';

export interface UseHealthChecksReturn {
  healthChecks: HealthCheckResult[];
  healthLoading: boolean;
  healthCheckedAt: string | null;
  healthError: string | null;
  backendMeta: BackendMeta | null;
  runHealthChecks: () => Promise<void>;
}

export function useHealthChecks(): UseHealthChecksReturn {
  const [healthChecks, setHealthChecks] = useState<HealthCheckResult[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthCheckedAt, setHealthCheckedAt] = useState<string | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [backendMeta, setBackendMeta] = useState<BackendMeta | null>(null);

  const runHealthChecks = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const t0 = Date.now();
      const { response, payload, requestId } = await fetchApi('/api/healthz');
      const latencyMs = Date.now() - t0;

      if (!response.ok || !payload || typeof payload !== 'object') {
        const baseMessage = readApiErrorMessage(payload, `Health check failed (${response.status})`);
        throw new Error(requestId ? `${baseMessage} (request ${requestId})` : baseMessage);
      }

      const p = payload as {
        ok?: boolean;
        service?: string;
        version?: string;
        env?: string;
        uptime?: number;
        nodeVersion?: string;
        memory?: { heapUsedMb?: number; rssMb?: number };
      };

      const backendOk = Boolean(p.ok);
      const backendService = String(p.service || 'backcountry-conditions-backend');
      const backendEnv = String(p.env || 'unknown');
      const backendVersion = String(p.version || '?');
      const backendUptime = typeof p.uptime === 'number' ? p.uptime : null;
      const backendNodeVersion = String(p.nodeVersion || '?');
      const heapUsedMb = p.memory?.heapUsedMb ?? null;
      const rssMb = p.memory?.rssMb ?? null;

      const nowIso = new Date().toISOString();

      const localStorageAvailable = (() => {
        try {
          if (typeof window === 'undefined' || !window.localStorage) return false;
          const probeKey = '__summitsafe_health_probe__';
          window.localStorage.setItem(probeKey, '1');
          window.localStorage.removeItem(probeKey);
          return true;
        } catch {
          return false;
        }
      })();

      const cookiesAvailable = typeof navigator !== 'undefined' && navigator.cookieEnabled;

      const webGlAvailable = (() => {
        try {
          const canvas = document.createElement('canvas');
          return Boolean(canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl'));
        } catch {
          return false;
        }
      })();

      const latencyStatus: HealthCheckResult['status'] = latencyMs < 400 ? 'ok' : latencyMs < 1200 ? 'warn' : 'down';

      const formatUptime = (seconds: number) => {
        const d = Math.floor(seconds / 86400);
        const h = Math.floor((seconds % 86400) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (d > 0) return `${d}d ${h}h ${m}m`;
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m ${seconds % 60}s`;
      };

      if (backendUptime !== null && heapUsedMb !== null && rssMb !== null) {
        setBackendMeta({
          version: backendVersion,
          env: backendEnv,
          uptime: backendUptime,
          nodeVersion: backendNodeVersion,
          heapUsedMb,
          rssMb,
          latencyMs,
        });
      }

      const checks: HealthCheckResult[] = [
        {
          label: 'Backend API',
          status: backendOk ? 'ok' : 'down',
          detail: backendOk
            ? `${backendService} responded healthy (${backendEnv}).`
            : 'Backend health endpoint returned not-ok.',
          meta: backendOk && backendUptime !== null ? `Up for ${formatUptime(backendUptime)} · Node ${backendNodeVersion}` : undefined,
        },
        {
          label: 'API Latency',
          status: latencyStatus,
          detail:
            latencyStatus === 'ok'
              ? `Response in ${latencyMs} ms — within normal range.`
              : latencyStatus === 'warn'
                ? `Response in ${latencyMs} ms — slower than expected.`
                : `Response in ${latencyMs} ms — very slow, possible network issue.`,
          meta: `Measured round-trip to /api/healthz`,
        },
        {
          label: 'Browser Network',
          status: typeof navigator !== 'undefined' && navigator.onLine ? 'ok' : 'warn',
          detail:
            typeof navigator !== 'undefined' && navigator.onLine
              ? 'Browser reports online.'
              : 'Browser reports offline mode.',
        },
        {
          label: 'Browser Storage',
          status: localStorageAvailable ? 'ok' : 'warn',
          detail: localStorageAvailable
            ? 'Local preferences storage is available.'
            : 'Local storage unavailable (private mode or browser policy).',
        },
        {
          label: 'Browser Cookies',
          status: cookiesAvailable ? 'ok' : 'warn',
          detail: cookiesAvailable
            ? 'Cookies are enabled.'
            : 'Cookies are disabled — some features may not work correctly.',
        },
        {
          label: 'Browser WebGL',
          status: webGlAvailable ? 'ok' : 'warn',
          detail: webGlAvailable
            ? 'WebGL is available for map rendering.'
            : 'WebGL unavailable — map tile rendering may be degraded.',
        },
      ];

      setHealthChecks(checks);
      setHealthCheckedAt(nowIso);
    } catch (error) {
      setHealthChecks([]);
      setBackendMeta(null);
      setHealthError(error instanceof Error ? error.message : 'Health check failed.');
      setHealthCheckedAt(new Date().toISOString());
    } finally {
      setHealthLoading(false);
    }
  }, []);

  return {
    healthChecks,
    healthLoading,
    healthCheckedAt,
    healthError,
    backendMeta,
    runHealthChecks,
  };
}
