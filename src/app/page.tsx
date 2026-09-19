'use client';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  FileText,
  FolderOpen,
  History,
  Layers,
  Monitor,
  Moon,
  Plus,
  ShieldCheck,
  Sparkles,
  Sun,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import {
  ready,
  needsAnalysis,
  uid,
  type DocumentSet,
  type Question,
  type QuizConfig,
  type QuizSession,
} from '@/lib/model';
import { getDocuments, getSessions, putDocument, putSession, deleteDocument } from '@/lib/storage';
import { detectQuestions, combineQuestions } from '@/lib/detection';
import { createQuiz, hydrateQuiz, quizPriority, results } from '@/lib/quiz';
import { processDocument, analyzeStructure } from '@/lib/processing';
import type { ExtractionProgress } from '@/lib/extract';
import type { SolverProfile } from '@/lib/batching';
const QuestionReview = dynamic(() => import('@/components/QuestionReview'));
const QuizPlayer = dynamic(() => import('@/components/QuizPlayer'));
const defaultConfig: QuizConfig = {
  count: 0,
  mode: 'practice',
  shuffleQuestions: false,
  shuffleOptions: true,
  includeMC: true,
  includeOpen: true,
};

export default function Home() {
  const [documents, setDocuments] = useState<DocumentSet[]>([]);
  const [sessions, setSessions] = useState<QuizSession[]>([]);
  const [view, setView] = useState<'documents' | 'history' | 'review' | 'quiz'>('documents');
  const [selected, setSelected] = useState<string[]>([]);
  const [reviewId, setReviewId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<ExtractionProgress | null>(null);
  const [processingId, setProcessingId] = useState('');
  const [configQuestions, setConfigQuestions] = useState<Question[] | null>(null);
  const [config, setConfig] = useState(defaultConfig);
  const [services, setServices] = useState({
    ai: false,
    ocr: false,
    batchSize: 40,
    providers: [] as SolverProfile[],
    provider: 'openai',
    requestIntervalMs: 2000,
  });
  const [theme, setTheme] = useState('system');
  const [generateOptions, setGenerateOptions] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const stop = useRef(false);
  const running = useRef(false);
  const resumed = useRef(new Set<string>());
  const sessionsRef = useRef<QuizSession[]>([]);
  const activeRef = useRef('');
  const [serviceLoaded, setServiceLoaded] = useState(false);
  const acceptDocument = (doc: DocumentSet) => {
    setDocuments((old) =>
      old.some((d) => d.id === doc.id)
        ? old.map((d) => (d.id === doc.id ? doc : d))
        : [doc, ...old],
    );
    let changed = false;
    const next = sessionsRef.current.map((session) => {
      const updated = hydrateQuiz(session, doc.questions);
      if (updated !== session) {
        changed = true;
        void putSession(updated).catch(() => setError('Progresul quiz-ului nu a putut fi salvat.'));
      }
      return updated;
    });
    if (changed) {
      sessionsRef.current = next;
      setSessions(next);
    }
  };
  const updateDocument = async (doc: DocumentSet) => {
    await putDocument(doc);
    acceptDocument(doc);
  };
  const updateSession = async (session: QuizSession) => {
    const latest = sessionsRef.current.find((s) => s.id === session.id);
    session = hydrateQuiz(session, latest?.questions || []);
    const next = sessionsRef.current.some((s) => s.id === session.id)
      ? sessionsRef.current.map((s) => (s.id === session.id ? session : s))
      : [session, ...sessionsRef.current];
    sessionsRef.current = next;
    setSessions(next);
    await putSession(session);
  };
  useEffect(() => {
    Promise.all([getDocuments(), getSessions()])
      .then(([docs, quizzes]) => {
        setDocuments(docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
        const restored = quizzes
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
          .map((s) =>
            hydrateQuiz(
              s,
              docs.flatMap((d) => d.questions),
            ),
          );
        sessionsRef.current = restored;
        setSessions(restored);
        try {
          const active = localStorage.getItem('aiquiz-active');
          if (active && restored.some((s) => s.id === active && !s.completedAt)) {
            activeRef.current = active;
            setSessionId(active);
            setView('quiz');
          }
        } catch {}
      })
      .catch(() =>
        setError(
          'Stocarea locală nu este disponibilă. Permite accesul la datele site-ului în browser.',
        ),
      )
      .finally(() => setLoaded(true));
    fetch('/api/config')
      .then((r) => r.json())
      .then((value) => {
        setServices(value);
        setServiceLoaded(true);
      })
      .catch(() => {});
    try {
      const value = localStorage.getItem('aiquiz-theme');
      if (value) setTheme(value);
      const pref = localStorage.getItem('aiquiz-preferences');
      if (pref) setConfig({ ...defaultConfig, ...JSON.parse(pref) });
    } catch {
      /* Settings are optional; IndexedDB failures are reported above. */
    }
  }, []);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
    };
    apply();
    media.addEventListener('change', apply);
    try {
      localStorage.setItem('aiquiz-theme', theme);
    } catch {}
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  const solve = async (doc: DocumentSet, options = generateOptions, optionsOnly = false) => {
    if (running.current) return;
    running.current = true;
    resumed.current.add(doc.id);
    setBusy(true);
    setProcessingId(doc.id);
    stop.current = false;
    setError('');
    try {
      await processDocument(
        doc,
        services.batchSize,
        options,
        acceptDocument,
        () => stop.current,
        services.requestIntervalMs,
        services.providers,
        () => quizPriority(sessionsRef.current.find((s) => s.id === activeRef.current)),
        optionsOnly,
      );
    } catch {
      setError('Progresul nu a putut fi salvat. Eliberează spațiu în browser și reîncearcă.');
    } finally {
      setBusy(false);
      setProcessingId('');
      running.current = false;
    }
  };
  const analyze = async (doc: DocumentSet) => {
    setBusy(true);
    stop.current = false;
    setError('');
    try {
      await analyzeStructure(
        doc,
        (changed) => setDocuments((old) => old.map((d) => (d.id === changed.id ? changed : d))),
        () => stop.current,
      );
    } catch {
      setError('Analiza nu a putut fi salvată.');
    } finally {
      setBusy(false);
    }
  };
  const upload = async (file?: File) => {
    if (!file || busy) return;
    setBusy(true);
    setError('');
    setProgress({ stage: 'Validare document', completed: 0, total: 1 });
    try {
      const { extractFile } = await import('@/lib/extract');
      const extractionStarted = performance.now();
      const extracted = await extractFile(file, setProgress);
      const id = uid();
      const detected = detectQuestions(extracted.lines, id, file.name);
      const doc: DocumentSet = {
        id,
        name: file.name,
        createdAt: new Date().toISOString(),
        ...detected,
        lines: extracted.lines,
        pages: extracted.pages,
        status: 'extracted',
        extractionMs: Math.round(performance.now() - extractionStarted),
      };
      await updateDocument(doc);
      setSelected([id]);
      if (!doc.questions.length)
        setError(
          'Nu au fost detectate întrebări românești. Verifică structura documentului; textul extras a fost păstrat.',
        );
      else if (services.ai) await solve(doc);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Documentul nu a putut fi procesat. Încearcă un alt fișier.',
      );
    } finally {
      setBusy(false);
      setProgress(null);
      if (input.current) input.current.value = '';
    }
  };
  const start = async (questions: Question[], cfg = defaultConfig) => {
    try {
      const session = createQuiz(
        questions,
        cfg,
        Array.from(new Set(questions.map((q) => q.source))).join(', '),
        services.ai && questions.some((q) => !ready(q)),
      );
      await updateSession(session);
      activeRef.current = session.id;
      setSessionId(session.id);
      try {
        localStorage.setItem('aiquiz-active', session.id);
      } catch {}
      setView('quiz');
      setConfigQuestions(null);
      setError('');
      try {
        localStorage.setItem('aiquiz-preferences', JSON.stringify(cfg));
      } catch {}
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Quiz-ul nu a putut fi salvat.');
    }
  };
  const activeSession = sessions.find((s) => s.id === sessionId);
  const solveRef = useRef(solve);
  useEffect(() => {
    solveRef.current = solve;
  });
  useEffect(() => {
    if (!loaded || !serviceLoaded || !services.ai || busy || running.current) return;
    const pendingIds = new Set(
      activeSession?.progressive && !activeSession.completedAt
        ? activeSession.questions.filter((q) => !ready(q) && !q.solveError).map((q) => q.documentId)
        : [],
    );
    const pending = documents.find(
      (d) =>
        !resumed.current.has(d.id) &&
        (d.status === 'processing' || pendingIds.has(d.id)) &&
        d.questions.some((q) => needsAnalysis(q) && !q.solveError),
    );
    if (pending) void solveRef.current(pending);
  }, [loaded, serviceLoaded, services.ai, busy, documents, activeSession]);
  const openSession = (id: string) => {
    activeRef.current = id;
    setSessionId(id);
    setView('quiz');
    try {
      localStorage.setItem('aiquiz-active', id);
    } catch {}
  };
  const exitQuiz = () => {
    setView('documents');
    activeRef.current = '';
    try {
      localStorage.removeItem('aiquiz-active');
    } catch {}
  };
  const review = documents.find((d) => d.id === reviewId);
  const available = combineQuestions(
    documents
      .filter((d) => selected.includes(d.id))
      .flatMap((d) => d.questions)
      .filter((q) => (services.ai ? q.language !== 'foreign' : ready(q))),
  );
  const unfinished = sessions.find((s) => !s.completedAt);
  const totalQuestions = documents.reduce(
    (sum, d) => sum + d.questions.filter((q) => q.language !== 'foreign').length,
    0,
  );
  const totalReady = documents.reduce((sum, d) => sum + d.questions.filter(ready).length, 0);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="AIQuiz acasă">
          <span className="brand-mark">
            <BookOpen size={24} />
          </span>
          AI<span>Quiz</span>
        </Link>
        <p className="nav-caption">SPAȚIUL TĂU DE ÎNVĂȚARE</p>
        <nav>
          <button
            className={view !== 'history' ? 'active' : ''}
            onClick={() => setView('documents')}
          >
            <FolderOpen size={20} /> Documente <span>{documents.length}</span>
          </button>
          <button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}>
            <History size={20} /> Istoric quiz-uri
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <ShieldCheck size={21} />
            <div>
              <b>Fără cont. Doar învățare.</b>
              <p>Documentele și progresul sunt salvate în acest browser.</p>
            </div>
          </div>
          <div className="theme-control" aria-label="Tema interfeței">
            {[
              { id: 'light', label: 'Luminoasă', icon: Sun },
              { id: 'dark', label: 'Întunecată', icon: Moon },
              { id: 'system', label: 'Sistem', icon: Monitor },
            ].map((t) => (
              <button
                key={t.id}
                title={t.label}
                aria-label={t.label}
                className={theme === t.id ? 'chosen' : ''}
                onClick={() => setTheme(t.id)}
              >
                <t.icon size={17} />
              </button>
            ))}
            <span>Aspect</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            <span>Biblioteca ta</span>
            <ChevronRight size={14} />
            <b>
              {view === 'history'
                ? 'Istoric'
                : view === 'quiz'
                  ? 'Quiz'
                  : view === 'review'
                    ? 'Întrebări'
                    : 'Documente'}
            </b>
          </div>
          <select
            className="mobile-theme"
            aria-label="Aspect mobil"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          >
            <option value="system">Sistem</option>
            <option value="light">Luminos</option>
            <option value="dark">Întunecat</option>
          </select>
          <span className="privacy-label">
            <ShieldCheck size={15} /> Progres salvat local
          </span>
        </header>
        <main>
          {error && (
            <div className="error global-error" role="alert">
              {error}
              <button
                className="icon-button"
                aria-label="Închide mesajul"
                onClick={() => setError('')}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!loaded ? (
            <div className="empty">Se încarcă biblioteca locală…</div>
          ) : view === 'quiz' && activeSession ? (
            <QuizPlayer
              key={activeSession.id}
              session={activeSession}
              onChange={updateSession}
              onExit={exitQuiz}
              preparation={documents.filter((d) =>
                activeSession.questions.some((q) => q.documentId === d.id),
              )}
              onContinue={() => {
                const doc = documents.find((d) =>
                  activeSession.questions.some((q) => q.documentId === d.id && !ready(q)),
                );
                if (doc && !running.current) void solve(doc);
              }}
              onRetry={(qs) => start(qs)}
            />
          ) : view === 'review' && review ? (
            <QuestionReview
              doc={review}
              onChange={updateDocument}
              onBack={() => setView('documents')}
              onQuiz={() => setConfigQuestions(review.questions)}
              onBulk={() => solve({ ...review, processing: undefined }, true, true)}
              processing={Boolean(processingId)}
            />
          ) : view === 'history' ? (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">ÎNVAȚĂ. EXERSEAZĂ. PROGRESEAZĂ.</p>
                  <h1>Istoric quiz-uri</h1>
                  <p>Fiecare sesiune, un pas înainte.</p>
                </div>
              </div>
              {!sessions.length ? (
                <div className="empty">
                  <History size={34} />
                  <h3>Primul tău quiz te așteaptă</h3>
                  <p>Încarcă un document și începe să exersezi.</p>
                  <button onClick={() => setView('documents')}>Vezi documentele</button>
                </div>
              ) : (
                <div className="question-list">
                  {sessions.map((s) => (
                    <article className="history-row" key={s.id}>
                      <div className="file-icon">
                        <BookOpen />
                      </div>
                      <div>
                        <h3>{s.title}</h3>
                        <p>
                          {new Date(s.startedAt).toLocaleDateString('ro-RO')} · {s.questions.length}{' '}
                          întrebări · {s.config.mode === 'exam' ? 'Examen' : 'Practică'}
                        </p>
                      </div>
                      <b>{s.completedAt ? `${results(s).percent}%` : 'În progres'}</b>
                      <button
                        onClick={() => {
                          openSession(s.id);
                        }}
                      >
                        {s.completedAt ? 'Rezultate' : 'Continuă'}
                        <ArrowRight size={16} />
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">MAI PUȚINĂ PREGĂTIRE. MAI MULTĂ ÎNVĂȚARE.</p>
                  <h1>
                    Documentele tale.
                    <br />
                    <span>Următorul tău quiz.</span>
                  </h1>
                  <p>Transformă documentele în quiz-uri interactive, în limba română.</p>
                </div>
                <div className="heading-label">
                  <Sparkles size={17} /> Învățare asistată de AI
                </div>
              </div>
              <div className="stats-grid">
                <div className="stat">
                  <span className="stat-icon">
                    <FolderOpen size={21} />
                  </span>
                  <div>
                    <b>{documents.length.toString().padStart(2, '0')}</b>
                    <span>Documente în bibliotecă</span>
                  </div>
                </div>
                <div className="stat">
                  <span className="stat-icon">
                    <Layers size={21} />
                  </span>
                  <div>
                    <b>{totalQuestions}</b>
                    <span>Întrebări extrase</span>
                  </div>
                </div>
                <div className="stat">
                  <span className="stat-icon">
                    <Check size={21} />
                  </span>
                  <div>
                    <b>{totalReady}</b>
                    <span>Pregătite pentru quiz</span>
                  </div>
                </div>
              </div>
              {unfinished && (
                <section className="resume-banner">
                  <div className="resume-icon">
                    <BookOpen size={23} />
                  </div>
                  <div>
                    <b>Continuă de unde ai rămas</b>
                    <p>
                      {Object.values(unfinished.answers).filter((a) => a.submitted).length} /{' '}
                      {unfinished.questions.length} întrebări răspunse · {unfinished.title}
                    </p>
                  </div>
                  <button onClick={() => start(unfinished.questions, unfinished.config)}>
                    Reîncepe
                  </button>
                  <button
                    className="primary"
                    onClick={() => {
                      openSession(unfinished.id);
                    }}
                  >
                    Continuă Quiz <ArrowRight size={16} />
                  </button>
                </section>
              )}
              <section
                className={`upload-zone ${dragging ? 'dragging' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  upload(e.dataTransfer.files[0]);
                }}
              >
                <div className="upload-icon">
                  <Upload size={29} />
                </div>
                <h2>
                  {busy
                    ? processingId
                      ? 'Se rezolvă întrebările…'
                      : 'Se procesează documentul…'
                    : 'Un document. Sute de posibilități.'}
                </h2>
                <p>
                  {busy
                    ? 'Poți urmări progresul mai jos.'
                    : 'Trage documentul aici sau selectează un fișier de pe dispozitiv.'}
                </p>
                <input
                  ref={input}
                  type="file"
                  aria-label="Încarcă document PDF sau DOCX"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  hidden
                  onChange={(e) => upload(e.target.files?.[0])}
                />
                <button className="primary" disabled={busy} onClick={() => input.current?.click()}>
                  <Plus size={18} /> Selectează fișier
                </button>
                <div className="upload-meta">
                  <span>PDF</span>
                  <span>DOCX</span>
                  <i /> Maximum 30 MB · OCR gratuit pentru PDF scanat
                </div>
                {progress && !processingId && (
                  <div className="extraction-progress" role="status">
                    <div>
                      <b>{progress.stage}</b>
                      <span>
                        {progress.completed} / {progress.total}
                      </span>
                    </div>
                    <progress value={progress.completed} max={progress.total} />
                  </div>
                )}
              </section>
              <div className="processing-options">
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={generateOptions}
                    onChange={(e) => setGenerateOptions(e.target.checked)}
                    disabled={busy}
                  />{' '}
                  Generează variante pentru întrebările fără opțiuni
                </label>
                <span>
                  <ShieldCheck size={14} /> Fișierele rămân locale. Textul întrebărilor este trimis
                  serviciului AI.
                </span>
              </div>
              {!services.ai && (
                <div className="notice">
                  <Sparkles size={18} />
                  <p>
                    <b>Verificare manuală disponibilă.</b> Rezolvarea automată necesită configurarea
                    unei chei Groq, Gemini sau OpenAI în Vercel. Extrage întrebările, apoi
                    completează răspunsurile în editor.
                  </p>
                </div>
              )}
              {services.ai && (
                <p className="analysis-status">
                  Furnizor AI:{' '}
                  {services.provider === 'groq'
                    ? 'Groq'
                    : services.provider === 'gemini'
                      ? 'Google Gemini'
                      : 'OpenAI'}
                  . Limitele furnizorului se aplică; loturile sunt procesate pe rând.{' '}
                  {services.provider === 'gemini' &&
                    'Pe planul gratuit, Google poate folosi conținutul trimis pentru îmbunătățirea produselor.'}
                </p>
              )}
              <div className="section-heading library-heading">
                <div>
                  <h2>
                    Biblioteca de documente <span className="count">{documents.length}</span>
                  </h2>
                  <p>Revizuiește întrebările sau începe un quiz din documentele salvate.</p>
                </div>
                {selected.length > 0 && (
                  <button
                    className="primary"
                    disabled={!available.length}
                    onClick={() => setConfigQuestions(available)}
                  >
                    Generează Quiz · {available.length}
                    <ArrowRight size={16} />
                  </button>
                )}
              </div>
              {!documents.length ? (
                <div className="empty">
                  <FileText size={31} />
                  <h3>Un loc pentru tot ce înveți</h3>
                  <p>Documentele încărcate vor apărea aici, pregătite pentru următoarea sesiune.</p>
                </div>
              ) : (
                <div className="documents">
                  {documents.map((doc) => {
                    const solved = doc.questions.filter(
                      (q) => q.solved || !needsAnalysis(q) || q.solveError,
                    ).length;
                    const accepted = doc.questions.filter(ready).length;
                    return (
                      <article className="document-card" key={doc.id}>
                        <div className="document-main">
                          <input
                            type="checkbox"
                            aria-label={`Selectează ${doc.name}`}
                            checked={selected.includes(doc.id)}
                            disabled={busy}
                            onChange={(e) =>
                              setSelected((old) =>
                                e.target.checked
                                  ? [...old, doc.id]
                                  : old.filter((id) => id !== doc.id),
                              )
                            }
                          />
                          <div
                            className={`file-icon ${doc.name.toLowerCase().endsWith('.docx') ? 'word' : ''}`}
                          >
                            <FileText size={25} />
                            <small>{doc.name.split('.').pop()?.toUpperCase()}</small>
                          </div>
                          <div className="document-info">
                            <h3>{doc.name}</h3>
                            <p>
                              {doc.questions.filter((q) => q.language !== 'foreign').length}{' '}
                              întrebări · {doc.pages} pagini ·{' '}
                              {new Date(doc.createdAt).toLocaleDateString('ro-RO')}
                            </p>
                            <div className="document-badges">
                              <span className="badge green">{accepted} pregătite</span>
                              {doc.questions.length - accepted > 0 && (
                                <span className="badge amber">
                                  {doc.questions.length - accepted} de verificat
                                </span>
                              )}
                              {doc.rejected + doc.duplicates > 0 && (
                                <span className="muted">
                                  {doc.rejected} străine · {doc.duplicates} duplicate eliminate
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            className="icon-button"
                            disabled={busy}
                            title="Șterge documentul"
                            aria-label={`Șterge ${doc.name}`}
                            onClick={async () => {
                              if (
                                window.confirm(
                                  'Ștergi documentul și întrebările sale din acest browser? Quiz-urile salvate rămân disponibile.',
                                )
                              ) {
                                try {
                                  await deleteDocument(doc.id);
                                  setDocuments((old) => old.filter((d) => d.id !== doc.id));
                                  setSelected((old) => old.filter((id) => id !== doc.id));
                                } catch {
                                  setError('Documentul nu a putut fi șters.');
                                }
                              }
                            }}
                          >
                            <X size={17} />
                          </button>
                        </div>
                        {(doc.processing ||
                          processingId === doc.id ||
                          doc.status === 'partial' ||
                          doc.status === 'processing') && (
                          <div className="batch-progress" role="status">
                            <div>
                              <span>
                                Pregătire AI · {accepted} / {doc.questions.length} pregătite
                              </span>
                              <b>
                                {solved} / {doc.questions.length}
                              </b>
                            </div>
                            <progress value={solved} max={Math.max(1, doc.questions.length)} />
                            {doc.processing && (
                              <p className="analysis-status">
                                {Math.round((solved / Math.max(1, doc.questions.length)) * 100)}%
                                încercate · AI: {doc.processing.provider} · Lot curent:{' '}
                                {doc.processing.batchSize} întrebări
                                <br />
                                Timp scurs: {Math.floor(doc.processing.elapsedMs / 60000)}:
                                {String(Math.floor(doc.processing.elapsedMs / 1000) % 60).padStart(
                                  2,
                                  '0',
                                )}
                                {' · '}Timp estimat rămas:{' '}
                                {doc.processing.workDone > 0
                                  ? `~${Math.ceil(((doc.questions.length - solved) * doc.processing.elapsedMs) / doc.processing.workDone / 60000)} min`
                                  : 'se calculează după primul lot'}
                                {doc.processing.failed > 0 &&
                                  ` · ${doc.processing.failed} nereușite, de verificat manual`}
                              </p>
                            )}
                            {processingId === doc.id && (
                              <button
                                className="text-button"
                                onClick={() => {
                                  stop.current = true;
                                }}
                              >
                                Oprește după lotul curent
                              </button>
                            )}
                          </div>
                        )}
                        {accepted === 0 && processingId !== doc.id && (
                          <p className="analysis-status">
                            Quiz-ul devine disponibil după verificarea răspunsurilor. Reîncearcă
                            loturile după remedierea erorii sau folosește „Vezi întrebările” pentru
                            a completa și verifica răspunsurile manual. Nu trebuie să încarci din
                            nou fișierul.
                          </p>
                        )}
                        {doc.analysisCursor !== undefined && (
                          <p className="analysis-status">
                            Analiză structură: {doc.analysisCursor} / {doc.lines.length} linii{' '}
                            {doc.analysisComplete
                              ? '· Finalizată'
                              : '· Poți continua de unde ai rămas'}
                          </p>
                        )}
                        {busy && !processingId && !progress && (
                          <button
                            className="text-button"
                            onClick={() => {
                              stop.current = true;
                            }}
                          >
                            Oprește analiza după lotul curent
                          </button>
                        )}
                        {doc.error && <p className="error">{doc.error}</p>}
                        <div className="document-footer">
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => {
                              setReviewId(doc.id);
                              setView('review');
                            }}
                          >
                            Vezi întrebările <ChevronRight size={15} />
                          </button>
                          <div className="button-row">
                            {!doc.analysisComplete && (
                              <button disabled={busy || !services.ai} onClick={() => analyze(doc)}>
                                Caută întrebări suplimentare
                              </button>
                            )}
                            {doc.questions.some(needsAnalysis) && (
                              <button disabled={busy || !services.ai} onClick={() => solve(doc)}>
                                <Sparkles size={15} />{' '}
                                {doc.status === 'partial' || doc.status === 'processing'
                                  ? 'Reîncearcă loturile rămase'
                                  : 'Rezolvă cu AI'}
                              </button>
                            )}
                            <button
                              disabled={
                                accepted <
                                  Math.min(
                                    20,
                                    doc.questions.filter((q) => q.language !== 'foreign').length,
                                  ) || !accepted
                              }
                              onClick={() => start(doc.questions)}
                            >
                              <Zap size={16} /> Quiz Rapid
                            </button>
                            <button
                              disabled={services.ai ? !doc.questions.length : !accepted}
                              onClick={() => setConfigQuestions(doc.questions)}
                            >
                              Generează Quiz <ArrowRight size={15} />
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
              <footer className="page-footer">
                <span>AIQuiz · Învață în ritmul tău.</span>
                <span>Română · Fără cont · Progres local</span>
              </footer>
            </>
          )}
        </main>
      </div>
      {configQuestions && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-label="Generează Quiz">
            <div className="section-heading">
              <h2>Generează Quiz</h2>
              <button
                className="icon-button"
                aria-label="Închide configurarea"
                onClick={() => setConfigQuestions(null)}
              >
                <X />
              </button>
            </div>
            <p>
              {combineQuestions(configQuestions.filter((q) => q.language !== 'foreign')).length}{' '}
              întrebări extrase · {configQuestions.filter(ready).length} pregătite. Quiz-ul rezervă
              toate întrebările selectate; AI continuă în fundal.
            </p>
            <label>
              Număr întrebări
              <select
                value={config.count}
                onChange={(e) => setConfig({ ...config, count: Number(e.target.value) })}
              >
                {[10, 20, 50, 100].map((n) => (
                  <option value={n} key={n}>
                    {n}
                  </option>
                ))}
                <option value={0}>Toate</option>
              </select>
            </label>
            <label>
              Mod
              <select
                value={config.mode}
                onChange={(e) =>
                  setConfig({ ...config, mode: e.target.value as QuizConfig['mode'] })
                }
              >
                <option value="practice">Practică — feedback după răspuns</option>
                <option value="exam">Examen — rezultate la final</option>
              </select>
            </label>
            <fieldset>
              <legend>Tipuri de întrebări</legend>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={config.includeMC}
                  onChange={(e) => setConfig({ ...config, includeMC: e.target.checked })}
                />{' '}
                Variante de răspuns
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={config.includeOpen}
                  onChange={(e) => setConfig({ ...config, includeOpen: e.target.checked })}
                />{' '}
                Răspuns manual
              </label>
            </fieldset>
            <label className="check-label">
              <input
                type="checkbox"
                checked={config.shuffleQuestions}
                onChange={(e) => setConfig({ ...config, shuffleQuestions: e.target.checked })}
              />{' '}
              Amestecă întrebările
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={config.shuffleOptions}
                onChange={(e) => setConfig({ ...config, shuffleOptions: e.target.checked })}
              />{' '}
              Amestecă variantele
            </label>
            <button
              className="primary full-width"
              disabled={!config.includeMC && !config.includeOpen}
              onClick={() => start(configQuestions, config)}
            >
              Începe Quiz <ArrowRight size={17} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
