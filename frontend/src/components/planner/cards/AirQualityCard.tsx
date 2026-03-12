export interface AirQualityCardProps {
  category: string;
  pm25: number | null | undefined;
  pm10: number | null | undefined;
  ozone: number | null | undefined;
  airQualityFutureNotApplicable: boolean;
  note: string | null | undefined;
  source: string | null | undefined;
  measuredTime: string | null | undefined;
  formatPubTime: (isoString?: string) => string;
}

export function AirQualityCard({
  category,
  pm25,
  pm10,
  ozone,
  airQualityFutureNotApplicable,
  note,
  source,
  measuredTime,
  formatPubTime,
}: AirQualityCardProps) {
  return (
    <>
      <div className="plan-grid">
        <div>
          <span className="stat-label">Category</span>
          <strong>{category || 'Unknown'}</strong>
        </div>
        <div>
          <span className="stat-label">PM2.5</span>
          <strong>{Number.isFinite(Number(pm25)) ? Number(pm25).toFixed(1) : 'N/A'}</strong>
        </div>
        <div>
          <span className="stat-label">PM10</span>
          <strong>{Number.isFinite(Number(pm10)) ? Number(pm10).toFixed(1) : 'N/A'}</strong>
        </div>
        <div>
          <span className="stat-label">Ozone</span>
          <strong>{Number.isFinite(Number(ozone)) ? Number(ozone).toFixed(1) : 'N/A'}</strong>
        </div>
      </div>
      <p className="muted-note">
        {airQualityFutureNotApplicable
          ? (note || 'Air quality is only used for the objective-local current day. It is not applied to future-date forecasts.')
          : `Source: ${source || 'Open-Meteo Air Quality API'}${
              measuredTime ? ` \u2022 Measured ${formatPubTime(measuredTime)}` : ''
            }`}
      </p>
    </>
  );
}
