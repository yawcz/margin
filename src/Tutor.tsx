import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  BookOpen,
  Check,
  Compass,
  ExternalLink,
  GraduationCap,
  History,
  MessageCircle,
  Sparkles,
  X,
} from 'lucide-react';
import {
  pageLabel,
  type Action,
  type AgentStatus,
  type Job,
  type Message,
  type Recommendation,
  type Passage,
  type QuestionContext,
} from '../shared/types';
import Markdown from './Markdown';
import Answer from './Answer';
import ReplyStyle from './ReplyStyle';
import ModelSettings from './ModelSettings';
import { api, json } from './api';

type Props = {
  messages: Message[];
  recommendations: Recommendation[];
  jobs: Job[];
  selection: Passage | null;
  page: number;
  agent?: AgentStatus;
  busy: boolean;
  error: string;
  onAsk: (action: Action, question: string, context?: QuestionContext) => Promise<void>;
  onRefresh: () => void;
  onPage: (page: number) => void;
};
export default function Tutor({
  messages,
  recommendations,
  jobs,
  selection,
  page,
  agent,
  busy,
  error,
  onAsk,
  onRefresh,
  onPage,
}: Props) {
  const [tab, setTab] = useState<'conversation' | 'reading'>('conversation');
  const [question, setQuestion] = useState('');
  const [localError, setLocalError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState<'model' | 'style' | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const newest = useRef<HTMLElement>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const latest = messages.at(-1);
  useEffect(() => {
    const panel = conversation.current;
    if (!panel) return;
    let positioned = false;
    const showLatest = () => {
      // Mobile panels can receive messages while display:none. Defer scrolling until visible.
      if (positioned || !panel.clientHeight) return;
      positioned = true;
      if (!busy && latest?.role === 'assistant')
        newest.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    const observer = new ResizeObserver(showLatest);
    observer.observe(panel);
    showLatest();
    return () => observer.disconnect();
  }, [latest?.id, latest?.role, busy, tab]);
  const quizPending = latest?.role === 'assistant' && latest.action === 'quiz';
  const send = async () => {
    if (!question.trim() || busy) return;
    const text = question;
    setQuestion('');
    try {
      await onAsk(quizPending ? 'feedback' : 'chat', text);
    } catch {
      setQuestion(text);
    }
  };
  const action = (kind: Action, text: string) => {
    setTab('conversation');
    void onAsk(kind, text).catch(() => {});
  };
  const latestJob = jobs.at(-1);
  const dismiss = async (message: Message) => {
    try {
      await api(`/messages/${message.id}`, json('PATCH', { quizDismissed: true }));
      onRefresh();
    } catch (e) {
      setLocalError((e as Error).message);
    }
  };
  const update = async (rec: Recommendation, status: Recommendation['status']) => {
    try {
      await api(`/recommendations/${rec.id}`, json('PATCH', { status }));
      onRefresh();
    } catch (e) {
      setLocalError((e as Error).message);
    }
  };
  return (
    <aside className="tutor-panel" aria-label="Paper tutor">
      <div className="tutor-heading">
        <div className="tutor-mark">
          <Sparkles size={19} />
        </div>
        <div>
          <strong>Your reading companion</strong>
          <span>Make room for understanding.</span>
        </div>
        <span
          className={`status-dot ${agent?.authenticated ? 'connected' : ''}`}
          title={agent?.authenticated ? 'Agent connected' : 'Agent not connected'}
        />
      </div>
      <div className="panel-tabs">
        <button
          className={tab === 'conversation' ? 'active' : ''}
          onClick={() => setTab('conversation')}
        >
          <MessageCircle size={15} /> Conversation
        </button>
        <button className={tab === 'reading' ? 'active' : ''} onClick={() => setTab('reading')}>
          <BookOpen size={15} /> Reading path{' '}
          {recommendations.length > 0 && <span className="count">{recommendations.length}</span>}
        </button>
      </div>
      {tab === 'conversation' ? (
        <>
          <div className="tutor-settings">
            <ModelSettings
              open={settingsOpen === 'model'}
              onToggle={() => setSettingsOpen(settingsOpen === 'model' ? null : 'model')}
              onClose={() => setSettingsOpen(null)}
            />
            <ReplyStyle
              open={settingsOpen === 'style'}
              onToggle={() => setSettingsOpen(settingsOpen === 'style' ? null : 'style')}
              onClose={() => setSettingsOpen(null)}
            />
          </div>
          <div className="conversation" ref={conversation}>
            {messages.length === 0 && (
              <div className="tutor-empty">
                <div className="empty-orbit">
                  <Sparkles size={24} />
                </div>
                <h2>A little clarity goes a long way.</h2>
                <p>Select a passage in the paper, or start with the bigger picture.</p>
                <button
                  onClick={() =>
                    action(
                      'orientation',
                      'Give me a brief orientation to this paper: its question, contribution, scientific context at publication, and what I should know to read it.',
                    )
                  }
                >
                  <Compass size={18} />
                  <span>
                    <strong>Orient me</strong>
                    <small>The question, the contribution, the context</small>
                  </span>
                </button>
                <button
                  onClick={() =>
                    action(
                      'prerequisites',
                      'What should I learn first to understand this paper, given my background? Suggest an ordered and manageable path with reasons.',
                    )
                  }
                >
                  <BookOpen size={18} />
                  <span>
                    <strong>Find my starting point</strong>
                    <small>Prerequisites matched to what you know</small>
                  </span>
                </button>
                <button
                  onClick={() =>
                    action(
                      'quiz',
                      'Give me a brief diagnostic quiz on the prerequisites for this paper. Ask questions without showing solutions.',
                    )
                  }
                >
                  <GraduationCap size={18} />
                  <span>
                    <strong>Check my foundations</strong>
                    <small>A few questions to find the gaps</small>
                  </span>
                </button>
              </div>
            )}
            {messages.map((message, index) => (
              <article
                ref={index === messages.length - 1 ? newest : undefined}
                key={message.id}
                className={`message ${message.role}`}
              >
                <div className="message-label">
                  {message.role === 'user'
                    ? 'YOU'
                    : message.action === 'quiz'
                      ? 'A CHECK FOR UNDERSTANDING'
                      : 'MARGIN'}
                  <button onClick={() => onPage(message.page)}>
                    {pageLabel(message.page, message.endPage)}
                  </button>
                </div>
                {message.role === 'assistant' && message.generation && (
                  <div className="message-generation" title="Model and reasoning effort">
                    {message.generation.model} · {message.generation.effort}
                  </div>
                )}
                {message.role === 'user' && message.selection && (
                  <button className="passage" onClick={() => onPage(message.page)}>
                    {message.selection}
                  </button>
                )}
                {message.role === 'assistant' ? (
                  <>
                    <Answer content={message.content} onPage={onPage} />
                    {message.action !== 'quiz' && index === messages.length - 1 && (
                      <div className="answer-actions">
                        {[
                          ['Go deeper', 'Go deeper into the reasoning behind your last answer.'],
                          ['Give an example', 'Show me one small concrete example.'],
                        ].map(([label, question]) => (
                          <button
                            key={label}
                            disabled={busy}
                            onClick={() => {
                              void onAsk('chat', question, {
                                selection: message.selection,
                                page: message.page,
                                endPage: message.endPage,
                              }).catch(() => {});
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <Markdown onPage={onPage}>{message.content}</Markdown>
                )}
                {message.role === 'assistant' &&
                  index === messages.length - 1 &&
                  message.quizSuggested &&
                  !message.quizDismissed && (
                    <div className="quiz-nudge">
                      <GraduationCap size={18} />
                      <div>
                        <strong>Want to see if it clicked?</strong>
                        <small>
                          {message.quizReason ||
                            'Try a short question using the idea in a new setting.'}
                        </small>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => {
                            void dismiss(message);
                            action(
                              'quiz',
                              'Quiz me on the challenging ideas we just discussed. Use a new example and wait for my answer before giving solutions.',
                            );
                          }}
                        >
                          Try a quick quiz
                        </button>
                      </div>
                      <button
                        className="icon-button"
                        aria-label="Dismiss quiz suggestion"
                        onClick={() => void dismiss(message)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
              </article>
            ))}
            {busy && (
              <div className="thinking" role="status">
                <span className="thinking-dots">•••</span>
                <div>
                  <strong>Following the thread…</strong>
                  <small>You can keep reading. Your answer will be saved here.</small>
                </div>
              </div>
            )}
            {(error || localError || latestJob?.status === 'failed') && (
              <div className="error-banner" role="alert">
                {error || localError || latestJob?.error}
              </div>
            )}
            <div ref={bottom} />
          </div>
          <div className="composer-area">
            <div className="quick-actions">
              <button
                disabled={busy}
                onClick={() =>
                  action(
                    'quiz',
                    'Quiz me on the new ideas in this section and our recent discussion. Ask 1–3 transfer questions and wait for my answer.',
                  )
                }
              >
                <GraduationCap size={14} /> Quiz me
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  action(
                    'orientation',
                    'Give me a brief scientific and historical context for this paper. Separate the situation at publication from later developments, and cite sources.',
                  )
                }
              >
                <History size={14} /> Context
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  action(
                    'prerequisites',
                    'Suggest a prerequisite reading path based on the gaps in our discussion, with reasons for each step.',
                  )
                }
              >
                <BookOpen size={14} /> Prerequisites
              </button>
            </div>
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <textarea
                aria-label="Ask the tutor"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={
                  quizPending ? 'Work through your answer…' : 'What would you like to understand?'
                }
                rows={2}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing &&
                    window.matchMedia('(min-width: 900px)').matches
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="composer-footer">
                <span>
                  {selection
                    ? `Selected passage · ${pageLabel(selection.page, selection.endPage)}`
                    : `Paper context · page ${page}`}
                </span>
                <button
                  className="send-button"
                  type="submit"
                  aria-label="Send question"
                  disabled={busy || !question.trim()}
                >
                  <ArrowUp size={19} />
                </button>
              </div>
            </form>
            {!agent?.authenticated && (
              <p className="agent-note">{agent?.detail || 'Checking the tutor connection…'}</p>
            )}
          </div>
        </>
      ) : (
        <div className="reading-path">
          <div className="path-intro">
            <Compass size={25} />
            <h2>Your next useful step.</h2>
            <p>Follow your curiosity. Every recommendation is yours to accept, skip, or revisit.</p>
          </div>
          <div className="path-actions">
            <button
              className="secondary small"
              disabled={busy}
              onClick={() =>
                action(
                  'prerequisites',
                  'Suggest an ordered prerequisite reading path tailored to my background and our discussion.',
                )
              }
            >
              <BookOpen size={15} /> Before this paper
            </button>
            <button
              className="secondary small"
              disabled={busy}
              onClick={() =>
                action(
                  'next',
                  'Suggest useful papers to read after this one, taking into account my reading history and learning goals.',
                )
              }
            >
              <Compass size={15} /> After this paper
            </button>
          </div>
          {recommendations.length === 0 && (
            <p className="muted path-placeholder">
              Your reading suggestions will appear here as you explore the paper.
            </p>
          )}
          {recommendations.map((rec, i) => (
            <article
              className={`recommendation ${rec.status === 'skipped' ? 'skipped' : ''}`}
              key={rec.id}
            >
              <div className="rec-number">{String(i + 1).padStart(2, '0')}</div>
              <div className="rec-body">
                <span className="eyebrow">
                  {rec.kind} {rec.effort && `· ${rec.effort}`}
                </span>
                <a href={rec.url} target="_blank" rel="noopener noreferrer">
                  {rec.title}
                  <ExternalLink size={13} />
                </a>
                <p>{rec.reason}</p>
                <div className="rec-controls">
                  {rec.status === 'suggested' ? (
                    <>
                      <button onClick={() => void update(rec, 'queued')}>
                        <Check size={13} /> Add to my path
                      </button>
                      <button onClick={() => void update(rec, 'skipped')}>Skip</button>
                    </>
                  ) : (
                    <>
                      <span>
                        {rec.status === 'queued'
                          ? 'On your path'
                          : rec.status === 'read'
                            ? 'Read'
                            : 'Skipped'}
                      </span>
                      {rec.status === 'queued' && (
                        <button onClick={() => void update(rec, 'read')}>Mark read</button>
                      )}
                      <button onClick={() => void update(rec, 'suggested')}>Reset</button>
                    </>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </aside>
  );
}
