import { lazy, Suspense, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ExternalLink, FileCheck2, Upload } from 'lucide-react';
import { formatRouteAnalysisSections } from '../../app/text-utils';
import { parseGpxFile, type ParsedGpxRoute } from '../../lib/gpx';
import type { RouteAnalysisOptions, RouteOption, RouteAnalysisResult } from '../../hooks/useRouteAnalysis';
import { AiInsightBriefing } from './AiInsightBriefing';

const RouteConditionsProfile = lazy(() =>
  import('./cards/RouteConditionsProfile').then((module) => ({ default: module.RouteConditionsProfile })),
);

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
}

export function RouteAnalysisSection({
  objectiveName, positionLat, positionLng,
  forecastDate, alpineStartTime, travelWindowHours, order,
  routeSuggestions, routeAnalysis, routeLoading, routeError,
  fetchRouteSuggestions, fetchRouteAnalysis,
  customRouteName, setCustomRouteName, setRouteSuggestions, setRouteError,
  getScoreColor, formatTempDisplay, formatWindDisplay, formatElevationDisplay, formatDistanceDisplay,
  initialGpxRoute = null,
}: RouteAnalysisSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [gpxRoute, setGpxRoute] = useState<ParsedGpxRoute | null>(initialGpxRoute);
  const [gpxParsing, setGpxParsing] = useState(false);

  useEffect(() => {
    setGpxRoute(initialGpxRoute);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [initialGpxRoute, objectiveName, positionLat, positionLng]);

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

  const analyzeGpxRoute = () => {
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
        },
      },
    );
  };

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

  return (
    <div className="route-analysis-section" style={{ order: order - 1 }}>
      {!gpxRoute && !routeSuggestions && !routeAnalysis && !routeLoading && (
        <div className="route-analysis-actions">
          {gpxInput}
          <button
            type="button"
            className="route-analyze-btn"
            onClick={() => fetchRouteSuggestions(objectiveName, positionLat, positionLng)}
          >
            Analyze a Known Route
          </button>
          <button
            type="button"
            className="route-analyze-btn route-gpx-upload-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={gpxParsing}
          >
            <Upload size={16} /> {gpxParsing ? 'Reading GPX…' : 'Import GPX Route'}
          </button>
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
          <p>Checkpoints follow the uploaded track at even distance intervals. GPX coordinates bypass AI waypoint estimation.</p>
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

      {routeLoading && (
        <div className="route-loading">
          <div className="route-loading-dots">
            <span /><span /><span />
          </div>
          <div className="route-loading-label">
            {routeAnalysis === null && routeSuggestions ? 'Running safety checks along route...' : 'Fetching routes...'}
          </div>
        </div>
      )}

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
            Route Analysis <span className="route-ai-badge">AI-assisted · verify</span>
            {routeAnalysis.routeSource === 'gpx' && <span className="route-gpx-badge">GPX Track</span>}
            {routeAnalysis.routeSource === 'nps' && <span className="route-gpx-badge">NPS Trail</span>}
            {routeAnalysis.routeSource === 'openstreetmap' && <span className="route-gpx-badge">Mapped Trail</span>}
          </div>
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
            <div className="route-gpx-result-meta">
              <strong>Sampled terrain</strong>
              {Number.isFinite(Number(routeAnalysis.terrainProfile.sampledDistanceMiles)) && <span>{formatDistanceDisplay(Number(routeAnalysis.terrainProfile.sampledDistanceMiles))}</span>}
              {Number.isFinite(Number(routeAnalysis.terrainProfile.sampledElevationGainFt)) && <span>{formatElevationDisplay(Number(routeAnalysis.terrainProfile.sampledElevationGainFt))} gain</span>}
              {Number.isFinite(Number(routeAnalysis.terrainProfile.maxSampledGradePct)) && <span>max sampled grade {routeAnalysis.terrainProfile.maxSampledGradePct}%</span>}
              {(routeAnalysis.terrainProfile.dominantTravelAspects || []).length > 0 && <span>travel aspects {(routeAnalysis.terrainProfile.dominantTravelAspects || []).join(', ')}</span>}
            </div>
          )}
          {routeAnalysis.routeMetadata && (
            <div className="route-gpx-result-meta">
              <strong>{routeAnalysis.routeMetadata.fileName}</strong>
              {routeAnalysis.routeMetadata.distanceMiles !== null && <span>{formatDistanceDisplay(routeAnalysis.routeMetadata.distanceMiles)}</span>}
              {routeAnalysis.routeMetadata.elevationGainFt !== null && <span>{formatElevationDisplay(routeAnalysis.routeMetadata.elevationGainFt)} gain</span>}
              {routeAnalysis.routeMetadata.pointCount != null && <span>{routeAnalysis.routeMetadata.pointCount.toLocaleString()} points</span>}
            </div>
          )}
          {routeAnalysis.partialData && (
            <p className="route-analysis-disclaimer route-analysis-partial">Some waypoints have no data and are excluded from scoring. Treat those segments as unknown, review the briefing notes, and verify them from current sources before travel.</p>
          )}
          <div className="route-waypoints">
            {routeAnalysis.summaries.map((wp, i) => {
              const wpCoords = routeAnalysis.waypoints[i];
              const wpReportParams = new URLSearchParams({
                lat: String(wpCoords?.lat ?? ''),
                lon: String(wpCoords?.lon ?? ''),
                name: wp.name,
                date: forecastDate,
                start: alpineStartTime,
                travel_window_hours: String(travelWindowHours),
              });
              return (
                <div key={wp.name} className={`route-waypoint-row${wp.dataAvailable ? '' : ' route-wp-no-data'}`}>
                  <span className="route-wp-name">{wp.name}</span>
                  {wp.distance_miles != null && <span className="route-wp-distance">mi {wp.distance_miles.toFixed(1)}</span>}
                  <span className="route-wp-elev">{formatElevationDisplay(wp.elev_ft)}</span>
                  {!wp.dataAvailable && <span className="route-wp-no-data-label">No data</span>}
                  {wp.weather.temp != null && (
                    <span className="route-wp-temp">{formatTempDisplay(wp.weather.temp)}</span>
                  )}
                  {wp.weather.windGust != null && (
                    <span className="route-wp-gust">g {formatWindDisplay(wp.weather.windGust)}</span>
                  )}
                  {wp.score !== null && (
                    <span className="route-wp-score" style={{ color: getScoreColor(wp.score) }}>{wp.score}%</span>
                  )}
                  {wp.avalanche?.risk && (
                    <span className="route-wp-avy">{wp.avalanche.risk}</span>
                  )}
                  {wpCoords && (
                    <a
                      href={`/?${wpReportParams.toString()}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="route-wp-link"
                      title={`Open full report for ${wp.name}`}
                    >
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>
              );
            })}
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
  );
}
