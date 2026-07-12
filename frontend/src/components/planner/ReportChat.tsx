import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { ChevronDown, MessageCircleQuestion, Send, Square } from 'lucide-react';
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
import '../../styles/report-chat.css';

const STARTER_QUESTIONS = [
  'What is driving the risk score?',
  'What should I verify before leaving?',
  'How does the timing affect this plan?',
];

const FOLLOW_UP_QUESTIONS = {
  avalanche: [
    'Which avalanche details matter most?',
    'What terrain should I avoid?',
    'What should I confirm in the official forecast?',
  ],
  weather: [
    'When is the safest travel window?',
    'Which weather threshold is closest?',
    'What should I recheck before leaving?',
  ],
  uncertainty: [
    'What is the biggest uncertainty?',
    'Which missing data matters most?',
    'Where should I verify it?',
  ],
  general: [
    'What could change this recommendation?',
    'What should I check in the field?',
    'What would make this a no-go?',
  ],
} as const;

const AVALANCHE_TERMS = ['avalanche', 'slab', 'snowpack', 'aspect', 'slope', 'terrain trap'];
const WEATHER_TERMS = ['weather', 'wind', 'gust', 'precipitation', 'storm', 'temperature', 'travel window'];
const UNCERTAINTY_TERMS = ['unknown', 'missing', 'unavailable', 'stale', 'conflict', 'uncertain'];

function includesAny(text: string, terms: readonly string[]) {
  return terms.some((term) => text.includes(term));
}

function getFollowUpQuestions(answer: string): readonly string[] {
  const normalizedAnswer = answer.toLowerCase();
  if (includesAny(normalizedAnswer, AVALANCHE_TERMS)) return FOLLOW_UP_QUESTIONS.avalanche;
  if (includesAny(normalizedAnswer, WEATHER_TERMS)) return FOLLOW_UP_QUESTIONS.weather;
  if (includesAny(normalizedAnswer, UNCERTAINTY_TERMS)) return FOLLOW_UP_QUESTIONS.uncertainty;
  return FOLLOW_UP_QUESTIONS.general;
}

export interface ReportChatProps {
  reportPayload: string;
}

function ReportChatComponent({ reportPayload }: ReportChatProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [input, setInput] = React.useState('');
  const conversationId = React.useId();
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
  } = useChat({ transport });
  const isBusy = status === 'submitted' || status === 'streaming';
  const latestMessage = messages[messages.length - 1];
  const latestAssistantAnswer = latestMessage?.role === 'assistant'
    ? latestMessage.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
    : '';
  const followUpQuestions = !isBusy && !error && latestAssistantAnswer
    ? getFollowUpQuestions(latestAssistantAnswer)
    : [];

  React.useEffect(() => {
    setMessages([]);
    setInput('');
  }, [reportPayload, setMessages]);

  const submitQuestion = React.useCallback((question: string) => {
    const text = question.trim();
    if (!text || isBusy || !reportPayload) return;
    setIsOpen(true);
    setInput('');
    void sendMessage(
      { text },
      { body: { report: reportPayload } },
    );
  }, [isBusy, reportPayload, sendMessage]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitQuestion(input);
  };

  return (
    <div className={`report-chat ${isOpen ? 'is-open' : ''}`}>
      <button
        type="button"
        className="report-chat-toggle"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls={conversationId}
      >
        <span className="report-chat-toggle-icon"><MessageCircleQuestion size={17} aria-hidden /></span>
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
                        {question}
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
                      />
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
