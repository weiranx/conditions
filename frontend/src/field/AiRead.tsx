import { useId, useState, type FormEvent } from "react";
import { ArrowUp, ChevronRight, Info, RefreshCw, Sparkles } from "lucide-react";
import { AiBriefSection, AiExplanationSkeleton } from "./AiExplanation";
import { parseExplanation, type ExplanationSection } from "./ai-explanation";
import {
  evidenceLinks,
  sectionCitations,
  sectionCitesChapter,
  type EvidenceChapter,
} from "../app/ai-evidence";
import { chapterLabel } from "./sky/report-chapters";
import type { AiBriefDetails } from "../app/types";
import "./ai-explanation.css";
import "./ai-read.css";

/** The fields one section of the read cites, each a link to the chapter that shows it. */
function Citations({ details, section, onOpen }: {
  details: AiBriefDetails | null;
  section: ExplanationSection;
  onOpen: (chapter: EvidenceChapter) => void;
}) {
  const links = evidenceLinks(sectionCitations(details, section.title));
  if (!links.length) return null;
  return (
    <p className="ai-read-cites">
      <span className="ai-read-cites-label">Based on</span>
      {links.map((link) => link.chapter ? (
        <button key={link.label} type="button" onClick={() => onOpen(link.chapter!)}
          title={`Open ${chapterLabel(link.chapter)}`}>
          {link.label}
        </button>
      ) : (
        <span key={link.label}>{link.label}</span>
      ))}
    </p>
  );
}

/**
 * The report's AI read: what the decision means for this plan, the move to make,
 * the evidence behind each part, and a place to ask a follow-up. It explains
 * the backend's decision and never changes it.
 */
