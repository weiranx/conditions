type WeatherTrendPoint = {
  label: string;
  hourValue: string | null;
  value: number | null;
  windDirectionLabel: string | null;
};

interface WeatherTrendMiniChartProps {
  data: WeatherTrendPoint[];
  metric: string;
  metricLabel: string;
  metricOptions: Array<{ key: string; label: string }>;
  lineColor: string;
  selectedHourValue: string | null;
  formatTick: (value: number) => string;
  formatValue: (value: number | null | undefined, directionLabel?: string | null) => string;
  onMetricChange: (key: string) => void;
}

export function WeatherTrendMiniChart({
  data,
  metric,
  metricLabel,
  metricOptions,
  lineColor,
  selectedHourValue,
  formatTick,
  formatValue,
  onMetricChange,
}: WeatherTrendMiniChartProps) {
  const width = 720;
  const height = 214;
  const padding = { top: 22, right: 18, bottom: 42, left: 64 };
  const values = data
    .map((point) => point.value)
    .filter((value): value is number => Number.isFinite(Number(value)));

  if (data.length < 2 || values.length < 2) return null;

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const naturalSpan = Math.max(1, rawMax - rawMin);
  const min = rawMin - naturalSpan * 0.12;
  const max = rawMax + naturalSpan * 0.12;
  const span = Math.max(1, max - min);
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const xForIndex = (index: number) => padding.left + (index / Math.max(1, data.length - 1)) * innerWidth;
  const yForValue = (value: number) => padding.top + ((max - value) / span) * innerHeight;

  let linePath = '';
  let continuingPath = false;
  data.forEach((point, index) => {
    if (!Number.isFinite(Number(point.value))) {
      continuingPath = false;
      return;
    }
    const command = continuingPath ? 'L' : 'M';
    linePath += `${command} ${xForIndex(index)} ${yForValue(Number(point.value))} `;
    continuingPath = true;
  });

  const ticks = [max, min + span / 2, min];
  const selectedIndex = data.findIndex((point) => point.hourValue === selectedHourValue);
  const selectedPoint = selectedIndex >= 0 ? data[selectedIndex] : null;

  return (
    <div className="ssr-wx-trend">
      <div className="ssr-wx-trend-head">
        <div>
          <span className="ssr-wx-eyebrow">Across your travel window</span>
          <strong>{metricLabel}</strong>
        </div>
        <label className="ssr-wx-metric-select">
          <span>Trend metric</span>
          <select value={metric} onChange={(event) => onMetricChange(event.target.value)}>
            {metricOptions.map((option) => (
              <option key={option.key} value={option.key}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="ssr-wx-chart-scroll">
        <svg
          className="ssr-wx-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${metricLabel} hourly trend. Use the hourly forecast buttons above to preview a time.`}
        >
          {ticks.map((tick, index) => {
            const y = yForValue(tick);
            return (
              <g key={`${tick}-${index}`}>
                <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="ssr-wx-chart-grid" />
                <text x={padding.left - 10} y={y + 4} textAnchor="end" className="ssr-wx-chart-tick">
                  {formatTick(tick)}
                </text>
              </g>
            );
          })}

          {selectedIndex >= 0 && (
            <line
              x1={xForIndex(selectedIndex)}
              x2={xForIndex(selectedIndex)}
              y1={padding.top}
              y2={height - padding.bottom}
              className="ssr-wx-chart-selected-line"
            />
          )}

          <path d={linePath.trim()} fill="none" stroke={lineColor} className="ssr-wx-chart-line" />

          {data.map((point, index) => {
            if (!Number.isFinite(Number(point.value)) || !point.hourValue) return null;
            const isSelected = point.hourValue === selectedHourValue;
            const x = xForIndex(index);
            const y = yForValue(Number(point.value));
            const showLabel = index === 0 || index === data.length - 1 || isSelected;
            return (
              <g
                key={`${point.hourValue}-${index}`}
                className={`ssr-wx-chart-point ${isSelected ? 'is-selected' : ''}`}
              >
                <title>{`${point.label}, ${formatValue(point.value, point.windDirectionLabel)}`}</title>
                <circle cx={x} cy={y} r={isSelected ? 6 : 4} fill={lineColor} />
                <circle cx={x} cy={y} r={isSelected ? 11 : 9} className="ssr-wx-chart-hit" />
                {showLabel && (
                  <text x={x} y={height - 15} textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'} className="ssr-wx-chart-hour">
                    {point.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {selectedPoint && Number.isFinite(Number(selectedPoint.value)) && (
        <p className="ssr-wx-trend-selection" aria-live="polite">
          <span>{selectedPoint.label}</span>
          <strong>{formatValue(selectedPoint.value, selectedPoint.windDirectionLabel)}</strong>
          <small>Previewing this hour in the weather summary above</small>
        </p>
      )}
    </div>
  );
}
