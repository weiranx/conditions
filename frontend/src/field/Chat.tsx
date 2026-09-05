import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowDown, Send, Sparkles, Square } from "lucide-react";
import { Streamdown } from "streamdown";
import { buildApiUrl } from "../lib/api-client";
import { useAiAccess } from "../hooks/useAiAccess";
import type { PersistedReportChatMessage } from "../app/report-storage";

type Message = UIMessage<
  never,
  { followUpSuggestions: { suggestions: string[] } }
>;
export function Chat({
  reportPayload,
  contextType = "report",
  initialMessages = [],
  onMessagesChange,
  readOnly = false,
}: {
  reportPayload: string;
  contextType?: "report" | "trip";
  initialMessages?: PersistedReportChatMessage[];
  onMessagesChange?: (messages: PersistedReportChatMessage[]) => void;
  readOnly?: boolean;
}) {
  const { requestAiAccess } = useAiAccess();
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(initialMessages.length > 0);
  const latest = useRef<HTMLDivElement>(null);
  const lastSaved = useRef(JSON.stringify(initialMessages));
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: buildApiUrl("/api/report-chat"),
        credentials: "include",
      }),
    [],
  );
  const { messages, sendMessage, status, error, stop } = useChat<Message>({
    transport,
    messages: initialMessages as Message[],
  });
  const busy = status === "submitted" || status === "streaming";
  useEffect(() => {
    if (readOnly || !onMessagesChange) return;
    const value = JSON.stringify(messages);
    if (value !== lastSaved.current) {
      lastSaved.current = value;
      onMessagesChange(messages as PersistedReportChatMessage[]);
    }
  }, [messages, onMessagesChange, readOnly]);
  const final = messages[messages.length - 1];
  const suggestions =
    final?.parts
      .flatMap((part) =>
        part.type === "data-followUpSuggestions" ? part.data.suggestions : [],
      )
      .filter((value) => typeof value === "string")
      .slice(0, 3) || [];
  const starters =
    contextType === "trip"
      ? [
          "Which day has the best weather window?",
          "What are the tradeoffs between these days?",
          "What should I verify before committing?",
        ]
      : [
          "What is driving the risk score?",
          "How does the timing affect my plan?",
          "What should I verify before leaving?",
        ];
  function ask(question: string) {
    const text = question.trim();
    if (!text || busy || readOnly || !requestAiAccess()) return;
    setInput("");
    void sendMessage(
      { text },
      { body: { report: reportPayload, contextType } },
    );
  }
  return (
    <section className="field-chat field-panel">
      <button
        className="field-chat-toggle"
        aria-expanded={open}
        onClick={() => {
          if (!open && !readOnly && !requestAiAccess()) return;
          setOpen(!open);
        }}
      >
        <Sparkles size={20} />
        <span>
          <strong>
            {readOnly
              ? "Saved conversation"
              : contextType === "trip"
                ? "Ask about these days"
                : "Ask about this report"}
          </strong>
          <small>Weather, timing, terrain, and preparation</small>
        </span>
        <span>{open ? "Close" : "Open"}</span>
      </button>
      {open && (
        <>
          <div
            className="field-chat-messages"
            role="log"
            aria-label="AI conversation"
          >
            {messages.map((message) => (
              <article
                key={message.id}
                className={`field-chat-message is-${message.role}`}
              >
                <span className="field-kicker">
                  {message.role === "user" ? "You" : "Conditions assistant"}
                </span>
                {message.parts.map((part, i) =>
                  part.type === "text" ? (
                    <div className="field-markdown" key={i}>
                      <Streamdown>{part.text}</Streamdown>
                    </div>
                  ) : null,
                )}
              </article>
            ))}
            {status === "submitted" && <p role="status">Reading the report…</p>}
            <div ref={latest} />
          </div>
          {messages.length > 0 && (
            <button
              className="field-text-button"
              onClick={() =>
                latest.current?.scrollIntoView({ block: "nearest" })
              }
            >
              <ArrowDown size={14} />
              Latest message
            </button>
          )}
          {!readOnly && !busy && (
            <div
              className="field-chat-suggestions"
              aria-label="Suggested questions"
            >
              {(messages.length ? suggestions : starters).map((question) => (
                <button key={question} onClick={() => ask(question)}>
                  {question}
                  <ArrowDown size={12} />
                </button>
              ))}
            </div>
          )}
          {error && (
            <p className="field-warning" role="alert">
              The assistant could not answer. Your question is still in the
              conversation; try sending it again.
            </p>
          )}
          {!readOnly && (
            <form
              className="field-chat-form"
              onSubmit={(e) => {
                e.preventDefault();
                ask(input);
              }}
            >
              <textarea
                aria-label={`Question about this ${contextType === "trip" ? "multi-day plan" : "report"}`}
                placeholder="Ask a question…"
                rows={2}
                maxLength={1000}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    ask(input);
                  }
                }}
              />
              {busy ? (
                <button
                  className="field-button"
                  type="button"
                  aria-label="Stop response"
                  onClick={() => void stop()}
                >
                  <Square size={16} />
                </button>
              ) : (
                <button
                  className="field-button field-button-primary"
                  type="submit"
                  aria-label="Send question"
                  disabled={!input.trim()}
                >
                  <Send size={16} />
                </button>
              )}
            </form>
          )}
          <p className="field-muted">
            Planning support. Confirm official forecasts and current field
            conditions.
          </p>
        </>
      )}
    </section>
  );
}
