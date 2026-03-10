import { useMemo } from 'react';
import {
  Area,
  Bar,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface MultiDayRiskArcProps {
  tripDays: Array<{
    date: string;
    dateLabel: string;
    score: number | null;
    decisionLevel: 'GO' | 'CAUTION' | 'NO-GO';
    precipChance: number | null;
    windGustMph: number | null;
  }>;
  getScoreColor: (score: number) => string;
  theme?: string;
}

const DECISION_COLORS: Record<string, string> = {
  GO: '#22c55e',
  CAUTION: '#eab308',
  'NO-GO': '#ef4444',
};

function CustomDot(props: Record<string, unknown>) {
  const { cx, cy, payload } = props as {
    cx: number;
    cy: number;
    payload: MultiDayRiskArcProps['tripDays'][number];
  };
  if (cx == null || cy == null || payload?.score == null) return null;
  const fill = DECISION_COLORS[payload.decisionLevel] ?? '#888';
  return <circle cx={cx} cy={cy} r={5} fill={fill} stroke="#fff" strokeWidth={1.5} />;
}

function useChartTooltipStyle(theme?: string): React.CSSProperties {
  return useMemo(() => {
    const isDark = theme === 'dark' || (
      theme !== 'light' &&
      typeof document !== 'undefined' &&
      document.documentElement.getAttribute('data-theme') === 'dark'
    );
    return isDark
      ? { fontSize: 12, padding: '6px 10px', background: '#1a2731', border: '1px solid #2b3946', color: '#e9f1f8' }
      : { fontSize: 12, padding: '6px 10px' };
  }, [theme]);
}

export function MultiDayRiskArc({ tripDays, getScoreColor, theme }: MultiDayRiskArcProps) {
  const tooltipStyle = useChartTooltipStyle(theme);
  if (!tripDays || tripDays.length === 0) return null;

  const chartData = tripDays.map((d) => ({
    ...d,
    scoreVal: d.score ?? undefined,
    precipVal: d.precipChance ?? undefined,
  }));

  const midScore = tripDays.find((d) => d.score != null)?.score ?? 75;
  const gradientId = 'risk-arc-gradient';

  return (
    <div className="multi-day-risk-arc">
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: -20 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={getScoreColor(90)} stopOpacity={0.4} />
              <stop offset="50%" stopColor={getScoreColor(midScore)} stopOpacity={0.2} />
              <stop offset="100%" stopColor={getScoreColor(30)} stopOpacity={0.1} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="dateLabel"
            tick={{ fontSize: 11, fill: '#888' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            yAxisId="score"
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: '#aaa' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            yAxisId="precip"
            orientation="right"
            domain={[0, 100]}
            hide
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value, name) => {
              const v = Number(value);
              if (name === 'scoreVal') return [`${Math.round(v)}`, 'Score'];
              if (name === 'precipVal') return [`${Math.round(v)}%`, 'Precip'];
              return [v, String(name)];
            }}
          />
          <Bar
            yAxisId="precip"
            dataKey="precipVal"
            fill="#94a3b8"
            opacity={0.3}
            barSize={20}
            isAnimationActive={false}
          />
          <Area
            yAxisId="score"
            type="monotone"
            dataKey="scoreVal"
            stroke={getScoreColor(midScore)}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={<CustomDot />}
            connectNulls
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
