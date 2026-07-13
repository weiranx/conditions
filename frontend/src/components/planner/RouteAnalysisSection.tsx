import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ChevronDown, ChevronUp, FileCheck2, Route, Upload } from 'lucide-react';
import { formatRouteAnalysisSections } from '../../app/text-utils';
import { parseGpxFile, type ParsedGpxRoute } from '../../lib/gpx';
import type { RouteAnalysisOptions, RouteOption, RouteAnalysisResult, RouteLoadingState } from '../../hooks/useRouteAnalysis';
import { AiInsightBriefing } from './AiInsightBriefing';

const loadRouteConditionsProfile = () => import('./cards/RouteConditionsProfile');
const RouteConditionsProfile = lazy(() =>
  loadRouteConditionsProfile().then((module) => ({ default: module.RouteConditionsProfile })),
);

function RouteAnalysisLoading({ state }: { state: RouteLoadingState }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(() => Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000)));

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [state.startedAt]);

  const isAnalysis = state.kind === 'analysis';
  const checkpointCopy = state.checkpointCount
    ? `${state.checkpointCount} timed checkpoint${state.checkpointCount === 1 ? '' : 's'}`
    : 'timed route checkpoints';

  return (
    <div className="route-loading" role="status" aria-live="polite" aria-busy="true">
      <div className="route-loading-progress" aria-hidden="true"><span /></div>
      <div className="route-loading-copy">
        <strong>{isAnalysis ? `Analyzing ${state.routeName}` : `Finding routes for ${state.routeName}`}</strong>
        <span>
          {isAnalysis
            ? `Checking ${checkpointCopy}, then building a field briefing.`
            : 'Checking mapped trail sources and preparing route options.'}
        </span>
      </div>
      {isAnalysis && (
        <div className="route-loading-steps" aria-hidden="true">
          <span>Route geometry</span>
          <span>{state.checkpointCount ? `${state.checkpointCount} forecasts` : 'Checkpoint forecasts'}</span>
          <span>Field briefing</span>
        </div>
      )}
      <div className="route-loading-time" aria-hidden="true">
        <span>{elapsedSeconds < 5 ? 'Starting…' : `${elapsedSeconds}s elapsed`}</span>
        {isAnalysis && <span>Live checks run in parallel; complex routes can take a minute or more.</span>}
      </div>
    </div>
  );
}

export interface RouteAnalysisSectionProps {
  objectiveName: string;
  positionLat: number;
  positionLng: number;
  forecastDate: string;
  alpineStartTime: string;
  travelWindowHours: number;
  order: number;
  routeSuggestions: RouteOption[] | null;
  routeAnalysis: RouteAnalysisResult | null;
  routeLoading: boolean;
  routeLoadingState: RouteLoadingState | null;
  routeError: string | null;
  fetchRouteSuggestions: (name: string, lat: number, lng: number) => void;
  fetchRouteAnalysis: (objectiveName: string, routeName: string, lat: number, lng: number, date: string, startTime: string, hours: number, options?: RouteAnalysisOptions) => void;
  customRouteName: string;
  setCustomRouteName: (name: string) => void;
  setRouteSuggestions: (routes: RouteOption[] | null) => void;
  setRouteError: (err: string | null) => void;
  getScoreColor: (score: number, tier?: string) => string;
  formatTempDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  formatWindDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  formatElevationDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  formatDistanceDisplay: (miles: number | null | undefined) => string;
  initialGpxRoute?: ParsedGpxRoute | null;
  aiAvailable: boolean;
}

