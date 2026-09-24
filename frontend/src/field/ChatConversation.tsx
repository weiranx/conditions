import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowDown, ArrowUp, RotateCcw, Sparkles, Square } from "lucide-react";
import { buildApiUrl } from "../lib/api-client";
import { useAiAccess } from "../hooks/useAiAccess";
import type { PersistedReportChatMessage } from "../app/report-storage";
import { Markdown } from "./Markdown";
import { preloadMarkdown } from "./markdown-loader";

type Message = UIMessage<never, { followUpSuggestions: { suggestions: string[] } }>;
export function ChatConversation({
  id,
  viewportRef,
  reportPayload,
  contextType,
  initialMessages,
  onMessagesChange,
  readOnly,
}: {
  id: string;
  viewportRef: RefObject<HTMLDivElement | null>;
  reportPayload: string;
  contextType: "report" | "trip" | "itinerary";
  initialMessages: PersistedReportChatMessage[];
  onMessagesChange?: (messages: PersistedReportChatMessage[]) => void;
  readOnly: boolean;
}) {
  const { requestAiAccess } = useAiAccess();
  const [input, setInput] = useState("");
  // Follow a streaming answer only while the reader is already at the bottom.
  const following = useRef(true);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const lastSaved = useRef(JSON.stringify(initialMessages));
  const transport = useMemo(() => new DefaultChatTransport({
    api: buildApiUrl("/api/report-chat"), credentials: "include",
  }), []);
  const { messages, sendMessage, regenerate, status, error, stop } = useChat<Message>({
    transport, messages: initialMessages as Message[],
  });
  const busy = status === "submitted" || status === "streaming";

  useEffect(preloadMarkdown, []);

  useEffect(() => {
    if (readOnly || !onMessagesChange) return;
    const value = JSON.stringify(messages);
    if (value !== lastSaved.current) {
      lastSaved.current = value;
      onMessagesChange(messages as PersistedReportChatMessage[]);
    }
  }, [messages, onMessagesChange, readOnly]);

  useEffect(() => {
    const node = viewportRef.current;
    if (node && following.current) node.scrollTop = node.scrollHeight;
  }, [messages, busy, viewportRef]);

  function trackScroll() {
    const node = viewportRef.current;
    if (!node) return;
    following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
    setAwayFromLatest(!following.current);
  }

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
  ] : contextType === "itinerary" ? [
    "What makes the weakest day or night hard?",
    "Is my sleep system warm enough for these nights?",
    "What would make this trip safer to run?",
  ] : [
    "What is driving the risk score?",
    "How does the timing affect my plan?",
    "What should I verify before leaving?",
  ];
  function ask(question: string) {
    const text = question.trim();
    if (!text || busy || readOnly || !requestAiAccess()) return;
    setInput("");
    following.current = true;
    void sendMessage({ text }, { body: { report: reportPayload, contextType } });
  }
  return (
    <>
      <div ref={viewportRef} className="field-chat-messages" tabIndex={0} role="region" aria-label="Conversation messages" onScroll={trackScroll}>
        <div className="field-chat-reading">
          {!messages.length && <div className="field-chat-welcome">
            <span className="field-chat-avatar is-large" aria-hidden="true"><Sparkles size={18} /></span>
            <h3>{readOnly ? "No messages saved" : "Make sense of the conditions."}</h3>
            <p>{readOnly ? "This report does not have a saved conversation." : "Explore the forecast, weigh the tradeoffs, or work through your timing. Answers use the conditions in this " + (contextType === "trip" ? "comparison." : contextType === "itinerary" ? "trip." : "report.")}</p>
          </div>}
          <div role="log" aria-label="AI conversation" aria-live={busy ? "off" : "polite"}>
            {messages.map(message => <article key={message.id} className={`field-chat-message is-${message.role}`}>
              {message.role === "user" ? <span className="field-sr-only">You</span> : <span className="field-chat-author"><span className="field-chat-avatar" aria-hidden="true"><Sparkles size={12} /></span>Conditions assistant</span>}
              {message.parts.map((part, i) => part.type === "text" ? <div className="field-markdown" key={i}><Markdown>{part.text}</Markdown></div> : null)}
            </article>)}
          </div>
          {busy && <p className="field-chat-status" role="status"><span className="field-chat-dots" aria-hidden="true"><i /><i /><i /></span>{status === "submitted" ? "Reading the conditions…" : "Writing a response…"}</p>}
          {!readOnly && !busy && (messages.length ? suggestions : starters).length > 0 && <div className="field-chat-prompts">
            <p className="field-chat-prompts-label" id={`${id}-prompts`}>{messages.length ? "Follow up" : "Try asking"}</p>
            <div className="field-chat-suggestions" role="group" aria-labelledby={`${id}-prompts`}>
              {(messages.length ? suggestions : starters).map(question => <button key={question} onClick={() => ask(question)}>{question}</button>)}
            </div>
          </div>}
        </div>
      </div>
      <footer className="field-chat-footer">
        <div className="field-chat-reading">
          {messages.length > 0 && awayFromLatest && <button className="field-chat-latest" onClick={() => {
            if (viewportRef.current) viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
            following.current = true;
            setAwayFromLatest(false);
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
              {busy ? <button className="field-button" type="button" aria-label="Stop response" onClick={() => void stop()}><Square size={14} fill="currentColor" aria-hidden="true" /></button> :
                <button className="field-button field-button-primary" type="submit" aria-label="Send question" disabled={!input.trim()}><ArrowUp size={18} aria-hidden="true" /></button>}
            </form>
            <div className="field-chat-composer-meta"><span id={`${id}-hint`}>Enter to send · Shift + Enter for a new line</span>{input.length > 800 && <span>{input.length}/1,000</span>}</div>
          </>}
          <p className="field-chat-disclaimer">{readOnly ? "Saved with this report · Read only" : "AI planning support that can be wrong. Confirm official forecasts and current field conditions."}</p>
        </div>
      </footer>
    </>
  );
}
