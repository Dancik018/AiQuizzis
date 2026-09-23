'use client';
import { useState } from 'react';
import { ArrowLeft, Check, Copy, Pencil, Search, Sparkles, Trash2, X } from 'lucide-react';
import { questionSchema, ready, uid, type DocumentSet, type Question } from '@/lib/model';
import { solveQuestions } from '@/lib/processing';
import { sanitizeQuestion, detectAnswerLeakage } from '@/lib/question-safety';

export default function QuestionReview({
  doc,
  onChange,
  onBack,
  onQuiz,
  onBulk,
  processing = false,
}: {
  doc: DocumentSet;
  onChange: (doc: DocumentSet) => Promise<void>;
  onBack: () => void;
  onQuiz: () => void;
  onBulk?: () => Promise<void>;
  processing?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Question | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const filtered = doc.questions.filter(
    (q) =>
      q.question.toLowerCase().includes(search.toLowerCase()) &&
      (filter === 'all' ||
        (filter === 'images' ? q.requiresImage : filter === 'review' ? !ready(q) : ready(q))),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 15));
  const save = async (q: Question) => {
    q = sanitizeQuestion(q);
    if (q.requiresImage) {
      setError(
        'Întrebarea depinde de o imagine. Consultă pagina sursă și reformulează întrebarea astfel încât să poată fi rezolvată fără imagine.',
      );
      return;
    }
    if (q.type !== 'open') {
      const indices =
        q.type === 'multiple'
          ? [...new Set(q.correctOptionIndices || [])].sort((a, b) => a - b)
          : q.correctOptionIndex === null
            ? []
            : [q.correctOptionIndex];
      if (
        q.options.length < 2 ||
        q.options.some((o) => !o.trim()) ||
        !indices.length ||
        indices.some((i) => !Number.isInteger(i) || i < 0 || !q.options[i])
      ) {
        setError('Completează variantele și selectează cel puțin un răspuns corect.');
        return;
      }
      q = {
        ...q,
        correctOptionIndices: indices,
        correctOptionIndex: indices[0],
        correctAnswer: indices.map((i) => q.options[i]).join('; '),
      };
    }
    if (!questionSchema.safeParse(q).success) {
      setError('Verifică lungimea întrebării și a variantelor; sunt permise maximum 12 variante.');
      return;
    }
    if (detectAnswerLeakage(q.question, q.correctAnswer)) {
      setError('Textul întrebării dezvăluie răspunsul. Reformulează întrebarea.');
      return;
    }
    if (!q.question.trim() || !q.correctAnswer.trim()) {
      setError('Completează întrebarea și răspunsul corect.');
      return;
    }
    if (
      q.type === 'multiple_choice' &&
      (q.options.length < 2 ||
        q.options.some((o) => !o.trim()) ||
        q.correctOptionIndex === null ||
        !q.options[q.correctOptionIndex])
    ) {
      setError('Adaugă cel puțin două variante și selectează răspunsul corect.');
      return;
    }
    try {
      await onChange({
        ...doc,
        questions: doc.questions.map((old) =>
          old.id === q.id
            ? {
                ...q,
                solved: true,
                status: 'verified',
                answerLeakage: false,
                answerSource: 'manual',
                reviewed: true,
                solveError: undefined,
                correctAnswer:
                  q.type === 'multiple_choice' ? q.options[q.correctOptionIndex!] : q.correctAnswer,
              }
            : old,
        ),
      });
      setEditing(null);
      setError('');
    } catch {
      setError('Modificările nu au putut fi salvate în browser.');
    }
  };
  const regenerate = async (distractors: boolean) => {
    if (!editing) return;
    setBusy(true);
    setError('');
    try {
      if (distractors && editing.originalOptions.length)
        throw new Error(
          'Variantele originale sunt păstrate. Poți regenera răspunsul sau edita manual.',
        );
      const input = distractors ? { ...editing, options: [], correctOptionIndex: null } : editing;
      let generated = (await solveQuestions([{ ...input, passes: undefined }], distractors))[0];
      if (!generated) throw new Error('AI nu a returnat variante valide. Reîncearcă.');
      for (let pass = 0; pass < 2 && generated.status === 'verifying'; pass++) {
        await onChange({
          ...doc,
          questions: doc.questions.map((q) => (q.id === generated.id ? generated : q)),
        });
        const next = (await solveQuestions([generated], distractors, 'openai', true))[0];
        if (!next) throw new Error('Verificarea automată nu a returnat un rezultat valid.');
        generated = next;
      }
      await onChange({
        ...doc,
        questions: doc.questions.map((q) => (q.id === generated.id ? generated : q)),
      });
      setEditing(generated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI indisponibil.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className="text-button" onClick={onBack}>
        <ArrowLeft size={17} /> Documente
      </button>
      <div className="page-heading">
        <div>
          <p className="eyebrow">REVIZUIRE DOCUMENT</p>
          <h1>{doc.name}</h1>
          <p>
            {doc.questions.length} întrebări · {doc.questions.filter(ready).length} pregătite pentru
            quiz
          </p>
        </div>
        <button className="primary" onClick={onQuiz} disabled={!doc.questions.some(ready)}>
          Generează Quiz
        </button>
      </div>
      <div className="toolbar">
        <button
          disabled={busy || processing || !doc.questions.some((q) => !q.options.length)}
          onClick={async () => {
            setBusy(true);
            try {
              await onBulk?.();
            } finally {
              setBusy(false);
            }
          }}
        >
          Generează variante pentru toate
        </button>
        <label className="search">
          <Search size={18} />
          <input
            aria-label="Caută întrebări"
            placeholder="Caută în întrebări…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <select
          aria-label="Filtrează întrebările"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(0);
          }}
        >
          <option value="all">Toate întrebările</option>
          <option value="ready">Pregătite</option>
          <option value="review">Necesită verificare</option>
          <option value="images">Depind de imagini</option>
        </select>
      </div>
      <div className="question-list">
        {filtered
          .slice(Math.min(page, pages - 1) * 15, (Math.min(page, pages - 1) + 1) * 15)
          .map((q) => (
            <article className="review-row" key={q.id}>
              <span className="question-number">{doc.questions.indexOf(q) + 1}</span>
              <div>
                <div className="row-meta">
                  <span className={ready(q) ? 'badge green' : 'badge amber'}>
                    {ready(q)
                      ? 'Pregătită'
                      : q.requiresImage
                        ? 'Necesită imaginea sursă'
                        : q.language === 'foreign'
                          ? 'Limbă străină'
                          : 'Necesită verificare'}
                  </span>
                  {q.possibleDuplicate && <span className="badge amber">Posibil duplicat</span>}
                  <span>
                    Pagina {q.page} ·{' '}
                    {q.type === 'open' ? 'Răspuns manual' : `${q.options.length} variante`}
                  </span>
                </div>
                <h3>{q.question}</h3>
                {q.requiresImage && (
                  <p className="analysis-status">
                    Consultă diagrama de la pagina {q.page}. Întrebarea este exclusă din quiz până
                    când o reformulezi cu informațiile necesare; AI-ul nu ghicește imaginea.
                  </p>
                )}
                {q.solveError && <p className="analysis-status">{q.solveError}</p>}
                <p>
                  {q.solved
                    ? `Încredere răspuns: ${Math.round(q.answerConfidence * 100)}%`
                    : 'Răspunsul nu a fost încă verificat'}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label={`Editează întrebarea ${doc.questions.indexOf(q) + 1}`}
                disabled={processing}
                onClick={() => {
                  setEditing(structuredClone(q));
                  setError('');
                }}
              >
                <Pencil size={18} />
              </button>
            </article>
          ))}
      </div>
      {!filtered.length && (
        <div className="empty compact">Nu există întrebări pentru acest filtru.</div>
      )}
      <div className="pagination">
        <button disabled={page <= 0} onClick={() => setPage((p) => p - 1)}>
          Înapoi
        </button>
        <span>
          Pagina {Math.min(page, pages - 1) + 1} / {pages}
        </span>
        <button disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
          Următoarea
        </button>
      </div>
      {editing && (
        <div className="modal-backdrop">
          <section
            className="modal editor"
            role="dialog"
            aria-modal="true"
            aria-label="Editează întrebarea"
          >
            <div className="section-heading">
              <h2>Editează întrebarea</h2>
              <button
                className="icon-button"
                aria-label="Închide editorul"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                <X />
              </button>
            </div>
            <p className="muted">
              {editing.source} · Pagina {editing.page}
            </p>
            <label>
              Întrebare
              <textarea
                value={editing.question}
                onChange={(e) =>
                  setEditing({ ...editing, question: e.target.value, reviewed: false })
                }
                rows={3}
              />
            </label>
            <div className="form-grid">
              <label>
                Tip
                <select
                  value={editing.type}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      type: e.target.value as Question['type'],
                      options:
                        e.target.value === 'multiple_choice' && !editing.options.length
                          ? ['', '', '', '']
                          : editing.options,
                    })
                  }
                >
                  <option value="multiple_choice">Variante de răspuns</option>
                  <option value="multiple">Mai multe răspunsuri corecte</option>
                  <option value="open">Răspuns manual</option>
                </select>
              </label>
              <label>
                Limba
                <select
                  value={editing.language}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      language: e.target.value as Question['language'],
                      languageConfidence: 1,
                    })
                  }
                >
                  <option value="ro">Română</option>
                  <option value="uncertain">Necesită verificare</option>
                  <option value="foreign">Altă limbă</option>
                </select>
              </label>
            </div>
            {editing.type !== 'open' ? (
              <fieldset>
                <legend>Variante · selectează răspunsul corect</legend>
                {editing.options.map((o, i) => (
                  <label className="option-edit" key={i}>
                    <input
                      type={editing.type === 'multiple' ? 'checkbox' : 'radio'}
                      name="correct"
                      checked={
                        editing.type === 'multiple'
                          ? editing.correctOptionIndices?.includes(i) || false
                          : editing.correctOptionIndex === i
                      }
                      onChange={() =>
                        setEditing({
                          ...editing,
                          correctOptionIndex: i,
                          correctOptionIndices:
                            editing.type === 'multiple'
                              ? editing.correctOptionIndices?.includes(i)
                                ? editing.correctOptionIndices.filter((j) => j !== i)
                                : [...(editing.correctOptionIndices || []), i]
                              : [i],
                          correctAnswer:
                            editing.type === 'multiple'
                              ? (editing.correctOptionIndices?.includes(i)
                                  ? editing.correctOptionIndices.filter((j) => j !== i)
                                  : [...(editing.correctOptionIndices || []), i]
                                )
                                  .map((j) => editing.options[j])
                                  .join('; ')
                              : editing.options[i],
                        })
                      }
                    />
                    <span>{String.fromCharCode(65 + i)}</span>
                    <input
                      aria-label={`Varianta ${String.fromCharCode(65 + i)}`}
                      value={o}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          options: editing.options.map((v, j) => (i === j ? e.target.value : v)),
                          correctAnswer:
                            editing.correctOptionIndex === i
                              ? e.target.value
                              : editing.correctAnswer,
                        })
                      }
                    />
                  </label>
                ))}
                <button
                  disabled={editing.options.length >= 12}
                  onClick={() => setEditing({ ...editing, options: [...editing.options, ''] })}
                >
                  Adaugă variantă
                </button>
              </fieldset>
            ) : (
              <label>
                Răspuns corect
                <textarea
                  value={editing.correctAnswer}
                  onChange={(e) => setEditing({ ...editing, correctAnswer: e.target.value })}
                />
              </label>
            )}
            <label>
              Explicație
              <textarea
                value={editing.explanation}
                onChange={(e) => setEditing({ ...editing, explanation: e.target.value })}
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={editing.reviewed}
                onChange={(e) => setEditing({ ...editing, reviewed: e.target.checked })}
              />{' '}
              Am verificat întrebarea, limba și răspunsul
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <div className="button-row">
              <button disabled={busy} onClick={() => regenerate(false)}>
                <Sparkles size={16} /> Regenerează răspuns
              </button>
              <button
                disabled={busy || processing || editing.options.length > 0}
                onClick={() => regenerate(true)}
              >
                {busy ? 'Se generează variantele...' : 'Generează variante'}
              </button>
            </div>
            <div className="modal-footer">
              <button
                className="icon-button danger"
                aria-label="Șterge întrebarea"
                disabled={busy}
                onClick={async () => {
                  await onChange({
                    ...doc,
                    questions: doc.questions.filter((q) => q.id !== editing.id),
                  });
                  setEditing(null);
                }}
              >
                <Trash2 size={18} />
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  const q = { ...editing, id: uid() };
                  await onChange({ ...doc, questions: [...doc.questions, q] });
                  setEditing(q);
                }}
              >
                <Copy size={16} /> Duplică
              </button>
              <button className="primary" disabled={busy} onClick={() => save(editing)}>
                <Check size={17} /> Salvează
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
