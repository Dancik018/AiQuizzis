import { needsAnalysis, normalize, uid, type DocumentSet, type Question } from './model';
import { putDocument } from './storage';

class BatchError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryAfter = 60,
  ) {
    super(message);
  }
}

export async function solveQuestions(
  questions: Question[],
  generateOptions = false,
): Promise<Question[]> {
  const response = await fetch('/api/solve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questions, generateOptions }),
    signal: AbortSignal.timeout(65000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new BatchError(
      result?.error || 'Rezolvarea lotului a eșuat. Progresul este salvat.',
      result?.code || 'PROVIDER_ERROR',
      Number(response.headers.get('retry-after') || result?.retryAfter) || 60,
    );
  if (!result?.questions) throw new Error('Lot incomplet. Reîncearcă.');
  return questions.map((q) => {
    const answer = result.questions.find((a: { id: string }) => a.id === q.id);
    if (!answer) throw new Error('Lot incomplet. Reîncearcă.');
    const options = q.options.length ? q.options : answer.generatedOptions;
    return {
      ...q,
      language: answer.language,
      languageConfidence: answer.languageConfidence,
      options,
      type: options.length >= 2 ? 'multiple_choice' : 'open',
      correctOptionIndex: answer.correctOptionIndex,
      correctAnswer: answer.correctAnswer,
      answerConfidence: answer.answerConfidence,
      explanation: answer.explanation,
      solved: true,
      reviewed: false,
    };
  });
}
export async function processDocument(
  doc: DocumentSet,
  batchSize: number,
  generateOptions: boolean,
  update: (doc: DocumentSet) => void,
  shouldStop: () => boolean,
  requestIntervalMs = 0,
) {
  let current: DocumentSet = { ...doc, status: 'processing', error: undefined };
  const waitUntil = async (until: number, retry: boolean) => {
    current = { ...current, retryAt: until };
    await putDocument(current);
    let lastSecond = -1;
    while (Date.now() < until && !shouldStop()) {
      const seconds = Math.ceil((until - Date.now()) / 1000);
      if (seconds !== lastSecond) {
        lastSecond = seconds;
        update({
          ...current,
          error: `${retry ? 'Limită temporară AI. Reîncercare automată' : 'Următorul lot'} în ${seconds} secunde. Progresul este salvat.`,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (shouldStop()) return false;
    current = { ...current, retryAt: undefined, error: undefined };
    await putDocument(current);
    update(current);
    return true;
  };
  const pending = current.questions.filter(needsAnalysis);
  await putDocument(current);
  update(current);
  let nextRequest = current.retryAt || 0;
  let retries = 0;
  for (let i = 0; i < pending.length;) {
    if (shouldStop()) break;
    if (nextRequest > Date.now() && !(await waitUntil(nextRequest, retries > 0))) break;
    const batch: Question[] = [];
    let bytes = 0;
    while (
      i + batch.length < pending.length &&
      batch.length < Math.min(10, Math.max(1, batchSize))
    ) {
      const item = pending[i + batch.length];
      const size = new TextEncoder().encode(JSON.stringify(item)).length;
      if (batch.length && bytes + size > 100000) break;
      batch.push(item);
      bytes += size;
    }
    try {
      nextRequest = Date.now() + Math.min(60000, Math.max(0, requestIntervalMs));
      const solved = await solveQuestions(batch, generateOptions);
      const byId = new Map(solved.map((q) => [q.id, q]));
      current = {
        ...current,
        questions: current.questions.map((q) => {
          const resolved = byId.get(q.id);
          if (!resolved) return q;
          // A source-provided answer only needs ambiguous language verification.
          return q.solved
            ? { ...q, language: resolved.language, languageConfidence: resolved.languageConfidence }
            : resolved;
        }),
      };
      await putDocument(current);
      update(current);
      i += batch.length;
      retries = 0;
    } catch (error) {
      if (
        error instanceof BatchError &&
        error.code === 'RATE_LIMIT' &&
        retries < 3 &&
        error.retryAfter <= 120
      ) {
        retries++;
        nextRequest = Date.now() + Math.max(error.retryAfter, 2 ** retries) * 1000;
        current = { ...current, retryAt: nextRequest };
        await putDocument(current);
        continue;
      }
      current = {
        ...current,
        status: 'partial',
        retryAt:
          error instanceof BatchError && error.code === 'RATE_LIMIT'
            ? Date.now() + error.retryAfter * 1000
            : undefined,
        error:
          error instanceof BatchError && error.code === 'RATE_LIMIT'
            ? 'Limita AI persistă. Verifică și cota zilnică în contul furnizorului. Progresul este salvat; reîncearcă mai târziu.'
            : error instanceof Error
              ? error.message
              : 'Lot eșuat.',
      };
      await putDocument(current);
      update(current);
      return;
    }
  }
  current = {
    ...current,
    status: current.questions.some(needsAnalysis) ? 'partial' : 'ready',
  };
  await putDocument(current);
  update(current);
}

// Optional semantic recovery for layouts the deterministic parser cannot recognize.
// Cursor is committed with each batch, so failed requests never discard earlier work.
export async function analyzeStructure(
  doc: DocumentSet,
  update: (doc: DocumentSet) => void,
  shouldStop: () => boolean,
) {
  let current = { ...doc };
  while ((current.analysisCursor || 0) < current.lines.length && !shouldStop()) {
    const start = current.analysisCursor || 0;
    const lines = [];
    let size = 0;
    for (let i = start; i < Math.min(start + 60, current.lines.length); i++) {
      if (size + current.lines[i].text.length > 24000 && lines.length) break;
      lines.push({ text: current.lines[i].text, page: current.lines[i].page });
      size += current.lines[i].text.length;
    }
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines }),
        signal: AbortSignal.timeout(65000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Analiza structurii a eșuat.');
      const seen = new Set(current.questions.map((q) => normalize(q.question)));
      const added: Question[] = [];
      for (const item of result.questions) {
        if (seen.has(normalize(item.question)) || item.language === 'foreign') continue;
        seen.add(normalize(item.question));
        added.push({
          id: uid(),
          documentId: doc.id,
          source: doc.name,
          page: lines[item.startLine].page,
          question: item.question,
          options: item.options,
          originalOptions: [...item.options],
          type: item.options.length >= 2 ? 'multiple_choice' : 'open',
          correctOptionIndex: null,
          correctAnswer: '',
          explanation: '',
          language: item.language,
          languageConfidence: item.languageConfidence,
          answerConfidence: 0,
          solved: false,
          reviewed: false,
        });
      }
      const atEnd = start + lines.length >= current.lines.length;
      current = {
        ...current,
        questions: [...current.questions, ...added],
        analysisCursor: atEnd ? current.lines.length : start + Math.max(1, lines.length - 10),
        analysisComplete: atEnd,
        error: undefined,
      };
      await putDocument(current);
      update(current);
    } catch (e) {
      current = {
        ...current,
        error: e instanceof Error ? e.message : 'Analiza structurii a eșuat.',
      };
      await putDocument(current);
      update(current);
      return current;
    }
  }
  return current;
}
