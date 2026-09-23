/** Shared SVG path helpers for the report charts. */

export type Pt = { x: number; y: number };

/** Monotone cubic (Fritsch–Carlson) path through the points, so peaks never overshoot. */
export function smoothPath(points: Pt[]) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;
  const n = points.length;
  const dx: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1].x - points[i].x);
    m.push((points[i + 1].y - points[i].y) / dx[i]);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  const f = (v: number) => v.toFixed(1);
  let d = `M${f(points[0].x)},${f(points[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${f(points[i].x + h)},${f(points[i].y + t[i] * h)} ${f(points[i + 1].x - h)},${f(points[i + 1].y - t[i + 1] * h)} ${f(points[i + 1].x)},${f(points[i + 1].y)}`;
  }
  return d;
}

/** Split into runs of consecutive readings so missing hours leave a gap in the line. */
export function runs(values: (number | null)[]) {
  const out: { i: number; v: number }[][] = [];
  let cur: { i: number; v: number }[] = [];
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) { if (cur.length) out.push(cur); cur = []; return; }
    cur.push({ i, v });
  });
  if (cur.length) out.push(cur);
  return out;
}
