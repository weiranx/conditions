const { FT_PER_METER } = require('./weather');

const decodeHtmlEntities = (input = "") => {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
};

const cleanForecastText = (input = "") => {
  return decodeHtmlEntities(input)
    .replace(/<[^>]*>?/gm, " ")
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const scoreBottomLineCandidate = (text = "") => {
  let score = text.length;
  if (/avalanche|danger|snow|terrain|slab|trigger|wind/i.test(text)) score += 200;
  if (text.length > 1500) score -= 250;
  return score;
};

const pickBestBottomLine = (candidates = []) => {
  const cleaned = candidates.map(cleanForecastText).filter(Boolean).filter(t => t.length >= 40);
  if (!cleaned.length) return null;
  return cleaned.sort((a, b) => scoreBottomLineCandidate(b) - scoreBottomLineCandidate(a))[0];
};

const normalizeHttpUrl = (value) => {
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

const normalizeExternalLink = (value) => {
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

const isAvalancheApiLink = (value) =>
  typeof value === 'string' && /^https?:\/\/api\.avalanche\.(org|state\.co\.us)\b/i.test(value.trim());

const isCaicHomepageLink = (value) =>
  typeof value === 'string' && /^https?:\/\/(?:www\.)?avalanche\.state\.co\.us\/?(?:[?#].*)?$/i.test(value.trim());

const formatCoordinateForLink = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric.toFixed(5);
};

const buildCaicForecastLink = (lat, lon) => {
  const latParam = formatCoordinateForLink(lat);
  const lonParam = formatCoordinateForLink(lon);
  if (!latParam || !lonParam) {
    return 'https://avalanche.state.co.us/';
  }
  return `https://avalanche.state.co.us/?lat=${encodeURIComponent(latParam)}&lng=${encodeURIComponent(lonParam)}`;
};

const resolveAvalancheCenterLink = ({ centerId, link, centerLink, lat, lon }) => {
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

const normalizeAvalancheLevel = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.min(5, Math.max(0, Math.round(numeric)));
};

const deriveOverallDangerLevelFromElevations = (elevations, fallbackLevel = 0) => {
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

module.exports = {
  decodeHtmlEntities,
  cleanForecastText,
  pickBestBottomLine,
  normalizeExternalLink,
  resolveAvalancheCenterLink,
  deriveOverallDangerLevelFromElevations,
};
