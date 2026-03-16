import { ExternalLink } from 'lucide-react';
import { RouteConditionsProfile } from './cards/RouteConditionsProfile';
import { renderSimpleMarkdown } from '../../app/markdown';
import type { RouteOption, RouteAnalysisResult } from '../../hooks/useRouteAnalysis';

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
  fetchRouteAnalysis: (objectiveName: string, routeName: string, lat: number, lng: number, date: string, startTime: string, hours: number) => void;
  customRouteName: string;
  setCustomRouteName: (name: string) => void;
  setRouteSuggestions: (routes: RouteOption[] | null) => void;
  setRouteError: (err: string | null) => void;
  getScoreColor: (score: number, tier?: string) => string;
  formatTempDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  formatWindDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  formatElevationDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
}

export function RouteAnalysisSection({
  objectiveName, positionLat, positionLng,
  forecastDate, alpineStartTime, travelWindowHours, order,
  routeSuggestions, routeAnalysis, routeLoading, routeError,
  fetchRouteSuggestions, fetchRouteAnalysis,
  customRouteName, setCustomRouteName, setRouteSuggestions, setRouteError,
  getScoreColor, formatTempDisplay, formatWindDisplay, formatElevationDisplay,
}: RouteAnalysisSectionProps) {
  return (
    <div className="route-analysis-section" style={{ order: order - 1 }}>
      {!routeSuggestions && !routeAnalysis && !routeLoading && (
        <button
          type="button"
          className="route-analyze-btn"
          onClick={() => fetchRouteSuggestions(objectiveName, positionLat, positionLng)}
        >
          Analyze Full Route
        </button>
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
                  <span className="route-option-meta">{r.distance_rt_miles}mi RT &middot; {r.elev_gain_ft.toLocaleString()}ft &middot; {r.class}</span>
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
          <div className="route-analysis-header">Route Analysis <span className="route-ai-badge">AI Advisory</span></div>
          <p className="route-analysis-disclaimer">Waypoint locations and recommendations are AI-estimated. Cross-reference against CalTopo or Gaia GPS before committing.</p>
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
                <div key={wp.name} className="route-waypoint-row">
                  <span className="route-wp-name">{wp.name}</span>
                  <span className="route-wp-elev">{wp.elev_ft.toLocaleString()}ft</span>
                  {wp.weather.temp != null && (
                    <span className="route-wp-temp">{formatTempDisplay(wp.weather.temp)}</span>
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
          <RouteConditionsProfile
            waypoints={routeAnalysis.summaries}
            getScoreColor={getScoreColor}
            formatTempDisplay={formatTempDisplay}
            formatWindDisplay={formatWindDisplay}
            formatElevationDisplay={formatElevationDisplay}
          />
          <div className="route-analysis-text">
            {renderSimpleMarkdown(routeAnalysis.analysis)}
          </div>
        </div>
      )}
    </div>
  );
}
