import type { AiBriefCitation, AiBriefDetails } from './types';

/** The report chapters an AI citation can point the reader to. */
export type EvidenceChapter = 'forecast' | 'timing' | 'terrain' | 'route' | 'sources' | 'gear';

// Where each top-level report field is shown. Conditions (alerts, air, fire,
// precipitation history) sit in the Weather chapter beside the forecast.
const CHAPTER_BY_ROOT: Record<string, EvidenceChapter> = {
  weather: 'forecast',
  forecast: 'forecast',
  alerts: 'forecast',
  airQuality: 'forecast',
  rainfall: 'forecast',
  fireRisk: 'forecast',
  heatRisk: 'forecast',
  atmosphere: 'forecast',
  pleasantness: 'forecast',
  solar: 'timing',
  daylight: 'timing',
  avalanche: 'terrain',
  snowpack: 'terrain',
  terrainCondition: 'terrain',
  trail: 'terrain',
  fieldObservations: 'terrain',
  route: 'route',
  gear: 'gear',
  contingency: 'gear',
  safety: 'sources',
  reportInsights: 'sources',
  supplementalEvidence: 'sources',
  localConditions: 'sources',
};

const ROOT_LABEL: Record<string, string> = {
  safety: 'Safety',
  avalanche: 'Avalanche',
  snowpack: 'Snowpack',
  alerts: 'Alerts',
  airQuality: 'Air quality',
  rainfall: 'Precipitation',
  fireRisk: 'Fire',
  heatRisk: 'Heat',
  terrainCondition: 'Surface',
  route: 'Route',
  reportInsights: 'Source insight',
  supplementalEvidence: 'Source',
  fieldObservations: 'Trip report',
  localConditions: 'Local observation',
};

const words = (key: string) => key
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/[_-]+/g, ' ')
  .toLowerCase()
  .trim();

export function evidenceChapter(path: string): EvidenceChapter | null {
  return CHAPTER_BY_ROOT[path.split('.')[0]] ?? null;
}

/** A short, plain name for a cited field, e.g. `weather.windGust` → "Wind gust". */
export function evidenceLabel(path: string): string {
  const parts = path.split('.').filter((part) => part && !/^\d+$/.test(part));
  const root = parts[0] ?? '';
  const leaf = parts.length > 1 ? words(parts[parts.length - 1]) : words(root);
  const prefix = ROOT_LABEL[root];
  const label = prefix && !leaf.includes(prefix.toLowerCase()) && parts.length > 1 ? `${prefix} ${leaf}` : leaf;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export interface EvidenceLink {
  label: string;
  chapter: EvidenceChapter | null;
}

/** The distinct fields a section cites, each with the chapter that shows it. */
export function evidenceLinks(citations: AiBriefCitation[], limit = 4): EvidenceLink[] {
  const seen = new Set<string>();
  const links: EvidenceLink[] = [];
  for (const citation of citations) {
    const label = evidenceLabel(citation.path);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    links.push({ label, chapter: evidenceChapter(citation.path) });
    if (links.length === limit) break;
  }
  return links;
}

/** The citations for one section of the read, matched by its heading. */
export function sectionCitations(details: AiBriefDetails | null, title: string): AiBriefCitation[] {
  if (!details) return [];
  const heading = title.trim().toUpperCase();
  return details.evidence.find((section) => section.heading.trim().toUpperCase() === heading)?.evidence ?? [];
}

/** Whether a section of the read cites anything a chapter shows. */
export function sectionCitesChapter(citations: AiBriefCitation[], chapter: EvidenceChapter): boolean {
  return citations.some((citation) => evidenceChapter(citation.path) === chapter);
}

const LEVEL_RANK: Record<string, number> = { GO: 0, CAUTION: 1, 'NO-GO': 2 };

/**
 * The AI's headline and reason for the top of the report, when it passed its
 * checks and was written against a decision at least as strict as the one shown.
 */
export function aiHero(details: AiBriefDetails | null, level: string): NonNullable<AiBriefDetails['hero']> | null {
  const hero = details?.validation === 'evidence_checked' ? details.hero : null;
  if (!hero?.headline.trim() || !hero.reason.trim()) return null;
  const written = hero.level === undefined ? undefined : LEVEL_RANK[hero.level];
  const shown = LEVEL_RANK[level];
  if (written === undefined || shown === undefined || written < shown) return null;
  return hero;
}

/**
 * A read written before the AI also wrote the report's opening: its details
 * carry no hero at all (a read whose opening failed its checks has `hero: null`).
 */
export function isOutdatedRead(narrative: string | null, details: AiBriefDetails | null): boolean {
  return Boolean(narrative) && (!details || details.hero === undefined);
}
