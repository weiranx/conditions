import { useEffect, useState } from 'react';

const STEP_LABELS = ['Weather', 'Avalanche', 'Alerts', 'Air Quality', 'Precipitation', 'Snowpack'];
const SLOW_RESPONSE_DELAY_MS = 8_000;

export function ForecastLoading() {
  const [isTakingLonger, setIsTakingLonger] = useState(false);

  useEffect(() => {
    const slowResponseTimer = window.setTimeout(() => {
      setIsTakingLonger(true);
    }, SLOW_RESPONSE_DELAY_MS);

    return () => window.clearTimeout(slowResponseTimer);
  }, []);

  return (
    <section
      className="loading-state forecast-loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-describedby="forecast-loading-description"
    >
      <div className="forecast-loading-sky" aria-hidden="true">
        <span className="forecast-loading-orb" />
        <span className="forecast-loading-cloud forecast-loading-cloud-a" />
        <span className="forecast-loading-cloud forecast-loading-cloud-b" />
        <span className="forecast-loading-ridge forecast-loading-ridge-back" />
        <span className="forecast-loading-ridge forecast-loading-ridge-front" />
        <span className="forecast-loading-signal forecast-loading-signal-a" />
        <span className="forecast-loading-signal forecast-loading-signal-b" />
        <span className="forecast-loading-signal forecast-loading-signal-c" />
        <span className="forecast-loading-wind forecast-loading-wind-a" />
        <span className="forecast-loading-wind forecast-loading-wind-b" />
        <span className="forecast-loading-wind forecast-loading-wind-c" />
        <span className="forecast-loading-scan" />
      </div>
      <div className="forecast-loading-copy">
        <span className="forecast-loading-eyebrow">Conditions report</span>
        <strong>Building your forecast brief</strong>
        <span id="forecast-loading-description">
          Combining fresh conditions from {STEP_LABELS.length} source groups for your objective.
        </span>
      </div>
      <div className="forecast-loading-steps" aria-hidden="true">
        {STEP_LABELS.map((label, index) => (
          <span key={label} className="forecast-loading-step" style={{ animationDelay: `${index * 0.18}s` }}>
            <span className="forecast-loading-step-dot" />
            <span>{label}</span>
          </span>
        ))}
      </div>

      {isTakingLonger && (
        <div className="forecast-loading-wakeup">
          <strong>Still checking live sources</strong>
          <span>Some providers are responding slowly. We’ll flag anything that remains unavailable.</span>
        </div>
      )}
    </section>
  );
}
