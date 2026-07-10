import { useState, useCallback, useEffect, useTransition } from 'react';
import { flushSync } from 'react-dom';
import L from 'leaflet';
import type { UserPreferences } from '../app/types';
import { parseLinkState, buildShareQuery } from '../app/url-state';

/**
 * Cross-fade between views using the View Transitions API when available.
 * The state change must be flushed synchronously inside the transition
 * callback so the "new" snapshot captures the updated DOM — flushSync would
 * not flush a startTransition-marked update, so `apply` must set state
 * directly. `fallback` runs instead on unsupported browsers or when the user
 * prefers reduced motion.
 */
function withViewTransition(apply: () => void, fallback: () => void = apply) {
  const doc = document as Document & {
    startViewTransition?: (callback: () => void) => {
      ready?: Promise<void>;
      finished?: Promise<void>;
      updateCallbackDone?: Promise<void>;
    };
  };
  if (
    typeof doc.startViewTransition !== 'function' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    fallback();
    return;
  }
  const transition = doc.startViewTransition(() => {
    flushSync(apply);
  });
  // A transition aborted by a rapid follow-up navigation (or a hidden tab)
  // rejects these promises; that's expected, not an error worth surfacing.
  transition?.ready?.catch(() => {});
  transition?.finished?.catch(() => {});
  transition?.updateCallbackDone?.catch(() => {});
}

export type AppView = 'home' | 'planner' | 'settings' | 'status' | 'trip' | 'logs';

export interface UseUrlStateParams {
  todayDate: string;
  maxForecastDate: string;
  preferences: UserPreferences;
  initialView: AppView;
  onPopState: (linkState: ReturnType<typeof parseLinkState>) => void;
  isApplyingPopStateRef?: React.MutableRefObject<boolean>;
}

export interface UseUrlStateReturn {
  view: AppView;
  setView: React.Dispatch<React.SetStateAction<AppView>>;
  isViewPending: boolean;
  startViewChange: (callback: () => void) => void;
  navigateToView: (nextView: AppView) => void;
}

export function useUrlState({
  todayDate,
  maxForecastDate,
  preferences,
  initialView,
  onPopState,
  isApplyingPopStateRef,
}: UseUrlStateParams): UseUrlStateReturn {
  const [view, setView] = useState<AppView>(initialView);
  const [isViewPending, startReactTransition] = useTransition();

  const startViewChange = useCallback(
    (callback: () => void) => {
      withViewTransition(callback, () => startReactTransition(callback));
    },
    [startReactTransition],
  );

  const navigateToView = useCallback(
    (nextView: AppView) => {
      startViewChange(() => setView(nextView));
    },
    [startViewChange],
  );

  // Handle popstate (browser back/forward)
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handlePopState = () => {
      if (isApplyingPopStateRef) isApplyingPopStateRef.current = true;
      const linkState = parseLinkState(todayDate, maxForecastDate, preferences);
      withViewTransition(() => {
        onPopState(linkState);
        setView(linkState.view);
      });
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayDate, maxForecastDate, preferences.defaultStartTime, onPopState]);

  return {
    view,
    setView,
    isViewPending,
    startViewChange,
    navigateToView,
  };
}

/**
 * Sync the URL bar with current planner state. Call this from an effect in App.
 * Exported separately since it uses external state not owned by the hook.
 */
export function useSyncUrlEffect(params: {
  view: AppView;
  hasObjective: boolean;
  position: L.LatLng;
  objectiveName: string;
  committedSearchQuery: string;
  forecastDate: string;
  alpineStartTime: string;
  targetElevationInput: string;
  travelWindowHours?: number;
  isApplyingPopStateRef: React.MutableRefObject<boolean>;
  hasInitializedHistoryRef: React.MutableRefObject<boolean>;
}) {
  const {
    view, hasObjective, position, objectiveName, committedSearchQuery,
    forecastDate, alpineStartTime, targetElevationInput, travelWindowHours,
    isApplyingPopStateRef, hasInitializedHistoryRef,
  } = params;

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const hasSharableState = view === 'planner' || view === 'trip';
    const query = hasSharableState
      ? buildShareQuery({
          view,
          hasObjective,
          position,
          objectiveName,
          searchQuery: committedSearchQuery,
          forecastDate,
          alpineStartTime,
          targetElevationInput,
          travelWindowHours,
        })
      : '';

    const viewPath = view === 'home' ? '' : view;
    const nextUrl = `/${viewPath}${query ? `?${query}` : ''}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (nextUrl !== currentUrl) {
      if (isApplyingPopStateRef.current || !hasInitializedHistoryRef.current) {
        window.history.replaceState(null, '', nextUrl);
      } else {
        window.history.pushState(null, '', nextUrl);
      }
    }

    isApplyingPopStateRef.current = false;
    hasInitializedHistoryRef.current = true;
  }, [
    view,
    hasObjective,
    position,
    objectiveName,
    committedSearchQuery,
    forecastDate,
    alpineStartTime,
    targetElevationInput,
    travelWindowHours,
    isApplyingPopStateRef,
    hasInitializedHistoryRef,
  ]);
}
