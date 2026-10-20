import { useContext, useEffect, useRef, useState } from "react";
import { FileText, Info, Sparkles } from "lucide-react";
import { AiAccessContext } from "../contexts/ai-access";
import type { SafetyData, TimeStyle } from "../app/types";
import {
  discussionSummaryKey,
  fetchDiscussionSummary,
  storeDiscussionSummary,
  useStoredDiscussionSummary,
  type DiscussionSummaryRequest,
} from "../lib/forecast-discussion";
import { AiExplanationSkeleton } from "./AiExplanation";
import { SourceLink } from "./Details";
import "./forecast-discussion.css";
import { Fold } from "./sky/Fold";

const issued = (value: string | null | undefined, timeStyle: TimeStyle) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short", hour12: timeStyle !== "24h" })
  : null;

const CONFIDENCE_LABELS = { high: "High", moderate: "Moderate", low: "Low" } as const;

export interface ForecastDiscussionProps {
  report: SafetyData;
  objectiveName: string;
  units: DiscussionSummaryRequest["units"];
  /** The report's AI read is configured and enabled on this server. */
  available: boolean;
  timeStyle?: TimeStyle;
  /** Shut until asked for, as reference beside the forecast. */
  folded?: boolean;
}

/** The NWS forecasters' discussion, read by AI against this plan. Regional context: it never changes the verdict. */
export function ForecastDiscussion({ report, objectiveName, units, available, timeStyle = "ampm", folded = false }: ForecastDiscussionProps) {
  const access = useContext(AiAccessContext);
  const discussion = report.supplementalEvidence?.discussion;
  const request: DiscussionSummaryRequest = { report, objectiveName, units };
  const key = discussionSummaryKey(request);
  const summary = useStoredDiscussionSummary(key);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  // A different report or discussion starts without the last one's error.
  useEffect(() => setError(null), [key]);

  if (!discussion?.available || !key || (!available && !summary)) return null;
  const office = discussion.office ? `${discussion.office} ` : "";
  const issuedAt = issued(discussion.issuedTime, timeStyle);

  const summarize = async () => {
    if (loading) return;
    if (access && !access.requestAiAccess()) return;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDiscussionSummary(request, next.signal);
      if (!next.signal.aborted) storeDiscussionSummary(key, result);
    } catch (caught) {
      if (!next.signal.aborted) setError(caught instanceof Error ? caught.message : "Could not summarize the forecast discussion right now.");
    } finally {
      if (controller.current === next) {
        controller.current = null;
        setLoading(false);
      }
    }
  };

  const card = (
    <section className={`sky-card ai-panel forecast-discussion${folded ? " is-secondary" : " sky-section"}`} aria-labelledby="sky-forecast-discussion" aria-busy={loading}>
      <div className="ai-panel-head">
        <span className="sky-card-head">
          <span id="sky-forecast-discussion" className={folded ? "sr-only" : undefined}>Forecaster discussion</span>
          <span className="ai-panel-badge"><Sparkles size={11} aria-hidden="true" />AI</span>
        </span>
        <FileText size={18} aria-hidden="true" className="sky-muted" />
      </div>
      <p className="sky-cap forecast-discussion-meta">
        NWS {office}Area Forecast Discussion{issuedAt ? ` · issued ${issuedAt}` : ""}
        {summary && summary.coversTripDate === true && <span className="sky-chip">Covers your date</span>}
        {summary && summary.coversTripDate === false && <span className="sky-chip is-over">Ends before your date</span>}
        {summary && summary.forecasterConfidence !== "not stated" && (
          <span className="sky-chip">{CONFIDENCE_LABELS[summary.forecasterConfidence]} forecaster confidence</span>
        )}
      </p>
      {error && <p className="sky-notice is-caution" role="alert">{error}</p>}
      {summary ? (
        <>
          <div className="forecast-discussion-body">
            <h3>The regional picture</h3>
            <p>{summary.summary}</p>
            <h3>For {objectiveName || "your objective"}</h3>
            <p>{summary.forObjective}</p>
            {summary.watch.length > 0 && <>
              <h3>Watch for</h3>
              <ul className="sky-bullets">
                {summary.watch.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </>}
          </div>
          <p className="ai-brief-footnote">
            <Info size={13} aria-hidden="true" />
            Written by AI from the forecasters’ discussion for the whole office region. It is context
            for the forecast above, not a forecast at your objective, and it does not change the report’s call.
          </p>
        </>
      ) : (
        <>
          <div className="ai-brief-empty">
            <p>
              The forecasters’ own reasoning behind the forecast: which systems are coming, when, and
              how sure they are. AI can translate it and say how it bears on this plan.
            </p>
            <button
              type="button"
              className="field-button field-button-primary"
              aria-disabled={loading || undefined}
              onClick={() => void summarize()}
            >
              <Sparkles size={16} aria-hidden="true" />
              {loading ? "Reading the discussion…" : "Summarize for this plan"}
            </button>
          </div>
          {loading && <AiExplanationSkeleton />}
        </>
      )}
      {discussion.sourceLink && <SourceLink url={discussion.sourceLink}>Read the full discussion</SourceLink>}
    </section>
  );
  if (!folded) return card;
  return (
    <Fold id="sky-forecast-discussion-fold" title="Forecaster’s discussion"
      hint={`NWS ${office}Area Forecast Discussion${issuedAt ? ` · issued ${issuedAt}` : ""}${summary ? " · summarized for this plan" : ""}`}>
      {card}
    </Fold>
  );
}
