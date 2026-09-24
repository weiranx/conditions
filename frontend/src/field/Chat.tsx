import { lazy, Suspense, useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Maximize2, MessagesSquare, Minimize2 } from "lucide-react";
import { useAiAccess } from "../hooks/useAiAccess";
import type { PersistedReportChatMessage } from "../app/report-storage";
import "./chat.css";

// The conversation needs the AI SDK, which outweighs the report screen, so it
// loads the first time the chat opens. It then stays mounted so collapsing the
// chat keeps the draft and any response in progress.
const ChatConversation = lazy(() =>
  import("./ChatConversation").then((m) => ({ default: m.ChatConversation })),
);

export function Chat({
  reportPayload,
  contextType = "report",
  contextLabel,
  initialMessages = [],
  onMessagesChange,
  readOnly = false,
}: {
  reportPayload: string;
  contextType?: "report" | "trip" | "itinerary";
  contextLabel?: string;
  initialMessages?: PersistedReportChatMessage[];
  onMessagesChange?: (messages: PersistedReportChatMessage[]) => void;
  readOnly?: boolean;
}) {
  const { requestAiAccess } = useAiAccess();
  const [open, setOpen] = useState(initialMessages.length > 0);
  const [opened, setOpened] = useState(open);
  const [fullScreen, setFullScreen] = useState(false);
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const exitButton = useRef<HTMLButtonElement>(null);
  const scrollPosition = useRef(0);
  const title = readOnly
    ? "Saved conversation"
    : contextType === "trip" ? "Ask about these days" : contextType === "itinerary" ? "Ask about this trip" : "Ask about this report";
  const context = contextLabel || (contextType === "trip" ? "Your multi-day comparison" : contextType === "itinerary" ? "Your multi-day trip" : "Your conditions brief");

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

  function changeScreen(expanded: boolean) {
    if (expanded && !readOnly && !requestAiAccess()) return;
    scrollPosition.current = viewport.current?.scrollTop ?? 0;
    setOpen(true);
    setOpened(true);
    setFullScreen(expanded);
  }
  return (
    <section className="field-chat field-panel">
      <div className="field-chat-heading">
        <button className="field-chat-toggle" aria-expanded={open} aria-controls={id} onClick={() => {
          if (!open && !readOnly && !requestAiAccess()) return;
          setOpen(!open);
          setOpened(true);
        }}>
          <span className="field-chat-mark" aria-hidden="true"><MessagesSquare size={18} /></span>
          <span className="field-chat-toggle-text"><strong>{title}</strong><small>{context}</small></span>
          <ChevronDown className="field-chat-chevron" size={18} aria-hidden="true" />
        </button>
        <button ref={expandButton} className="field-chat-screen-button" aria-label="Open chat full screen" title="Open chat full screen" onClick={() => changeScreen(true)}>
          <Maximize2 size={16} aria-hidden="true" /><span>Full screen</span>
        </button>
      </div>
      <dialog ref={dialog} id={id} className={`field-chat-dialog${fullScreen ? " is-fullscreen" : ""}`} aria-labelledby={`${id}-title`} aria-describedby={`${id}-context`} aria-modal={fullScreen ? true : undefined} onCancel={e => {
        e.preventDefault();
        changeScreen(false);
      }}>
        <header className="field-chat-dialog-header">
          <div><h2 id={`${id}-title`}>{title}</h2><p id={`${id}-context`}>{context}</p></div>
          {fullScreen && <button ref={exitButton} className="field-chat-screen-button" aria-label="Exit full screen" title="Exit full screen (Esc)" onClick={() => changeScreen(false)}>
            <Minimize2 size={16} aria-hidden="true" /><span>Back to {contextType === "trip" ? "comparison" : contextType === "itinerary" ? "trip" : "report"}</span>
          </button>}
        </header>
        {opened && (
          <Suspense fallback={<p className="field-chat-status" role="status">Loading the assistant…</p>}>
            <ChatConversation
              id={id}
              viewportRef={viewport}
              reportPayload={reportPayload}
              contextType={contextType}
              initialMessages={initialMessages}
              onMessagesChange={onMessagesChange}
              readOnly={readOnly}
            />
          </Suspense>
        )}
      </dialog>
    </section>
  );
}
