import { normalize, uid, type DocumentSet, type Question, type SolvedQuestions } from './model';
import { putDocument } from './storage';
import { BatchError, runSolverQueue } from './solver-queue';
import { defaultProfile, type SolverProfile } from './batching';
import { questionHash, readAnswer, writeAnswer } from './answer-cache';

export async function solveQuestions(
  questions: Question[],
  generateOptions = false,
  selected?: SolverProfile['id'],
  strong = false,
  model?: string,
): Promise<SolvedQuestions> {
  const keys =
    model && !strong
      ? await Promise.all(
          questions.map((q) => questionHash(q, generateOptions, `${selected}:${model}`)),
        )
      : [];
  const cached = keys.length
    ? await Promise.all(questions.map((q, i) => readAnswer(keys[i], q)))
    : [];
  const pending = questions.filter((_, i) => !cached[i]);
  if (!pending.length)
    return Object.assign(
      cached.filter((q): q is Question => Boolean(q)),
      { cacheHits: cached.length },
    );
  const response = await fetch('/api/solve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questions: pending, generateOptions, provider: selected, strong }),
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
  const solved: SolvedQuestions = pending
    .filter((q) => result.questions.filter((a: { id: string }) => a.id === q.id).length === 1)
    .map((q) => {
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
        strengthened: strong,
      };
    });
  solved.usage = result.usage;
  solved.cacheHits = cached.filter(Boolean).length;
  for (const q of solved) {
    const index = questions.findIndex((original) => original.id === q.id);
    if (keys[index]) await writeAnswer(keys[index], q);
  }
  solved.push(...cached.filter((q): q is Question => Boolean(q)));
  return solved;
}
export async function processDocument(
  doc: DocumentSet,
  batchSize: number,
  generateOptions: boolean,
  update: (doc: DocumentSet) => void,
  shouldStop: () => boolean,
  requestIntervalMs = 0,
  profiles?: SolverProfile[],
  priority?: () => string[],
  optionsOnly = false,
) {
  const configured = profiles?.length
    ? profiles
    : [
        {
          ...defaultProfile('gemini'),
          maxQuestions: batchSize || 40,
          intervalMs: requestIntervalMs,
        },
      ];
  return runSolverQueue(doc, configured, generateOptions, {
    solve: (qs, generate, selected, strong) =>
      solveQuestions(
        qs,
        generate,
        selected,
        strong,
        configured.find((p) => p.id === selected)?.model,
      ),
    save: putDocument,
    update,
    shouldStop,
    priority,
    optionsOnly,
  });
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
