import { CalendarRange } from 'lucide-react';
import type { MultiDayTripForecastDay } from '../../hooks/useTripForecast';

interface PlannerDaySwitcherProps {
  days: MultiDayTripForecastDay[];
  activeDate: string;
  startTimeLabel: string;
  formatTempDisplay: (value: number | null | undefined, options?: { includeUnit?: boolean; precision?: number }) => string;
  onSelectDay: (date: string) => void;
}

function dateParts(isoDate: string): { weekday: string; monthDay: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return { weekday: '', monthDay: isoDate };
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return {
    weekday: date.toLocaleDateString('en-US', { weekday: 'short' }),
    monthDay: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  };
}

function decisionClass(day: MultiDayTripForecastDay): string {
  return day.decisionLevel.toLowerCase().replace('-', '');
}

function decisionLabel(day: MultiDayTripForecastDay): string {
  if (day.decisionLevel === 'GO') return 'Clear';
  if (day.decisionLevel === 'NO-GO') return 'Blocked';
  return 'Caution';
}

export function PlannerDaySwitcher({
  days,
  activeDate,
  startTimeLabel,
  formatTempDisplay,
  onSelectDay,
}: PlannerDaySwitcherProps) {
  if (days.length < 2) return null;

  const activeIndex = days.findIndex((day) => day.date === activeDate);

  return (
    <section className="planner-day-switcher" aria-labelledby="planner-day-switcher-title">
      <header className="planner-day-switcher-header">
        <div className="planner-day-switcher-heading">
          <span className="planner-day-switcher-icon" aria-hidden><CalendarRange /></span>
          <div>
            <p>Multi-day plan</p>
            <h2 id="planner-day-switcher-title">Switch report day</h2>
          </div>
        </div>
        <p className="planner-day-switcher-status" aria-live="polite">
          {activeIndex >= 0 ? `Day ${activeIndex + 1} of ${days.length}` : `${days.length} days available`} · {startTimeLabel} start
        </p>
      </header>

      <div className="planner-day-switcher-days" role="group" aria-label="Available report days">
        {days.map((day, index) => {
          const active = day.date === activeDate;
          const labels = dateParts(day.date);
          return (
            <button
              type="button"
              key={day.date}
              className={`planner-day-switcher-day ${active ? 'is-active' : ''}`}
              aria-pressed={active}
              aria-label={`${labels.weekday}, ${labels.monthDay}, day ${index + 1} of ${days.length}, ${decisionLabel(day)}, ${day.score !== null ? `score ${day.score} out of 100` : 'score unavailable'}`}
              onClick={() => onSelectDay(day.date)}
            >
              <span className={`planner-day-switcher-band ${decisionClass(day)}`} aria-hidden />
              <span className="planner-day-switcher-date">
                <strong>{labels.weekday}</strong>
                <span>{labels.monthDay}</span>
              </span>
              <span className={`planner-day-switcher-decision ${decisionClass(day)}`}>{decisionLabel(day)}</span>
              <span className="planner-day-switcher-weather">
                {formatTempDisplay(day.tempHighF)} / {formatTempDisplay(day.tempLowF)}
              </span>
              <span className="planner-day-switcher-score">
                {day.score !== null ? <>{day.score}<small>/100</small></> : 'No score'}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
