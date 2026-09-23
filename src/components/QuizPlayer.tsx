'use client';
import { useState } from 'react';
import { ArrowLeft, ArrowRight, Flag, Check, X, RotateCcw, Trophy } from 'lucide-react';
import { exactAnswer, results } from '@/lib/quiz';
import { ready, type Answer, type Question, type QuizSession, type DocumentSet } from '@/lib/model';
import PreparationStatus from './PreparationStatus';

export default function QuizPlayer({
  session,
  onChange,
  onExit,
  onRetry,
  preparation = [],
  onContinue,
}: {
  session: QuizSession;
  onChange: (s: QuizSession) => Promise<void>;
  onExit: () => void;
  onRetry: (q: Question[]) => void;
  preparation?: DocumentSet[];
  onContinue?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showMistakes, setShowMistakes] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const q = session.questions[session.current];
  const answer = session.answers[q.id];
  const exam = session.config.mode === 'exam';
  const answered = Object.values(session.answers).filter((a) => a.submitted).length;
  const persist = async (next: QuizSession) => {
    try {
      await onChange(next);
      setError('');
    } catch {
      setError('Progresul nu a putut fi salvat. Verifică spațiul disponibil în browser.');
    }
  };
  const submit = async () => {
    if (!ready(q) || !answer?.value.trim()) return;
    setBusy(true);
    setError('');
    const next: Answer = {
      ...answer,
      submitted: true,
      correct:
        q.type === 'multiple'
          ? [...(answer.optionIndices || [])].sort((a, b) => a - b).join(',') ===
            [...(q.correctOptionIndices || [])].sort((a, b) => a - b).join(',')
          : q.type === 'multiple_choice'
            ? answer.optionIndex === q.correctOptionIndex
            : exactAnswer(answer.value, q.correctAnswer)
              ? true
              : null,
    };
    if (q.type === 'open' && next.correct === null) {
      try {
        const response = await fetch('/api/evaluate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: q.question,
            expected: q.correctAnswer,
            answer: answer.value,
          }),
          signal: AbortSignal.timeout(65000),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        next.correct = data.confidence >= 0.8 ? data.correct : null;
        next.explanation = data.explanation;
      } catch {
        setError(
          'Evaluarea OpenAI nu este disponibilă momentan. Răspunsul tău este salvat; apasă Verifică pentru a reîncerca.',
        );
        setBusy(false);
        return;
      }
      if (next.correct === null) {
        setError('Evaluarea nu este concludentă. Reformulează răspunsul sau reîncearcă.');
        setBusy(false);
        return;
      }
    }
    await persist({ ...session, answers: { ...session.answers, [q.id]: next } });
    setBusy(false);
  };
  const choose = (value: string, optionIndex?: number) => {
    const indices =
      q.type === 'multiple' && optionIndex !== undefined
        ? answer?.optionIndices?.includes(optionIndex)
          ? answer.optionIndices.filter((i) => i !== optionIndex)
          : [...(answer?.optionIndices || []), optionIndex]
        : undefined;
    return persist({
      ...session,
      answers: {
        ...session.answers,
        [q.id]: {
          value: indices ? indices.map((i) => q.options[i]).join('; ') : value,
          optionIndex,
          optionIndices: indices,
          correct: null,
          submitted: false,
        },
      },
    });
  };
  const move = (index: number) => persist({ ...session, current: index });
  if (session.completedAt) {
    const score = results(session);
    const mistakes = session.questions.filter((item) => session.answers[item.id]?.correct !== true);
    const incorrect = session.questions.filter(
      (item) => session.answers[item.id]?.submitted && session.answers[item.id]?.correct === false,
    );
    return (
      <>
        <button className="text-button" onClick={onExit}>
          <ArrowLeft size={17} /> Documente
        </button>
        <div className="result-panel">
          <div className="trophy">
            <Trophy size={36} />
          </div>
          <p className="eyebrow">QUIZ FINALIZAT</p>
          <h1>
            {score.percent}
            <span>%</span>
          </h1>
          <p>
            {score.correct} răspunsuri corecte din {session.questions.length}
          </p>
          <div className="result-stats">
            <div>
              <b>{score.correct}</b>
              <span>Corecte</span>
            </div>
            <div>
              <b>{score.incorrect}</b>
              <span>Greșite</span>
            </div>
            <div>
              <b>{score.unanswered}</b>
              <span>Fără răspuns</span>
            </div>
            <div>
              <b>{score.pending}</b>
              <span>De verificat</span>
            </div>
          </div>
          {score.pending > 0 && (
            <p className="notice">
              Scor provizoriu: verifică manual răspunsurile neevaluate mai jos.
            </p>
          )}
          <div className="button-row centered">
            <button onClick={() => setShowMistakes(!showMistakes)}>Vezi greșelile</button>
            <button
              className="primary"
              disabled={!incorrect.length}
              onClick={() => onRetry(incorrect)}
            >
              <RotateCcw size={17} /> Reîncearcă greșelile
            </button>
            <button onClick={onExit}>Quiz nou</button>
          </div>
        </div>
        {showMistakes && (
          <div className="question-list">
            {mistakes.map((item) => {
              const a = session.answers[item.id];
              return (
                <article className="mistake" key={item.id}>
                  <span className="badge amber">
                    {a?.correct === null
                      ? 'De verificat'
                      : a?.submitted
                        ? 'Greșit'
                        : 'Fără răspuns'}
                  </span>
                  <h3>{item.question}</h3>
                  <p>
                    Răspunsul tău: <b>{a?.value || '—'}</b>
                  </p>
                  <p className="success-text">
                    Răspuns corect: <b>{item.correctAnswer}</b>
                  </p>
                  <p>{item.explanation}</p>
                  {a?.submitted && a.correct === null && (
                    <div className="button-row">
                      <span>Evaluare manuală:</span>
                      <button
                        onClick={() =>
                          persist({
                            ...session,
                            answers: { ...session.answers, [item.id]: { ...a, correct: true } },
                          })
                        }
                      >
                        Corect
                      </button>
                      <button
                        onClick={() =>
                          persist({
                            ...session,
                            answers: { ...session.answers, [item.id]: { ...a, correct: false } },
                          })
                        }
                      >
                        Greșit
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </>
    );
  }
  return (
    <>
      <div className="quiz-top">
        <button className="text-button" disabled={busy} onClick={onExit}>
          <ArrowLeft size={17} /> Salvează și ieși
        </button>
        <span className="badge green">{exam ? 'Mod examen' : 'Mod practică'}</span>
      </div>
      <div className="quiz-layout">
        <section className="quiz-main">
          <div className="section-heading">
            <span className="eyebrow">
              ÎNTREBAREA {session.current + 1} / {session.questions.length}
            </span>
            <span>{Math.round((answered / session.questions.length) * 100)}% răspunse</span>
          </div>
          <progress value={answered} max={session.questions.length} />
          {session.progressive && (
            <PreparationStatus documents={preparation} questions={session.questions} />
          )}
          {ready(q) && (!session.progressive || session.bufferStarted) ? (
            <>
              <p className="source-label">
                {q.source} · Pagina {q.page}
              </p>
              <h1 className="quiz-question">{q.question}</h1>
              {q.type === 'multiple' && <p>Selectează toate răspunsurile corecte.</p>}
              {q.type !== 'open' ? (
                <div className="answers">
                  {session.optionOrders[session.current].map((index, display) => (
                    <button
                      key={index}
                      disabled={busy || Boolean(answer?.submitted && !exam)}
                      aria-pressed={
                        q.type === 'multiple'
                          ? Boolean(answer?.optionIndices?.includes(index))
                          : answer?.optionIndex === index
                      }
                      className={`answer ${(q.type === 'multiple' ? answer?.optionIndices?.includes(index) : answer?.optionIndex === index) ? 'selected' : ''} ${!exam && answer?.submitted && (q.type === 'multiple' ? q.correctOptionIndices?.includes(index) : index === q.correctOptionIndex) ? 'correct' : ''}`}
                      onClick={() => choose(q.options[index], index)}
                    >
                      <span>{String.fromCharCode(65 + display)}</span>
                      {q.options[index]}
                    </button>
                  ))}
                </div>
              ) : (
                <label>
                  Răspunsul tău
                  <textarea
                    aria-label="Răspunsul tău"
                    rows={4}
                    value={answer?.value || ''}
                    disabled={busy || Boolean(answer?.submitted && !exam)}
                    onChange={(e) => choose(e.target.value)}
                  />
                </label>
              )}
              {answer?.submitted && !exam && (
                <div
                  className={`feedback ${answer.correct ? 'positive' : 'negative'}`}
                  role="status"
                >
                  <b>
                    {answer.correct === null ? (
                      'Evaluare în curs'
                    ) : answer.correct ? (
                      <>
                        <Check size={18} /> Corect!
                      </>
                    ) : (
                      <>
                        <X size={18} /> Greșit
                      </>
                    )}
                  </b>
                  <p>Răspuns corect: {q.correctAnswer}</p>
                  <p>{answer.explanation || q.explanation}</p>
                  {answer.correct === null && (
                    <div className="button-row">
                      <button
                        onClick={() =>
                          persist({
                            ...session,
                            answers: { ...session.answers, [q.id]: { ...answer, correct: true } },
                          })
                        }
                      >
                        Răspunsul meu este corect
                      </button>
                      <button
                        onClick={() =>
                          persist({
                            ...session,
                            answers: { ...session.answers, [q.id]: { ...answer, correct: false } },
                          })
                        }
                      >
                        Răspunsul meu este greșit
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="empty" role="status">
              <h2>
                {q.requiresImage
                  ? 'Întrebarea necesită imaginea sursă'
                  : 'Se pregătesc următoarele întrebări...'}
              </h2>
              {q.requiresImage && (
                <p>
                  Consultă pagina {q.page} din document. Această întrebare nu poate fi rezolvată
                  automat fără diagramă. Poți trece la următoarea întrebare.
                </p>
              )}
              <p>
                {preparation
                  .filter((d) => d.status === 'processing')
                  .reduce((n, d) => n + (d.processing?.batchSize || 0), 0)}{' '}
                întrebări sunt în curs de pregătire.
              </p>
              {!session.bufferStarted && (
                <p>
                  Pregătim bufferul inițial de{' '}
                  {Math.min(session.minReady || 20, session.questions.length)} întrebări.
                </p>
              )}
              {(q.solveError || (q.solved && !ready(q))) && (
                <p>
                  Întrebarea nu a trecut validarea automată și este exclusă din test. Poți continua
                  la alta.
                </p>
              )}
              {!q.requiresImage && preparation.every((d) => d.status !== 'processing') && (
                <button onClick={onContinue}>Continuă pregătirea AI</button>
              )}
            </div>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="quiz-actions">
            <button
              disabled={busy || session.current === 0}
              onClick={() => move(session.current - 1)}
            >
              <ArrowLeft size={17} /> Înapoi
            </button>
            {ready(q) && (!session.progressive || session.bufferStarted) && !answer?.submitted && (
              <button className="primary" disabled={busy || !answer?.value.trim()} onClick={submit}>
                {busy ? 'Se verifică…' : exam ? 'Salvează răspunsul' : 'Verifică'}
              </button>
            )}
            {session.current < session.questions.length - 1 ? (
              <button
                disabled={busy}
                onClick={() => {
                  if (!answer?.submitted)
                    persist({
                      ...session,
                      skipped: Array.from(new Set([...session.skipped, q.id])),
                      current: session.current + 1,
                    });
                  else move(session.current + 1);
                }}
              >
                Următoarea <ArrowRight size={17} />
              </button>
            ) : (
              <button disabled={busy} onClick={() => setConfirm(true)}>
                Finalizează
              </button>
            )}
          </div>
          <button
            className="text-button flag-button"
            disabled={busy}
            onClick={() =>
              persist({
                ...session,
                flagged: session.flagged.includes(q.id)
                  ? session.flagged.filter((id) => id !== q.id)
                  : [...session.flagged, q.id],
              })
            }
          >
            <Flag size={16} />{' '}
            {session.flagged.includes(q.id)
              ? 'Marcată pentru revizuire'
              : 'Marchează pentru revizuire'}
          </button>
        </section>
        <aside className="quiz-nav">
          <h3>Navigare întrebări</h3>
          <p>
            {answered} răspunse · {session.questions.length - answered} nerăspunse
          </p>
          <div className="number-grid">
            {session.questions.map((item, i) => (
              <button
                disabled={busy}
                title={`Întrebarea ${i + 1}${session.flagged.includes(item.id) ? ', marcată' : ''}${session.skipped.includes(item.id) ? ', omisă' : ''}`}
                aria-label={`Mergi la întrebarea ${i + 1}`}
                className={`${session.answers[item.id]?.submitted ? 'done' : ''} ${i === session.current ? 'current' : ''} ${session.flagged.includes(item.id) ? 'flagged' : ''} ${session.skipped.includes(item.id) && !session.answers[item.id]?.submitted ? 'skipped' : ''}`}
                key={item.id}
                onClick={() => move(i)}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <div className="nav-legend">
            <span>● Răspunsă</span>
            <span>⚑ Marcată</span>
            <span>◌ Omisă</span>
          </div>
          <button className="full-width" disabled={busy} onClick={() => setConfirm(true)}>
            Finalizează quiz
          </button>
        </aside>
      </div>
      {confirm && (
        <div className="modal-backdrop">
          <section
            className="modal small"
            role="dialog"
            aria-modal="true"
            aria-label="Finalizează quiz"
          >
            <h2>Finalizezi quiz-ul?</h2>
            <p>
              {session.questions.length - answered} întrebări nu au un răspuns trimis. Vei putea
              vedea rezultatele și reîncerca greșelile.
            </p>
            <div className="button-row">
              <button onClick={() => setConfirm(false)}>Continuă quiz-ul</button>
              <button
                className="primary"
                onClick={() => persist({ ...session, completedAt: new Date().toISOString() })}
              >
                Finalizează
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
