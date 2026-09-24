import { useState, useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { fetchApi, fetchApiStream, readApiErrorMessage, type StreamEvent } from '../lib/api-client';
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

export type RouteLeg = 'return';

/** How a route runs past its objective: back the same way, around a loop, or on to another finish. */
export type RouteShape = 'out-and-back' | 'loop' | 'point-to-point';
/** The traveler's choice of shape; "auto" leaves it to the route (a GPX track as drawn, a named route's landmarks). */
export type RouteShapeChoice = 'auto' | RouteShape;

/** When to turn around at the objective, from the traveler's pace. */
export interface RouteTurnaround {
  objectiveName: string;
  objectiveEta: string;
  /** Minutes from the objective back to the finish. */
  returnMinutes: number;
  /** Latest turnaround clock (HH:MM) to finish by the end of the planned window. */
  byPlanEnd: string;
  /** Latest turnaround clock to finish by sunset at the finish, when sunset is known. */
  byDark?: string;
  sunset?: string;
  /** Minutes to spare at the objective before those turnaround times; negative when it is reached later. */
  marginToPlanEndMinutes: number;
  marginToDarkMinutes?: number;
}

export interface RouteWaypointSummary {
  name: string;
  /** Null when no elevation source knew the checkpoint's elevation. */
  elev_ft: number | null;
  distance_miles?: number;
  progress_percent?: number;
  /** Set on the estimated return to the start of an out-and-back route. */
  leg?: RouteLeg;
  /** Whether the estimated arrival falls between the checkpoint's sunrise and sunset. */
  daylight?: 'day' | 'dark';
  /** A generated landmark the map search couldn't find, so its location is the AI's estimate. */
  locationEstimated?: boolean;
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
  /** The route name this analysis was requested for; older saved analyses lack it. */
  routeName?: string;
  /** The plan this analysis was requested for, to tell when the plan has changed since; older saved analyses lack it. */
  request?: RouteAnalysisRequest;
  waypoints: Array<{
    name: string;
    lat: number;
    lon: number;
    elev_ft: number | null;
    distance_miles?: number;
    progress_percent?: number;
    leg?: RouteLeg;
    eta_date?: string;
    eta_time?: string;
    offset_minutes?: number;
    /** False for a generated landmark the map search couldn't find. */
    geocodingVerified?: boolean;
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
  /** The mapped trail's line, thinned for drawing, with distance along it; only for NPS and OpenStreetMap routes. */
  routeGeometry?: Array<{ lat: number; lon: number; distance_miles?: number }>;
  terrainProfile?: {
    sampledPointCount?: number;
    sampledDistanceMiles?: number;
    sampledElevationGainFt?: number;
    maxSampledGradePct?: number | null;
    dominantTravelAspects?: string[];
    note?: string;
  };
  routeMetadata?: GpxRouteMetadata;
  timing?: RouteTiming;
}

export interface RouteAnalysisRequest {
  lat: number;
  lon: number;
  date: string;
  start: string;
  travelWindowHours: number;
  routeShape?: RouteShapeChoice;
  pace?: RoutePace;
}

export interface RoutePace {
  minutesPerMile: number;
  ascentMinutesPer1000Ft: number;
  /** Stop and transition minutes for the outing; with a pace, arrivals follow it directly. */
  stopBufferMinutes?: number;
}

/** How checkpoint arrival times were spread across the planned travel window. */
export interface RouteTiming {
  basis: 'distance-and-vert' | 'distance' | 'progress' | 'even';
  /**
   * "pace": arrivals follow the traveler's pace and stop time from the start.
   * "window": arrivals are spread across the planned duration because the route's
   * length isn't known well enough for a pace. Older saved analyses lack it (window).
   */
  mode?: 'pace' | 'window';
  roundTrip: boolean;
  /** How the route runs past its objective: back the same way, around a loop, or on to another finish. */
  routeShape?: RouteShape;
  /** Set when the traveler chose the shape rather than the route. */
  shapeSource?: 'traveler';
  travelWindowHours: number;
  pace: RoutePace;
  paceSource: 'user' | 'default';
  /** Stop and transition minutes spread across the outing, in pace mode. */
  stopMinutes?: number;
  /** The whole outing at the traveler's pace, stops included, in pace mode. */
  estimatedMinutes?: number;
  /** How the pace estimate compares with the planned duration, in pace mode. */
  windowFit?: 'fits' | 'longer' | 'shorter';
  /** Arrivals follow every climb and descent of the GPX track, not just those between checkpoints. */
  trackTimed?: boolean;
  turnaround?: RouteTurnaround;
  /**
   * How named-route checkpoint distances were found: measured along a mapped
   * trail, scaled to the route's listed length, or straight lines.
   */
  distanceBasis?: 'along-trail' | 'route-length' | 'straight-line';
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
  /** Ratio of distance to climbing used to weight checkpoint arrival times. */
  pace?: RoutePace;
  /** Round-trip length of the chosen suggested route, to scale checkpoint distances. */
  routeDistanceRtMiles?: number;
  /** A GPX track's distance and elevation, [miles, feet | null], to time arrivals over every climb. */
  track?: Array<[number, number | null]>;
  routeShape?: RouteShapeChoice;
}

/** Where a streamed route analysis has got to: finding the route, placing checkpoints, their forecasts, the briefing. */
export type RouteAnalysisStage = 'route' | 'locating' | 'forecasts' | 'briefing';

export interface RouteProgressCheckpoint {
  name: string;
  etaTime?: string;
  leg?: RouteLeg;
  status: 'pending' | 'done' | 'missing';
  weather?: { temp?: number; windGust?: number; precipChance?: number; description?: string };
}

export interface RouteLoadingState {
  kind: 'suggestions' | 'analysis';
  routeName: string;
  checkpointCount?: number;
  startedAt: number;
  /** Set as a streaming server reports progress. */
  stage?: RouteAnalysisStage;
  checkpoints?: RouteProgressCheckpoint[];
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
  routeShape: RouteShapeChoice;
  setRouteShape: (value: RouteShapeChoice) => void;
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
  /** Stops the analysis or suggestions in progress, keeping whatever was there before. */
  cancelRouteRequest: () => void;
  /** Drops the analysis for a new report but keeps the planned route and its options. */
  clearRouteAnalysis: () => void;
  restoreRouteState: (state: {
    routeSuggestions: RouteOption[] | null;
    routeAnalysis: RouteAnalysisResult | null;
    customRouteName: string;
    routeShape?: RouteShapeChoice;
  }) => void;
}

export interface RouteAnalysisInput {
  peak: string;
  route: string;
  lat: number;
  lon: number;
  date: string;
  start: string;
  travelWindowHours: number;
  units?: RouteAnalysisUnits;
  options?: RouteAnalysisOptions;
}

/**
 * Analyze one route for a plan, following the server's progress lines when it
 * streams them. The result keeps the route name and plan it was run for, so
 * renaming the route later can't relabel its checkpoints and a changed plan can
 * be flagged. Throws with the server's message on failure.
 */
export async function requestRouteAnalysis(
  { peak, route, lat, lon, date, start, travelWindowHours, units, options }: RouteAnalysisInput,
  { signal, onProgress = () => {} }: { signal?: AbortSignal; onProgress?: (event: StreamEvent) => void } = {},
): Promise<RouteAnalysisResult> {
  const { ok, payload } = await fetchApiStream('/api/route-analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
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
      ...(options?.pace ? { pace: options.pace } : {}),
      ...(options?.routeDistanceRtMiles ? { route_distance_rt_miles: options.routeDistanceRtMiles } : {}),
      ...(options?.track ? { track: options.track } : {}),
      ...(options?.routeShape && options.routeShape !== 'auto' ? { route_shape: options.routeShape } : {}),
    }),
  }, onProgress);
  if (!ok) throw new Error(readApiErrorMessage(payload, 'Failed to analyze route'));
  return {
    ...(payload as RouteAnalysisResult),
    routeName: route,
    request: { lat, lon, date, start, travelWindowHours, routeShape: options?.routeShape ?? 'auto', ...(options?.pace ? { pace: options.pace } : {}) },
  };
}

