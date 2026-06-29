// Runner gear lens.
//
// The backend builds a gear list tuned for a slow, well-insulated backcountry
// traveller (puffy, bivy, ice axe...). A fast-and-light runner carries a vest,
// not a pack: water and calories scaled to moving time matter far more than a
// static-insulation kit, and pace-driven thermoregulation changes what layers
// are useful. This lens reshapes the backend list when running mode is on —
// adding fuel/hydration/thermal items and de-prioritising heavy kit that the
// conditions don't actually demand.

export interface GearItem {
  title: string;
  detail: string;
  category: string;
  tone: string;
}

export interface RunnerGearContext {
  runnerMode: boolean;
  durationMinutes?: number | null;
  tempF?: number | null;
  feelsLikeF?: number | null;
  gainM?: number | null;
  heatLevel?: number | null;
}

// Heavy items that a runner should only carry when conditions truly warrant it.
const HEAVY_PATTERNS = /bivy|emergency shelter|static insulation|puffy/i;

function hours(durationMinutes?: number | null): number | null {
  const m = Number(durationMinutes);
  return Number.isFinite(m) && m > 0 ? m / 60 : null;
}

/**
 * Reshape a gear list for running mode. When runnerMode is false the list is
 * returned unchanged. Additions are returned ahead of the (filtered) originals.
 */
export function applyRunnerGearLens(items: GearItem[], ctx: RunnerGearContext): GearItem[] {
  if (!ctx.runnerMode) {
    return items;
  }

  const feelsLikeF = Number(ctx.feelsLikeF);
  const trulyCold = Number.isFinite(feelsLikeF) && feelsLikeF <= 20;
  const heatLevel = Number(ctx.heatLevel);
  const hot = Number.isFinite(heatLevel) && heatLevel >= 1;
  const tripHours = hours(ctx.durationMinutes);
  const gainM = Number(ctx.gainM);
  const hasVert = Number.isFinite(gainM) && gainM >= 400;

  const additions: GearItem[] = [];

  // Hydration scaled to moving time (and heat). ~0.5 L/h baseline, ~0.75 L/h hot.
  if (tripHours !== null) {
    const litersPerHour = hot ? 0.75 : 0.5;
    const liters = Math.max(0.5, Math.round(tripHours * litersPerHour * 2) / 2);
    additions.push({
      title: 'Water carry',
      detail: `Plan ~${liters.toFixed(1)} L for an estimated ${tripHours.toFixed(1)} h moving${hot ? ' (heat-adjusted)' : ''}. Map resupply/filter points if carrying less.`,
      category: 'Fuel',
      tone: hot ? 'watch' : 'go',
    });
  }

  // Calories for anything beyond a short effort.
  if (tripHours !== null && tripHours >= 1.5) {
    const kcal = Math.round((tripHours * 250) / 50) * 50;
    additions.push({
      title: 'Calories',
      detail: `Carry ~${kcal} kcal (≈250/hour) of fast-digesting fuel for a ${tripHours.toFixed(1)} h push. Front-load before the climb.`,
      category: 'Fuel',
      tone: 'go',
    });
  }

  // Pace-driven thermoregulation: runners overheat on climbs and chill fast on
  // descents / summits. Surfaces when there's real vert and it isn't hot out.
  if (hasVert && (!hot || (Number.isFinite(feelsLikeF) && feelsLikeF <= 55))) {
    additions.push({
      title: 'Climb-hot / descend-cold layering',
      detail: 'You will overheat going up and chill fast on the descent and at the top. Run the climb light, stash a wind shell + light gloves you can throw on in seconds before pointing downhill.',
      category: 'Conditions',
      tone: 'watch',
    });
  }

  // Fast-and-light framing.
  additions.push({
    title: 'Fast-and-light kit',
    detail: 'Running vest over a pack: stuffable wind shell, phone/GPS, ID, and a minimal repair/first-aid card. Trim weight everywhere the conditions allow.',
    category: 'General',
    tone: 'go',
  });

  // Drop heavy items unless it is genuinely cold enough to need them.
  const filtered = items.filter((item) => {
    if (!HEAVY_PATTERNS.test(`${item.title} ${item.detail}`)) {
      return true;
    }
    return trulyCold; // keep puffy/bivy only when feels-like <= 20F
  });

  // De-duplicate by title in case the backend already surfaced hydration/sun.
  const seen = new Set(additions.map((a) => a.title.toLowerCase()));
  const merged = [...additions, ...filtered.filter((item) => !seen.has(item.title.toLowerCase()))];
  return merged;
}
