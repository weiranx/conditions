import { PERSISTED_REPORT_KEY, USER_PREFERENCES_KEY } from './constants';

export const LANDING_SEEN_KEY = 'summitsafe:landing-seen:v1';
const GUEST_REPORT_COUNT_KEY = 'summitsafe:guest-report-count:v1';

type Place = Pick<Location, 'pathname' | 'search' | 'hash'>;
type Reader = Pick<Storage, 'getItem'>;

/**
 * `/welcome` always shows the landing page. A bare `/` shows it only to a
 * first-time visitor: any link state (query or hash) or sign of earlier use in
 * this browser opens the planner. Unreadable storage also opens the planner, so
 * a visitor we cannot remember is never stuck in front of the landing page.
 */
export function shouldShowLanding(place: Place, storage: Reader | null): boolean {
  if (/^\/welcome\/?$/.test(place.pathname)) return true;
  if (place.pathname !== '/' || place.search || place.hash || !storage) return false;
  try {
    return [LANDING_SEEN_KEY, USER_PREFERENCES_KEY, PERSISTED_REPORT_KEY, GUEST_REPORT_COUNT_KEY]
      .every((key) => storage.getItem(key) === null);
  } catch {
    return false;
  }
}

export function markLandingSeen() {
  try {
    window.localStorage.setItem(LANDING_SEEN_KEY, '1');
  } catch {
    // Storage can be blocked; the visitor will simply see the landing page again.
  }
}

export function readLocalStorage(): Reader | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
