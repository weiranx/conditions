export const firstNonEmptyString = (...values: (string | null | undefined)[]): string | null => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
};

interface JsonChunk {
  chunk: string;
  startIndex: number;
  endIndex: number;
}

const extractBalancedJsonChunk = (input: string, startIndex: number = 0): JsonChunk | null => {
  if (typeof input !== 'string' || input.length === 0) {
    return null;
  }

  let cursor = Math.max(0, startIndex);
  while (cursor < input.length && /\s/.test(input[cursor])) {
    cursor += 1;
  }

  if (cursor >= input.length) return null;

  const opening = input[cursor];
  const closing = opening === '{' ? '}' : opening === '[' ? ']' : null;
  if (!closing) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let idx = cursor; idx < input.length; idx += 1) {
    const ch = input[idx];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === opening) {
      depth += 1;
      continue;
    }

    if (ch === closing) {
      depth -= 1;
      if (depth === 0) {
        return {
          chunk: input.slice(cursor, idx + 1),
          startIndex: cursor,
          endIndex: idx + 1,
        };
      }
    }
  }

  return null;
};

export const parseAvalancheDetailPayloads = (rawText: string | null | undefined): any[] => {
  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    return [];
  }

  const text = rawText.trim();
  const candidateChunks: string[] = [];
  const addCandidateChunk = (chunk: string | null | undefined) => {
    if (typeof chunk !== 'string') {
      return;
    }
    const normalized = chunk.trim();
    if (normalized.length > 0) {
      candidateChunks.push(normalized);
    }
  };

  addCandidateChunk(text);

  const warningSplitIndex = text.search(/<br\b|<b>\s*warning/i);
  if (warningSplitIndex > 0) {
    addCandidateChunk(text.slice(0, warningSplitIndex));
  }

  const firstJsonIndex = text.search(/[\[{]/);
  if (firstJsonIndex > 0) {
    addCandidateChunk(text.slice(firstJsonIndex));
  }

  const firstChunk = extractBalancedJsonChunk(text, firstJsonIndex >= 0 ? firstJsonIndex : 0);
  if (firstChunk?.chunk) {
    addCandidateChunk(firstChunk.chunk);
  }

  for (let idx = 0; idx < text.length; idx += 1) {
    const ch = text[idx];
    if (ch !== '{' && ch !== '[') {
      continue;
    }
    const extracted = extractBalancedJsonChunk(text, idx);
    if (!extracted?.chunk) {
      continue;
    }
    addCandidateChunk(extracted.chunk);
    idx = Math.max(idx, extracted.endIndex - 1);
  }

  const parsedPayloads: any[] = [];
  const seenChunks = new Set<string>();
  for (const chunk of candidateChunks) {
    if (seenChunks.has(chunk)) {
      continue;
    }
    seenChunks.add(chunk);

    try {
      const parsed = JSON.parse(chunk);
      if (parsed && typeof parsed === 'object') {
        parsedPayloads.push(parsed);
      }
    } catch {
      // Try next candidate chunk.
    }
  }

  return parsedPayloads;
};

const normalizeAvalancheLikelihood = (value: any): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const mapped: Record<number, string> = {
      1: 'unlikely',
      2: 'possible',
      3: 'likely',
      4: 'very likely',
      5: 'certain',
    };
    return mapped[Math.round(value)] || String(value);
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => normalizeAvalancheLikelihood(entry))
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);

    if (!parts.length) {
      return undefined;
    }

    return [...new Set(parts)].join(' to ');
  }

  if (typeof value === 'object') {
    const record = value;
    const label = firstNonEmptyString(record.label, record.name, record.text, record.display, record.value);
    if (label) {
      return label;
    }

    const minVal = Number(record.min ?? record.low);
    const maxVal = Number(record.max ?? record.high);
    if (Number.isFinite(minVal) && Number.isFinite(maxVal)) {
      return `${normalizeAvalancheLikelihood(minVal)} to ${normalizeAvalancheLikelihood(maxVal)}`;
    }
    if (Number.isFinite(minVal)) {
      return normalizeAvalancheLikelihood(minVal);
    }
    if (Number.isFinite(maxVal)) {
      return normalizeAvalancheLikelihood(maxVal);
    }

    return undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  return undefined;
};

