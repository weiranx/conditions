import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowDown, ArrowUpRight, Maximize2, MessageSquare, Minimize2, RotateCcw, Send, Square } from "lucide-react";
import { Streamdown } from "streamdown";
import { buildApiUrl } from "../lib/api-client";
import { useAiAccess } from "../hooks/useAiAccess";
import type { PersistedReportChatMessage } from "../app/report-storage";
import "./chat.css";

type Message = UIMessage<never, { followUpSuggestions: { suggestions: string[] } }>;
export function Chat({
  reportPayload,
  contextType = "report",
  contextLabel,
  initialMessages = [],
  onMessagesChange,
  readOnly = false,
}: {
  reportPayload: string;
  contextType?: "report" | "trip";
  contextLabel?: string;
  initialMessages?: PersistedReportChatMessage[];
  onMessagesChange?: (messages: PersistedReportChatMessage[]) => void;
  readOnly?: boolean;
}) {
  const { requestAiAccess } = useAiAccess();
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(initialMessages.length > 0);
  const [fullScreen, setFullScreen] = useState(false);
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const exitButton = useRef<HTMLButtonElement>(null);
  const scrollPosition = useRef(0);
  const lastSaved = useRef(JSON.stringify(initialMessages));
  const transport = useMemo(() => new DefaultChatTransport({
    api: buildApiUrl("/api/report-chat"), credentials: "include",
  }), []);
  const { messages, sendMessage, regenerate, status, error, stop } = useChat<Message>({
    transport, messages: initialMessages as Message[],
  });
  const busy = status === "submitted" || status === "streaming";
  const title = readOnly ? "Saved conversation" : contextType === "trip" ? "Ask about these days" : "Ask about this report";
  const context = contextLabel || (contextType === "trip" ? "Your multi-day comparison" : "Your conditions brief");

  // Keep the same conversation DOM when moving into the browser's modal layer.
  // Opening inline never invokes native dialog autofocus or moves the report.
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (!fullScreen) {
      if (open) {
        node.setAttribute("open", "");
        if (viewport.current) viewport.current.scrollTop = scrollPosition.current;
      }
      else node.removeAttribute("open");
      return;
    }
    const previousOverflow = document.body.style.overflow;
    const trigger = expandButton.current;
    node.removeAttribute("open");
    node.showModal();
    document.body.style.overflow = "hidden";
    exitButton.current?.focus({ preventScroll: true });
    if (viewport.current) viewport.current.scrollTop = scrollPosition.current;
    return () => {
      node.close();
      document.body.style.overflow = previousOverflow;
      trigger?.focus({ preventScroll: true });
    };
  }, [open, fullScreen]);

  useEffect(() => {
    if (readOnly || !onMessagesChange) return;
    const value = JSON.stringify(messages);
    if (value !== lastSaved.current) {
      lastSaved.current = value;
      onMessagesChange(messages as PersistedReportChatMessage[]);
    }
  }, [messages, onMessagesChange, readOnly]);

  const final = messages[messages.length - 1];
  const suggestions = final?.role === "assistant" ? [...new Set(final.parts.flatMap(part =>
    part.type === "data-followUpSuggestions" && Array.isArray(part.data?.suggestions)
      ? part.data.suggestions.filter((value): value is string => typeof value === "string" && !!value.trim()).map(value => value.trim())
      : [],
  ))].slice(0, 3) : [];
  const starters = contextType === "trip" ? [
    "Which day has the best weather window?",
    "What are the tradeoffs between these days?",
    "What should I verify before committing?",
  ] : [
    "What is driving the risk score?",
    "How does the timing affect my plan?",
    "What should I verify before leaving?",
  ];
  function ask(question: string) {
    const text = question.trim();
    if (!text || busy || readOnly || !requestAiAccess()) return;
    setInput("");
    void sendMessage({ text }, { body: { report: reportPayload, contextType } });
  }
  function changeScreen(expanded: boolean) {
    if (expanded && !readOnly && !requestAiAccess()) return;
    scrollPosition.current = viewport.current?.scrollTop ?? 0;
    setOpen(true);
    setFullScreen(expanded);
  }
  return (
    <section className="field-chat field-panel">
      <div className="field-chat-heading">
        <button className="field-chat-toggle" aria-expanded={open} aria-controls={id} onClick={() => {
          if (!open && !readOnly && !requestAiAccess()) return;
          setOpen(!open);
        }}>
          <MessageSquare size={20} aria-hidden="true" />
          <span><strong>{title}</strong><small>Weather, timing, terrain, and preparation</small></span>
          <span>{open ? "Hide" : "Open"}</span>
        </button>
        <button ref={expandButton} className="field-chat-screen-button" aria-label="Open chat full screen" title="Open chat full screen" onClick={() => changeScreen(true)}>
          <Maximize2 size={17} aria-hidden="true" /><span>Full screen</span>
        </button>
      </div>
      <dialog ref={dialog} id={id} className={`field-chat-dialog${fullScreen ? " is-fullscreen" : ""}`} aria-labelledby={`${id}-title`} aria-describedby={`${id}-context`} aria-modal={fullScreen ? true : undefined} onCancel={e => {
        e.preventDefault();
        changeScreen(false);
      }}>
        <header className="field-chat-dialog-header">
          <div><h2 id={`${id}-title`}>{title}</h2><p id={`${id}-context`}>{context}</p></div>
          {fullScreen && <button ref={exitButton} className="field-chat-screen-button" aria-label="Exit full screen" title="Exit full screen (Esc)" onClick={() => changeScreen(false)}>
            <Minimize2 size={18} aria-hidden="true" /><span>Back to {contextType === "trip" ? "comparison" : "report"}</span>
          </button>}
        </header>
        <div ref={viewport} className="field-chat-messages" tabIndex={0} role="region" aria-label="Conversation messages">
          <div className="field-chat-reading">
            {!messages.length && <div className="field-chat-welcome">
              <span className="field-kicker">Conditions assistant</span>
              <h3>{readOnly ? "No messages saved" : "Make sense of the conditions."}</h3>
              <p>{readOnly ? "This report does not have a saved conversation." : "Explore the forecast, weigh the tradeoffs, or work through your timing. Answers use the conditions in this " + (contextType === "trip" ? "comparison." : "report.")}</p>
            </div>}
            <div role="log" aria-label="AI conversation" aria-live={busy ? "off" : "polite"}>
              {messages.map(message => <article key={message.id} className={`field-chat-message is-${message.role}`}>
                <span className="field-kicker">{message.role === "user" ? "You" : "Conditions assistant"}</span>
                {message.parts.map((part, i) => part.type === "text" ? <div className="field-markdown" key={i}><Streamdown>{part.text}</Streamdown></div> : null)}
              </article>)}
            </div>
            {busy && <p className="field-chat-status" role="status"><span aria-hidden="true" />{status === "submitted" ? "Reading the conditions…" : "Writing a response…"}</p>}
            {!readOnly && !busy && (messages.length ? suggestions : starters).length > 0 && <div className="field-chat-suggestions" aria-label="Suggested questions">
              {(messages.length ? suggestions : starters).map(question => <button key={question} onClick={() => ask(question)}>{question}<ArrowUpRight size={15} aria-hidden="true" /></button>)}
            </div>}
          </div>
        </div>
        <footer className="field-chat-footer">
          <div className="field-chat-reading">
            {messages.length > 0 && <button className="field-text-button field-chat-latest" onClick={() => {
              if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
            }}><ArrowDown size={14} aria-hidden="true" />Latest message</button>}
            {error && <div className="field-chat-error" role="alert"><p>The response was interrupted. You can retry your last question.</p>
              {!readOnly && <button className="field-text-button" disabled={busy} onClick={() => {
                if (!busy && requestAiAccess()) void regenerate({ body: { report: reportPayload, contextType } });
              }}><RotateCcw size={14} aria-hidden="true" />Retry response</button>}
            </div>}
            {!readOnly && <>
              <form className="field-chat-form" onSubmit={e => { e.preventDefault(); ask(input); }}>
                <textarea aria-label={`Question about this ${contextType === "trip" ? "multi-day plan" : "report"}`} aria-describedby={`${id}-hint`} placeholder="Ask about the conditions…" rows={2} maxLength={1000} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(input); }
                }} />
                {busy ? <button className="field-button" type="button" aria-label="Stop response" onClick={() => void stop()}><Square size={16} aria-hidden="true" /></button> :
                  <button className="field-button field-button-primary" type="submit" aria-label="Send question" disabled={!input.trim()}><Send size={17} aria-hidden="true" /></button>}
              </form>
              <div className="field-chat-composer-meta"><span id={`${id}-hint`}>Enter to send · Shift + Enter for a new line</span>{input.length > 800 && <span>{input.length}/1,000</span>}</div>
            </>}
            <p className="field-chat-disclaimer">{readOnly ? "Saved with this report · Read only" : "Planning support. Confirm official forecasts and current field conditions."}</p>
          </div>
        </footer>
      </dialog>
    </section>
  );
}
