import { useEffect, useId, useState } from 'react';

interface ScoreGaugeProps {
  score: number;
  size?: number;
  scoreColor: string;
}

const ARC_DEGREES = 270;
const START_ANGLE = 135;

export function ScoreGauge({ score, size = 110, scoreColor }: ScoreGaugeProps) {
  const [animated, setAnimated] = useState(false);
  const filterId = useId();

  const safeScore = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;

  const cx = 60;
  const cy = 60;
  const r = 44;
  const strokeWidth = 9;
  const circumference = 2 * Math.PI * r;
  const arcLength = (ARC_DEGREES / 360) * circumference;
  const gapLength = circumference - arcLength;
  const progress = safeScore / 100;
  const filledLength = arcLength * progress;
  const emptyLength = arcLength - filledLength;

  useEffect(() => {
    setAnimated(false);
    const id = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(id);
  }, [safeScore]);

  return (
    <div
      className="score-gauge"
      role="img"
      aria-label={`Safety score: ${Math.round(safeScore)} out of 100`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 120 120" width={size} height={size}>
        <defs>
          <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor={scoreColor} floodOpacity="0.35" />
          </filter>
        </defs>

        {/* Background arc */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="var(--score-gauge-track, rgba(0,0,0,0.08))"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${arcLength} ${gapLength}`}
          transform={`rotate(${START_ANGLE} ${cx} ${cy})`}
        />

        {/* Score arc */}
        <circle
          className="score-gauge-arc"
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={scoreColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={animated ? `${filledLength} ${emptyLength + gapLength}` : `0 ${circumference}`}
          transform={`rotate(${START_ANGLE} ${cx} ${cy})`}
          filter={`url(#${filterId})`}
          style={{ transition: 'stroke-dasharray 0.8s ease-out, stroke 0.4s ease' }}
        />

        {/* Score text */}
        <text
          x={cx}
          y={cy - 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill={scoreColor}
          className="score-gauge-number"
          style={{ transition: 'fill 0.4s ease' }}
        >
          {Math.round(safeScore)}
        </text>

        {/* "/100" label */}
        <text
          x={cx}
          y={cy + 16}
          textAnchor="middle"
          dominantBaseline="central"
          className="score-gauge-label"
        >
          / 100
        </text>
      </svg>
    </div>
  );
}