const normalizeAvalancheLocation = (value: any): string[] | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  const locations: string[] = [];
  const appendLocation = (entry: any) => {
    if (entry === null || entry === undefined) {
      return;
    }

    if (Array.isArray(entry)) {
      entry.forEach(appendLocation);
      return;
    }

    if (typeof entry === 'string') {
      const parts = entry
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length) {
        parts.forEach((part) => locations.push(part));
      } else if (entry.trim()) {
        locations.push(entry.trim());
      }
      return;
    }

    if (typeof entry === 'object') {
      for (const [key, nested] of Object.entries(entry)) {
        if (key && String(key).trim()) {
          locations.push(String(key).trim());
        }
        appendLocation(nested);
      }
      return;
    }

    locations.push(String(entry));
  };

  appendLocation(value);

  const deduped = [...new Set(locations.map((entry) => entry.trim()).filter(Boolean))];
  return deduped.length > 0 ? deduped : undefined;
};

export interface AvalancheProblem {
  id?: number | string;
  name?: string;
  likelihood?: string;
  location?: string[];
  discussion?: string;
  [key: string]: any;
}

export const normalizeAvalancheProblemCollection = (rawProblems: any[] | null | undefined): AvalancheProblem[] => {
  if (!Array.isArray(rawProblems) || rawProblems.length === 0) {
    return [];
  }

  return rawProblems
    .map((problem, index) => {
      if (!problem || typeof problem !== 'object') {
        return null;
      }

      const normalized: AvalancheProblem = { ...problem };
      const normalizedName = firstNonEmptyString(problem.name, problem.problem, problem.problem_name, problem.problem_type);
      const normalizedLikelihood = normalizeAvalancheLikelihood(
        problem.likelihood ?? problem.trigger_likelihood ?? problem.probability ?? problem.chance,
      );
      const normalizedLocation = normalizeAvalancheLocation(
        problem.location ?? problem.aspect_elevation ?? problem.terrain ?? problem.aspectElevation,
      );

      if (!normalized.id && Number.isFinite(Number(problem.problem_id))) {
        normalized.id = Number(problem.problem_id);
      } else if (!normalized.id && Number.isFinite(Number(problem.avalanche_problem_id))) {
        normalized.id = Number(problem.avalanche_problem_id);
      } else if (!normalized.id) {
        normalized.id = index + 1;
      }

      if (normalizedName) {
        normalized.name = normalizedName;
      }
      if (normalizedLikelihood) {
        normalized.likelihood = normalizedLikelihood;
      }
      if (normalizedLocation && normalizedLocation.length > 0) {
        normalized.location = normalizedLocation;
      }

      return normalized;
    })
    .filter((problem): problem is AvalancheProblem => Boolean(problem));
};

export const getAvalancheProblemsFromDetail = (detail: any): AvalancheProblem[] =>
  normalizeAvalancheProblemCollection(detail?.forecast_avalanche_problems || detail?.avalanche_problems || detail?.problems || []);

const getAvalancheBottomLineFromDetail = (detail: any): string | null =>
  firstNonEmptyString(
    detail?.bottom_line,
    detail?.bottom_line_summary,
    detail?.bottom_line_summary_text,
    detail?.overall_summary,
    detail?.summary,
  );

const hasAvalancheDangerData = (detail: any): boolean =>
  Boolean(
    (Array.isArray(detail?.danger) && detail.danger.length > 0)
      || detail?.danger_low
      || detail?.danger_mid
      || detail?.danger_high
      || detail?.danger_level,
  );

const normalizeAvalancheZoneToken = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
};

