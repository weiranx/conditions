export const GUEST_REPORT_LIMIT = 10;
export const GUEST_REPORT_COUNT_KEY = 'summitsafe:guest-report-count:v1';

function normalizeGuestReportCount(value: unknown): number {
  const count = Number(value);
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.min(GUEST_REPORT_LIMIT, Math.floor(count)));
}

export function loadGuestReportCount(): number {
  if (typeof window === 'undefined') return 0;

  try {
    return normalizeGuestReportCount(window.localStorage.getItem(GUEST_REPORT_COUNT_KEY));
  } catch {
    return 0;
  }
}

export function incrementGuestReportCount(currentCount: number): number {
  const nextCount = Math.min(
    GUEST_REPORT_LIMIT,
    Math.max(normalizeGuestReportCount(currentCount), loadGuestReportCount()) + 1,
  );

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(GUEST_REPORT_COUNT_KEY, String(nextCount));
    } catch {
      // Storage may be unavailable; keep enforcing the limit for this session.
    }
  }

  return nextCount;
}
