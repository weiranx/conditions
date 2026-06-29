import type { SafetyData } from '../../../app/types';

type Atmosphere = NonNullable<SafetyData['atmosphere']>;

export interface SkyConditionsCardProps {
  atmosphere: Atmosphere;
  formatTempDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  formatElevationDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  localizeUnitText: (text: string) => string;
}

const isFinite = (value: unknown): value is number => Number.isFinite(Number(value));

export function SkyConditionsCard({
  atmosphere,
  formatTempDisplay,
  formatElevationDisplay,
  localizeUnitText,
}: SkyConditionsCardProps) {
  const {
    uvIndex,
    uvIndexMax,
    uvCategory,
    windChill,
    freezingLevelFt,
    snowLevelFt,
    thunderProbability,
    thunderCategory,
    precipType,
    moon,
    sources,
  } = atmosphere;

  return (
    <>
      {precipType?.label && (
        <p className="muted-note">
          Expected precipitation type: <strong>{precipType.label}</strong>
          {precipType.reason ? ` — ${localizeUnitText(precipType.reason)}` : ''}
        </p>
      )}
      <div className="plan-grid">
        <div>
          <span className="stat-label">UV Index</span>
          <strong>{isFinite(uvIndex) ? Math.round(Number(uvIndex)) : isFinite(uvIndexMax) ? Math.round(Number(uvIndexMax)) : 'N/A'}</strong>
          {uvCategory && <small>{uvCategory}</small>}
        </div>
        {isFinite(uvIndexMax) && (
          <div>
            <span className="stat-label">Peak UV (day)</span>
            <strong>{Math.round(Number(uvIndexMax))}</strong>
          </div>
        )}
        {isFinite(windChill) && (
          <div>
            <span className="stat-label">Wind Chill</span>
            <strong>{formatTempDisplay(Number(windChill))}</strong>
          </div>
        )}
        <div>
          <span className="stat-label">Thunderstorm</span>
          <strong>{isFinite(thunderProbability) ? `${Math.round(Number(thunderProbability))}%` : 'N/A'}</strong>
          {thunderCategory && <small>{thunderCategory}</small>}
        </div>
        <div>
          <span className="stat-label">Freezing Level</span>
          <strong>{isFinite(freezingLevelFt) ? formatElevationDisplay(Number(freezingLevelFt)) : 'N/A'}</strong>
        </div>
        <div>
          <span className="stat-label">Snow Level</span>
          <strong>{isFinite(snowLevelFt) ? formatElevationDisplay(Number(snowLevelFt)) : 'N/A'}</strong>
        </div>
        {moon?.name && (
          <div>
            <span className="stat-label">Moon</span>
            <strong>{moon.emoji ? `${moon.emoji} ` : ''}{moon.name}</strong>
            {isFinite(moon.illumination) && <small>{Math.round(Number(moon.illumination) * 100)}% lit</small>}
          </div>
        )}
      </div>
      {sources && Object.keys(sources).length > 0 && (
        <p className="muted-note">
          Sources: {Array.from(new Set(Object.values(sources).filter((s) => s && s !== 'Unavailable' && s !== 'Not applicable'))).join(' · ')}
        </p>
      )}
    </>
  );
}
