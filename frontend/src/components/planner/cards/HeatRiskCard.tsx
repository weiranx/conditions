export interface HeatRiskCardProps {
  heatRiskGuidance: string;
  heatRiskReasons: string[];
  heatRiskMetrics: Record<string, unknown>;
  safetyWeatherTemp: number;
  safetyWeatherFeelsLike: number | null | undefined;
  safetyWeatherHumidity: number | null | undefined;
  heatRiskSource: string;
  travelWindowHours: number;
  lowerTerrainHeatLabel: string | null;
  localizeUnitText: (text: string) => string;
  formatTempDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
}

export function HeatRiskCard({
  heatRiskGuidance,
  heatRiskReasons,
  heatRiskMetrics,
  safetyWeatherTemp,
  safetyWeatherFeelsLike,
  safetyWeatherHumidity,
  heatRiskSource,
  travelWindowHours,
  lowerTerrainHeatLabel,
  localizeUnitText,
  formatTempDisplay,
}: HeatRiskCardProps) {
  return (
    <>
      <p className="muted-note">{heatRiskGuidance}</p>
      <div className="plan-grid">
        <div>
          <span className="stat-label">Temp</span>
          <strong>{formatTempDisplay((heatRiskMetrics.tempF as number) ?? safetyWeatherTemp)}</strong>
        </div>
        <div>
          <span className="stat-label">Feels Like</span>
          <strong>{formatTempDisplay((heatRiskMetrics.feelsLikeF as number) ?? safetyWeatherFeelsLike ?? safetyWeatherTemp)}</strong>
        </div>
        <div>
          <span className="stat-label">Humidity</span>
          <strong>{Number.isFinite(Number((heatRiskMetrics.humidity as number) ?? safetyWeatherHumidity)) ? `${Math.round(Number((heatRiskMetrics.humidity as number) ?? safetyWeatherHumidity))}%` : 'N/A'}</strong>
        </div>
        <div>
          <span className="stat-label">{travelWindowHours}h Peak Temp</span>
          <strong>{formatTempDisplay((heatRiskMetrics.peakTemp12hF as number) ?? null)}</strong>
        </div>
        <div>
          <span className="stat-label">Lower Terrain Feels</span>
          <strong>{formatTempDisplay((heatRiskMetrics.lowerTerrainFeelsLikeF as number) ?? null)}</strong>
          {lowerTerrainHeatLabel && <small>{lowerTerrainHeatLabel}</small>}
        </div>
      </div>
      {heatRiskReasons.length > 0 ? (
        <ul className="signal-list compact">
          {heatRiskReasons.map((reason, idx) => (
            <li key={`heat-risk-reason-${idx}`}>{localizeUnitText(reason)}</li>
          ))}
        </ul>
      ) : (
        <p className="muted-note">No strong heat-stress signal was detected for this objective/time.</p>
      )}
      <p className="muted-note">Source: {heatRiskSource}</p>
    </>
  );
}
