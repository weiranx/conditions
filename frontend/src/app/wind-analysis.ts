const SIXTEEN_WAY_DIRECTIONS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'] as const;

export function windDirectionFromDegrees(value: number | null | undefined): string {
  const degrees = Number(value);
  if (!Number.isFinite(degrees)) {
    return 'N/A';
  }
  const normalized = ((degrees % 360) + 360) % 360;
  const index = Math.round(normalized / 22.5) % 16;
  return SIXTEEN_WAY_DIRECTIONS[index];
}
