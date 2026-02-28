import { FT_PER_METER } from './weather';

export const decodeHtmlEntities = (input: string = ""): string => {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
};

export const cleanForecastText = (input: string = ""): string => {
  return decodeHtmlEntities(input)
    .replace(/<[^>]*>?/gm, " ")
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

export const scoreBottomLineCandidate = (text: string = ""): number => {
  let score = text.length;
  if (/avalanche|danger|snow|terrain|slab|trigger|wind/i.test(text)) score += 200;
  if (text.length > 1500) score -= 250;
  return score;
};

export const pickBestBottomLine = (candidates: (string | null | undefined)[] = []): string | null => {
  const cleaned = candidates
    .filter((c): c is string => typeof c === 'string')
    .map(cleanForecastText)
    .filter(Boolean)
    .filter(t => t.length >= 40);
  if (!cleaned.length) return null;
  return cleaned.sort((a, b) => scoreBottomLineCandidate(b) - scoreBottomLineCandidate(a))[0];
};

export const normalizeHttpUrl = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^https:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^http:\/\//i.test(trimmed)) {
    return trimmed.replace(/^http:\/\//i, 'https://');
  }
  return null;
};

export const normalizeExternalLink = (value: string | null | undefined): string | null => {
  const normalized = normalizeHttpUrl(value);
  if (!normalized) {
    return null;
  }
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    if (host === 'www.nwac.us') {
      parsed.hostname = 'nwac.us';
    } else if (host === 'mountwashingtonavalanchecenter.org') {
      parsed.hostname = 'www.mountwashingtonavalanchecenter.org';
    } else if (host === 'avalanche.state.co.us' && parsed.pathname.toLowerCase() === '/home') {
      parsed.pathname = '/';
    }
    return parsed.toString();
  } catch {
    return normalized;
  }
};

export const isAvalancheApiLink = (value: string | null | undefined): boolean =>
  typeof value === 'string' && /^https?:\/\/api\.avalanche\.(org|state\.co\.us)\b/i.test(value.trim());

export const isCaicHomepageLink = (value: string | null | undefined): boolean =>
  typeof value === 'string' && /^https?:\/\/(?:www\.)?avalanche\.state\.co\.us\/?(?:[?#].*)?$/i.test(value.trim());

export const formatCoordinateForLink = (value: number | string | null | undefined): string | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric.toFixed(5);
};

export const buildCaicForecastLink = (lat: number | string, lon: number | string): string => {
  const latParam = formatCoordinateForLink(lat);
  const lonParam = formatCoordinateForLink(lon);
  if (!latParam || !lonParam) {
    return 'https://avalanche.state.co.us/';
  }
  return `https://avalanche.state.co.us/?lat=${encodeURIComponent(latParam)}&lng=${encodeURIComponent(lonParam)}`;
};

interface ResolveAvalancheCenterLinkOptions {
  centerId: string | null | undefined;
  link: string | null | undefined;
  centerLink: string | null | undefined;
  lat: number | string;
  lon: number | string;
}

export const resolveAvalancheCenterLink = ({ centerId, link, centerLink, lat, lon }: ResolveAvalancheCenterLinkOptions): string | null => {
  const primaryLink = normalizeExternalLink(link);
  const fallbackLink = normalizeExternalLink(centerLink);
  const nonApiLink = [primaryLink, fallbackLink].find((candidate) => candidate && !isAvalancheApiLink(candidate));

  if (centerId === 'CAIC') {
    if (nonApiLink) {
      try {
        const parsed = new URL(nonApiLink);
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        const hasCoordinateParams = Boolean(parsed.searchParams.get('lat')) && Boolean(parsed.searchParams.get('lng') || parsed.searchParams.get('lon'));
        if (host === 'avalanche.state.co.us' && hasCoordinateParams) {
          return nonApiLink;
        }
      } catch {
        // Fall through to existing CAIC handling.
      }
    }
    if (nonApiLink && !isCaicHomepageLink(nonApiLink)) {
      return nonApiLink;
    }
    return buildCaicForecastLink(lat, lon);
  }

  return nonApiLink || primaryLink || fallbackLink || null;
};

const normalizeAvalancheLevel = (value: number | string | null | undefined): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.min(5, Math.max(0, Math.round(numeric)));
};

export const deriveOverallDangerLevelFromElevations = (elevations: any, fallbackLevel: number | string = 0): number => {
  const fallback = normalizeAvalancheLevel(fallbackLevel);
  if (!elevations || typeof elevations !== 'object') {
    return fallback;
  }

  const levels = [elevations.above, elevations.at, elevations.below]
    .map((band) => normalizeAvalancheLevel(band?.level))
    .filter((level) => Number.isFinite(level) && level > 0);

  if (levels.length === 0) {
    return fallback;
  }

  const maxLevel = Math.max(...levels);
  return maxLevel;
};
