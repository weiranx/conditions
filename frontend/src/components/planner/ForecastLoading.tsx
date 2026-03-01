const STEP_LABELS = ['Weather', 'Avalanche', 'Alerts', 'Air Quality'];

export function ForecastLoading() {
  return (
    <div className="loading-state forecast-loading" role="status" aria-live="polite">
      <div className="forecast-loading-sky" aria-hidden="true">
        <span className="forecast-loading-orb" />
        <span className="forecast-loading-ridge forecast-loading-ridge-back" />
        <span className="forecast-loading-ridge forecast-loading-ridge-front" />
        <span className="forecast-loading-wind forecast-loading-wind-a" />
        <span className="forecast-loading-wind forecast-loading-wind-b" />
        <span className="forecast-loading-wind forecast-loading-wind-c" />
      </div>
      <div className="forecast-loading-copy">
        <strong>Building forecast brief...</strong>
        <span>Syncing weather, avalanche, alerts, and air-quality feeds.</span>
      </div>
      <div className="forecast-loading-steps" aria-hidden="true">
        {STEP_LABELS.map((label, index) => (
          <span key={label} className="forecast-loading-step" style={{ animationDelay: `${index * 0.18}s` }}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
