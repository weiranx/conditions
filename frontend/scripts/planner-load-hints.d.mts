import type { Plugin } from 'vite';

export const RETURNING_VISITOR_KEYS: string[];
export const WRITE_PROBE_KEY: string;
export function apiOriginOf(apiBaseUrl: unknown): string | null;
export function plannerPreloads(bundle: Record<string, unknown>, base?: string): { js: string[]; css: string[] } | null;
export function plannerPreloadScript(preloads: { js: string[]; css: string[] }): string;
export function plannerLoadHints(): Plugin;
