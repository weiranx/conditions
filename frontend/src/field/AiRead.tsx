import { useEffect, useId, useState, type FormEvent } from "react";
import { ArrowUp, Check, ChevronRight, Info, RefreshCw, Satellite, Sparkles } from "lucide-react";
import { AiBriefSection, AiExplanationSkeleton, SnowImageryDate } from "./AiExplanation";
import { parseExplanation, suggestedQuestions, type ExplanationSection } from "./ai-explanation";
import { imageryDateLabel } from "./data";
import {
  evidenceLinks,
  sectionCitations,
  sectionCitesChapter,
  type EvidenceChapter,
} from "../app/ai-evidence";
import { chapterLabel } from "./sky/report-chapters";
import type { AiBriefCitation, AiBriefDetails, AiReadRun } from "../app/types";
import "./ai-explanation.css";
import "./ai-read.css";

/** The fields one section of the read cites, each a link to the chapter that shows it. */
function Citations({ details, section, evidence, onOpen }: {
  details: AiBriefDetails | null;
  section?: ExplanationSection;
  /** Citations to show in place of a section's. */
  evidence?: AiBriefCitation[];
  onOpen: (chapter: EvidenceChapter) => void;
}) {
  const links = evidenceLinks(evidence ?? (section ? sectionCitations(details, section.title) : []));
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

/** Why AI text was replaced or left out: what the fact checks rejected, in their words. */
function CheckDetails({ details }: { details: AiBriefDetails | null }) {
  const problems = details?.checks?.problems ?? [];
  const seconds = details?.checks?.seconds ?? [];
  if (!problems.length && !seconds.length) return null;
  const took = seconds.length ? ` · took ${seconds.map((second) => `${Math.round(second)} s`).join(" + ")}` : "";
  return (
    <details className="ai-read-checks">
      <summary>
        Fact-check details · {problems.length ? `${problems.length} ${problems.length === 1 ? "issue" : "issues"}` : "all passed"}
        {details?.checks && details.checks.attempts > 1 ? ` across ${details.checks.attempts} AI answers` : ""}
        {took}
      </summary>
      {problems.length > 0 && (
        <ul>
          {problems.map((problem, index) => <li key={`${index}-${problem}`}>{problem}</li>)}
        </ul>
      )}
    </details>
  );
}

/**
 * The satellite image the read looked at, when snow shapes the trip: when it was
 * taken, and what the AI saw in it for this plan, with its citations.
 */
function SatelliteSnow({ details, onOpen }: { details: AiBriefDetails; onOpen: (chapter: EvidenceChapter) => void }) {
  const satellite = details.satellite;
  if (!satellite) return null;
  const date = imageryDateLabel(satellite.imagery?.acquiredAt);
  return (
    <aside className="ai-read-snow" aria-label="Satellite snow imagery">
      <img
        className="ai-read-snow-image"
        src={satellite.image}
        alt={`Sentinel-2 satellite image of snow around the objective${date ? `, taken ${date}` : ""}`}
      />
      <div className="ai-read-snow-body">
        <p className="ai-read-snow-title"><Satellite size={15} aria-hidden="true" />Satellite snow cover</p>
        <SnowImageryDate imagery={satellite.imagery} />
        {satellite.text ? (
          <p>{satellite.text}</p>
        ) : (
          <p className="ai-read-snow-note">The AI’s note on this image didn’t pass the report’s fact checks, so only the image is shown.</p>
        )}
        <Citations details={details} evidence={satellite.evidence} onOpen={onOpen} />
        <p className="ai-read-snow-note">About 5 × 5 km around the objective. It can’t show cornices, ice or surface firmness.</p>
      </div>
    </aside>
  );
}

/** The current time, ticking each second while `active`. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * What the AI is doing while it writes: the opening first, from a fast model,
 * then the full read, with the time so far, so a long wait is never a blank one.
 */
function ReadProgress({ run, satellite = false }: { run: AiReadRun | null; satellite?: boolean }) {
  const now = useNow(Boolean(run));
  const elapsed = run ? Math.max(0, Math.round((now - run.startedAt) / 1000)) : null;
  const steps: { state: "done" | "active" | "kept" | "next"; text: string }[] = [];
  // The full read starts once the opening has answered, so until then it waits its turn.
  const waiting = run?.opening === "pending";
  if (run && run.opening !== "off") {
    steps.push(run.opening === "pending"
      ? { state: "active", text: "Rewriting the opening at the top of the report" }
      : run.opening === "written"
        ? { state: "done", text: `Rewrote the opening${run.openingSeconds != null ? ` in ${run.openingSeconds} s` : ""}` }
        : { state: "kept", text: "The quick opening didn’t pass its checks; the full read writes it" });
  }
  const next = waiting ? "next" : "active";
  if (satellite) steps.push({ state: next, text: "Looking at a recent satellite image of the snow around your objective" });
  steps.push({ state: next, text: waiting
    ? "Then the full read: why, what to watch, the best move, and a note for each section"
    : "Writing the full read: why, what to watch, the best move, and a note for each section" });
  return (
    <div className="ai-read-progress">
      <p className="ai-read-status">
        <Sparkles size={14} aria-hidden="true" className="ai-read-pulse" />
        <span>AI is reading the report</span>
        {elapsed !== null && <span className="ai-read-elapsed" aria-hidden="true">{elapsed} s</span>}
      </p>
      <ol className="ai-read-steps" aria-live="polite">
        {steps.map((step) => (
          <li key={step.text} className={`is-${step.state}`}>
            <span className="ai-read-step-mark" aria-hidden="true">{step.state === "done" ? <Check size={12} /> : null}</span>
            {step.text}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Where the AI's text went across the report, so the reader can tell what changed:
 * the opening it rewrote and the sections it added notes to, each one tap away.
 */
function ReadChanges({ details, run, openingRewritten, onOpen }: {
  details: AiBriefDetails | null;
  run: AiReadRun | null;
  openingRewritten: boolean;
  onOpen: (chapter: EvidenceChapter) => void;
}) {
  if (!details || details.validation !== "evidence_checked") return null;
  const chapters = (["forecast", "timing", "terrain", "sources"] as const).filter((chapter) => details.chapters?.[chapter]?.text);
  if (!openingRewritten && !chapters.length) return null;
  const took = run?.seconds != null ? `Written in ${run.seconds} s. ` : "";
  const lead = openingRewritten
    ? chapters.length ? "Rewrote the report’s opening and added notes to" : "Rewrote the report’s opening."
    : "Added notes to";
  return (
    <p className="ai-read-changes">
      <span className="ai-read-changes-lead"><Check size={14} aria-hidden="true" />{took}{lead}</span>
      {chapters.map((chapter) => (
        <button key={chapter} type="button" onClick={() => onOpen(chapter)} title={`Open ${chapterLabel(chapter)}`}>
          {chapterLabel(chapter)}
        </button>
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
  run = null,
  acrossReport = false,
  openingRewritten = false,
  error,
  briefAvailable,
  chatAvailable,
  readOnly,
  fallbackQuestions,
  readsSatellite = false,
  chatBelow = false,
  onRequest,
  onAsk,
  onOpen,
}: {
  narrative: string | null;
  details: AiBriefDetails | null;
  loading: boolean;
  /** The read being written, or the one just written, with its timings. */
  run?: AiReadRun | null;
  /** The read's opening and chapter notes are shown across the report, not only here. */
  acrossReport?: boolean;
  /** The report's opening on screen is the AI's. */
  openingRewritten?: boolean;
  error: string | null;
  /** The AI read can be written on this server. */
  briefAvailable: boolean;
  /** The report assistant can answer questions. */
  chatAvailable: boolean;
  /** A saved snapshot: show what was saved, write nothing new. */
  readOnly: boolean;
  fallbackQuestions: string[];
  /** Snow shapes this trip, so the read also looks at a satellite image of it. */
  readsSatellite?: boolean;
  /** The report's chat sits right below, with the same questions: leading the report, the read leaves asking to it. */
  chatBelow?: boolean;
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
  const questions = suggestedQuestions(details?.questions, fallbackQuestions);
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

  const tucked = acrossReport && Boolean(narrative);
  const ask = canAsk && !(tucked && chatBelow) && (
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
  );
  const footnote = (narrative || canWrite) && (
    <p className="ai-brief-footnote">
      <Info size={13} aria-hidden="true" />
      Written by AI from this report’s data and can be wrong. The go/no-go comes from the report’s checks, not the AI.
    </p>
  );
  // Leading the report, the read is its big picture and best move; the rest, and the ask, wait one tap away.
  const changes = !loading && acrossReport && (
    <ReadChanges details={details} run={run} openingRewritten={openingRewritten} onOpen={onOpen} />
  );
  const supporting = more.length > 0 && (
    <div className={`ai-explanation-supporting${more.length === 3 ? " is-three" : ""}`}>
      {more.map(render)}
    </div>
  );

  return (
    <section className={`ai-read${tucked ? " is-leading" : ""}`} aria-labelledby={`${id}-title`} aria-busy={loading} id="ai-read">
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
      {loading && narrative && <ReadProgress run={run} satellite={readsSatellite} />}
      {narrative ? (
        <div className={`ai-explanation ai-read-body${loading ? " is-stale" : ""}`}>
          {!tucked && changes}
          {fallback && (
            <p className="ai-read-fallback">
              The AI answer didn’t pass the report’s fact checks, so this summary comes straight from the checks.
            </p>
          )}
          {!tucked && <CheckDetails details={details} />}
          {lead.map(render)}
          {action.map(render)}
          {!tucked && details && <SatelliteSnow details={details} onOpen={onOpen} />}
          {!tucked && supporting && (
            <details className="ai-read-more">
              <summary>
                <span>Why, what to watch, and how sure</span>
                <ChevronRight size={16} aria-hidden="true" />
              </summary>
              {supporting}
            </details>
          )}
        </div>
      ) : loading ? (
        <>
          <ReadProgress run={run} satellite={readsSatellite} />
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
      {tucked ? (
        <details className="ai-read-more ai-read-fold">
          <summary>
            <span>{ask ? "Ask about this report" : supporting ? "Why, what to watch, and how sure" : "About this AI read"}</span>
            {ask && <span className="ai-read-fold-hint">{supporting ? "why, what to watch, how sure · " : ""}suggested questions</span>}
            <ChevronRight size={16} aria-hidden="true" />
          </summary>
          <div className="ai-read-fold-body">
            {changes}
            <CheckDetails details={details} />
            {details && <SatelliteSnow details={details} onOpen={onOpen} />}
            {supporting}
            {ask}
            {footnote}
          </div>
        </details>
      ) : (
        <>
          {ask}
          {footnote}
        </>
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
