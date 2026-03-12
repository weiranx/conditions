import { useState, useCallback, useRef, useEffect, useTransition } from 'react';
import L from 'leaflet';
import type { UserPreferences } from '../app/types';
import { parseLinkState, buildShareQuery } from '../app/url-state';

export type AppView = 'home' | 'planner' | 'settings' | 'status' | 'trip' | 'logs';

export interface UseUrlStateParams {
  todayDate: string;
  maxForecastDate: string;
  preferences: UserPreferences;
  initialView: AppView;
  onPopState: (linkState: ReturnType<typeof parseLinkState>) => void;
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
}: UseUrlStateParams): UseUrlStateReturn {
  const [view, setView] = useState<AppView>(initialView);
  const [isViewPending, startViewChange] = useTransition();

  const isApplyingPopStateRefRef = useRef(false);

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
      isApplyingPopStateRefRef.current = true;
      const linkState = parseLinkState(todayDate, maxForecastDate, preferences);
      onPopState(linkState);
      setView(linkState.view);
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
  isApplyingPopStateRef: React.MutableRefObject<boolean>;
  hasInitializedHistoryRef: React.MutableRefObject<boolean>;
}) {
  const {
    view, hasObjective, position, objectiveName, committedSearchQuery,
    forecastDate, alpineStartTime, targetElevationInput,
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
    isApplyingPopStateRef,
    hasInitializedHistoryRef,
  ]);
}
