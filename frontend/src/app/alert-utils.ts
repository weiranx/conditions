export const alertSeverityRank = (severity: string | undefined | null): number => {
  const normalized = String(severity || '').trim().toLowerCase();
  if (!normalized) return 1;
  if (['extreme', 'severe'].includes(normalized)) return 5;
  if (normalized === 'warning') return 4;
  if (['advisory', 'watch'].includes(normalized)) return 3;
  if (normalized === 'moderate') return 2;
  return 1;
};
