export function toPlainText(input: string | undefined): string {
  if (!input) {
    return '';
  }

  if (typeof window !== 'undefined' && typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(input, 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  }

  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function summarizeText(input: string | undefined, maxLength?: number): string {
  const text = toPlainText(input);
  if (!text) {
    return '';
  }

  if (!Number.isFinite(maxLength) || (maxLength as number) <= 0) {
    return text;
  }

  const max = Math.round(maxLength as number);
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max).trimEnd()}...`;
}

export function normalizeAlertNarrative(input: string | null | undefined, maxLength = 3200): string {
  if (!input) {
    return '';
  }
  const normalized = String(input)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function splitAlertNarrativeParagraphs(input: string | null | undefined, maxLength = 3200): string[] {
  return normalizeAlertNarrative(input, maxLength)
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function stringifyRawPayload(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return '{"error":"Unable to serialize raw payload"}';
  }
}

export function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

export function truncateText(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

// AI-generated field analyses (score card / satellite snow analysis) are prompted to
// avoid markdown and to break into blank-line-separated paragraphs, but models
// occasionally slip in a stray "#" heading or "**bold**" anyway, or (for cached
// responses generated before that prompt existed) return one dense block with no
// paragraph breaks at all. This cleans up both cases for display.
export function formatAiNarrativeParagraphs(input: string | null | undefined): string[] {
  if (!input) {
    return [];
  }
  const stripped = String(input)
    .replace(/\r\n/g, '\n')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)\*(\S[^*]*?\S|\S)\*(?=\s|$)/g, '$1$2')
    .trim();

  const blocks = stripped
    .split(/\n\s*\n+/)
    .map((block) => collapseWhitespace(block))
    .filter(Boolean);

  if (blocks.length > 1) {
    return blocks;
  }

  const solo = blocks[0] || '';
  if (solo.length <= 420) {
    return solo ? [solo] : [];
  }

  // No paragraph breaks in a long block — group sentences into readable chunks.
  const sentences = solo.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || [solo];
  const paragraphs: string[] = [];
  let current = '';
  sentences.forEach((sentence) => {
    const next = current ? `${current} ${sentence.trim()}` : sentence.trim();
    if (current && next.length > 280) {
      paragraphs.push(current);
      current = sentence.trim();
    } else {
      current = next;
    }
  });
  if (current) {
    paragraphs.push(current);
  }
  return paragraphs;
}

export type AiBriefSectionKind = 'overview' | 'watch' | 'comfort' | 'evidence' | 'gear' | 'action' | 'note';

export interface AiBriefSection {
  kind: AiBriefSectionKind;
  label: string;
  text: string;
}

interface AiBriefSectionDefinition {
  prefix: string;
  kind: AiBriefSectionKind;
  label: string;
}

const SUMMARY_SECTION_DEFINITIONS: AiBriefSectionDefinition[] = [
  { prefix: 'big picture', kind: 'overview', label: 'Big picture' },
  { prefix: 'watch closely', kind: 'watch', label: 'Watch closely' },
  { prefix: 'comfort check', kind: 'comfort', label: 'Comfort check' },
  { prefix: 'best move', kind: 'action', label: 'Best move' },
];

const SNOW_SECTION_DEFINITIONS: AiBriefSectionDefinition[] = [
  { prefix: 'snow coverage', kind: 'overview', label: 'Snow coverage' },
  { prefix: 'ground check', kind: 'evidence', label: 'Ground check' },
  { prefix: 'travel takeaway', kind: 'action', label: 'Travel takeaway' },
];

const ROUTE_SECTION_DEFINITIONS: AiBriefSectionDefinition[] = [
  { prefix: 'hazard zones', kind: 'overview', label: 'Hazard zones' },
  { prefix: 'weather window', kind: 'watch', label: 'Weather window' },
  { prefix: 'other concerns', kind: 'evidence', label: 'Other concerns' },
  { prefix: 'gear check', kind: 'gear', label: 'Gear check' },
  { prefix: 'bottom line', kind: 'action', label: 'Bottom line' },
];

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatAiSections(
  input: string | null | undefined,
  definitions: AiBriefSectionDefinition[],
  fallbackDefinitions: AiBriefSectionDefinition[],
): AiBriefSection[] {
  const paragraphs = formatAiNarrativeParagraphs(input);
  if (paragraphs.length === 0) {
    return [];
  }

  const labeledSections: AiBriefSection[] = [];
  const prefixes = definitions.map(({ prefix }) => escapeRegExp(prefix)).join('|');
  const sectionBoundary = new RegExp(`\\s+(?=(?:${prefixes})\\s*:)`, 'i');
  const normalizedLines = paragraphs.flatMap((paragraph) =>
    paragraph
      .split(sectionBoundary)
      .map((line) => line.trim())
      .filter(Boolean),
  );

  normalizedLines.forEach((line) => {
    const definition = definitions.find(({ prefix }) =>
      new RegExp(`^${escapeRegExp(prefix)}\\s*:\\s*`, 'i').test(line),
    );
    if (!definition) {
      return;
    }
    const sectionText = line.replace(new RegExp(`^${escapeRegExp(definition.prefix)}\\s*:\\s*`, 'i'), '').trim();
    if (sectionText) {
      labeledSections.push({ kind: definition.kind, label: definition.label, text: sectionText });
    }
  });

  if (labeledSections.length >= 2) {
    return labeledSections;
  }

  return paragraphs.map((text, index) => {
    const isLastParagraph = index === paragraphs.length - 1 && paragraphs.length > 1;
    const definition = isLastParagraph
      ? fallbackDefinitions[fallbackDefinitions.length - 1]
      : fallbackDefinitions[Math.min(index, fallbackDefinitions.length - 1)];
    return { kind: definition?.kind || 'note', label: definition?.label || 'Field note', text };
  });
}

// The AI prompts emit labeled lines. These formatters also support legacy
// paragraph responses so cached or imperfect model output still becomes cards.
export function formatAiBriefSections(input: string | null | undefined): AiBriefSection[] {
  return formatAiSections(input, SUMMARY_SECTION_DEFINITIONS, [
    SUMMARY_SECTION_DEFINITIONS[0],
    { prefix: '', kind: 'note', label: 'Field note' },
    SUMMARY_SECTION_DEFINITIONS[3],
  ]);
}

export function formatSnowVisionSections(input: string | null | undefined): AiBriefSection[] {
  return formatAiSections(input, SNOW_SECTION_DEFINITIONS, SNOW_SECTION_DEFINITIONS);
}

export function formatRouteAnalysisSections(input: string | null | undefined): AiBriefSection[] {
  return formatAiSections(input, ROUTE_SECTION_DEFINITIONS, ROUTE_SECTION_DEFINITIONS);
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