export function RouteAnalysisSection({
  objectiveName, positionLat, positionLng,
  forecastDate, alpineStartTime, travelWindowHours, order,
  routeSuggestions, routeAnalysis, routeLoading, routeLoadingState, routeError,
  fetchRouteSuggestions, fetchRouteAnalysis,
  customRouteName, setCustomRouteName, setRouteSuggestions, setRouteError,
  getScoreColor, formatTempDisplay, formatWindDisplay, formatElevationDisplay, formatDistanceDisplay,
  initialGpxRoute = null,
  aiAvailable,
}: RouteAnalysisSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [gpxRoute, setGpxRoute] = useState<ParsedGpxRoute | null>(initialGpxRoute);
  const [gpxParsing, setGpxParsing] = useState(false);
  const [showAllWaypoints, setShowAllWaypoints] = useState(false);
  const [expandedWaypointIndex, setExpandedWaypointIndex] = useState<number | null>(null);

  useEffect(() => {
    setGpxRoute(initialGpxRoute);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [initialGpxRoute, objectiveName, positionLat, positionLng]);

  useEffect(() => {
    setShowAllWaypoints(false);
    setExpandedWaypointIndex(null);
  }, [routeAnalysis]);

  useEffect(() => {
    if (routeLoadingState?.kind === 'analysis') {
      void loadRouteConditionsProfile();
    }
  }, [routeLoadingState]);

  const handleGpxFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setGpxParsing(true);
    setRouteError(null);
    try {
      const parsed = await parseGpxFile(file);
      setGpxRoute(parsed);
      setRouteSuggestions(null);
    } catch (error) {
      setGpxRoute(null);
      setRouteError(error instanceof Error ? error.message : 'Could not read this GPX file.');
    } finally {
      setGpxParsing(false);
    }
  };

  const analyzeGpxRoute = useCallback(() => {
    if (!gpxRoute) return;
    fetchRouteAnalysis(
      objectiveName,
      gpxRoute.name,
      positionLat,
      positionLng,
      forecastDate,
      alpineStartTime,
      travelWindowHours,
      {
        waypoints: gpxRoute.checkpoints,
        routeMetadata: {
          fileName: gpxRoute.fileName,
          pointCount: gpxRoute.pointCount,
          distanceMiles: gpxRoute.distanceMiles,
          elevationGainFt: gpxRoute.elevationGainFt,
          minElevationFt: gpxRoute.minElevationFt,
          maxElevationFt: gpxRoute.maxElevationFt,
          routeShape: gpxRoute.routeShape,
        },
      },
    );
  }, [
    gpxRoute,
    fetchRouteAnalysis,
    objectiveName,
    positionLat,
    positionLng,
    forecastDate,
    alpineStartTime,
    travelWindowHours,
  ]);

  const analyzeCustomRoute = useCallback(() => {
    const routeName = customRouteName.trim();
    if (!routeName) return;
    fetchRouteAnalysis(
      objectiveName,
      routeName,
      positionLat,
      positionLng,
      forecastDate,
      alpineStartTime,
      travelWindowHours,
    );
    setCustomRouteName('');
  }, [
    customRouteName,
    fetchRouteAnalysis,
    objectiveName,
    positionLat,
    positionLng,
    forecastDate,
    alpineStartTime,
    travelWindowHours,
    setCustomRouteName,
  ]);

  const gpxInput = (
    <input
      ref={fileInputRef}
      className="route-gpx-input"
      type="file"
      accept=".gpx,application/gpx+xml"
      onChange={handleGpxFile}
      aria-label="Import a GPX route"
    />
  );
  const sectionMeta = routeLoading
    ? 'Analyzing'
    : routeAnalysis
      ? `${routeAnalysis.summaries.length} checkpoint${routeAnalysis.summaries.length === 1 ? '' : 's'}`
      : gpxRoute
        ? 'GPX ready'
        : routeSuggestions
          ? `${routeSuggestions.length} route${routeSuggestions.length === 1 ? '' : 's'}`
          : 'Optional';

  return (
    <section
      className="ssr-card ssr-route-card route-analysis-section"
      id="planner-section-route"
      style={{ order: order - 1 }}
      aria-labelledby="planner-route-title"
    >
      <div className="ssr-card-h">
        <h2 id="planner-route-title">
          <span className="ssr-h-icon icon-neutral"><Route size={16} /></span>
          Route analysis
        </h2>
        <span className="ssr-h-meta">{sectionMeta}</span>
      </div>
      <div className="ssr-card-b ssr-route-body">
      {!gpxRoute && !routeSuggestions && !routeAnalysis && !routeLoading && (
        <div className="route-analysis-actions">
          {gpxInput}
          {aiAvailable ? (
            <button
              type="button"
              className="route-analyze-btn"
              onClick={() => fetchRouteSuggestions(objectiveName, positionLat, positionLng)}
            >
              Analyze a Known Route
            </button>
          ) : (
            <div className="route-picker-custom">
              <input
                type="text"
                placeholder="Enter a mapped route name…"
                value={customRouteName}
                onChange={(event) => setCustomRouteName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') analyzeCustomRoute();
                }}
              />
              <button type="button" disabled={!customRouteName.trim()} onClick={analyzeCustomRoute}>Analyze</button>
            </div>
          )}
          <button
            type="button"
            className="route-analyze-btn route-gpx-upload-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={gpxParsing}
          >
            <Upload size={16} /> {gpxParsing ? 'Reading GPX…' : 'Import GPX Route'}
          </button>
          {!aiAvailable && (
            <p className="route-analysis-disclaimer">AI route assistance is off. Enter a mapped trail name or import a GPX track for data-derived analysis.</p>
          )}
        </div>
      )}

      {gpxRoute && !routeAnalysis && !routeLoading && (
        <div className="route-gpx-card">
          <div className="route-gpx-title"><FileCheck2 size={18} /> <span>{gpxRoute.name}</span></div>
          <div className="route-gpx-meta">
            <span>{formatDistanceDisplay(gpxRoute.distanceMiles)}</span>
            {gpxRoute.elevationGainFt !== null && <span>{formatElevationDisplay(gpxRoute.elevationGainFt)} gain</span>}
            <span>{gpxRoute.pointCount.toLocaleString()} track points</span>
            <span>{gpxRoute.checkpoints.length} safety checkpoints</span>
          </div>
          <p>Checkpoints follow the uploaded track and are forecast at estimated arrival times across your {travelWindowHours}h plan. GPX coordinates bypass waypoint estimation. Route analysis starts only when you click below.</p>
          <div className="route-gpx-card-actions">
            <button type="button" className="route-gpx-analyze" onClick={analyzeGpxRoute}>Analyze This Track</button>
            <button
              type="button"
              className="route-picker-cancel"
              onClick={() => {
                setGpxRoute(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {routeLoading && routeLoadingState && <RouteAnalysisLoading key={routeLoadingState.startedAt} state={routeLoadingState} />}

      {routeError && (
        <div className="route-error">{routeError}</div>
      )}

      {routeSuggestions && !routeAnalysis && !routeLoading && (
        <div className="route-picker-card">
          <div className="route-picker-header">Choose a route to analyze</div>
          <ul className="route-picker-list">
            {routeSuggestions.map((r) => (
              <li key={r.name} className="route-picker-item">
                <button
                  type="button"
                  className="route-picker-option"
                  onClick={() => fetchRouteAnalysis(objectiveName, r.name, positionLat, positionLng, forecastDate, alpineStartTime, travelWindowHours)}
                >
                  <span className="route-option-name">{r.name}</span>
                  <span className="route-option-meta">{formatDistanceDisplay(r.distance_rt_miles)} RT &middot; {formatElevationDisplay(r.elev_gain_ft)} gain &middot; {r.class}</span>
                  <span className="route-option-desc">{r.description}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="route-picker-custom">
            <input
              type="text"
              placeholder="Or type a route name…"
              value={customRouteName}
              onChange={(e) => setCustomRouteName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customRouteName.trim()) {
                  fetchRouteAnalysis(objectiveName, customRouteName.trim(), positionLat, positionLng, forecastDate, alpineStartTime, travelWindowHours);
                  setCustomRouteName('');
                }
              }}
            />
            <button
              type="button"
              disabled={!customRouteName.trim()}
              onClick={() => {
                fetchRouteAnalysis(objectiveName, customRouteName.trim(), positionLat, positionLng, forecastDate, alpineStartTime, travelWindowHours);
                setCustomRouteName('');
              }}
            >
              Go
            </button>
          </div>
          <button type="button" className="route-picker-gpx" onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} /> Import GPX instead
          </button>
          {gpxInput}
          <button
            type="button"
            className="route-picker-cancel"
            onClick={() => { setRouteSuggestions(null); setRouteError(null); setCustomRouteName(''); }}
          >
            Cancel
          </button>
        </div>
      )}

      {routeAnalysis && (
        <div className="route-analysis-card">
          <div className="route-analysis-header">
            <span className="route-analysis-badges">
              <span className="route-ai-badge">{routeAnalysis.analysisSource === 'deterministic' ? 'Data-derived · verify' : 'AI-assisted · verify'}</span>
              {routeAnalysis.routeSource === 'gpx' && <span className="route-gpx-badge">GPX Track</span>}
              {routeAnalysis.routeSource === 'nps' && <span className="route-gpx-badge">NPS Trail</span>}
              {routeAnalysis.routeSource === 'openstreetmap' && <span className="route-gpx-badge">Mapped Trail</span>}
            </span>
          </div>
          {(routeAnalysis.routeSourceDetails?.matchedName || routeAnalysis.routeMetadata?.fileName) && (
            <h3 className="route-analysis-route-title">
              {routeAnalysis.routeSourceDetails?.matchedName || routeAnalysis.routeMetadata?.fileName}
            </h3>
          )}
          <p className="route-analysis-disclaimer">
            {routeAnalysis.routeSource === 'gpx'
              ? 'Checkpoints come from your GPX track, but conditions and recommendations are model-derived. Verify the route, closures, and current official sources, and navigate with your original track.'
              : routeAnalysis.routeSource === 'nps'
                ? `Waypoints follow National Park Service public trail geometry${routeAnalysis.routeSourceDetails?.matchedName ? ` (${routeAnalysis.routeSourceDetails.matchedName})` : ''}, not live trail or closure status. Verify current park information and navigate with a trusted map.`
                : routeAnalysis.routeSource === 'openstreetmap'
                  ? `Waypoints follow OpenStreetMap trail geometry${routeAnalysis.routeSourceDetails?.matchedName ? ` (${routeAnalysis.routeSourceDetails.matchedName})` : ''}. Community mapping can be incomplete or outdated; verify the route and navigate with a trusted map.`
                  : 'Waypoint locations and recommendations are AI-estimated and are not navigation instructions. Cross-check the route in CalTopo, Gaia GPS, or another trusted map before committing.'}
          </p>
          {routeAnalysis.terrainProfile && (
            <div className="route-summary-row">
              <strong className="route-summary-label">Terrain sample</strong>
              <div className="route-summary-values">
                {Number.isFinite(Number(routeAnalysis.terrainProfile.sampledDistanceMiles)) && <span>{formatDistanceDisplay(Number(routeAnalysis.terrainProfile.sampledDistanceMiles))}</span>}
                {Number.isFinite(Number(routeAnalysis.terrainProfile.sampledElevationGainFt)) && <span>{formatElevationDisplay(Number(routeAnalysis.terrainProfile.sampledElevationGainFt))} gain</span>}
                {Number.isFinite(Number(routeAnalysis.terrainProfile.maxSampledGradePct)) && <span>{routeAnalysis.terrainProfile.maxSampledGradePct}% max grade</span>}
                {(routeAnalysis.terrainProfile.dominantTravelAspects || []).length > 0 && <span>{(routeAnalysis.terrainProfile.dominantTravelAspects || []).join(', ')} aspects</span>}
              </div>
            </div>
          )}
          {routeAnalysis.routeMetadata && (
            <div className="route-summary-row">
              <strong className="route-summary-label">Original track</strong>
              <div className="route-summary-values">
                {routeAnalysis.routeMetadata.distanceMiles !== null && <span>{formatDistanceDisplay(routeAnalysis.routeMetadata.distanceMiles)}</span>}
                {routeAnalysis.routeMetadata.elevationGainFt !== null && <span>{formatElevationDisplay(routeAnalysis.routeMetadata.elevationGainFt)} gain</span>}
                {routeAnalysis.routeMetadata.routeShape && <span>{routeAnalysis.routeMetadata.routeShape}</span>}
                {routeAnalysis.routeMetadata.pointCount != null && <span>{routeAnalysis.routeMetadata.pointCount.toLocaleString()} points</span>}
              </div>
            </div>
          )}
          {routeAnalysis.partialData && (
            <p className="route-analysis-disclaimer route-analysis-partial">Some waypoints have no data and are excluded from scoring. Treat those segments as unknown, review the briefing notes, and verify them from current sources before travel.</p>
          )}
          <div className="route-waypoints">
            {routeAnalysis.summaries.map((wp, i) => {
              const waypointCount = routeAnalysis.summaries.length;
              const collapsible = waypointCount > 6;
              const hiddenWaypointCount = waypointCount - 5;
              const shouldHide = collapsible && !showAllWaypoints && i > 2 && i < waypointCount - 2;
              const routeTitle = routeAnalysis.routeSourceDetails?.matchedName || routeAnalysis.routeMetadata?.fileName;
              const displayName = routeTitle && wp.name.toLocaleLowerCase().startsWith(routeTitle.toLocaleLowerCase())
                ? wp.name.slice(routeTitle.length).trim().replace(/^./, (character) => character.toUpperCase()) || wp.name
                : wp.name;

              if (shouldHide) return null;

              const isExpanded = expandedWaypointIndex === i;
              const detailsId = `route-waypoint-details-${i}`;
              return (
                <div key={`${i}-${wp.name}`}>
                  {collapsible && !showAllWaypoints && i === waypointCount - 2 && (
                    <button
                      type="button"
                      className="route-waypoints-toggle route-waypoints-toggle-inline"
                      aria-expanded="false"
                      onClick={() => setShowAllWaypoints(true)}
                    >
                      <span>{hiddenWaypointCount} more checkpoints</span>
                      <ChevronDown size={15} aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    className={`route-waypoint-row${wp.dataAvailable ? '' : ' route-wp-no-data'}`}
                    aria-expanded={isExpanded}
                    aria-controls={detailsId}
                    onClick={() => setExpandedWaypointIndex(isExpanded ? null : i)}
                  >
                    <div className="route-wp-content">
                      <div className="route-wp-heading">
                        <span className="route-wp-name" title={wp.name}>{displayName}</span>
                      </div>
                      <div className="route-wp-metrics">
                        {wp.distance_miles != null && <span className="route-wp-distance">Mile {wp.distance_miles.toFixed(1)}</span>}
                        {wp.etaTime && <span className="route-wp-eta">ETA {wp.etaTime}{wp.etaDate && wp.etaDate !== forecastDate ? ' +1 day' : ''}</span>}
                        <span className="route-wp-elev">{formatElevationDisplay(wp.elev_ft)}</span>
                        {!wp.dataAvailable && <span className="route-wp-no-data-label">No data</span>}
                        {wp.weather.temp != null && (
                          <span className="route-wp-temp">{formatTempDisplay(wp.weather.temp)}</span>
                        )}
                        {wp.weather.windGust != null && (
                          <span className="route-wp-gust">Gust {formatWindDisplay(wp.weather.windGust)}</span>
                        )}
                        {wp.avalanche?.risk && (
                          <span className="route-wp-avy">{wp.avalanche.risk}</span>
                        )}
                      </div>
                    </div>
                    <span className="route-wp-status">
                      {wp.score !== null && (
                        <span className="route-wp-score" style={{ color: getScoreColor(wp.score) }}>{wp.score}%</span>
                      )}
                      {isExpanded
                        ? <ChevronUp size={16} aria-hidden="true" />
                        : <ChevronDown size={16} aria-hidden="true" />}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="route-wp-details" id={detailsId}>
                      <span><strong>Forecast</strong>{wp.weather.description || 'No conditions summary available'}</span>
                      {wp.weather.precipChance != null && <span><strong>Precipitation</strong>{Math.round(wp.weather.precipChance)}%</span>}
                      {wp.weather.windSpeed != null && <span><strong>Wind</strong>{formatWindDisplay(wp.weather.windSpeed)}</span>}
                      {wp.activeAlerts > 0 && <span><strong>Active alerts</strong>{wp.activeAlerts}</span>}
                      {wp.snowDepthIn != null && <span><strong>Snow depth</strong>{Math.round(wp.snowDepthIn)} in</span>}
                      {wp.avalanche?.risk && <span><strong>Avalanche</strong>{wp.avalanche.risk}</span>}
                    </div>
                  )}
                </div>
              );
            })}
            {routeAnalysis.summaries.length > 6 && showAllWaypoints && (
              <button
                type="button"
                className="route-waypoints-toggle"
                aria-expanded="true"
                onClick={() => setShowAllWaypoints(false)}
              >
                <span>Show fewer checkpoints</span>
                <ChevronUp size={15} aria-hidden="true" />
              </button>
            )}
          </div>
          <Suspense
            fallback={(
              <div className="loading-state inline-loading-state" role="status" aria-live="polite" aria-busy="true">
                Loading route profile…
              </div>
            )}
          >
            <RouteConditionsProfile
              waypoints={routeAnalysis.summaries}
              getScoreColor={getScoreColor}
              formatTempDisplay={formatTempDisplay}
              formatWindDisplay={formatWindDisplay}
              formatElevationDisplay={formatElevationDisplay}
            />
          </Suspense>
          <div className="route-analysis-text">
            <AiInsightBriefing
              title="Route field briefing"
              subtitle="Where conditions change and what that means for the route."
              sections={formatRouteAnalysisSections(routeAnalysis.analysis)}
            />
          </div>
        </div>
      )}
      </div>
    </section>
  );
}