const getAvalancheCandidateZoneHints = (candidate: any): { zoneId: string | null; zoneName: string | null; zoneSlug: string | null } => {
  const zoneId = firstNonEmptyString(candidate?.zone_id, candidate?.forecast_zone_id, candidate?.id);
  const zoneName = firstNonEmptyString(candidate?.zone_name, candidate?.name, candidate?.forecast_zone?.name);
  const zoneSlug = firstNonEmptyString(candidate?.zone_slug, candidate?.slug);
  return {
    zoneId: zoneId ? String(zoneId) : null,
    zoneName: zoneName ? String(zoneName) : null,
    zoneSlug: zoneSlug ? String(zoneSlug) : null,
  };
};

export interface AvalancheDetailCandidate {
  candidate: any;
  score: number;
  hasUsefulDetail: boolean;
  problems: AvalancheProblem[];
}

const scoreAvalancheDetailCandidate = (candidate: any, context: any = {}, options: any = {}): AvalancheDetailCandidate | null => {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const cleanForecastText = typeof options.cleanForecastText === 'function' ? options.cleanForecastText : (value: any) => String(value || '').trim();
  const bottomLine = getAvalancheBottomLineFromDetail(candidate) || '';
  const cleanedBottomLine = cleanForecastText(bottomLine);
  const problems = getAvalancheProblemsFromDetail(candidate);
  const hasDanger = hasAvalancheDangerData(candidate);
  const hasUsefulDetail = cleanedBottomLine.length > 20 || problems.length > 0 || hasDanger;
  const zoneHints = getAvalancheCandidateZoneHints(candidate);
  const candidateZoneToken = normalizeAvalancheZoneToken(zoneHints.zoneName || zoneHints.zoneSlug || zoneHints.zoneId);

  const expectedZoneId = context.zoneId ? String(context.zoneId) : null;
  const expectedZoneToken = normalizeAvalancheZoneToken(context.zoneSlug || context.zoneName || expectedZoneId);
  const expectedCenterId = context.centerId ? String(context.centerId).toUpperCase() : null;

  let score = 0;
  if (problems.length > 0) {
    score += 600 + Math.min(240, problems.length * 40);
  }
  if (cleanedBottomLine.length > 0) {
    score += Math.min(320, cleanedBottomLine.length);
  }
  if (hasDanger) {
    score += 180;
  }

  if (expectedCenterId && String(candidate.center_id || '').toUpperCase() === expectedCenterId) {
    score += 120;
  }

  if (expectedZoneId && zoneHints.zoneId === expectedZoneId) {
    score += 900;
  } else if (expectedZoneToken && candidateZoneToken) {
    if (candidateZoneToken === expectedZoneToken) {
      score += 700;
    } else if (candidateZoneToken.includes(expectedZoneToken) || expectedZoneToken.includes(candidateZoneToken)) {
      score += 350;
    }
  }

  if (!hasUsefulDetail) {
    score -= 500;
  }

  return {
    candidate,
    score,
    hasUsefulDetail,
    problems,
  };
};

const extractAvalancheDetailCandidates = (payload: any): any[] => {
  const candidates: any[] = [];
  const pushCandidate = (value: any) => {
    if (!value || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(pushCandidate);
      return;
    }
    if (value.properties && typeof value.properties === 'object') {
      candidates.push(value.properties);
      return;
    }
    candidates.push(value);
  };

  pushCandidate(payload?.features);
  pushCandidate(payload?.products);
  pushCandidate(payload?.data);
  pushCandidate(payload?.product);
  pushCandidate(payload?.properties);
  pushCandidate(payload);

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const signature = [
      firstNonEmptyString(candidate?.id, ''),
      firstNonEmptyString(candidate?.zone_id, ''),
      firstNonEmptyString(candidate?.name, candidate?.zone_name, ''),
      firstNonEmptyString(candidate?.published_time, candidate?.updated_at, ''),
      Array.isArray(candidate?.forecast_avalanche_problems) ? candidate.forecast_avalanche_problems.length : 0,
    ].join('|');

    if (seen.has(signature)) {
      return false;
    }
    seen.add(signature);
    return true;
  });
};

interface PickBestAvalancheDetailCandidateOptions {
  payloads: any[];
  centerId: string | null | undefined;
  zoneId: string | number | null | undefined;
  zoneSlug: string | null | undefined;
  zoneName: string | null | undefined;
  cleanForecastText: (text: string) => string;
}

