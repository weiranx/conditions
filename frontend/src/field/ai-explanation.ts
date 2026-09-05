export type ExplanationKind =
  | "overview"
  | "action"
  | "watch"
  | "confidence"
  | "evidence"
  | "comfort"
  | "note";
export type ExplanationSection = {
  kind: ExplanationKind;
  title: string;
  text: string;
};
const labels: Record<string, { kind: ExplanationKind; title: string }> = {
  "big picture": { kind: "overview", title: "Big picture" },
  "best move": { kind: "action", title: "Best move" },
  "watch closely": { kind: "watch", title: "Watch closely" },
  "data confidence": { kind: "confidence", title: "Data confidence" },
  "why it matters": { kind: "evidence", title: "Why it matters" },
  "comfort check": { kind: "comfort", title: "Comfort check" },
};

// Find section boundaries before breaking paragraphs: wrapped continuation text
// belongs to the preceding heading and must never be discarded.
export function parseExplanation(input: string): ExplanationSection[] {
  const text = input.replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  const pattern =
    /(?:^|\s)(?:#{1,6}\s*)?(?:\*\*)?(BIG PICTURE|BEST MOVE|WATCH CLOSELY|DATA CONFIDENCE|WHY IT MATTERS|COMFORT CHECK)(?:\*\*)?\s*:(?:\*\*)?\s*/gi;
  const matches = [...text.matchAll(pattern)];
  if (!matches.length)
    return [{ kind: "note", title: "Report explanation", text }];
  const sections: ExplanationSection[] = [];
  const intro = text.slice(0, matches[0].index).trim();
  if (intro)
    sections.push({ kind: "note", title: "Report explanation", text: intro });
  matches.forEach((match, index) => {
    const content = text
      .slice(
        match.index! + match[0].length,
        matches[index + 1]?.index ?? text.length,
      )
      .trim();
    if (content)
      sections.push({ ...labels[match[1].toLowerCase()], text: content });
  });
  return sections.length
    ? sections
    : [{ kind: "note", title: "Report explanation", text }];
}
