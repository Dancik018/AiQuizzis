import { normalize, ready, uid, type Question, type QuizConfig, type QuizSession } from './model';
import { combineQuestions } from './detection';
export function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function createQuiz(
  questions: Question[],
  config: QuizConfig,
  title: string,
  progressive = false,
): QuizSession {
  let available = combineQuestions(
    questions.filter(
      (q) =>
        (progressive ? q.language !== 'foreign' : ready(q)) &&
        (q.type === 'open' ? config.includeOpen : config.includeMC),
    ),
  );
  if (config.shuffleQuestions) available = shuffled(available);
  available = available.slice(0, config.count || available.length);
  if (!available.length)
    throw new Error(
      'Nu există întrebări pregătite pentru această selecție. Verifică răspunsurile din editor.',
    );
  return {
    id: uid(),
    title,
    questions: structuredClone(available),
    config,
    progressive,
    bufferStarted: !progressive || available.filter(ready).length >= Math.min(20, available.length),
    optionOrders: available.map((q) =>
      ready(q)
        ? config.shuffleOptions
          ? shuffled(q.options.map((_, i) => i))
          : q.options.map((_, i) => i)
        : [],
    ),
    current: 0,
    answers: {},
    flagged: [],
    skipped: [],
    startedAt: new Date().toISOString(),
  };
}
// Hydrate only reserved, unprepared questions. A played question is an immutable snapshot.
export function hydrateQuiz(session: QuizSession, questions: Question[]): QuizSession {
  if (!session.progressive || session.completedAt) return session;
  const byId = new Map(questions.map((q) => [q.id, q]));
  let changed = false;
  const optionOrders = [...session.optionOrders];
  const updated = session.questions.map((q, i) => {
    const next = byId.get(q.id);
    if (
      ready(q) ||
      session.answers[q.id] ||
      !next ||
      (!ready(next) && next.solveError === q.solveError && next.solved === q.solved)
    )
      return q;
    changed = true;
    if (ready(next))
      optionOrders[i] = session.config.shuffleOptions
        ? shuffled(next.options.map((_, j) => j))
        : next.options.map((_, j) => j);
    return structuredClone(next);
  });
  if (!changed) return session;
  return {
    ...session,
    questions: updated,
    optionOrders,
    bufferStarted:
      session.bufferStarted || updated.filter(ready).length >= Math.min(20, updated.length),
  };
}

export function quizPriority(session?: QuizSession): string[] {
  if (!session || session.completedAt || !session.progressive) return [];
  return [
    ...session.questions.slice(session.current),
    ...session.questions.slice(0, session.current),
  ]
    .filter((q) => !ready(q))
    .map((q) => q.id);
}
export function exactAnswer(answer: string, expected: string) {
  return normalize(answer) === normalize(expected);
}
export function results(session: QuizSession) {
  const values = session.questions.map((q) => session.answers[q.id]);
  const correct = values.filter((a) => a?.submitted && a.correct === true).length;
  const incorrect = values.filter((a) => a?.submitted && a.correct === false).length;
  const pending = values.filter((a) => a?.submitted && a.correct === null).length;
  return {
    correct,
    incorrect,
    pending,
    unanswered: values.length - correct - incorrect - pending,
    percent: Math.round((correct / Math.max(1, values.length)) * 1000) / 10,
  };
}
