import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/tokens.css'
import App from './App.tsx'
import './styles/mobile-experience.css'
import './styles/field-instrument.css'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { FeatureFlagsProvider } from './contexts/FeatureFlagsProvider.tsx'
import { AccountProvider } from './contexts/AccountProvider.tsx'

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
          <AccountProvider>
            <App />
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
