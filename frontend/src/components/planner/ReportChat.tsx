import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { ChevronDown, Send, Sparkles, Square } from 'lucide-react';
import React from 'react';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '../ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageResponse,
} from '../ai-elements/message';
import { Suggestion, Suggestions } from '../ai-elements/suggestion';
import { buildApiUrl } from '../../lib/api-client';
import { useAiAccess } from '../../hooks/useAiAccess';
import '../../styles/report-chat.css';
import type { PersistedReportChatMessage } from '../../app/report-storage';

const STARTER_QUESTIONS = [
  'What is driving the risk score?',
  'What should I verify before leaving?',
  'How does the timing affect this plan?',
];

type ReportChatMessage = UIMessage<never, {
  followUpSuggestions: { suggestions: string[] };
}>;

function getFollowUpQuestions(message: ReportChatMessage | undefined): string[] {
  if (!message || message.role !== 'assistant') return [];
  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index];
    if (part.type === 'data-followUpSuggestions') {
      const suggestions = part.data?.suggestions;
      if (!Array.isArray(suggestions)) return [];
      return suggestions
        .filter((suggestion) => typeof suggestion === 'string' && suggestion.trim())
        .slice(0, 3);
    }
  }
  return [];
}

export interface ReportChatProps {
  reportPayload: string;
  initialMessages: PersistedReportChatMessage[];
  onMessagesChange: (messages: PersistedReportChatMessage[]) => void;
}

function ReportChatComponent({ reportPayload, initialMessages, onMessagesChange }: ReportChatProps) {
  const { requestAiAccess } = useAiAccess();
  const [isOpen, setIsOpen] = React.useState(false);
  const [input, setInput] = React.useState('');
  const conversationId = React.useId();
  const lastReportedMessagesRef = React.useRef(JSON.stringify([]));
  const transport = React.useMemo(
    () => new DefaultChatTransport({ api: buildApiUrl('/api/report-chat') }),
    [],
  );
  const {
    messages,
    sendMessage,
    status,
    error,
    setMessages,
    stop,
  } = useChat<ReportChatMessage>({
    transport,
    messages: initialMessages as ReportChatMessage[],
  });
  const isBusy = status === 'submitted' || status === 'streaming';
  const latestMessage = messages[messages.length - 1];
  const followUpQuestions = !isBusy && !error
    ? getFollowUpQuestions(latestMessage)
    : [];

  const resetChatForReport = React.useEffectEvent(() => {
    lastReportedMessagesRef.current = JSON.stringify(initialMessages);
    setMessages(initialMessages as ReportChatMessage[]);
    setInput('');
  });

  React.useEffect(() => {
    resetChatForReport();
  }, [reportPayload]);

  React.useEffect(() => {
    const serialized = JSON.stringify(messages);
    if (serialized === lastReportedMessagesRef.current) return;
    lastReportedMessagesRef.current = serialized;
    onMessagesChange(messages as PersistedReportChatMessage[]);
  }, [messages, onMessagesChange]);

  const submitQuestion = React.useCallback((question: string) => {
    const text = question.trim();
    if (!text || isBusy || !reportPayload) return;
    if (!requestAiAccess()) return;
    setIsOpen(true);
    setInput('');
    void sendMessage(
      { text },
      { body: { report: reportPayload } },
    );
  }, [isBusy, reportPayload, requestAiAccess, sendMessage]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitQuestion(input);
  };

  return (
    <div className={`report-chat ${isOpen ? 'is-open' : ''}`}>
      <button
        type="button"
        className="report-chat-toggle"
        onClick={() => {
          if (isOpen) {
            setIsOpen(false);
          } else if (requestAiAccess()) {
            setIsOpen(true);
          }
        }}
        aria-expanded={isOpen}
        aria-controls={conversationId}
      >
        <span className="report-chat-toggle-icon"><Sparkles size={17} aria-hidden /></span>
        <span>
          <strong>Ask about this report</strong>
          <small>Chat with the report data already attached</small>
        </span>
        <ChevronDown className="report-chat-chevron" size={17} aria-hidden />
      </button>

      {isOpen && (
        <div id={conversationId} className="report-chat-panel">
          <Conversation className="report-chat-conversation" aria-live="polite">
            <ConversationContent className="report-chat-messages">
              {messages.length === 0 ? (
                <div className="report-chat-empty">
                  <p>Ask what is driving the decision, how conditions interact, or what needs a current field check.</p>
                  <div className="report-chat-suggestions" aria-label="Suggested questions">
                    {STARTER_QUESTIONS.map((question) => (
                      <button key={question} type="button" onClick={() => submitQuestion(question)}>
                        <Sparkles size={12} aria-hidden /> {question}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((message, messageIndex) => (
                  <Message key={message.id} from={message.role} className="report-chat-message">
                    <MessageContent className="report-chat-message-content">
                      {message.parts.map((part, partIndex) => (
                        part.type === 'text' ? (
                          <MessageResponse
                            className="report-chat-response"
                            key={`${message.id}-${partIndex}`}
                            isAnimating={isBusy && message.role === 'assistant' && messageIndex === messages.length - 1}
                          >
                            {part.text}
                          </MessageResponse>
                        ) : null
                      ))}
                    </MessageContent>
                  </Message>
                ))
              )}
              {status === 'submitted' && (
                <div className="report-chat-thinking" role="status" aria-live="polite">
                  <span /><span /><span /> Reading the report…
                </div>
              )}
              {followUpQuestions.length > 0 && (
                <div className="report-chat-follow-ups" role="group" aria-label="Suggested replies">
                  <p>Suggested replies</p>
                  <Suggestions className="report-chat-follow-up-list">
                    {followUpQuestions.map((question) => (
                      <Suggestion
                        key={question}
                        className="report-chat-follow-up"
                        suggestion={question}
                        onClick={submitQuestion}
                      >
                        <Sparkles size={12} aria-hidden /> {question}
                      </Suggestion>
                    ))}
                  </Suggestions>
                </div>
              )}
              {error && (
                <div className="report-chat-error" role="alert">
                  The report assistant couldn’t answer. Please try again.
                </div>
              )}
            </ConversationContent>
            <ConversationScrollButton className="report-chat-scroll" aria-label="Scroll to latest message" />
          </Conversation>

          <form className="report-chat-form" onSubmit={handleSubmit}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value.slice(0, 1000))}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submitQuestion(input);
                }
              }}
              placeholder="Ask a question about this report…"
              aria-label="Question about this report"
              rows={2}
              disabled={!reportPayload}
            />
            {isBusy ? (
              <button type="button" className="report-chat-submit" onClick={() => void stop()} aria-label="Stop response">
                <Square size={14} fill="currentColor" aria-hidden />
              </button>
            ) : (
              <button type="submit" className="report-chat-submit" disabled={!input.trim()} aria-label="Send question">
                <Send size={16} aria-hidden />
              </button>
            )}
          </form>
          <p className="report-chat-disclaimer">Planning support only. Confirm official forecasts and current field conditions.</p>
        </div>
      )}
    </div>
  );
}

export const ReportChat = React.memo(ReportChatComponent);
