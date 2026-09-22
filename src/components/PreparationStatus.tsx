'use client';
import { ready, type DocumentSet, type Question } from '@/lib/model';

export default function PreparationStatus({
  documents,
  questions,
}: {
  documents: DocumentSet[];
  questions: Question[];
}) {
  const prepared = questions.filter(ready).length;
  const samples = documents.flatMap((d) => d.processing?.metrics?.recent || []);
  const count = samples.reduce((sum, s) => sum + s.count, 0);
  const seconds = count
    ? Math.ceil(
        ((questions.length - prepared) * samples.reduce((sum, s) => sum + s.ms, 0)) / count / 1000,
      )
    : null;
  return (
    <section className="notice" aria-label="Pregătire AI">
      <div>
        <b>
          Pregătire AI: {prepared} / {questions.length}
        </b>
        <progress value={prepared} max={Math.max(1, questions.length)} />
        <p>
          Timp estimat rămas:{' '}
          {seconds === null
            ? 'se calculează după primul lot'
            : `${Math.floor(seconds / 60)} min ${seconds % 60} sec`}
        </p>
        {documents.map((d) => (
          <p key={d.id}>
            {d.processing?.provider} · {d.processing?.batchSize || 0} întrebări în lot ·{' '}
            {d.error || (d.status === 'processing' ? 'Pregătire în fundal' : 'Progres salvat')}
          </p>
        ))}
        <details>
          <summary>Diagnostic procesare</summary>
          {documents.map((d) => {
            const m = d.processing?.metrics;
            return (
              <p key={d.id}>
                {d.name}: extragere {d.extractionMs ?? '—'} ms · {d.questions.length} detectate ·
                cereri {m?.requests || 0} · reutilizate din cache {m?.cacheHits || 0} ·
                întrebări/cerere {m?.requests ? (m.sent / m.requests).toFixed(1) : '—'} · latență
                medie {m?.requests ? Math.round(m.latencyMs / m.requests) : '—'} ms · timp total{' '}
                {Math.round((d.processing?.elapsedMs || 0) / 1000)} s · pauze{' '}
                {Math.round((m?.waitMs || 0) / 1000)} s · reîncercări {m?.retries || 0} · 429:{' '}
                {m?.rateLimits || 0} · întrebări/min{' '}
                {d.processing?.elapsedMs && m
                  ? ((d.questions.filter(ready).length * 60000) / d.processing.elapsedMs).toFixed(1)
                  : '—'}{' '}
                · primele 20{' '}
                {m?.first20Ms !== undefined
                  ? `${Math.round((m.first20Ms + (d.extractionMs || 0)) / 1000)} s`
                  : '—'}
                {' · '}Input tokens: {m?.usage?.reduce((sum, u) => sum + u.inputTokens, 0) || 0}
                {' · '}Output tokens: {m?.usage?.reduce((sum, u) => sum + u.outputTokens, 0) || 0}
                {' · '}Total tokens: {m?.usage?.reduce((sum, u) => sum + u.totalTokens, 0) || 0}
                {' · '}Cost estimat OpenAI: $
                {m?.usage?.reduce((sum, u) => sum + (u.estimatedCostUSD || 0), 0).toFixed(4) || '0'}
                {' · '}Modele:{' '}
                {Array.from(new Set(m?.usage?.map((u) => u.model))).join(', ') || '—'}
              </p>
            );
          })}
        </details>
      </div>
    </section>
  );
}
