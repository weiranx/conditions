import { Suspense, type ReactNode } from 'react';
import { FeatureFlagsProvider } from './contexts/FeatureFlagsProvider.tsx';
import { AccountProvider } from './contexts/AccountProvider.tsx';

function Loading() {
  return (
    <main className="loading-state" role="status" aria-live="polite" aria-busy="true">
      Loading Backcountry Conditions…
    </main>
  );
}

/**
 * The providers sit outside the Suspense boundary on purpose. A boundary that is still waiting on a
 * screen's code commits nothing beneath it, so providers inside it would send their requests (feature
 * flags, the session) only after the whole planner had downloaded. Outside it they send them at once,
 * and the responses are ready by the time the screen renders.
 */
export function AppRoot({ landing, children }: { landing: boolean; children: ReactNode }) {
  if (landing) {
    // The landing page needs no account or feature flags, so it skips their requests and polling.
    return <Suspense fallback={<Loading />}>{children}</Suspense>;
  }
  return (
    <FeatureFlagsProvider>
      <AccountProvider>
        <Suspense fallback={<Loading />}>{children}</Suspense>
      </AccountProvider>
    </FeatureFlagsProvider>
  );
}
