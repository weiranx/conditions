interface ElevationDangerGradientProps {
  elevationBands: Array<{
    label: string;
    elevationFt: number;
    deltaFromObjectiveFt: number;
    temp: number;
    feelsLike: number;
    windSpeed: number;
    windGust: number;
  }>;
  avalancheElevations: {
    below?: { level?: number; label?: string };
    at?: { level?: number; label?: string };
    above?: { level?: number; label?: string };
  } | undefined;
  objectiveElevationFt: number | null;
  formatTempDisplay: (value: number | null | undefined) => string;
  formatWindDisplay: (value: number | null | undefined) => string;
  formatElevationDisplay: (value: number | null | undefined) => string;
  getDangerLevelClass: (level?: number) => string;
  getDangerText: (level: number) => string;
}

const DANGER_COLORS: Record<number, string> = {
  0: '#b0b0b0',
  1: '#50b848',
  2: '#fff200',
  3: '#f7931e',
  4: '#ed1c24',
  5: '#1a1a1a',
};

function dangerColor(level?: number): string {
  return DANGER_COLORS[level ?? 0] ?? DANGER_COLORS[0];
}

function avyBandForElevation(
  elevFt: number,
  objectiveFt: number | null,
  avyElev: ElevationDangerGradientProps['avalancheElevations'],
): { level?: number; label?: string } | undefined {
  if (!avyElev || objectiveFt == null) return undefined;
  if (elevFt > objectiveFt + 500) return avyElev.above;
  if (elevFt < objectiveFt - 500) return avyElev.below;
  return avyElev.at;
}

export function ElevationDangerGradient({
  elevationBands,
  avalancheElevations,
  objectiveElevationFt,
  formatTempDisplay,
  formatWindDisplay,
  formatElevationDisplay,
  getDangerLevelClass,
  getDangerText,
}: ElevationDangerGradientProps) {
  if (!elevationBands || elevationBands.length === 0) return null;

  const sorted = [...elevationBands].sort((a, b) => b.elevationFt - a.elevationFt);

  return (
    <div className="elevation-danger-gradient">
      {sorted.map((band) => {
        const avyBand = avyBandForElevation(
          band.elevationFt,
          objectiveElevationFt,
          avalancheElevations,
        );
        const isObjective =
          objectiveElevationFt != null &&
          Math.abs(band.elevationFt - objectiveElevationFt) < 250;
        const bgColor = dangerColor(avyBand?.level);

        return (
          <div
            key={band.label}
            className={`elevation-danger-row ${isObjective ? 'elevation-danger-row--objective' : ''}`}
          >
            <div className="elevation-danger-elev">
              <span className="elevation-danger-elev-value">
                {formatElevationDisplay(band.elevationFt)}
              </span>
              <span className="elevation-danger-elev-label">{band.label}</span>
            </div>

            <div className="elevation-danger-bar-cell">
              <div
                className={`elevation-danger-bar ${getDangerLevelClass(avyBand?.level)}`}
                style={{ backgroundColor: bgColor }}
              >
                {avyBand?.level != null && avyBand.level > 0 && (
                  <span className="elevation-danger-bar-text">
                    {getDangerText(avyBand.level)}
                  </span>
                )}
              </div>
              {isObjective && <div className="elevation-danger-objective-marker" />}
            </div>

            <div className="elevation-danger-metrics">
              <span>{formatTempDisplay(band.temp)}</span>
              <span className="elevation-danger-wind">
                {formatWindDisplay(band.windSpeed)}
                {band.windGust > band.windSpeed && (
                  <span className="elevation-danger-gust">
                    {' '}g{formatWindDisplay(band.windGust)}
                  </span>
                )}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
