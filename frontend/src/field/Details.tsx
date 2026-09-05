import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { sanitizeExternalUrl } from "../app/url-state";

export function SourceLink({
  url,
  children = "Open source",
}: {
  url?: string | null;
  children?: ReactNode;
}) {
  const safe = sanitizeExternalUrl(url || undefined);
  return safe ? (
    <a
      className="field-source-link"
      href={safe}
      target="_blank"
      rel="noreferrer"
    >
      {children}
      <ArrowUpRight size={13} />
    </a>
  ) : null;
}
const label = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\bIso\b/g, "")
    .replace(/^./, (value) => value.toUpperCase());
export function DetailValues({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "")
    return <span className="field-muted">Unavailable</span>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value === "number")
    return (
      <span>
        {Number.isFinite(value)
          ? value.toLocaleString(undefined, { maximumFractionDigits: 3 })
          : "Unavailable"}
      </span>
    );
  if (typeof value === "string")
    return /^https?:\/\//.test(value) ? (
      <SourceLink url={value} />
    ) : (
      <span>{value}</span>
    );
  if (Array.isArray(value))
    return value.length ? (
      <div className="field-record-list">
        {value.map((item, i) => (
          <div key={i}>
            <DetailValues value={item} />
          </div>
        ))}
      </div>
    ) : (
      <span className="field-muted">None reported</span>
    );
  if (typeof value === "object")
    return (
      <dl className="field-record">
        {Object.entries(value)
          .filter(([key]) => !["raw", "rawResponse", "debug"].includes(key))
          .map(([key, item]) => (
            <div key={key}>
              <dt>{label(key)}</dt>
              <dd>
                {typeof item === "object" && item !== null ? (
                  <details>
                    <summary>Details</summary>
                    <DetailValues value={item} />
                  </details>
                ) : (
                  <DetailValues value={item} />
                )}
              </dd>
            </div>
          ))}
      </dl>
    );
  return null;
}
export function Details({
  title,
  value,
  open = false,
}: {
  title: string;
  value: unknown;
  open?: boolean;
}) {
  return (
    <details className="field-detail-disclosure" open={open}>
      <summary>{title}</summary>
      <DetailValues value={value} />
    </details>
  );
}
