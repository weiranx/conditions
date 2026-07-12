import React from 'react';

const CHUNK_RELOAD_GUARD_KEY = 'summitsafe:chunk-reload-attempt:v1';
const CHUNK_RELOAD_GUARD_MS = 30_000;

function isRecoverableChunkLoadError(error: Error): boolean {
  const message = `${error.name}: ${error.message}`;
  return /ChunkLoadError|Loading chunk .* failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Expected a JavaScript-or-Wasm module script/i.test(message);
}

function reloadAfterChunkLoadError(): void {
  const locationKey = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  try {
    const rawAttempt = window.sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY);
    if (rawAttempt) {
      try {
        const previousAttempt = JSON.parse(rawAttempt) as { location?: unknown; attemptedAt?: unknown };
        const attemptedAt = Number(previousAttempt.attemptedAt);
        const elapsed = Date.now() - attemptedAt;
        if (
          previousAttempt.location === locationKey &&
          Number.isFinite(attemptedAt) &&
          elapsed >= 0 &&
          elapsed < CHUNK_RELOAD_GUARD_MS
        ) {
          return;
        }
      } catch {
        // Replace a malformed guard value below.
      }
    }

    window.sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, JSON.stringify({
      location: locationKey,
      attemptedAt: Date.now(),
    }));
    window.location.reload();
  } catch {
    // Without session storage, reloading could create an unrecoverable loop.
  }
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Backcountry Conditions crashed:', error, info.componentStack);
    if (isRecoverableChunkLoadError(error)) {
      reloadAfterChunkLoadError();
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', maxWidth: '600px', margin: '4rem auto', fontFamily: 'system-ui, sans-serif' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Something went wrong</h1>
          <p style={{ marginBottom: '1rem', color: '#666' }}>
            An unexpected error occurred. Refreshing the page usually resolves this.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ marginTop: '1rem', padding: '0.5rem 1.25rem', background: '#222', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.9rem' }}
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
