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

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
