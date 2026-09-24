export type CheckStatus = "ok" | "over" | "missing";

/**
 * Plain-language wording for a limit breach produced by the travel-window rules,
 * e.g. "gust 31>25 mph" → "Gusts 31 mph, over your 25 mph limit". Unknown text is returned as is.
 */
export function plainRule(rule: string): string {
  const text = rule.trim();
  let m = /^gust (\d+(?:\.\d+)?)>(\d+(?:\.\d+)?) ?(\S*)$/i.exec(text);
  if (m) {
    const unit = m[3] ? ` ${m[3]}` : "";
    return `Gusts ${m[1]}${unit}, over your ${m[2]}${unit} limit`;
  }
  m = /^precip (\d+)%>(\d+)%$/i.exec(text);
  if (m) return `Rain chance ${m[1]}%, over your ${m[2]}% limit`;
  m = /^feels (.+?)<(.+)$/i.exec(text);
  if (m) return `Feels like ${m[1]}, below your ${m[2]} floor`;
  m = /^feels (.+?)>(.+)$/i.exec(text);
  if (m) return `Feels like ${m[1]}, above your ${m[2]} ceiling`;
  m = /^condition: (.+)$/i.exec(text);
  if (m) return `${m[1]} forecast`;
  m = /^snow depth (\d+)\s*in$/i.exec(text);
  if (m) return `${m[1]} in of snow on the ground`;
  return text;
}

/** Replace every machine-style rule inside a longer reason with its plain wording. */
export function plainReason(reason: string, rules: string[]): string {
  return rules.reduce((out, rule) => out.split(rule).join(plainRule(rule)), reason);
}

/** "45 min", "3 h", "3 h 30 min". */
export function durationLabel(minutes: number): string {
  const total = Math.round(Math.abs(minutes));
  const h = Math.floor(total / 60), m = total % 60;
  if (h === 0) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** A finite elevation in feet, or null. Guards against Number(null) turning a missing value into 0 ft. */
export function knownFeet(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
