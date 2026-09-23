export type ExplanationKind =
  | "overview"
  | "action"
  | "watch"
  | "confidence"
  | "evidence"
  | "comfort"
  | "note";
export type ExplanationSection = LabeledSection<ExplanationKind>;
const labels: Record<string, { kind: ExplanationKind; title: string }> = {
  "big picture": { kind: "overview", title: "Big picture" },
  "best move": { kind: "action", title: "Best move" },
  "watch closely": { kind: "watch", title: "Watch closely" },
  "data confidence": { kind: "confidence", title: "Data confidence" },
  "why it matters": { kind: "evidence", title: "Why it matters" },
  "comfort check": { kind: "comfort", title: "Comfort check" },
};

export type SnowAnalysisKind =
  | "coverage"
  | "terrain"
  | "ground"
  | "uncertainty"
  | "takeaway"
  | "note";
export type LabeledSection<K extends string> = {
  kind: K;
  title: string;
  text: string;
};
const snowLabels: Record<string, { kind: SnowAnalysisKind; title: string }> = {
  "snow coverage": { kind: "coverage", title: "Snow coverage" },
  "terrain pattern": { kind: "terrain", title: "Terrain pattern" },
  "ground check": { kind: "ground", title: "Ground check" },
  uncertainty: { kind: "uncertainty", title: "Uncertainty" },
  "travel takeaway": { kind: "takeaway", title: "Travel takeaway" },
};

// Find section boundaries before breaking paragraphs: wrapped continuation text
// belongs to the preceding heading and must never be discarded.
function parseLabeled<K extends string>(
  input: string,
  labels: Record<string, { kind: K; title: string }>,
  note: { kind: K; title: string },
  caseSensitive: boolean,
): LabeledSection<K>[] {
  const text = input.replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  const names = Object.keys(labels).map((label) => label.toUpperCase()).join("|");
  const pattern = new RegExp(
    `(?:^|\\s)(?:#{1,6}\\s*)?(?:\\*\\*)?(${names})(?:\\*\\*)?\\s*:(?:\\*\\*)?\\s*`,
    caseSensitive ? "g" : "gi",
  );
  const matches = [...text.matchAll(pattern)];
  if (!matches.length) return [{ ...note, text }];
  const sections: LabeledSection<K>[] = [];
  const intro = text.slice(0, matches[0].index).trim();
  if (intro) sections.push({ ...note, text: intro });
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
  return sections.length ? sections : [{ ...note, text }];
}

export function parseExplanation(input: string): ExplanationSection[] {
  return parseLabeled(
    input,
    labels,
    { kind: "note", title: "Report explanation" },
    false,
  );
}

// The snow prompt requires upper-case labels; matching them exactly keeps prose
// such as "the main uncertainty: ..." from splitting a section.
export function parseSnowAnalysis(
  input: string,
): LabeledSection<SnowAnalysisKind>[] {
  return parseLabeled(
    input,
    snowLabels,
    { kind: "note", title: "Snow analysis" },
    true,
  );
}
