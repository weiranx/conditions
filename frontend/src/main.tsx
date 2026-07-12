import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/tokens.css'
import App from './App.tsx'
import './styles/mobile-experience.css'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { FeatureFlagsProvider } from './contexts/FeatureFlagsProvider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Suspense
        fallback={(
          <main className="loading-state" role="status" aria-live="polite" aria-busy="true">
            Loading Backcountry Conditions…
          </main>
        )}
      >
        <FeatureFlagsProvider>
          <App />
        </FeatureFlagsProvider>
      </Suspense>
    </ErrorBoundary>
  </StrictMode>,
)
