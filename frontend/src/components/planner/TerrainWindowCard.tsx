import { useMemo } from 'react';
import { AlertTriangle, Clock, Grid3X3, ShieldQuestion } from 'lucide-react';
import { buildTerrainWindow, type TerrainWindowLevel } from '../../app/terrain-window';
import type { AvalancheProblem, ElevationForecastBand, TravelWindowRow, UserPreferences } from '../../app/types';

interface TerrainWindowCardProps {
  travelRows: TravelWindowRow[];
  elevationBands: ElevationForecastBand[];
  avalancheProblems: AvalancheProblem[];
  avalancheRelevant: boolean;
  avalancheUnknown: boolean;
  avalancheDanger: number | null;
  leewardAspects: string[];
  secondaryAspects: string[];
  preferences: UserPreferences;
  formatClock: (time: string, style: UserPreferences['timeStyle']) => string;
  formatElevation: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
}

const CELL_LABEL: Record<TerrainWindowLevel, string> = {
  lower: 'Lower-risk relative window',
  caution: 'Caution',
  avoid: 'Avoid or change plan',
  unknown: 'Unrated or unknown',
};

export function TerrainWindowCard({
  travelRows,
  elevationBands,
  avalancheProblems,
  avalancheRelevant,
  avalancheUnknown,
  avalancheDanger,
  leewardAspects,
  secondaryAspects,
  preferences,
  formatClock,
  formatElevation,
}: TerrainWindowCardProps) {
  const model = useMemo(() => buildTerrainWindow({
    travelRows,
    elevationBands,
    avalancheProblems,
    avalancheRelevant,
    avalancheUnknown,
    avalancheDanger,
    leewardAspects,
    secondaryAspects,
    preferences,
  }), [
    avalancheDanger,
    avalancheProblems,
    avalancheRelevant,
    avalancheUnknown,
    elevationBands,
    leewardAspects,
    preferences,
    secondaryAspects,
    travelRows,
  ]);

  if (model.hours.length === 0 || model.lanes.length === 0) return null;
  const bestHourLabels = model.lowerRiskHourIndexes
    .slice(0, 4)
    .map((index) => formatClock(model.hours[index].time, preferences.timeStyle));

  return (
    <section className="ssr-card terrain-window-card" id="planner-section-terrain-window">
      <div className="ssr-card-h">
        <h2><span className="ssr-h-icon icon-amber"><Grid3X3 size={16} /></span>Terrain Window</h2>
        <span className="ssr-h-meta">time × elevation × aspect</span>
      </div>
      <div className="terrain-window-body">
        <div className="terrain-window-summary">
          <span className="terrain-window-summary-icon" aria-hidden><Clock size={18} /></span>
          <div>
            <span>Relative lower-risk hours</span>
            <strong>{bestHourLabels.length > 0 ? bestHourLabels.join(' · ') : 'No broad lower-risk window found'}</strong>
            <p>{model.explanation}</p>
          </div>
        </div>

        <div className="terrain-window-scroll" tabIndex={0} aria-label="Scrollable terrain window matrix">
          <table className="terrain-window-matrix">
            <caption className="sr-only">Relative planning conditions by hour, elevation band, and aspect group</caption>
            <thead>
              <tr>
                <th scope="col">Terrain lane</th>
                {model.hours.map((hour) => <th scope="col" key={hour.time}>{formatClock(hour.time, preferences.timeStyle)}</th>)}
              </tr>
            </thead>
            <tbody>
              {model.lanes.map((lane) => (
                <tr key={lane.id}>
                  <th scope="row">
                    <strong>{lane.elevationLabel}</strong>
                    <span>{formatElevation(lane.elevationFt, { precision: 0 })} · {lane.aspectLabel}</span>
                  </th>
                  {lane.cells.map((cell, index) => {
                    const time = formatClock(model.hours[index].time, preferences.timeStyle);
                    const reason = cell.reasons.join(' ');
                    return (
                      <td key={`${lane.id}-${model.hours[index].time}`}>
                        <span
                          className={`terrain-window-cell ${cell.level}`}
                          title={`${time} · ${lane.elevationLabel} · ${lane.aspectLabel}: ${CELL_LABEL[cell.level]}. ${reason}`}
                          aria-label={`${time}, ${lane.elevationLabel}, ${lane.aspectLabel}: ${CELL_LABEL[cell.level]}. ${reason}`}
                        >
                          <span aria-hidden>{cell.level === 'avoid' ? '×' : cell.level === 'caution' ? '!' : cell.level === 'unknown' ? '?' : '·'}</span>
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="terrain-window-legend" aria-label="Terrain Window legend">
          {(Object.keys(CELL_LABEL) as TerrainWindowLevel[]).map((level) => (
            <span key={level}><i className={`terrain-window-cell ${level}`} aria-hidden />{CELL_LABEL[level]}</span>
          ))}
        </div>
        <p className="terrain-window-caveat">
          {avalancheUnknown ? <ShieldQuestion size={14} aria-hidden /> : <AlertTriangle size={14} aria-hidden />}
          “Lower-risk” is relative within this forecast, not a declaration that terrain is safe. Local terrain, route choices, and field observations can change the result.
        </p>
      </div>
    </section>
  );
}
