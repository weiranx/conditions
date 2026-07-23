import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  Grid3X3,
  HelpCircle,
  ShieldQuestion,
  X,
} from 'lucide-react';
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

const LEGEND_LABEL: Record<TerrainWindowLevel, string> = {
  lower: 'Lower-risk',
  caution: 'Caution',
  avoid: 'Avoid',
  unknown: 'Unknown',
};

const formatDriver = (reason: string) => {
  const normalized = reason
    .trim()
    .replace(/(\d)in\b/gi, '$1 in')
    .replace(/[.\s]+$/, '');
  return normalized ? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}` : reason;
};

const CellMark = ({ level }: { level: TerrainWindowLevel }) => {
  if (level === 'lower') return <Check size={13} strokeWidth={2.5} />;
  if (level === 'avoid') return <X size={13} strokeWidth={2.5} />;
  if (level === 'unknown') return <HelpCircle size={13} strokeWidth={2.2} />;
  return <AlertTriangle size={12} strokeWidth={2.2} />;
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
  const [activeLaneId, setActiveLaneId] = useState('');
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
  const lowerRiskRanges = model.lowerRiskHourIndexes.reduce<number[][]>((ranges, index) => {
    const lastRange = ranges[ranges.length - 1];
    if (lastRange && index === lastRange[lastRange.length - 1] + 1) {
      lastRange.push(index);
    } else {
      ranges.push([index]);
    }
    return ranges;
  }, []);
  const bestWindowLabel = lowerRiskRanges.length > 0
    ? lowerRiskRanges.slice(0, 2).map((range) => {
        const start = formatClock(model.hours[range[0]].time, preferences.timeStyle);
        const end = formatClock(model.hours[range[range.length - 1]].time, preferences.timeStyle);
        return start === end ? start : `${start}–${end}`;
      }).join(' · ')
    : 'No broad lower-risk window found';
  const dominantReasons = Array.from(model.lanes.reduce<Map<string, number>>((counts, lane) => {
    lane.cells.forEach((cell) => {
      new Set(cell.reasons).forEach((reason) => counts.set(reason, (counts.get(reason) || 0) + 1));
    });
    return counts;
  }, new Map()))
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([reason]) => reason);
  const activeLane = model.lanes.find((lane) => lane.id === activeLaneId) || model.lanes[0];

  return (
    <section className="ssr-card terrain-window-card" id="planner-section-terrain-window">
      <div className="ssr-card-h">
        <h2><span className="ssr-h-icon icon-amber"><Grid3X3 size={16} /></span>Terrain Window</h2>
        <span className="ssr-h-meta">{model.hours.length} hours · {model.lanes.length} terrain lanes</span>
      </div>
      <div className="terrain-window-body">
        <div className={`terrain-window-summary ${model.lowerRiskHourIndexes.length > 0 ? 'has-window' : 'no-window'}`}>
          <div className="terrain-window-summary-main">
            <span className="terrain-window-summary-icon" aria-hidden><Clock size={18} /></span>
            <div>
              <span>Best relative window</span>
              <strong>{bestWindowLabel}</strong>
              <p>{model.explanation}</p>
            </div>
          </div>
          <div className="terrain-window-summary-stats" aria-label="Terrain Window coverage">
            <span><strong>{model.lowerRiskHourIndexes.length}</strong> lower-risk hours</span>
            <span><strong>{model.lanes.length}</strong> terrain lanes</span>
          </div>
        </div>

        {dominantReasons.length > 0 && (
          <div className="terrain-window-drivers">
            <div>
              <span>What is shaping this window</span>
              <p>Most common signals across the matrix</p>
            </div>
            <ul>
              {dominantReasons.map((reason) => <li key={reason}>{formatDriver(reason)}</li>)}
            </ul>
          </div>
        )}

        <div className="terrain-window-guide">
          <div>
            <strong>Terrain through time</strong>
            <span>Each cell combines the hour with that elevation and aspect group.</span>
          </div>
          <span className="terrain-window-scroll-cue">Scroll for later hours <span aria-hidden>→</span></span>
        </div>

        <div className="terrain-window-scroll" tabIndex={0} aria-label="Scrollable terrain window matrix">
          <table className="terrain-window-matrix">
            <caption className="sr-only">Relative planning conditions by hour, elevation band, and aspect group</caption>
            <thead>
              <tr>
                <th scope="col">Terrain lane</th>
                {model.hours.map((hour) => {
                  const label = formatClock(hour.time, preferences.timeStyle);
                  const meridiemMatch = label.match(/^(.*)\s(AM|PM)$/i);
                  return (
                    <th scope="col" key={hour.time}>
                      <span>{meridiemMatch?.[1] || label}</span>
                      {meridiemMatch?.[2] && <small>{meridiemMatch[2]}</small>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {model.lanes.map((lane, laneIndex) => (
                <tr
                  className={laneIndex === 0 || model.lanes[laneIndex - 1].elevationBand !== lane.elevationBand ? 'terrain-window-band-start' : undefined}
                  key={lane.id}
                >
                  <th scope="row">
                    <strong>{lane.elevationLabel}</strong>
                    <span>{formatElevation(lane.elevationFt, { precision: 0 })}</span>
                    <em>{lane.aspectLabel}</em>
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
                          <span aria-hidden><CellMark level={cell.level} /></span>
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="terrain-window-mobile-panel">
          <label>
            <span>Terrain lane</span>
            <select value={activeLane.id} onChange={(event) => setActiveLaneId(event.target.value)}>
              {model.lanes.map((lane) => (
                <option value={lane.id} key={lane.id}>
                  {lane.elevationLabel} · {lane.aspectLabel}
                </option>
              ))}
            </select>
          </label>
          <div className="terrain-window-mobile-lane">
            <strong>{activeLane.elevationLabel}</strong>
            <span>{formatElevation(activeLane.elevationFt, { precision: 0 })} · {activeLane.aspectLabel}</span>
          </div>
          <div className="terrain-window-mobile-grid">
            {activeLane.cells.map((cell, index) => {
              const time = formatClock(model.hours[index].time, preferences.timeStyle);
              const reason = cell.reasons.join(' ');
              return (
                <div
                  className="terrain-window-mobile-hour"
                  key={`${activeLane.id}-mobile-${model.hours[index].time}`}
                >
                  <span>{time}</span>
                  <span
                    className={`terrain-window-cell ${cell.level}`}
                    title={`${time} · ${activeLane.elevationLabel} · ${activeLane.aspectLabel}: ${CELL_LABEL[cell.level]}. ${reason}`}
                    aria-label={`${time}, ${activeLane.elevationLabel}, ${activeLane.aspectLabel}: ${CELL_LABEL[cell.level]}. ${reason}`}
                  >
                    <span aria-hidden><CellMark level={cell.level} /></span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="terrain-window-legend" aria-label="Terrain Window legend">
          {(Object.keys(CELL_LABEL) as TerrainWindowLevel[]).map((level) => (
            <span key={level}><i className={`terrain-window-swatch ${level}`} aria-hidden />{LEGEND_LABEL[level]}</span>
          ))}
        </div>
        <p className="terrain-window-caveat">
          {avalancheUnknown ? <ShieldQuestion size={15} aria-hidden /> : <AlertTriangle size={15} aria-hidden />}
          <span><strong>Planning aid, not a safety rating.</strong> “Lower-risk” is relative within this forecast. Local terrain, route choices, and field observations can change the result.</span>
        </p>
      </div>
    </section>
  );
}
