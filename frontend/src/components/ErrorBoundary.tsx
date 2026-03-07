import React from 'react';

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
