import { useState, useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { fetchApi, readApiErrorMessage } from '../lib/api-client';
import type { GpxCheckpoint } from '../lib/gpx';

export interface RouteAnalysisUnits {
  temperature: 'f' | 'c';
  wind: 'mph' | 'kph';
  elevation: 'ft' | 'm';
}

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
  distance_miles?: number;
  progress_percent?: number;
  etaDate?: string;
  etaTime?: string;
  offsetMinutes?: number;
  dataAvailable: boolean;
  score: number | null;
  weather: { temp?: number; feelsLike?: number; windSpeed?: number; windGust?: number; description?: string; precipChance?: number };
  avalanche?: { risk?: string; dangerLevel?: number };
  activeAlerts: number;
  snowDepthIn?: number | null;
}

export interface RouteAnalysisResult {
  waypoints: Array<{
    name: string;
    lat: number;
    lon: number;
    elev_ft: number;
    distance_miles?: number;
    progress_percent?: number;
    eta_date?: string;
    eta_time?: string;
    offset_minutes?: number;
  }>;
  summaries: RouteWaypointSummary[];
  analysis: string;
  analysisSource?: 'ai' | 'deterministic';
  partialData: boolean;
  routeSource?: 'generated' | 'gpx' | 'nps' | 'openstreetmap';
  routeSourceDetails?: {
    sourceLabel?: string;
    matchedName?: string;
    matchScore?: number;
    metadata?: Record<string, unknown>;
  };
  terrainProfile?: {
    sampledPointCount?: number;
    sampledDistanceMiles?: number;
    sampledElevationGainFt?: number;
    maxSampledGradePct?: number | null;
    dominantTravelAspects?: string[];
    note?: string;
  };
  routeMetadata?: GpxRouteMetadata;
}

export interface GpxRouteMetadata {
  fileName: string;
  pointCount: number | null;
  distanceMiles: number | null;
  elevationGainFt: number | null;
  minElevationFt: number | null;
  maxElevationFt: number | null;
  routeShape?: 'closed route' | 'point-to-point' | null;
}

export interface RouteAnalysisOptions {
  waypoints?: GpxCheckpoint[];
  routeMetadata?: GpxRouteMetadata;
}

export interface RouteLoadingState {
  kind: 'suggestions' | 'analysis';
  routeName: string;
  checkpointCount?: number;
  startedAt: number;
}

export interface UseRouteAnalysisReturn {
  routeSuggestions: RouteOption[] | null;
  setRouteSuggestions: Dispatch<SetStateAction<RouteOption[] | null>>;
  routeAnalysis: RouteAnalysisResult | null;
  routeLoading: boolean;
  routeLoadingState: RouteLoadingState | null;
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
    units?: RouteAnalysisUnits,
    options?: RouteAnalysisOptions,
  ) => Promise<void>;
  resetRouteState: () => void;
}

export function useRouteAnalysis(): UseRouteAnalysisReturn {
  const [routeSuggestions, setRouteSuggestions] = useState<RouteOption[] | null>(null);
  const [routeAnalysis, setRouteAnalysis] = useState<RouteAnalysisResult | null>(null);
  const [routeLoadingState, setRouteLoadingState] = useState<RouteLoadingState | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [customRouteName, setCustomRouteName] = useState('');
  const activeRequestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const nextRequestIdRef = useRef(0);

  const beginRequest = useCallback((loadingState: Omit<RouteLoadingState, 'startedAt'>) => {
    activeRequestRef.current?.controller.abort();
    const request = {
      id: nextRequestIdRef.current + 1,
      controller: new AbortController(),
    };
    nextRequestIdRef.current = request.id;
    activeRequestRef.current = request;
    setRouteLoadingState({ ...loadingState, startedAt: Date.now() });
    return request;
  }, []);

  const isCurrentRequest = useCallback((requestId: number) => activeRequestRef.current?.id === requestId, []);

  const finishRequest = useCallback((requestId: number) => {
    if (!isCurrentRequest(requestId)) return;
    activeRequestRef.current = null;
    setRouteLoadingState(null);
  }, [isCurrentRequest]);

  useEffect(() => () => {
    activeRequestRef.current?.controller.abort();
    activeRequestRef.current = null;
    nextRequestIdRef.current += 1;
  }, []);

  const fetchRouteSuggestions = useCallback(async (peak: string, lat: number, lon: number) => {
    const request = beginRequest({ kind: 'suggestions', routeName: peak });
    setRouteSuggestions(null);
    setRouteAnalysis(null);
    setRouteError(null);
    setCustomRouteName('');
    try {
      const { response, payload } = await fetchApi(`/api/route-suggestions?peak=${encodeURIComponent(peak)}&lat=${lat}&lon=${lon}`, {
        signal: request.controller.signal,
      });
      if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Failed to load route suggestions'));
      if (!isCurrentRequest(request.id)) return;
      setRouteSuggestions(payload as RouteOption[]);
    } catch (err) {
      if (request.controller.signal.aborted || !isCurrentRequest(request.id)) return;
      setRouteError(err instanceof Error ? err.message : 'Could not load route suggestions. Try again.');
    } finally {
      finishRequest(request.id);
    }
  }, [beginRequest, finishRequest, isCurrentRequest]);

  const fetchRouteAnalysis = useCallback(async (peak: string, route: string, lat: number, lon: number, date: string, start: string, travelWindowHours: number, units?: RouteAnalysisUnits, options?: RouteAnalysisOptions) => {
    const request = beginRequest({
      kind: 'analysis',
      routeName: route,
      ...(options?.waypoints ? { checkpointCount: options.waypoints.length } : {}),
    });
    setRouteAnalysis(null);
    setRouteError(null);
    try {
      const { response, payload } = await fetchApi('/api/route-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: request.controller.signal,
        body: JSON.stringify({
          peak,
          route,
          lat,
          lon,
          date,
          start,
          travel_window_hours: travelWindowHours,
          units: units ?? null,
          ...(options?.waypoints ? { waypoints: options.waypoints } : {}),
          ...(options?.routeMetadata ? { route_metadata: options.routeMetadata } : {}),
        }),
      });
      if (!response.ok) throw new Error(readApiErrorMessage(payload, 'Failed to analyze route'));
      if (!isCurrentRequest(request.id)) return;
      setRouteAnalysis(payload as RouteAnalysisResult);
    } catch (err) {
      if (request.controller.signal.aborted || !isCurrentRequest(request.id)) return;
      setRouteError(err instanceof Error ? err.message : 'Route analysis failed. Try again.');
    } finally {
      finishRequest(request.id);
    }
  }, [beginRequest, finishRequest, isCurrentRequest]);

  const resetRouteState = useCallback(() => {
    activeRequestRef.current?.controller.abort();
    activeRequestRef.current = null;
    nextRequestIdRef.current += 1;
    setRouteLoadingState(null);
    setRouteSuggestions(null);
    setRouteAnalysis(null);
    setRouteError(null);
  }, []);

  return {
    routeSuggestions,
    setRouteSuggestions,
    routeAnalysis,
    routeLoading: routeLoadingState !== null,
    routeLoadingState,
    routeError,
    setRouteError,
    customRouteName,
    setCustomRouteName,
    fetchRouteSuggestions,
    fetchRouteAnalysis,
    resetRouteState,
  };
}