export const pickBestAvalancheDetailCandidate = ({ payloads, centerId, zoneId, zoneSlug, zoneName, cleanForecastText }: PickBestAvalancheDetailCandidateOptions): AvalancheDetailCandidate | null => {
  if (!Array.isArray(payloads) || payloads.length === 0) {
    return null;
  }

  const context = { centerId, zoneId, zoneSlug, zoneName };
  let best: AvalancheDetailCandidate | null = null;

  for (const payload of payloads) {
    const candidates = extractAvalancheDetailCandidates(payload);
    for (const candidate of candidates) {
      const scored = scoreAvalancheDetailCandidate(candidate, context, { cleanForecastText });
      if (!scored) {
        continue;
      }
      if (!best || scored.score > best.score) {
        best = scored;
      }
    }
  }

  if (!best || !best.hasUsefulDetail) {
    return null;
  }

  return best;
};

export const inferAvalancheExpiresTime = (detail: any): string | null => {
  if (!detail || typeof detail !== 'object') {
    return null;
  }

  const fromTopLevel = firstNonEmptyString(
    detail.end_date,
    detail.expires,
    detail.expire_time,
    detail.expiration_time,
    detail.valid_until,
    detail.valid_to,
  );
  if (fromTopLevel) {
    return fromTopLevel;
  }

  if (Array.isArray(detail.danger) && detail.danger.length > 0) {
    const currentDay = detail.danger.find((entry: any) => entry?.valid_day === 'current') || detail.danger[0];
    const fromDanger = firstNonEmptyString(
      currentDay?.end_time,
      currentDay?.expires,
      currentDay?.valid_until,
      currentDay?.valid_to,
      currentDay?.valid_end,
    );
    if (fromDanger) {
      return fromDanger;
    }
  }

  return null;
};

export const buildUtahForecastJsonUrl = (forecastLink: string | null | undefined): string | null => {
  if (typeof forecastLink !== 'string' || !forecastLink.trim()) {
    return null;
  }

  try {
    const parsed = new URL(forecastLink);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'utahavalanchecenter.org') {
      return null;
    }

    const match = parsed.pathname.match(/^\/forecast\/([^/?#]+)/i);
    if (!match || !match[1]) {
      return null;
    }

    const region = match[1].trim().replace(/^\/+|\/+$/g, '');
    if (!region) {
      return null;
    }

    return `https://utahavalanchecenter.org/forecast/${encodeURIComponent(region)}/json`;
  } catch {
    return null;
  }
};

export interface UtahAvalancheAdvisory {
  bottomLine: string | null;
  problems: any[];
  publishedTime: string | null;
  rawAdvisory: any;
}

export const extractUtahAvalancheAdvisory = (payload: any): UtahAvalancheAdvisory | null => {
  const advisory = (payload?.advisories || [])[0]?.advisory;
  if (!advisory || typeof advisory !== 'object') {
    return null;
  }

  const bottomLine = firstNonEmptyString(advisory.bottom_line, advisory.current_conditions, advisory.mountain_weather);

  const problems = ([1, 2, 3] as const)
    .map((idx) => {
      const name = firstNonEmptyString(advisory[`avalanche_problem_${idx}`]);
      if (!name) {
        return null;
      }
      const discussion = firstNonEmptyString(advisory[`avalanche_problem_${idx}_description`]);
      return {
        id: idx,
        name,
        discussion: discussion || undefined,
      };
    })
    .filter((entry): entry is { id: number; name: string; discussion?: string } => Boolean(entry));

  let publishedTime: string | null = null;
  const issuedTimestamp = Number(advisory.date_issued_timestamp);
  if (Number.isFinite(issuedTimestamp) && issuedTimestamp > 0) {
    publishedTime = new Date(issuedTimestamp * 1000).toISOString();
  }

  return {
    bottomLine,
    problems,
    publishedTime,
    rawAdvisory: advisory,
  };
};
