import { ChevronDown, Sparkles } from 'lucide-react';
import React from 'react';
import { useAiAccess } from '../../hooks/useAiAccess';
import '../../styles/report-chat.css';
import type { PersistedReportChatMessage } from '../../app/report-storage';

const LazyReportChatConversation = React.lazy(() =>
  import('./ReportChatConversation').then((module) => ({ default: module.ReportChatConversation })),
);

const EMPTY_MESSAGES: PersistedReportChatMessage[] = [];

export interface ReportChatProps {
  readOnly: boolean;
  reportPayload: string;
  contextType?: 'report' | 'trip';
  initialMessages?: PersistedReportChatMessage[];
  onMessagesChange?: (messages: PersistedReportChatMessage[]) => void;
}

function ReportChatComponent({
  readOnly,
  reportPayload,
  contextType = 'report',
  initialMessages = EMPTY_MESSAGES,
  onMessagesChange,
}: ReportChatProps) {
  const { requestAiAccess } = useAiAccess();
  const initiallyOpen = readOnly && initialMessages.length > 0;
  const [isOpen, setIsOpen] = React.useState(initiallyOpen);
  // Keep the loaded conversation mounted after its first open so collapsing it
  // does not reset messages or interrupt an in-flight response.
  const [hasOpened, setHasOpened] = React.useState(initiallyOpen);
  const conversationId = React.useId();

  const openChat = () => {
    if (!readOnly && !requestAiAccess()) return;
    setHasOpened(true);
    setIsOpen(true);
  };

  return (
    <div className={`report-chat ${isOpen ? 'is-open' : ''}`}>
      <button
        type="button"
        className="report-chat-toggle"
        onClick={() => {
          if (isOpen) {
            setIsOpen(false);
          } else {
            openChat();
          }
        }}
        aria-expanded={isOpen}
        aria-controls={conversationId}
      >
        <span className="report-chat-toggle-icon"><Sparkles size={17} aria-hidden /></span>
        <span>
          <strong>
            {readOnly
              ? 'Saved AI conversation'
              : contextType === 'trip'
                ? 'Ask about this multi-day plan'
                : 'Ask about this report'}
          </strong>
          <small>
            {readOnly
              ? 'Read-only text stored with this report'
              : contextType === 'trip'
                ? 'Compare days, tradeoffs, timing, and preparation'
                : 'Chat with the report data already attached'}
          </small>
        </span>
        <ChevronDown className="report-chat-chevron" size={17} aria-hidden />
      </button>

      {hasOpened && (
        <React.Suspense
          fallback={isOpen ? (
            <div id={conversationId} className="report-chat-panel" role="status" aria-live="polite">
              Loading assistant…
            </div>
          ) : null}
        >
          <LazyReportChatConversation
            readOnly={readOnly}
            reportPayload={reportPayload}
            contextType={contextType}
            initialMessages={initialMessages}
            onMessagesChange={onMessagesChange}
            isOpen={isOpen}
            panelId={conversationId}
            requestAiAccess={requestAiAccess}
          />
        </React.Suspense>
      )}
    </div>
  );
}

export const ReportChat = React.memo(ReportChatComponent);
