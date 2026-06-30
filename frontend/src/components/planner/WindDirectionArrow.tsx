import { ArrowUp } from 'lucide-react';
import { windDirectionToDegrees } from '../../utils/avalanche';

interface WindDirectionArrowProps {
  /** Compass label, e.g. "NW". Used to derive degrees when `degrees` isn't already known. */
  direction?: string | null;
  /** Precomputed compass bearing in degrees (0 = N), if the caller already has it. */
  degrees?: number | null;
  size?: number;
  className?: string;
}

/**
 * Small rotated arrow icon for wind direction. Points toward where the wind is blowing FROM
 * (the same convention used by the wind-loading aspect rose in WindLoadingCard.tsx) — e.g. a
 * "NW" wind renders an arrow pointing up-and-to-the-left, toward the NW. Renders nothing for
 * calm/variable/unknown direction, since a rotation has no meaning in that case.
 */
export function WindDirectionArrow({ direction, degrees, size = 12, className = '' }: WindDirectionArrowProps) {
  const deg = degrees ?? windDirectionToDegrees(direction ?? null);
  if (deg === null || deg === undefined || !Number.isFinite(deg)) return null;
  return (
    <ArrowUp
      size={size}
      className={`wind-direction-arrow${className ? ` ${className}` : ''}`}
      style={{ transform: `rotate(${deg}deg)` }}
      aria-hidden="true"
      focusable="false"
    />
  );
}
