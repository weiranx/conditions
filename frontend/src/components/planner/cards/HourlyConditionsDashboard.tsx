import { useMemo } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';

function useChartTooltipStyle(): React.CSSProperties {
  return useMemo(() => {
    const isDark =
      typeof document !== 'undefined' &&
      document.documentElement.getAttribute('data-theme') === 'dark';
    return isDark
      ? { fontSize: 12, padding: '4px 8px', background: '#1a2731', border: '1px solid #2b3946', color: '#e9f1f8' }
      : { fontSize: 12, padding: '4px 8px' };
  }, []);
}

interface HourlyConditionsDashboardProps {
  trendData: Array<{
    label: string;
    temp: number | null;
    feelsLike: number | null;
    wind: number | null;
    gust: number | null;
    precipChance: number | null;
  }>;
  formatTempDisplay: (value: number | null | undefined) => string;
  formatWindDisplay: (value: number | null | undefined) => string;
  timeStyle: 'ampm' | '24h';
}

interface SparklineConfig {
  title: string;
  lines: Array<{ dataKey: string; color: string; dashed?: boolean }>;
  formatter: (v: number | null | undefined) => string;
  unit?: string;
}

function MiniSparkline({
  data,
  config,
  showXAxis,
}: {
  data: HourlyConditionsDashboardProps['trendData'];
  config: SparklineConfig;
  showXAxis: boolean;
}) {
  const tooltipStyle = useChartTooltipStyle();
  return (
    <div className="hourly-sparkline-row">
      <span className="hourly-sparkline-label">{config.title}</span>
      <div className="hourly-sparkline-chart">
        <ResponsiveContainer width="100%" height={showXAxis ? 76 : 60}>
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            {showXAxis && (
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#888' }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
            )}
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value) => [config.formatter(Number(value)), '']}
              labelFormatter={(label) => String(label)}
            />
            {config.lines.map((line) => (
              <Line
                key={line.dataKey}
                type="monotone"
                dataKey={line.dataKey}
                stroke={line.color}
                strokeWidth={1.5}
                strokeDasharray={line.dashed ? '4 2' : undefined}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function HourlyConditionsDashboard({
  trendData,
  formatTempDisplay,
  formatWindDisplay,
}: HourlyConditionsDashboardProps) {
  if (!trendData || trendData.length === 0) return null;

  const sparklines: SparklineConfig[] = [
    {
      title: 'Temp',
      lines: [{ dataKey: 'temp', color: '#3b82f6' }],
      formatter: formatTempDisplay,
    },
    {
      title: 'Wind',
      lines: [
        { dataKey: 'wind', color: '#6b7280' },
        { dataKey: 'gust', color: '#ef4444', dashed: true },
      ],
      formatter: formatWindDisplay,
    },
    {
      title: 'Precip',
      lines: [{ dataKey: 'precipChance', color: '#14b8a6' }],
      formatter: (v) => (v != null ? `${Math.round(v)}%` : '--'),
    },
    {
      title: 'Feels',
      lines: [{ dataKey: 'feelsLike', color: '#f97316' }],
      formatter: formatTempDisplay,
    },
  ];

  return (
    <div className="hourly-conditions-dashboard">
      {sparklines.map((config, i) => (
        <MiniSparkline
          key={config.title}
          data={trendData}
          config={config}
          showXAxis={i === sparklines.length - 1}
        />
      ))}
    </div>
  );
}
