import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface RouteConditionsProfileProps {
  waypoints: Array<{
    name: string;
    elev_ft: number;
    score: number | null;
    weather: { temp?: number; windSpeed?: number; description?: string; precipChance?: number };
    avalanche?: { risk?: string; dangerLevel?: number };
  }>;
  getScoreColor: (score: number) => string;
  formatTempDisplay: (value: number | null | undefined) => string;
  formatWindDisplay: (value: number | null | undefined) => string;
  formatElevationDisplay: (value: number | null | undefined) => string;
}

const HIGH_RISK_THRESHOLD = 40;

function CustomDot(props: Record<string, unknown>) {
  const { cx, cy, payload, getScoreColor } = props as {
    cx: number;
    cy: number;
    payload: RouteConditionsProfileProps['waypoints'][number];
    getScoreColor: (s: number) => string;
  };
  if (cx == null || cy == null) return null;
  const score = payload?.score;
  const fill = score != null ? getScoreColor(score) : '#888';
  const isHighRisk = score != null && score < HIGH_RISK_THRESHOLD;
  return (
    <>
      {isHighRisk && (
        <circle cx={cx} cy={cy} r={10} fill="#ef4444" opacity={0.2} />
      )}
      <circle cx={cx} cy={cy} r={4} fill={fill} stroke="#fff" strokeWidth={1.5} />
    </>
  );
}

function CustomTooltip({
  active,
  payload,
  formatTempDisplay,
  formatWindDisplay,
  formatElevationDisplay,
}: {
  active?: boolean;
  payload?: Array<{ payload: RouteConditionsProfileProps['waypoints'][number] }>;
  label?: string;
  formatTempDisplay: (v: number | null | undefined) => string;
  formatWindDisplay: (v: number | null | undefined) => string;
  formatElevationDisplay: (v: number | null | undefined) => string;
}) {
  if (!active || !payload?.[0]) return null;
  const wp = payload[0].payload;
  return (
    <div className="route-profile-tooltip">
      <div className="route-profile-tooltip-name">{wp.name}</div>
      <div>{formatElevationDisplay(wp.elev_ft)}</div>
      {wp.score != null && <div>Score: {Math.round(wp.score)}</div>}
      {wp.weather.temp != null && <div>Temp: {formatTempDisplay(wp.weather.temp)}</div>}
      {wp.weather.windSpeed != null && (
        <div>Wind: {formatWindDisplay(wp.weather.windSpeed)}</div>
      )}
      {wp.weather.precipChance != null && (
        <div>Precip: {Math.round(wp.weather.precipChance)}%</div>
      )}
      {wp.weather.description && <div>{wp.weather.description}</div>}
      {wp.avalanche?.risk && <div>Avy: {wp.avalanche.risk}</div>}
    </div>
  );
}

export function RouteConditionsProfile({
  waypoints,
  getScoreColor,
  formatTempDisplay,
  formatWindDisplay,
  formatElevationDisplay,
}: RouteConditionsProfileProps) {
  if (!waypoints || waypoints.length === 0) return null;

  const elevs = waypoints.map((w) => w.elev_ft);
  const minElev = Math.floor(Math.min(...elevs) / 500) * 500;
  const maxElev = Math.ceil(Math.max(...elevs) / 500) * 500;

  return (
    <div className="route-conditions-profile">
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={waypoints} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
          <defs>
            <linearGradient id="elev-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#64748b" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#64748b" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fill: '#888' }}
            axisLine={false}
            tickLine={false}
            interval={0}
            angle={-30}
            textAnchor="end"
            height={40}
          />
          <YAxis
            domain={[minElev, maxElev]}
            tick={{ fontSize: 10, fill: '#aaa' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}k`}
          />
          <Tooltip
            content={
              <CustomTooltip
                formatTempDisplay={formatTempDisplay}
                formatWindDisplay={formatWindDisplay}
                formatElevationDisplay={formatElevationDisplay}
              />
            }
          />
          <Area
            type="monotone"
            dataKey="elev_ft"
            stroke="#64748b"
            strokeWidth={2}
            fill="url(#elev-fill)"
            dot={(props: Record<string, unknown>) => (
              <CustomDot key={String(props.index)} {...props} getScoreColor={getScoreColor} />
            )}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
