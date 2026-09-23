import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './field/FieldApp.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { FeatureFlagsProvider } from './contexts/FeatureFlagsProvider.tsx'
import { AccountProvider } from './contexts/AccountProvider.tsx'
import { readLocalStorage, shouldShowLanding } from './app/landing-gate.ts'

const McpConnect = lazy(() => import('./field/McpConnect'));
const Landing = lazy(() => import('./field/Landing'));
const showLanding = shouldShowLanding(window.location, readLocalStorage());

const MockControls = import.meta.env.DEV && import.meta.env.VITE_MOCK_API === 'true' ? lazy(() => import('./field/MockControls')) : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {MockControls && <Suspense fallback={null}><MockControls /></Suspense>}
      <Suspense
        fallback={(
          <main className="loading-state" role="status" aria-live="polite" aria-busy="true">
            Loading Backcountry Conditions…
          </main>
        )}
      >
        <FeatureFlagsProvider>
          <AccountProvider>
            {window.location.pathname === '/connect' ? <McpConnect /> : showLanding ? <Landing /> : <App />}
          </AccountProvider>
        </FeatureFlagsProvider>
      </Suspense>
    </ErrorBoundary>
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const hadController = Boolean(navigator.serviceWorker.controller)
    let reloadingForWorkerUpdate = false

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloadingForWorkerUpdate) return
      reloadingForWorkerUpdate = true
      window.location.reload()
    })

    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => registration.update())
  })
}
