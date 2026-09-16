import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  GraduationCap,
  Library,
  Link,
  LogOut,
  Plus,
  Search,
  Sparkles,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import { api, json } from './api';
import type { Draft } from './Tutor';
import type {
  Action,
  AgentStatus,
  Job,
  Paper,
  PaperDetail,
  Passage,
  QuestionContext,
} from '../shared/types';
const PdfReader = lazy(() => import('./PdfReader'));
const Tutor = lazy(() => import('./Tutor'));
const Profile = lazy(() => import('./Profile'));

type Detail = PaperDetail & { jobs: Job[] };
function Logo() {
  return (
    <span className="brand">
      <span className="brand-icon">m</span>
      <span>
        margin<span className="brand-period">.</span>
      </span>
    </span>
  );
}
export default function App() {
  const [session, setSession] = useState<{ authenticated: boolean; passwordRequired: boolean }>();
  const [password, setPassword] = useState('');
  const [view, setView] = useState<'library' | 'reader' | 'profile'>('library');
  const [papers, setPapers] = useState<Paper[]>([]);
  const [paperId, setPaperId] = useState('');
  const [detail, setDetail] = useState<Detail>();
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<Passage | null>(null);
  const [pageJump, setPageJump] = useState(0);
  const [mobilePanel, setMobilePanel] = useState<'paper' | 'tutor'>('paper');
  const [agent, setAgent] = useState<AgentStatus>();
  const [error, setError] = useState('');
  const [askError, setAskError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [askingPaper, setAskingPaper] = useState('');
  const submitting = useRef(new Set<string>());
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [showImport, setShowImport] = useState(false);
  const [arxiv, setArxiv] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const fileInput = useRef<HTMLInputElement>(null);
  const importDialog = useRef<HTMLDialogElement>(null);
  const detailEpoch = useRef(0);
  const detailRequest = useRef(0);
  const detailApplied = useRef(0);
  const libraryRequest = useRef(0);
  const libraryApplied = useRef(0);
  const pageSaves = useRef(Promise.resolve());
  const pageRef = useRef(page);
  pageRef.current = page;
  const idRef = useRef(paperId);
  idRef.current = paperId;
  const refreshLibrary = useCallback(async () => {
    const request = ++libraryRequest.current;
    const values = await api<Paper[]>('/papers');
    if (request > libraryApplied.current) {
      libraryApplied.current = request;
      setPapers(values);
    }
  }, []);
  const refreshDetail = useCallback(async () => {
    const id = idRef.current;
    if (!id) return;
    const epoch = detailEpoch.current;
    const request = ++detailRequest.current;
    const value = await api<Detail>(`/papers/${id}?page=${pageRef.current}`);
    if (idRef.current === id && epoch === detailEpoch.current && request > detailApplied.current) {
      detailApplied.current = request;
      setDetail(value);
    }
  }, []);
  const [bootAttempt, setBootAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A network blip on load should retry (1 s, 2 s, 4 s) before showing an error with Retry.
    const load = async (attempt: number) => {
      try {
        const value = await api<typeof session>('/session');
        if (!cancelled) setSession(value);
      } catch (e) {
        if (cancelled) return;
        if (attempt < 3) timer = setTimeout(() => void load(attempt + 1), 1000 * 2 ** attempt);
        else setError((e as Error).message);
      }
    };
    void load(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bootAttempt]);
  useEffect(() => {
    const expired = () => {
      detailEpoch.current++;
      libraryApplied.current = ++libraryRequest.current;
      setSession((s) => s && { ...s, authenticated: false });
    };
    window.addEventListener('margin:unauthenticated', expired);
    return () => window.removeEventListener('margin:unauthenticated', expired);
  }, []);
  useEffect(() => {
    if (!session?.authenticated) return;
    void refreshLibrary().catch((e) => setError(e.message));
    void api<AgentStatus>('/agent')
      .then(setAgent)
      .catch(() => {});
  }, [session?.authenticated, refreshLibrary]);
  useEffect(() => {
    if (!paperId || !session?.authenticated) return;
    void refreshDetail().catch((e) => setError(e.message));
    const timer = setInterval(() => {
      void refreshDetail().catch(() => {});
    }, 2500);
    return () => clearInterval(timer);
  }, [paperId, session?.authenticated, refreshDetail]);
  useEffect(() => {
    const dialog = importDialog.current;
    if (!showImport || !session?.authenticated || !dialog) return;
    const opener = document.activeElement;
    dialog.showModal();
    dialog.querySelector('input')?.focus();
    return () => {
      dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [showImport, session?.authenticated]);
  useEffect(() => {
    const onFocus = () => {
      if (session?.authenticated) {
        void refreshLibrary().catch(() => {});
        void refreshDetail().catch(() => {});
        void api<AgentStatus>('/agent')
          .then(setAgent)
          .catch(() => {});
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [session?.authenticated, refreshLibrary, refreshDetail]);
  const openPaper = (paper: Paper) => {
    detailEpoch.current++;
    setPaperId(paper.id);
    idRef.current = paper.id;
    setDetail(undefined);
    setPage(paper.currentPage);
    pageRef.current = paper.currentPage;
    setSelection(null);
    setView('reader');
    setMobilePanel('paper');
    setError('');
    setAskError('');
  };
  const trackPage = (next: number) => {
    if (!detail || next < 1 || next > detail.paper.pages || next === pageRef.current) return;
    setPage(next);
    pageRef.current = next;
    pageSaves.current = pageSaves.current
      .then(() => api(`/papers/${paperId}`, json('PATCH', { currentPage: next })))
      .then(() => {})
      .catch((e) => setError(e.message));
  };
  const changePage = (next: number) => {
    trackPage(next);
    setPageJump((value) => value + 1);
  };
  const importFile = async (file: File) => {
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const paper = await api<Paper>('/papers', { method: 'POST', body: form });
      await refreshLibrary();
      setShowImport(false);
      openPaper(paper);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };
  const importLink = async (value: string) => {
    setUploading(true);
    setError('');
    try {
      const paper = await api<Paper>('/import', json('POST', { url: value }));
      await refreshLibrary();
      setShowImport(false);
      openPaper(paper);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };
  const busy = askingPaper === paperId || !!detail?.jobs.some((j) => j.status === 'running');
  const ask = async (action: Action, question: string, context?: QuestionContext) => {
    if (!paperId || busy || submitting.current.has(paperId))
      throw new Error('A question is already being sent.');
    const epoch = detailEpoch.current;
    submitting.current.add(paperId);
    setAskingPaper(paperId);
    setAskError('');
    setMobilePanel('tutor');
    try {
      const job = await api<Job>(
        `/papers/${paperId}/ask`,
        json('POST', {
          requestId: crypto.randomUUID(),
          action,
          question,
          selection: context?.selection ?? selection?.text ?? '',
          page: context?.page ?? selection?.page ?? page,
          endPage: context ? (context.endPage ?? context.page) : (selection?.endPage ?? page),
        }),
      );
      if (idRef.current === paperId && epoch === detailEpoch.current) {
        detailApplied.current = ++detailRequest.current;
        setDetail(
          (current) =>
            current && {
              ...current,
              jobs: [...current.jobs.filter((item) => item.id !== job.id), job],
            },
        );
        void refreshDetail().catch(() => {});
      }
    } catch (e) {
      if (idRef.current === paperId && epoch === detailEpoch.current)
        setAskError((e as Error).message);
      throw e;
    } finally {
      submitting.current.delete(paperId);
      setAskingPaper((current) => (current === paperId ? '' : current));
    }
  };
  const safeAsk = async (action: Action, question: string, context?: QuestionContext) => {
    try {
      await ask(action, question, context);
    } catch {}
  };
  const status = async (value: Paper['status']) => {
    if (!detail) return;
    try {
      await api(`/papers/${paperId}`, json('PATCH', { status: value }));
      await refreshDetail();
      await refreshLibrary();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const filtered = papers.filter(
    (p) =>
      (filter === 'all' || p.status === filter) &&
      p.title.toLowerCase().includes(search.toLowerCase()),
  );
  const reading = papers.filter((p) => p.status === 'reading'),
    completed = papers.filter((p) => p.status === 'read');
  if (!session)
    return (
      <div className="boot">
        <Logo />
        <p>{error || 'Opening your reading space…'}</p>
        {error && (
          <button
            className="secondary"
            onClick={() => {
              setError('');
              setBootAttempt((value) => value + 1);
            }}
          >
            Retry
          </button>
        )}
      </div>
    );
  if (!session.authenticated)
    return (
      <div className="login-page">
        <Logo />
        <form
          className="login-card"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api('/login', json('POST', { password }));
              setPassword('');
              setSession({ authenticated: true, passwordRequired: true });
              setError('');
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <span className="eyebrow">YOUR PRIVATE READING SPACE</span>
          <h1>Welcome back.</h1>
          <p>A quiet place to work through big ideas.</p>
          <label>
            Reader password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
          </label>
          {error && <div className="error-banner">{error}</div>}
          <button className="primary" type="submit">
            Open my library <ArrowRight size={17} />
          </button>
        </form>
      </div>
    );
  return (
    <div className={`app ${view === 'reader' ? 'reader-layout' : ''}`}>
      <header className="site-header">
        <button
          className="logo-button"
          onClick={() => {
            setView('library');
            void refreshLibrary();
          }}
        >
          <Logo />
        </button>
        <nav aria-label="Main navigation">
          <button
            className={view === 'library' ? 'active' : ''}
            onClick={() => {
              setView('library');
              void refreshLibrary();
            }}
          >
            <Library size={17} />
            <span>Library</span>
          </button>
          <button className={view === 'profile' ? 'active' : ''} onClick={() => setView('profile')}>
            <UserRound size={17} />
            <span>Learning profile</span>
          </button>
        </nav>
        <div className="header-right">
          <span className="private-label">
            <span className="status-dot connected" /> Personal workspace
          </span>
          {session.passwordRequired && (
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={async () => {
                await api('/logout', json('POST'));
                detailEpoch.current++;
                libraryApplied.current = ++libraryRequest.current;
                setSession({ authenticated: false, passwordRequired: true });
                setDetail(undefined);
              }}
            >
              <LogOut size={17} />
            </button>
          )}
          <span className="avatar">Y</span>
        </div>
      </header>
      <input
        className="sr-only"
        type="file"
        accept="application/pdf,.pdf"
        ref={fileInput}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file);
        }}
      />
      {view === 'library' && (
        <main className="library-page">
          <div className="library-intro">
            <div>
              <div className="eyebrow">
                <span className="tiny-line" /> YOUR PAPER TRAIL
              </div>
              <h1>Read a little deeper.</h1>
              <p className="page-description">
                Follow a question. Untangle an idea. Pick up where you left off.
              </p>
            </div>
            <button
              className="primary"
              onClick={() => {
                setError('');
                setShowImport(true);
              }}
            >
              <Plus size={18} /> Add a paper
            </button>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          <div className="library-summary">
            <div>
              <BookOpen size={19} />
              <strong>{reading.length}</strong>
              <span>in progress</span>
            </div>
            <div>
              <Check size={19} />
              <strong>{completed.length}</strong>
              <span>read</span>
            </div>
            <div className="summary-note">
              <Sparkles size={16} />
              <span>Understanding grows one question at a time.</span>
            </div>
          </div>
          {reading.length > 0 && !search && filter === 'all' && (
            <section className="continue-card">
              <div>
                <span className="eyebrow">CONTINUE READING</span>
                <h2>{reading[0].title}</h2>
                <p>
                  Page {reading[0].currentPage} of {reading[0].pages} <span>·</span> Your questions
                  and notes are waiting.
                </p>
                <button className="text-button" onClick={() => openPaper(reading[0])}>
                  Back to the paper <ArrowRight size={17} />
                </button>
              </div>
              <div className="paper-decoration" aria-hidden="true">
                <div className="mini-paper">
                  <span />
                  <span />
                  <span />
                  <i />
                  <span />
                  <span />
                  <b>λᵀγ</b>
                  <span />
                  <span />
                </div>
                <div className="annotation-dot">
                  <Sparkles size={22} />
                </div>
              </div>
            </section>
          )}
          <div className="library-tools">
            <div className="filter-tabs">
              {[
                ['all', 'All papers'],
                ['reading', 'Reading'],
                ['queued', 'To read'],
                ['read', 'Read'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  className={filter === key ? 'active' : ''}
                  onClick={() => setFilter(key)}
                >
                  {label}
                  {key === 'all' && <span>{papers.length}</span>}
                </button>
              ))}
            </div>
            <label className="search">
              <Search size={16} />
              <input
                aria-label="Search papers"
                placeholder="Find a paper…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </div>
          {papers.length === 0 ? (
            <section
              className="library-empty"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) void importFile(file);
              }}
            >
              <div className="empty-books">
                <BookOpen size={42} strokeWidth={1} />
                <span className="book-spark">
                  <Sparkles size={17} />
                </span>
              </div>
              <span className="eyebrow">A GOOD PLACE TO BEGIN</span>
              <h2>Bring a paper. Bring your questions.</h2>
              <p>
                Drop a PDF here, or add a paper from arXiv.
                <br />
                Your library and learning history will grow together.
              </p>
              <button
                className="primary"
                disabled={uploading}
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={17} />
                {uploading ? 'Preparing your paper…' : 'Upload your first PDF'}
              </button>
              <button
                className="text-button sample-link"
                disabled={uploading}
                onClick={() => void importLink('2311.03658v2')}
              >
                Start with the linear representation paper <ArrowRight size={15} />
              </button>
              <span className="upload-hint">PDF · up to 30 MB · text-based documents</span>
            </section>
          ) : (
            <div className="paper-grid">
              {filtered.map((paper, i) => (
                <button className="paper-card" key={paper.id} onClick={() => openPaper(paper)}>
                  <div className="paper-card-top">
                    <div className={`paper-icon tone-${i % 3}`}>
                      <FileText size={23} strokeWidth={1.5} />
                    </div>
                    <span className={`badge ${paper.status}`}>
                      {paper.status === 'queued'
                        ? 'To read'
                        : paper.status === 'read'
                          ? 'Read'
                          : 'Reading'}
                    </span>
                  </div>
                  <h2>{paper.title}</h2>
                  <div className="paper-meta">
                    {paper.source ? 'arXiv' : 'Your PDF'} <span>·</span> {paper.pages} pages
                  </div>
                  <div className="paper-card-bottom">
                    <span>
                      {paper.status === 'read'
                        ? 'Finished reading'
                        : `Page ${paper.currentPage} of ${paper.pages}`}
                    </span>
                    <ArrowRight size={17} />
                  </div>
                  <div className="progress-track">
                    <span
                      style={{
                        width: `${paper.status === 'read' ? 100 : (paper.currentPage / paper.pages) * 100}%`,
                      }}
                    />
                  </div>
                </button>
              ))}
              {filtered.length === 0 && <p className="muted">No papers match this view.</p>}
            </div>
          )}
          <footer className="library-footer">
            <span>Space to think, right in the margin.</span>
            <span>YOUR LIBRARY. YOUR PACE.</span>
          </footer>
        </main>
      )}
      {view === 'profile' && (
        <Suspense fallback={<div className="boot">Opening your profile…</div>}>
          <Profile />
        </Suspense>
      )}
      {view === 'reader' && !detail && (
        <div className="boot">
          <p>{error || 'Opening your paper…'}</p>
        </div>
      )}
      {view === 'reader' && detail && (
        <>
          <div className="reader-heading">
            <button
              className="icon-button"
              aria-label="Back to library"
              onClick={() => {
                setView('library');
                void refreshLibrary();
              }}
            >
              <ArrowLeft size={19} />
            </button>
            <div className="reader-title">
              <span className="eyebrow">IN YOUR LIBRARY</span>
              <h1 title={detail.paper.title}>{detail.paper.title}</h1>
            </div>
            <label className="reading-status">
              <span className="sr-only">Reading status</span>
              <select
                aria-label="Reading status"
                value={detail.paper.status}
                onChange={(e) => void status(e.target.value as Paper['status'])}
              >
                <option value="reading">Reading</option>
                <option value="queued">To read</option>
                <option value="read">Read</option>
              </select>
              <ChevronDown size={14} />
            </label>
          </div>
          {error && <div className="error-banner">{error}</div>}
          {detail.contextNotice && (
            <p className="context-notice">
              This long paper uses selected pages for tutor context. The tutor is told which pages
              it receives.
            </p>
          )}
          <div className={`reader-workspace mobile-${mobilePanel}`}>
            <Suspense fallback={<div className="boot reader-loading">Opening the reader…</div>}>
              <PdfReader
                paper={detail.paper}
                page={page}
                pageJump={pageJump}
                onPage={trackPage}
                onNavigate={changePage}
                selection={selection}
                onSelection={setSelection}
                asking={busy}
                onExplain={() => void safeAsk('explain', 'Explain this passage.')}
              />
              <Tutor
                key={paperId}
                draft={drafts[paperId] ?? { text: '', failed: '' }}
                onDraftChange={(update) =>
                  setDrafts((current) => ({
                    ...current,
                    [paperId]: update(current[paperId] ?? { text: '', failed: '' }),
                  }))
                }
                messages={detail.messages}
                recommendations={detail.recommendations}
                jobs={detail.jobs}
                selection={selection}
                page={page}
                agent={agent}
                busy={busy}
                error={askError}
                onAsk={ask}
                onRefresh={refreshDetail}
                onPage={(p) => {
                  changePage(p);
                  setMobilePanel('paper');
                }}
              />
            </Suspense>
          </div>
          <div className="mobile-reader-nav">
            <button
              className={mobilePanel === 'paper' ? 'active' : ''}
              onClick={() => setMobilePanel('paper')}
            >
              <FileText size={18} /> Paper{' '}
              <span>
                {page}/{detail.paper.pages}
              </span>
            </button>
            <button
              className={mobilePanel === 'tutor' ? 'active' : ''}
              onClick={() => setMobilePanel('tutor')}
            >
              <Sparkles size={18} /> Tutor {busy && <span className="busy-dot" />}
            </button>
          </div>
        </>
      )}
      {showImport && (
        <dialog
          ref={importDialog}
          className="modal-backdrop"
          aria-labelledby="import-title"
          onCancel={(e) => {
            e.preventDefault();
            if (!uploading) setShowImport(false);
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !uploading) setShowImport(false);
          }}
        >
          <section className="import-modal">
            <button
              className="icon-button modal-close"
              aria-label="Close import"
              disabled={uploading}
              onClick={() => setShowImport(false)}
            >
              <X size={20} />
            </button>
            <div className="eyebrow">A NEW THREAD TO FOLLOW</div>
            <h2 id="import-title">Add to your library.</h2>
            <button
              className="upload-zone"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={27} />
              <strong>Choose a PDF</strong>
              <span>Text-based PDF, up to 30 MB</span>
            </button>
            <div className="divider-label">or start with a link</div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void importLink(arxiv);
              }}
            >
              <label>
                arXiv URL or identifier
                <div className="link-input">
                  <Link size={17} />
                  <input
                    placeholder="https://arxiv.org/abs/2311.03658"
                    value={arxiv}
                    onChange={(e) => setArxiv(e.target.value)}
                    required
                  />
                </div>
              </label>
              <button className="primary" disabled={uploading || !arxiv.trim()}>
                {uploading ? 'Preparing your paper…' : 'Add paper'}
                <ArrowRight size={17} />
              </button>
            </form>
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
          </section>
        </dialog>
      )}
    </div>
  );
}
