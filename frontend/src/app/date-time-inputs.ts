import { formatDateInput } from './core';

export function currentLocalTimeInput(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function dateTimeInputsFor(instant: Date, timeZone?: string | null): { date: string; time: string } {
  const fallback = {
    date: formatDateInput(instant),
    time: `${String(instant.getHours()).padStart(2, '0')}:${String(instant.getMinutes()).padStart(2, '0')}`,
  };

  if (!timeZone || typeof Intl === 'undefined') {
    return fallback;
  }

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    }).formatToParts(instant);
    const partMap = parts.reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') {
        acc[part.type] = part.value;
      }
      return acc;
    }, {});
    if (partMap.year && partMap.month && partMap.day && partMap.hour && partMap.minute) {
      const rawHour = Number(partMap.hour);
      const rawMinute = Number(partMap.minute);
      if (!Number.isFinite(rawHour) || !Number.isFinite(rawMinute)) {
        return fallback;
      }
      const hour = ((Math.round(rawHour) % 24) + 24) % 24;
      const minute = Math.max(0, Math.min(59, Math.round(rawMinute)));
      return {
        date: `${partMap.year}-${partMap.month}-${partMap.day}`,
        time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      };
    }
  } catch {
    // Fall back to local device time/date if timezone formatting fails.
  }

  return fallback;
}

export function currentDateTimeInputs(timeZone?: string | null): { date: string; time: string } {
  return dateTimeInputsFor(new Date(), timeZone);
}
