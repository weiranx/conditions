import type { RunnerPlanningProps } from '../PlannerView';
import { formatDurationMinutes } from '../../../app/weather-display';

const toneToPill: Record<string, string> = {
  go: 'go',
  caution: 'caution',
  nogo: 'nogo',
  watch: 'watch',
};

export function RunnerPlanningCard({ runnerPlanning }: { runnerPlanning: RunnerPlanningProps }) {
  const {
    runnerMode,
    onToggleRunnerMode,
    routeDistanceKmInput,
    setRouteDistanceKmInput,
    routeGainMInput,
    setRouteGainMInput,
    estimatedTripDurationMinutes,
    daylightMargin,
    footingForecast,
  } = runnerPlanning;

  return (
    <div className="runner-planning">
      <div className="runner-mode-row">
        <div>
          <strong className="runner-mode-title">Fast &amp; light mode</strong>
          <p className="muted-note runner-mode-sub">
            Runner pace model, exposure-aware travel window, hydration/fuel gear, and finish-by-dark check.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={runnerMode}
          className={`runner-mode-toggle ${runnerMode ? 'on' : 'off'}`}
          onClick={onToggleRunnerMode}
        >
          {runnerMode ? 'On' : 'Off'}
        </button>
      </div>

      <div className="runner-route-inputs">
        <label className="runner-input">
          <span>Distance (km)</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={0.5}
            placeholder="e.g. 24"
            value={routeDistanceKmInput}
            onChange={(e) => setRouteDistanceKmInput(e.target.value)}
          />
        </label>
        <label className="runner-input">
          <span>Vert gain (m)</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={50}
            placeholder="e.g. 1800"
            value={routeGainMInput}
            onChange={(e) => setRouteGainMInput(e.target.value)}
          />
        </label>
        <div className="runner-input runner-duration">
          <span>Est. moving time</span>
          <strong>{estimatedTripDurationMinutes ? formatDurationMinutes(estimatedTripDurationMinutes) : '—'}</strong>
        </div>
      </div>

      {daylightMargin ? (
        <div className={`runner-daylight ${daylightMargin.tone}`}>
          <div className="runner-daylight-head">
            <span className={`decision-pill ${toneToPill[daylightMargin.tone] || 'watch'}`}>
              {daylightMargin.headlampLikely ? 'Headlamp likely' : 'Daylight finish'}
            </span>
            <strong className="runner-daylight-headline">{daylightMargin.headline}</strong>
          </div>
          <p className="runner-daylight-detail">{daylightMargin.detail}</p>
        </div>
      ) : (
        <p className="muted-note">Enter distance (and vert) to project a finish time against sunset.</p>
      )}

      {footingForecast && footingForecast.hasSignal && (
        <div className={`runner-footing ${footingForecast.tone}`}>
          <div className="runner-footing-head">
            <span className={`decision-pill ${toneToPill[footingForecast.tone] || 'watch'}`}>Footing</span>
            <strong>{footingForecast.headline}</strong>
          </div>
          <p className="runner-footing-detail">{footingForecast.detail}</p>
        </div>
      )}
    </div>
  );
}
