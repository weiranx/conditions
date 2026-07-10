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

export function buildAiAgentPrompt(rawReportPayload: string, reportUrl?: string): string {
  const reportLink = reportUrl?.trim();
  return [
    'I have questions about the following Backcountry Conditions planner report.',
    '',
    'Help me understand what the report says and how its weather, avalanche, snowpack, alerts, terrain, and timing signals relate to my plan. Base your answers on the supplied report data. Clearly separate reported facts from your interpretation, call out stale, unavailable, unknown, or conflicting data, and do not invent missing conditions. This is planning support, not a substitute for current official forecasts, field observations, or my own go/no-go decision.',
    ...(reportLink ? ['', 'Planner report URL:', reportLink] : []),
    '',
    'Planner report data (JSON):',
    rawReportPayload,
    '',
    'My question:',
    '[Type your question here]',
  ].join('\n');
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through for browsers or embedded views that deny the modern API.
    }
  }

  if (typeof document === 'undefined') {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
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

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
