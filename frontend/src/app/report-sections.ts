const REPORT_SECTION_ID_PATTERN = /^planner-section-[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function parseReportSectionHash(hash: string): string | null {
  const rawValue = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!rawValue) return null;

  try {
    const sectionId = decodeURIComponent(rawValue);
    return REPORT_SECTION_ID_PATTERN.test(sectionId) ? sectionId : null;
  } catch {
    return null;
  }
}

export function buildReportSectionHash(sectionId: string | null | undefined): string {
  if (!sectionId || !REPORT_SECTION_ID_PATTERN.test(sectionId)) return '';
  return `#${encodeURIComponent(sectionId)}`;
}
