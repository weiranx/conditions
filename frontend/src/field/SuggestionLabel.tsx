import { formatElevationForUnit } from "../app/core";
import type { ElevationUnit } from "../app/types";
import type { Suggestion } from "../lib/search";

/** A search result's detail line: "Recent · Peak · 14,411 ft · Pierce County, Washington". */
function suggestionDetails(item: Suggestion, elevationUnit: ElevationUnit): { title: string; details: string } {
  const coordinate = item.type === "coordinate";
  const [title, ...region] = coordinate ? [item.name] : item.name.split(",").map((part) => part.trim());
  const details = [
    item.class === "recent" ? "Recent" : null,
    coordinate ? "Coordinates" : item.kind,
    typeof item.elevationFt === "number" ? formatElevationForUnit(item.elevationFt, elevationUnit) : null,
    region.join(", "),
  ].filter(Boolean);
  return { title: title ?? item.name, details: details.join(" · ") };
}

/** The name of a place search result, with what it is, its elevation and where it is underneath. */
export function SuggestionLabel({ item, elevationUnit }: { item: Suggestion; elevationUnit: ElevationUnit }) {
  const { title, details } = suggestionDetails(item, elevationUnit);
  return (
    <span className="field-suggestion-label">
      <strong>{title}</strong>
      {details && <small>{details}</small>}
    </span>
  );
}
