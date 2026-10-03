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
import { createQuiz, hydrateQuiz, quizCandidate, quizPriority, results } from '@/lib/quiz';
import { processDocument, analyzeStructure } from '@/lib/processing';
import StudyConfiguration from './StudyConfiguration';
import { studyReady, studyAnalysis, type StudyConfig } from '@/lib/study';
import { prepareStudy, processStudy } from '@/lib/study-processing';
import { extractUploadedDocument, scanJobs, continueScan, cancelScan } from '@/lib/scan-client';
import type { ScanJob } from '@/lib/scan-storage';
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

export default function Workspace({
  accountId,
  onRequireAccount,
}: {
  accountId: string;
  onRequireAccount?: () => void;
}) {
  const [scans, setScans] = useState<ScanJob[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [studyDraft, setStudyDraft] = useState<DocumentSet | null>(null);
  const [documents, setDocuments] = useState<DocumentSet[]>([]);
  const [sessions, setSessions] = useState<QuizSession[]>([]);
  const [view, setView] = useState<'documents' | 'history' | 'review' | 'quiz'>('documents');
  const [selected, setSelected] = useState<string[]>([]);
  const [reviewId, setReviewId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [loaded, setLoaded] = useState(!accountId);
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
    batchSize: 50,
    minReady: 20,
    providers: [] as SolverProfile[],
    provider: 'openai',
    requestIntervalMs: 2000,
  });
  const [theme, setTheme] = useState('system');
  const [generateOptions, setGenerateOptions] = useState(true);
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
    session = {
      ...hydrateQuiz(session, latest?.questions || []),
      updatedAt: new Date().toISOString(),
      status: session.completedAt ? 'completed' : 'in_progress',
    };
    const next = sessionsRef.current.some((s) => s.id === session.id)
      ? sessionsRef.current.map((s) => (s.id === session.id ? session : s))
      : [session, ...sessionsRef.current];
    sessionsRef.current = next;
    setSessions(next);
    await putSession(session);
  };
  useEffect(() => {
    if (accountId)
      Promise.all([getDocuments(), getSessions()])
        .then(([docs, quizzes]) => {
          setDocuments(docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
          const restored = quizzes
            .sort((a, b) => (b.updatedAt || b.startedAt).localeCompare(a.updatedAt || a.startedAt))
            .map((s) =>
              hydrateQuiz(
                s,
                docs.flatMap((d) => d.questions),
              ),
            );
          sessionsRef.current = restored;
          setSessions(restored);
          try {
            const active = localStorage.getItem(`aiquiz-active-${accountId}`);
            if (active && restored.some((s) => s.id === active && !s.completedAt)) {
              activeRef.current = active;
              setSessionId(active);
              setView('quiz');
            }
          } catch {}
        })
        .catch(() =>
          setError(
            'Datele contului nu au putut fi încărcate. Verifică conexiunea și reîncarcă pagina.',
          ),
        )
        .finally(() => setLoaded(true));
    if (accountId)
      void scanJobs()
        .then((result) => setScans(result.jobs))
        .catch(() => {});
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
  }, [accountId]);
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
      if (doc.study) await processStudy(doc, acceptDocument, () => stop.current);
      else
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
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Progresul nu a putut fi salvat în cont. Reîncearcă.',
      );
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
  const upload = async (file?: File, mode?: 'questions' | 'study') => {
    if (!accountId) {
      onRequireAccount?.();
      return;
    }
    if (!file || busy) return;
    if (!mode) {
      setPendingFile(file);
      return;
    }
    setPendingFile(null);
    setBusy(true);
    setError('');
    setProgress({ stage: 'Validare document', completed: 0, total: 1 });
    try {
      // eslint-disable-next-line react-hooks/purity -- Measurement inside the upload event handler.
      const extractionStarted = performance.now();
      const extracted = await extractUploadedDocument(file, setProgress, {
        studyMaterial: mode === 'study',
      });
      const id = extracted.extractionJob || uid();
      const detected = detectQuestions(extracted.lines, id, file.name);
      const doc: DocumentSet = {
        id,
        name: file.name,
        createdAt: new Date().toISOString(),
        ...detected,
        extractionJob: extracted.extractionJob,
        lines: extracted.lines,
        pages: extracted.pages,
        status: 'extracted',
        // eslint-disable-next-line react-hooks/purity -- Event handler completion time.
        extractionMs: Math.round(performance.now() - extractionStarted),
      };
      if (mode === 'study') {
        setStudyDraft({ ...doc, questions: [], rejected: 0, duplicates: 0 });
        return;
      }
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
      void scanJobs()
        .then((result) => setScans(result.jobs))
        .catch(() => {});
    }
  };
  const resumeScan = async (job: ScanJob) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      // eslint-disable-next-line react-hooks/purity -- Measurement inside the resume event handler.
      const started = performance.now();
      const extracted = await continueScan(job, setProgress);
      const detected = detectQuestions(extracted.lines, job.id, job.name);
      const doc: DocumentSet = {
        id: job.id,
        name: job.name,
        createdAt: new Date().toISOString(),
        ...detected,
        ...extracted,
        status: 'extracted',
        // eslint-disable-next-line react-hooks/purity -- Event handler completion time.
        extractionMs: Math.round(performance.now() - started),
      };
      if (job.study) setStudyDraft({ ...doc, questions: [], rejected: 0, duplicates: 0 });
      else {
        await updateDocument(doc);
        setSelected([doc.id]);
        if (services.ai && doc.questions.length) await solve(doc);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scanarea nu a putut continua.');
    } finally {
      setBusy(false);
      setProgress(null);
      void scanJobs()
        .then((result) => setScans(result.jobs))
        .catch(() => {});
    }
  };
  const removeScan = async (job: ScanJob) => {
    if (busy) return;
    setBusy(true);
    try {
      await cancelScan(job.id);
      setScans((old) => old.filter((j) => j.id !== job.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scanarea nu a putut fi eliminată.');
    } finally {
      setBusy(false);
    }
  };
  const rescanStudy = async (doc: DocumentSet, file?: File) => {
    if (!file || !doc.study || busy) return;
    if (file.name !== doc.name) {
      setError('Selectează același fișier pentru a păstra întrebările și progresul.');
      return;
    }
    const old = studyAnalysis(doc.lines, undefined, doc.study.analysisVersion || 1);
    if (!old.sections.every((s) => doc.study!.config.sections.includes(s.id))) {
      setError(
        'Rescanarea completă este disponibilă pentru documentele cu toate secțiunile selectate. Poți continua analiza selecției existente.',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      const extracted = await extractUploadedDocument(file, setProgress, { studyMaterial: true });
      const analysis = studyAnalysis(extracted.lines);
      const config = { ...doc.study.config, sections: analysis.sections.map((s) => s.id) };
      const updated = prepareStudy({ ...doc, ...extracted }, config);
      updated.questions = doc.questions.map((q) => ({
        ...q,
        sourceUnitId: q.sourceQuote
          ? analysis.units.find((u) => u.page === q.page && u.text.includes(q.sourceQuote!))?.id
          : undefined,
      }));
      await updateDocument(updated);
      setProgress(null);
      await solve(updated);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Rescanarea nu a reușit. Documentul salvat este păstrat.',
      );
    } finally {
      setProgress(null);
      setBusy(false);
    }
  };
  const beginStudy = async (config: StudyConfig) => {
    if (!studyDraft) return;
    try {
      const doc = prepareStudy(studyDraft, config);
      setBusy(true);
      await updateDocument(doc);
      setStudyDraft(null);
      setSelected([doc.id]);
      await solve(doc);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generarea nu a putut începe.');
    } finally {
      setBusy(false);
    }
  };
  const start = async (questions: Question[], cfg = defaultConfig) => {
    try {
      const latest = new Map(documents.flatMap((d) => d.questions).map((q) => [q.id, q]));
      questions = questions.map((q) => (ready(q) ? q : latest.get(q.id) || q));
      if (questions.some((q) => q.generationMode === 'study' && !ready(q)))
        cfg = { ...cfg, includeMC: true, includeOpen: true };
      const session = createQuiz(
        questions,
        cfg,
        Array.from(new Set(questions.map((q) => q.source))).join(', '),
        services.ai && questions.some((q) => !ready(q)),
        services.minReady || 20,
      );
      session.studySources = documents
        .filter((d) => d.study && questions.some((q) => q.documentId === d.id))
        .map((d) => ({ documentId: d.id, name: d.name, config: d.study!.config }));
      await updateSession(session);
      activeRef.current = session.id;
      setSessionId(session.id);
      try {
        localStorage.setItem(`aiquiz-active-${accountId}`, session.id);
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
      activeSession && !activeSession.completedAt
        ? activeSession.questions.filter((q) => !ready(q) && !q.solveError).map((q) => q.documentId)
        : [],
    );
    const pending = documents.find(
      (d) =>
        !resumed.current.has(d.id) &&
        (!d.study || !d.study.complete) &&
        (d.status === 'extracted' ||
          d.status === 'processing' ||
          pendingIds.has(d.id) ||
          d.questions.some((q) => q.rawSourceText && q.status === 'parsing')) &&
        d.questions.some((q) => needsAnalysis(q) && !q.solveError),
    );
    if (pending && (!pending.study || !pending.study.complete)) void solveRef.current(pending);
  }, [loaded, serviceLoaded, services.ai, busy, documents, activeSession]);
  const openSession = (id: string) => {
    activeRef.current = id;
    setSessionId(id);
    setView('quiz');
    try {
      localStorage.setItem(`aiquiz-active-${accountId}`, id);
    } catch {}
  };
  const exitQuiz = () => {
    setView('documents');
    activeRef.current = '';
    try {
      localStorage.removeItem(`aiquiz-active-${accountId}`);
    } catch {}
  };
  const review = documents.find((d) => d.id === reviewId);
  const reservingStudy = Boolean(
    configQuestions?.some((q) => q.generationMode === 'study' && !ready(q)),
  );
  const available = combineQuestions(
    documents
      .filter((d) => selected.includes(d.id) && studyReady(d))
      .flatMap((d) => d.questions)
      .filter((q) => (services.ai ? quizCandidate(q) : ready(q))),
  );

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
              <b>{accountId ? 'Contul tău de învățare.' : 'Spațiul tău de învățare.'}</b>
              <p>
                {accountId
                  ? 'Documentele și progresul sunt salvate în contul tău.'
                  : 'Creează un cont pentru a încărca documente și a salva progresul.'}
              </p>
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
            <div className="empty">Se încarcă biblioteca ta…</div>
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
              onQuiz={() => setConfigQuestions(review.questions.filter(quizCandidate))}
              onBulk={
                review.study
                  ? undefined
                  : () => solve({ ...review, processing: undefined }, true, true)
              }
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
                  {[...sessions]
                    .sort((a, b) =>
                      (b.updatedAt || b.startedAt).localeCompare(a.updatedAt || a.startedAt),
                    )
                    .map((s) => (
                      <article className="history-row" key={s.id}>
                        <div className="file-icon">
                          <BookOpen />
                        </div>
                        <div>
                          <h3>{s.title}</h3>
                          <p>
                            {new Date(s.updatedAt || s.startedAt).toLocaleString('ro-RO')} ·{' '}
                            {s.questions.length} întrebări ·{' '}
                            {s.config.mode === 'exam' ? 'Examen' : 'Practică'}
                            {s.studySources?.length
                              ? ` · Material de studiu · ${s.studySources.reduce((n, d) => n + d.config.count, 0)} solicitate`
                              : ''}
                          </p>
                        </div>
                        <p>
                          {Object.values(s.answers).filter((a) => a.submitted).length} /{' '}
                          {s.questions.length} răspunse
                        </p>
                        <b>{s.completedAt ? `Finalizat · ${results(s).percent}%` : 'În progres'}</b>
                        <button
                          onClick={() => {
                            openSession(s.id);
                          }}
                        >
                          {s.completedAt ? 'Rezultate' : 'Continuă Quiz'}
                          <ArrowRight size={16} />
                        </button>
                        {!s.completedAt && (
                          <button
                            onClick={async () => {
                              if (
                                !window.confirm(
                                  'Sigur dorești să reîncepi acest quiz? Progresul actual va fi resetat.',
                                )
                              )
                                return;
                              await updateSession({
                                ...s,
                                answers: {},
                                current: 0,
                                flagged: [],
                                skipped: [],
                                startedAt: new Date().toISOString(),
                              });
                              openSession(s.id);
                            }}
                          >
                            Reîncepe
                          </button>
                        )}
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
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => (accountId ? input.current?.click() : onRequireAccount?.())}
                >
                  <Plus size={18} /> Selectează fișier
                </button>
                <div className="upload-meta">
                  <span>PDF</span>
                  <span>DOCX</span>
                  <i /> Maximum 50 MB · PDF și DOCX
                </div>
                {scans
                  .filter(
                    (job) =>
                      !documents.some((d) => d.extractionJob === job.id) &&
                      studyDraft?.extractionJob !== job.id,
                  )
                  .map((job) => (
                    <div className="extraction-progress" key={job.id}>
                      <div>
                        <b>{job.name}</b>
                        <span>
                          {job.status === 'complete'
                            ? 'Scanare finalizată'
                            : `${Math.max(0, job.next_page - 1)} / ${job.pages || '…'} pagini`}
                        </span>
                      </div>
                      <p>
                        Progresul este salvat în cont. Poți continua fără să scanezi din nou
                        paginile finalizate.
                      </p>
                      <div className="document-actions">
                        <button disabled={busy} onClick={() => void resumeScan(job)}>
                          Continuă scanarea
                        </button>
                        <button disabled={busy} onClick={() => void removeScan(job)}>
                          Elimină scanarea
                        </button>
                      </div>
                    </div>
                  ))}
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
                  <ShieldCheck size={14} /> Documentele sunt procesate securizat în cont.
                  Fragmentele necesare sunt trimise serviciului AI.
                </span>
              </div>
              {!services.ai && (
                <div className="notice">
                  <Sparkles size={18} />
                  <p>
                    <b>Verificare manuală disponibilă.</b> Rezolvarea automată necesită configurarea
                    unei chei OpenAI în Vercel. Extrage întrebările, apoi completează răspunsurile
                    în editor.
                  </p>
                </div>
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
                    const accepted = doc.questions.filter(ready).length;
                    const imageQuestions = doc.questions.filter(
                      (q) => q.requiresImage && q.language !== 'foreign',
                    ).length;
                    const foreignQuestions = doc.questions.filter(
                      (q) => q.language === 'foreign',
                    ).length;
                    const reviewQuestions = doc.study
                      ? 0
                      : doc.questions.length - accepted - imageQuestions - foreignQuestions;
                    const eligible = doc.questions.filter(
                      (q) => !q.requiresImage && q.language !== 'foreign',
                    );
                    const completed = eligible.filter(
                      (q) => ready(q) || q.solveError || q.status === 'failed',
                    ).length;
                    const pending = eligible.length - completed;
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
                              {doc.study
                                ? accepted
                                : doc.questions.filter((q) => q.language !== 'foreign').length}{' '}
                              întrebări · {doc.pages} pagini ·{' '}
                              {new Date(doc.createdAt).toLocaleDateString('ro-RO')}
                            </p>
                            <div className="document-badges">
                              <span className="badge green">{accepted} pregătite</span>
                              {reviewQuestions > 0 && (
                                <span className="badge amber">{reviewQuestions} de verificat</span>
                              )}
                              {doc.rejected + foreignQuestions + doc.duplicates > 0 && (
                                <span className="muted">
                                  {doc.rejected + foreignQuestions} străine · {doc.duplicates}{' '}
                                  duplicate eliminate
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
                                  'Ștergi documentul și întrebările sale din contul tău? Quiz-urile salvate rămân disponibile.',
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
                        {doc.study && (
                          <div className="batch-progress" role="status">
                            <div>
                              <span>
                                Material de studiu ·{' '}
                                {studyReady(doc) ? 'Quiz pregătit' : 'Se pregătesc întrebările'}
                              </span>
                              <b>
                                {accepted} / {doc.study.config.count} generate
                              </b>
                            </div>
                            <progress value={accepted} max={doc.study.config.count} />
                            <p>
                              {doc.study.pagesScanned ?? doc.pages} pagini scanate integral ·{' '}
                              {doc.study.topics} secțiuni · Trecerea {doc.study.generationPass || 1}
                              /4 · {doc.study.attempted} fragmente analizate ·{' '}
                              {Math.round(doc.study.elapsedMs / 1000)} secunde de procesare
                            </p>
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
                            {doc.study.exhausted && (
                              <p>
                                Au fost validate {accepted} din {doc.study.config.count} întrebări.
                                Poți continua analiza pentru a căuta alte informații distincte;
                                întrebările deja pregătite sunt păstrate.
                              </p>
                            )}
                          </div>
                        )}
                        {doc.repairNotice && (
                          <p className="notice" role="status">
                            {doc.repairNotice}
                          </p>
                        )}
                        {imageQuestions > 0 && (
                          <p className="analysis-status">
                            {imageQuestions} întrebări depind de imagini și sunt excluse din
                            rezolvarea automată. Le găsești în „Vezi întrebările” → „Depind de
                            imagini”, împreună cu pagina sursă.
                          </p>
                        )}
                        {!doc.study &&
                          (doc.processing ||
                            processingId === doc.id ||
                            doc.status === 'partial' ||
                            doc.status === 'processing') && (
                            <div className="batch-progress" role="status">
                              <div>
                                <span>Pregătire AI · {accepted} pregătite pentru quiz</span>
                                <b>
                                  {completed} / {eligible.length} procesate
                                </b>
                              </div>
                              <progress value={completed} max={Math.max(1, eligible.length)} />
                              {doc.processing && (
                                <p className="analysis-status">
                                  {Math.round((completed / Math.max(1, eligible.length)) * 100)}%
                                  procesate · AI: {doc.processing.provider} · Lot curent:{' '}
                                  {doc.processing.batchSize} întrebări
                                  <br />
                                  Timp scurs: {Math.floor(doc.processing.elapsedMs / 60000)}:
                                  {String(
                                    Math.floor(doc.processing.elapsedMs / 1000) % 60,
                                  ).padStart(2, '0')}
                                  {' · '}Timp estimat rămas:{' '}
                                  {pending === 0
                                    ? 'finalizat'
                                    : completed > 0
                                      ? `~${Math.max(1, Math.ceil((pending * doc.processing.elapsedMs) / completed / 60000))} min`
                                      : 'se calculează după prima verificare'}
                                  {reviewQuestions > 0 &&
                                    pending === 0 &&
                                    ` · ${reviewQuestions} de verificat manual`}
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
                        {!doc.study && accepted === 0 && processingId !== doc.id && (
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
                        {doc.error && (
                          <p className={doc.retryAt ? 'notice' : 'error'} role="status">
                            {doc.error}
                          </p>
                        )}
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
                            {doc.study?.exhausted && doc.name.toLowerCase().endsWith('.pdf') && (
                              <>
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    document.getElementById(`rescan-${doc.id}`)?.click()
                                  }
                                >
                                  Rescanează PDF-ul cu OCR
                                </button>
                                <input
                                  id={`rescan-${doc.id}`}
                                  type="file"
                                  accept=".pdf,application/pdf"
                                  disabled={busy}
                                  style={{ display: 'none' }}
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    e.target.value = '';
                                    void rescanStudy(doc, file);
                                  }}
                                />
                              </>
                            )}
                            {!doc.study && !doc.analysisComplete && (
                              <button disabled={busy || !services.ai} onClick={() => analyze(doc)}>
                                Caută întrebări suplimentare
                              </button>
                            )}
                            {(doc.study
                              ? !doc.study.complete || doc.study.exhausted
                              : doc.questions.some(needsAnalysis)) && (
                              <button disabled={busy || !services.ai} onClick={() => solve(doc)}>
                                <Sparkles size={15} />{' '}
                                {doc.study?.exhausted
                                  ? 'Continuă până la numărul ales'
                                  : doc.status === 'partial' || doc.status === 'processing'
                                    ? 'Reîncearcă loturile rămase'
                                    : 'Rezolvă cu AI'}
                              </button>
                            )}
                            <button
                              disabled={
                                !studyReady(doc) ||
                                (!doc.study &&
                                  accepted <
                                    Math.min(
                                      services.minReady || 20,
                                      doc.questions.filter((q) => q.language !== 'foreign').length,
                                    )) ||
                                !accepted
                              }
                              onClick={() => start(doc.questions)}
                            >
                              <Zap size={16} /> Quiz Rapid
                            </button>
                            <button
                              disabled={
                                !studyReady(doc) ||
                                (services.ai ? !doc.questions.length : !accepted)
                              }
                              onClick={() =>
                                setConfigQuestions(doc.questions.filter(quizCandidate))
                              }
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
            </>
          )}
        </main>
      </div>
      {pendingFile && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Tipul documentului"
          >
            <div className="section-heading">
              <h2>Ce conține documentul?</h2>
              <button
                aria-label="Anulează încărcarea"
                onClick={() => {
                  setPendingFile(null);
                  if (input.current) input.current.value = '';
                  void scanJobs()
                    .then((result) => setScans(result.jobs))
                    .catch(() => {});
                }}
              >
                ×
              </button>
            </div>
            <p>{pendingFile.name}</p>
            <div className="study-mode">
              <button onClick={() => void upload(pendingFile, 'questions')}>
                Document cu întrebări existente
              </button>
              <button onClick={() => void upload(pendingFile, 'study')}>
                Document cu informații / material de studiu
              </button>
            </div>
            <p>
              Prima opțiune extrage întrebările existente. A doua creează întrebări numai din teoria
              și notițele tale.
            </p>
          </section>
        </div>
      )}
      {studyDraft && (
        <StudyConfiguration
          doc={studyDraft}
          onCancel={() => setStudyDraft(null)}
          onGenerate={(c) => void beginStudy(c)}
        />
      )}
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
              {combineQuestions(configQuestions.filter(quizCandidate)).length} întrebări extrase ·{' '}
              {configQuestions.filter(ready).length} pregătite. Quiz-ul rezervă toate întrebările
              selectate; AI continuă în fundal.
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
            <fieldset disabled={reservingStudy}>
              <legend>Tipuri de întrebări</legend>
              {reservingStudy && (
                <p>Tipurile au fost alese la generare. Întrebările noi vor fi adăugate automat.</p>
              )}
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={reservingStudy || config.includeMC}
                  onChange={(e) => setConfig({ ...config, includeMC: e.target.checked })}
                />{' '}
                Variante de răspuns
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={reservingStudy || config.includeOpen}
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
              disabled={!reservingStudy && !config.includeMC && !config.includeOpen}
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
