import { useState, useCallback, type Dispatch, type SetStateAction } from 'react';
import { fetchApi, readApiErrorMessage } from '../lib/api-client';

export interface RouteOption {
  name: string;
  distance_rt_miles: number;
  elev_gain_ft: number;
  class: string;
  description: string;
}

export interface RouteWaypointSummary {
  name: string;
  elev_ft: number;
  score: number | null;
  weather: { temp?: number; windSpeed?: number; description?: string; precipChance?: number };
  avalanche: { risk?: string; dangerLevel?: number };
  activeAlerts: number;
  snowDepthIn: number | null;
}

export interface RouteAnalysisResult {
  waypoints: { name: string; lat: number; lon: number; elev_ft: number }[];
  summaries: RouteWaypointSummary[];
  analysis: string;
}

export interface UseRouteAnalysisReturn {
  routeSuggestions: RouteOption[] | null;
  setRouteSuggestions: Dispatch<SetStateAction<RouteOption[] | null>>;
  routeAnalysis: RouteAnalysisResult | null;
  routeLoading: boolean;
  routeError: string | null;
  setRouteError: Dispatch<SetStateAction<string | null>>;
  customRouteName: string;
  setCustomRouteName: (value: string) => void;
  fetchRouteSuggestions: (peak: string, lat: number, lon: number) => Promise<void>;
  fetchRouteAnalysis: (
    peak: string,
    route: string,
    lat: number,
    lon: number,
    date: string,
    start: string,
    travelWindowHours: number,
  ) => Promise<void>;
  resetRouteState: () => void;
}

export function useRouteAnalysis(): UseRouteAnalysisReturn {
  const [routeSuggestions, setRouteSuggestions] = useState<RouteOption[] | null>(null);
  const [routeAnalysis, setRouteAnalysis] = useState<RouteAnalysisResult | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [customRouteName, setCustomRouteName] = useState('');

  const fetchRouteSuggestions = useCallback(async (peak: string, lat: number, lon: number) => {
    setRouteSuggestions(null);
    setRouteAnalysis(null);
    setRouteError(null);
    setRouteLoading(true);
    setCustomRouteName('');
    try {
      const { response, payload } = await fetchApi(`/api/route-suggestions?peak=${encodeURIComponent(peak)}&lat=${lat}&lon=${lon}`);
      if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Failed to load route suggestions'));
      setRouteSuggestions(payload as RouteOption[]);
    } catch (err) {
      setRouteError(err instanceof Error ? err.message : 'Could not load route suggestions. Try again.');
    } finally {
      setRouteLoading(false);
    }
  }, []);

  const fetchRouteAnalysis = useCallback(async (peak: string, route: string, lat: number, lon: number, date: string, start: string, travelWindowHours: number) => {
    setRouteAnalysis(null);
    setRouteError(null);
    setRouteLoading(true);
    try {
      const { response, payload } = await fetchApi('/api/route-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peak, route, lat, lon, date, start, travel_window_hours: travelWindowHours }),
      });
      if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Failed to analyze route'));
      setRouteAnalysis(payload as RouteAnalysisResult);
    } catch (err) {
      setRouteError(err instanceof Error ? err.message : 'Route analysis failed. Try again.');
    } finally {
      setRouteLoading(false);
    }
  }, []);

  const resetRouteState = useCallback(() => {
    setRouteSuggestions(null);
    setRouteAnalysis(null);
    setRouteError(null);
  }, []);

  return {
    routeSuggestions,
    setRouteSuggestions,
    routeAnalysis,
    routeLoading,
    routeError,
    setRouteError,
    customRouteName,
    setCustomRouteName,
    fetchRouteSuggestions,
    fetchRouteAnalysis,
    resetRouteState,
  };
}
