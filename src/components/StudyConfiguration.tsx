'use client';
import { useMemo, useState } from 'react';
import type { DocumentSet } from '@/lib/model';
import { studyAnalysis, type StudyConfig } from '@/lib/study';
export default function StudyConfiguration({
  doc,
  onCancel,
  onGenerate,
}: {
  doc: DocumentSet;
  onCancel: () => void;
  onGenerate: (c: StudyConfig) => void;
}) {
  const all = useMemo(() => studyAnalysis(doc.lines), [doc.lines]);
  const [sections, setSections] = useState(all.sections.map((s) => s.id));
  const [pageFrom, setFrom] = useState(1),
    [pageTo, setTo] = useState(doc.pages);
  const [count, setCount] = useState(all.recommended);
  const [kind, setKind] = useState<StudyConfig['kind']>('multiple_choice');
  const [difficulty, setDifficulty] = useState<StudyConfig['difficulty']>('mixed');
  const a = useMemo(
    () => studyAnalysis(doc.lines, { sections, pageFrom, pageTo }),
    [doc.lines, sections, pageFrom, pageTo],
  );
  const valid =
    Number.isInteger(count) &&
    Number.isInteger(pageFrom) &&
    Number.isInteger(pageTo) &&
    count >= 1 &&
    count <= a.maximum &&
    pageFrom <= pageTo &&
    pageFrom >= 1 &&
    pageTo <= doc.pages;
  return (
    <div className="modal-backdrop">
      <section
        className="modal study-config"
        role="dialog"
        aria-modal="true"
        aria-label="Material de studiu"
      >
        <div className="section-heading">
          <h2>Material de studiu</h2>
          <button onClick={onCancel} aria-label="Închide configurarea">
            ×
          </button>
        </div>
        <p>{doc.name}</p>
        <div className="notice" role="status">
          Document analizat · {a.usefulPages} pagini cu text util · {a.topics} secțiuni ·{' '}
          {a.concepts} fragmente educaționale candidate · {a.words.toLocaleString('ro-RO')} cuvinte
          utile.
          <br />
          Recomandat: <strong>{a.recommended}</strong> întrebări · Maximum estimat:{' '}
          <strong>{a.maximum}</strong>.
        </div>
        <p className="muted">
          Estimare bazată pe text și densitate. AI poate genera mai puține întrebări dacă materialul
          nu susține concepte distincte. Paginile DOCX sunt aproximative.
        </p>
        <fieldset>
          <legend>Material selectat</legend>
          <button
            onClick={() => {
              setSections(all.sections.map((s) => s.id));
              setFrom(1);
              setTo(doc.pages);
            }}
          >
            Întregul document
          </button>
          <div className="study-sections">
            {all.sections.map((s) => (
              <label key={s.id}>
                <input
                  type="checkbox"
                  checked={sections.includes(s.id)}
                  onChange={(e) =>
                    setSections((v) =>
                      e.target.checked ? [...v, s.id] : v.filter((id) => id !== s.id),
                    )
                  }
                />
                {s.title}
              </label>
            ))}
          </div>
          <div className="study-grid">
            <label>
              De la pagina
              <input
                type="number"
                min={1}
                max={doc.pages}
                value={pageFrom}
                onChange={(e) => setFrom(Number(e.target.value))}
              />
            </label>
            <label>
              Până la pagina
              <input
                type="number"
                min={pageFrom}
                max={doc.pages}
                value={pageTo}
                onChange={(e) => setTo(Number(e.target.value))}
              />
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Număr de întrebări</legend>
          <div className="button-row">
            {[10, 20, 40, 60, 100].map((n) => (
              <button
                key={n}
                aria-pressed={count === n}
                disabled={n > a.maximum}
                onClick={() => setCount(n)}
              >
                {n}
                {n === a.recommended ? ' · Recomandat' : ''}
              </button>
            ))}
            <button onClick={() => setCount(a.recommended)} disabled={!a.maximum}>
              Recomandat · {a.recommended}
            </button>
          </div>
          <label>
            Număr personalizat
            <input
              type="number"
              min={1}
              disabled={!a.maximum}
              max={a.maximum}
              value={count || ''}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>
          {!valid && (
            <p className="error" role="alert">
              {a.maximum === 0 ? (
                'Materialul selectat este prea scurt pentru un quiz util. Selectează mai multe pagini sau încarcă un material mai complet.'
              ) : (
                <>
                  Materialul selectat permite aproximativ {a.maximum} întrebări utile. Alege între 1
                  și {a.maximum} și un interval valid de pagini.
                </>
              )}
            </p>
          )}
        </fieldset>
        <div className="study-grid">
          <label>
            Tipul întrebărilor
            <select value={kind} onChange={(e) => setKind(e.target.value as StudyConfig['kind'])}>
              {[
                ['multiple_choice', 'Variante de răspuns'],
                ['short_answer', 'Răspuns manual'],
              ].map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            Dificultate
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as StudyConfig['difficulty'])}
            >
              {[
                ['mixed', 'Mixtă'],
                ['easy', 'Ușoară'],
                ['medium', 'Medie'],
                ['hard', 'Dificilă'],
              ].map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
        {a.maximum > 0 && (
          <p>
            Poți începe după {Math.min(20, count || 1, a.maximum)} întrebări pregătite. Păstrează
            aplicația deschisă pentru continuarea generării.
          </p>
        )}
        <button
          className="primary"
          disabled={!valid}
          onClick={() => onGenerate({ sections, pageFrom, pageTo, count, kind, difficulty })}
        >
          Generează din material
        </button>
      </section>
    </div>
  );
}
