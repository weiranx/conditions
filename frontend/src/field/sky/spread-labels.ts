/**
 * Nudges label anchors apart so no two sit closer than `gap`, keeping their
 * order, centring each crowded group on its true positions, and staying
 * within [min, max].
 */
export function spreadLabels(desired: number[], gap: number, min: number, max: number): number[] {
  const order = desired.map((_, i) => i).sort((a, b) => desired[a] - desired[b]);
  const groups: { ids: number[]; top: number }[] = [];
  for (const i of order) {
    groups.push({ ids: [i], top: desired[i] });
    while (groups.length > 1) {
      const b = groups[groups.length - 1], a = groups[groups.length - 2];
      if (a.top + a.ids.length * gap <= b.top) break;
      const ids = [...a.ids, ...b.ids];
      const mean = ids.reduce((sum, k) => sum + desired[k], 0) / ids.length;
      groups.splice(-2, 2, { ids, top: mean - ((ids.length - 1) * gap) / 2 });
    }
  }
  const ys = groups.flatMap((g) => g.ids.map((_, k) => g.top + k * gap));
  for (let k = 0; k < ys.length; k += 1) ys[k] = Math.max(ys[k], k === 0 ? min : ys[k - 1] + gap);
  for (let k = ys.length - 1; k >= 0; k -= 1) ys[k] = Math.min(ys[k], k === ys.length - 1 ? max : ys[k + 1] - gap);
  const out: number[] = new Array(desired.length);
  order.forEach((i, k) => { out[i] = ys[k]; });
  return out;
}
