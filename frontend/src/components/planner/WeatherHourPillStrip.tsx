import { useEffect, useRef } from 'react';
import type { WeatherTrendPoint } from '../../app/types';

export interface WeatherHourOption {
  value: string;
  label: string;
  tempLabel: string | null;
  point: WeatherTrendPoint;
}

interface WeatherHourPillStripProps {
  options: WeatherHourOption[];
  selectedIndex: number;
  onSelect: (value: string) => void;
  weatherConditionEmoji: (description: string, isDaytime?: boolean | null) => string;
}

export function WeatherHourPillStrip({
  options,
  selectedIndex,
  onSelect,
  weatherConditionEmoji,
}: WeatherHourPillStripProps) {
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    }
  }, [selectedIndex]);

  if (options.length <= 1) return null;

  return (
    <div className="weather-hour-pill-strip-wrap">
      <div className="weather-hour-pill-strip-header">
        <span className="weather-hour-pill-strip-title">Hour-by-Hour</span>
        {selectedIndex >= 0 && selectedIndex < options.length && (
          <span className="weather-hour-pill-strip-selected">{options[selectedIndex].label}</span>
        )}
      </div>
      <div className="weather-hour-pill-strip" role="group" aria-label="Hour-by-hour weather selector">
        {options.map((option, index) => {
          const isSelected = index === selectedIndex;
          const compactLabel = option.label
            .replace(/ AM/i, 'a')
            .replace(/ PM/i, 'p');
          const emoji = weatherConditionEmoji(option.point.condition, option.point.isDaytime ?? null);

          return (
            <button
              key={option.value}
              ref={isSelected ? selectedRef : undefined}
              type="button"
              className={`weather-hour-pill${isSelected ? ' selected' : ''}`}
              onClick={() => onSelect(option.value)}
              aria-pressed={isSelected}
              aria-label={`${option.label}: ${option.tempLabel || 'N/A'}, ${option.point.condition}`}
            >
              <span className="weather-hour-pill-time">{compactLabel}</span>
              <span className="weather-hour-pill-temp">{option.tempLabel || '—'}</span>
              <span className="weather-hour-pill-icon">{emoji}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