export function AiRead({
  narrative,
  details,
  loading,
  error,
  briefAvailable,
  chatAvailable,
  readOnly,
  fallbackQuestions,
  onRequest,
  onAsk,
  onOpen,
}: {
  narrative: string | null;
  details: AiBriefDetails | null;
  loading: boolean;
  error: string | null;
  /** The AI read can be written on this server. */
  briefAvailable: boolean;
  /** The report assistant can answer questions. */
  chatAvailable: boolean;
  /** A saved snapshot: show what was saved, write nothing new. */
  readOnly: boolean;
  fallbackQuestions: string[];
  onRequest: () => void;
  onAsk: (question: string) => void;
  onOpen: (chapter: EvidenceChapter) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const canWrite = briefAvailable && !readOnly;
  const canAsk = chatAvailable && !readOnly;
  if (!narrative && !canWrite && !canAsk) return null;

  const sections = narrative ? parseExplanation(narrative) : [];
  const lead = sections.filter((s) => s.kind === "overview" || s.kind === "note");
  const action = sections.filter((s) => s.kind === "action");
  const more = sections.filter((s) => !["overview", "note", "action"].includes(s.kind));
  const fallback = details?.validation === "deterministic_fallback";
  const questions = (details?.questions.length ? details.questions : fallbackQuestions).slice(0, 3);
  const render = (section: ExplanationSection, index: number) => (
    <AiBriefSection
      key={`${section.kind}-${index}`}
      section={section}
      footer={<Citations details={details} section={section} onOpen={onOpen} />}
    />
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    const question = draft.trim();
    if (!question) return;
    setDraft("");
    onAsk(question);
  }

  return (
    <section className="ai-read" aria-labelledby={`${id}-title`} aria-busy={loading} id="ai-read">
      <div className="ai-brief-heading">
        <div>
          <span className="field-kicker ai-brief-kicker">
            <Sparkles size={14} aria-hidden="true" />
            AI read
          </span>
          <h2 id={`${id}-title`}>{narrative || canWrite ? "What this means for your plan" : "Ask about this plan"}</h2>
        </div>
        {narrative && canWrite && (
          <button
            type="button"
            className="field-button ai-brief-regenerate"
            aria-disabled={loading || undefined}
            onClick={() => { if (!loading) onRequest(); }}
          >
            <RefreshCw size={14} aria-hidden="true" className={loading ? "is-spinning" : undefined} />
            {loading ? "Rewriting…" : "Rewrite"}
          </button>
        )}
      </div>
      {error && <p className="field-warning" role="alert">{error}</p>}
      {narrative ? (
        <div className={`ai-explanation ai-read-body${loading ? " is-stale" : ""}`}>
          {fallback && (
            <p className="ai-read-fallback">
              The AI answer didn’t pass the report’s fact checks, so this summary comes straight from the checks.
            </p>
          )}
          {lead.map(render)}
          {action.map(render)}
          {more.length > 0 && (
            <details className="ai-read-more">
              <summary>
                <span>Why, what to watch, and how sure</span>
                <ChevronRight size={16} aria-hidden="true" />
              </summary>
              <div className={`ai-explanation-supporting${more.length === 3 ? " is-three" : ""}`}>
                {more.map(render)}
              </div>
            </details>
          )}
        </div>
      ) : loading ? (
        <>
          <p className="ai-read-status" role="status">Reading the report…</p>
          <AiExplanationSkeleton />
        </>
      ) : canWrite ? (
        <div className="ai-brief-empty">
          <p>A plain-language read of this report: what drives the decision, what to watch, and the best move for your plan.</p>
          <button type="button" className="field-button field-button-primary" onClick={onRequest}>
            <Sparkles size={16} aria-hidden="true" />
            Write the AI read
          </button>
        </div>
      ) : null}
      {canAsk && (
        <div className="ai-read-ask">
          <form className="ai-read-form" onSubmit={submit}>
            <label className="sr-only" htmlFor={`${id}-ask`}>Ask about this plan</label>
            <input
              id={`${id}-ask`}
              type="text"
              maxLength={1000}
              placeholder="Ask anything about this plan…"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" className="field-button field-button-primary" aria-label="Ask" disabled={!draft.trim()}>
              <ArrowUp size={18} aria-hidden="true" />
            </button>
          </form>
          {questions.length > 0 && (
            <div className="ai-read-questions" role="group" aria-label="Suggested questions">
              {questions.map((question) => (
                <button key={question} type="button" onClick={() => onAsk(question)}>{question}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {(narrative || canWrite) && (
        <p className="ai-brief-footnote">
          <Info size={13} aria-hidden="true" />
          Written by AI from this report’s data and can be wrong. It explains the decision and never changes it.
        </p>
      )}
    </section>
  );
}

/**
 * The AI's analysis at the top of a chapter: the fact-checked chapter analysis
 * when the read wrote one, otherwise the parts of the read that cite the chapter.
 */
export function AiChapterNote({ narrative, details, chapter, onReadAll, onOpen }: {
  narrative: string | null;
  details: AiBriefDetails | null;
  chapter: EvidenceChapter;
  onReadAll: () => void;
  /** Opens the chapter a citation points to. */
  onOpen?: (chapter: EvidenceChapter) => void;
}) {
  if (!narrative || !details || details.validation === "deterministic_fallback") return null;
  const analysis = chapter === "forecast" || chapter === "timing" || chapter === "terrain" || chapter === "sources"
    ? details.chapters?.[chapter]
    : undefined;
  const sections = parseExplanation(narrative);
  const relevant = analysis ? [] : chapter === "gear"
    ? sections.filter((s) => s.kind === "action")
    : sections.filter((s) => s.kind !== "comfort" && sectionCitesChapter(sectionCitations(details, s.title), chapter));
  if (!analysis && !relevant.length) return null;
  return (
    <aside className="ai-chapter-note" aria-label={`AI analysis of ${chapterLabel(chapter)}`}>
      <span className="field-kicker ai-brief-kicker">
        <Sparkles size={14} aria-hidden="true" />
        AI analysis · {chapterLabel(chapter).toLowerCase()}
      </span>
      {analysis ? <p>{analysis.text}</p> : relevant.slice(0, 2).map((section, index) => (
        <p key={`${section.kind}-${index}`}><strong>{section.title}.</strong> {section.text}</p>
      ))}
      {analysis && analysis.evidence.length > 0 && (
        <p className="ai-read-cites">
          <span className="ai-read-cites-label">Based on</span>
          {evidenceLinks(analysis.evidence).map((link) => link.chapter && link.chapter !== chapter && onOpen ? (
            <button key={link.label} type="button" onClick={() => onOpen(link.chapter!)} title={`Open ${chapterLabel(link.chapter)}`}>{link.label}</button>
          ) : (
            <span key={link.label}>{link.label}</span>
          ))}
        </p>
      )}
      <button type="button" className="sky-link" onClick={onReadAll}>Full AI read</button>
    </aside>
  );
}