export function useRouteAnalysis(initialState?: {
  routeSuggestions?: RouteOption[] | null;
  routeAnalysis?: RouteAnalysisResult | null;
  customRouteName?: string;
  routeShape?: RouteShapeChoice;
}): UseRouteAnalysisReturn {
  const [routeSuggestions, setRouteSuggestions] = useState<RouteOption[] | null>(initialState?.routeSuggestions ?? null);
  const [routeAnalysis, setRouteAnalysis] = useState<RouteAnalysisResult | null>(initialState?.routeAnalysis ?? null);
  const [routeLoadingState, setRouteLoadingState] = useState<RouteLoadingState | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [customRouteName, setCustomRouteName] = useState(initialState?.customRouteName ?? '');
  const [routeShape, setRouteShape] = useState<RouteShapeChoice>(initialState?.routeShape ?? 'auto');
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
      stage: 'route',
      ...(options?.waypoints ? { checkpointCount: options.waypoints.length } : {}),
    });
    setRouteAnalysis(null);
    setRouteError(null);
    // Progress lines update the loading state while this request is still current.
    const onProgress = (event: StreamEvent) => {
      if (!isCurrentRequest(request.id)) return;
      setRouteLoadingState((state) => {
        if (!state || state.kind !== 'analysis') return state;
        if (event.type === 'stage' && event.stage === 'forecasts' && Array.isArray(event.checkpoints)) {
          return {
            ...state,
            stage: 'forecasts',
            checkpointCount: event.checkpoints.length,
            checkpoints: (event.checkpoints as Array<{ name: string; etaTime?: string; leg?: RouteLeg }>).map((checkpoint) => ({ ...checkpoint, status: 'pending' })),
          };
        }
        if (event.type === 'stage' && (event.stage === 'locating' || event.stage === 'briefing')) {
          return { ...state, stage: event.stage, ...(typeof event.checkpointCount === 'number' && !state.checkpoints ? { checkpointCount: event.checkpointCount } : {}) };
        }
        if (event.type === 'checkpoint' && typeof event.index === 'number' && state.checkpoints?.[event.index]) {
          const checkpoints = [...state.checkpoints];
          checkpoints[event.index] = {
            ...checkpoints[event.index],
            status: event.dataAvailable ? 'done' : 'missing',
            ...(event.weather ? { weather: event.weather as RouteProgressCheckpoint['weather'] } : {}),
          };
          return { ...state, checkpoints };
        }
        return state;
      });
    };
    try {
      const analysis = await requestRouteAnalysis(
        { peak, route, lat, lon, date, start, travelWindowHours, units, options },
        { signal: request.controller.signal, onProgress },
      );
      if (!isCurrentRequest(request.id)) return;
      setRouteAnalysis(analysis);
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
    setCustomRouteName('');
    setRouteShape('auto');
  }, []);

  const cancelRouteRequest = useCallback(() => {
    activeRequestRef.current?.controller.abort();
    activeRequestRef.current = null;
    nextRequestIdRef.current += 1;
    setRouteLoadingState(null);
  }, []);

  const clearRouteAnalysis = useCallback(() => {
    activeRequestRef.current?.controller.abort();
    activeRequestRef.current = null;
    nextRequestIdRef.current += 1;
    setRouteLoadingState(null);
    setRouteAnalysis(null);
    setRouteError(null);
  }, []);

  const restoreRouteState = useCallback((state: {
    routeSuggestions: RouteOption[] | null;
    routeAnalysis: RouteAnalysisResult | null;
    customRouteName: string;
    routeShape?: RouteShapeChoice;
  }) => {
    activeRequestRef.current?.controller.abort();
    activeRequestRef.current = null;
    nextRequestIdRef.current += 1;
    setRouteLoadingState(null);
    setRouteError(null);
    setRouteSuggestions(state.routeSuggestions);
    setRouteAnalysis(state.routeAnalysis);
    setCustomRouteName(state.customRouteName);
    setRouteShape(state.routeShape ?? 'auto');
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
    routeShape,
    setRouteShape,
    fetchRouteSuggestions,
    fetchRouteAnalysis,
    resetRouteState,
    cancelRouteRequest,
    clearRouteAnalysis,
    restoreRouteState,
  };
}
