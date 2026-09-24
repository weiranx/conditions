import type { ThemeMode } from './types';

/** Page background of each theme (--f-bg / --sky-bg in the field styles). */
const THEME_COLORS = { light: '#f2f3f1', dark: '#0f1211' } as const;

/**
 * Applies a theme preference to the document, following the system setting
 * when the preference is "system". Returns a cleanup that stops following it.
 *
 * The browser's status and tool bars take the page background, so on a phone
 * they read as part of the page rather than a band of another colour.
 * index.html has one theme-color tag per system scheme for the first paint;
 * the app's own setting can differ from the system, so both follow it here.
 */
export function followThemePreference(mode: ThemeMode): () => void {
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  const apply = () => {
    const theme = mode === 'system' ? (media?.matches ? 'dark' : 'light') : mode;
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
      meta.content = THEME_COLORS[theme];
    });
  };
  apply();
  media?.addEventListener?.('change', apply);
  return () => media?.removeEventListener?.('change', apply);
}
