import React from 'react';

const CHUNK_RECOVERY_GUARD_KEY = 'summitsafe:chunk-recovery-attempts:v2';
const CHUNK_RECOVERY_WINDOW_MS = 2 * 60_000;
const CHUNK_RECOVERY_STABLE_MS = 15_000;
const CHUNK_RECOVERY_MAX_RELOADS = 3;
const CHUNK_RECOVERY_PROBE_DELAYS_MS = [750, 1_500, 3_000, 5_000, 8_000, 13_000, 20_000];

interface ChunkRecoveryHistory {
  location: string;
  attemptedAt: number[];
}

function isRecoverableChunkLoadError(error: Error): boolean {
  const message = `${error.name}: ${error.message}`;
  return /ChunkLoadError|Loading chunk .* failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Expected a JavaScript-or-Wasm module script/i.test(message);
}

function readChunkRecoveryHistory(): ChunkRecoveryHistory | null {
  const locationKey = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  try {
    const rawHistory = window.sessionStorage.getItem(CHUNK_RECOVERY_GUARD_KEY);
    if (!rawHistory) return { location: locationKey, attemptedAt: [] };

    const parsed = JSON.parse(rawHistory) as { location?: unknown; attemptedAt?: unknown };
    if (parsed.location !== locationKey || !Array.isArray(parsed.attemptedAt)) {
      return { location: locationKey, attemptedAt: [] };
    }

    const cutoff = Date.now() - CHUNK_RECOVERY_WINDOW_MS;
    const attemptedAt = parsed.attemptedAt
      .map(Number)
      .filter((timestamp) => Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= Date.now());
    return { location: locationKey, attemptedAt };
  } catch {
    // Without session storage, an automatic reload could create an unrecoverable loop.
    return null;
  }
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

function getChunkRecoveryProbe(): string {
  const url = new URL(window.location.href);
  url.searchParams.set('__chunk_recovery', Date.now().toString());
  return url.href;
}

async function reloadWhenAppIsAvailable(): Promise<boolean> {
  const history = readChunkRecoveryHistory();
  if (!history || history.attemptedAt.length >= CHUNK_RECOVERY_MAX_RELOADS) return false;
  const probeUrl = getChunkRecoveryProbe();

  for (const delayMs of CHUNK_RECOVERY_PROBE_DELAYS_MS) {
    await wait(delayMs);

    try {
      const response = await window.fetch(probeUrl, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) continue;
      if (!response.headers.get('content-type')?.includes('text/html')) continue;

      window.sessionStorage.setItem(CHUNK_RECOVERY_GUARD_KEY, JSON.stringify({
        ...history,
        attemptedAt: [...history.attemptedAt, Date.now()],
      }));
      window.location.reload();
      return true;
    } catch {
      // The frontend is still restarting. Try again after the next backoff.
    }
  }

  return false;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  recoveryExhausted: boolean;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  private recoveryStarted = false;

  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, recoveryExhausted: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, recoveryExhausted: false };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Backcountry Conditions crashed:', error, info.componentStack);
    if (isRecoverableChunkLoadError(error) && !this.recoveryStarted) {
      this.recoveryStarted = true;
      void reloadWhenAppIsAvailable().then((willReload) => {
        if (!willReload) this.setState({ recoveryExhausted: true });
      });
    }
  }

  componentDidMount() {
    window.setTimeout(() => {
      if (!this.state.hasError) {
        try {
          window.sessionStorage.removeItem(CHUNK_RECOVERY_GUARD_KEY);
        } catch {
          // Recovery remains disabled when session storage is unavailable.
        }
      }
    }, CHUNK_RECOVERY_STABLE_MS);
  }

  private handleReload = () => {
    try {
      window.sessionStorage.removeItem(CHUNK_RECOVERY_GUARD_KEY);
    } catch {
      // A user-requested reload is safe even when session storage is unavailable.
    }
    window.location.reload();
  }

  render() {
    if (this.state.hasError) {
      const recovering = Boolean(this.state.error && isRecoverableChunkLoadError(this.state.error));
      return (
        <main className="app-error-boundary" role="alert" aria-live="assertive">
          <section className="app-error-boundary-card" aria-labelledby="app-error-boundary-title">
            <span className="app-error-boundary-icon" aria-hidden>!</span>
            <p className="app-error-boundary-eyebrow">
              {recovering && !this.state.recoveryExhausted ? 'Connection interrupted' : 'Application error'}
            </p>
            <h1 id="app-error-boundary-title">
              {recovering && !this.state.recoveryExhausted ? 'Reconnecting…' : 'Something went wrong'}
            </h1>
            <p className="app-error-boundary-copy">
              {recovering && !this.state.recoveryExhausted
                ? 'The app was briefly unavailable. It will reload automatically when the server is ready.'
                : 'An unexpected error occurred. Refreshing the page usually resolves this.'}
            </p>
            <button type="button" onClick={this.handleReload}>Reload now</button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
