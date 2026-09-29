import type { ReactNode } from "react";
import { SourceLink } from "./Details";

/** One labelled reading; rows whose value is missing are left out. */
export type EvidenceRow = readonly [label: string, value: ReactNode];

const MISSING = new Set(["", "N/A", "Not available", "Unavailable"]);
const present = (value: ReactNode) =>
  value !== null && value !== undefined && value !== false && !(typeof value === "string" && MISSING.has(value.trim()));

/**
 * The evidence behind a card, written out for a reader: labelled readings,
 * short points, notes and source links. Shows nothing when there is nothing to add.
 */
export function Evidence({
  title,
  rows = [],
  points = [],
  notes = [],
  links = [],
  children,
  open = false,
}: {
  title: string;
  rows?: EvidenceRow[];
  points?: Array<string | null | undefined | false>;
  notes?: Array<string | null | undefined | false>;
  links?: Array<{ url?: string | null; label?: string } | null | undefined | false>;
  children?: ReactNode;
  open?: boolean;
}) {
  const shownRows = rows.filter(([, value]) => present(value));
  const shownPoints = [...new Set(points.filter((point): point is string => Boolean(point && point.trim())))];
  const shownNotes = [...new Set(notes.filter((note): note is string => Boolean(note && note.trim())))];
  const shownLinks = links.filter((link): link is { url: string; label?: string } => Boolean(link && link.url));
  if (!shownRows.length && !shownPoints.length && !shownNotes.length && !shownLinks.length && !children) return null;
  return (
    <details className="field-detail-disclosure sky-evidence-body" open={open}>
      <summary>{title}</summary>
      {shownRows.length > 0 && (
        <dl className="sky-list is-compact">
          {shownRows.map(([label, value]) => (
            <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      )}
      {shownPoints.length > 0 && <ul className="sky-bullets">{shownPoints.map((point) => <li key={point}>{point}</li>)}</ul>}
      {children}
      {shownNotes.map((note) => <p key={note} className="sky-cap">{note}</p>)}
      {shownLinks.length > 0 && (
        <p className="sky-evidence-links">
          {shownLinks.map((link) => <SourceLink key={link.url} url={link.url}>{link.label || "Open source"}</SourceLink>)}
        </p>
      )}
    </details>
  );
}
