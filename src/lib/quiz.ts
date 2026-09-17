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
export function createQuiz(questions: Question[], config: QuizConfig, title: string): QuizSession {
  let available = combineQuestions(
    questions.filter(
      (q) => ready(q) && (q.type === 'open' ? config.includeOpen : config.includeMC),
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
    optionOrders: available.map((q) =>
      config.shuffleOptions ? shuffled(q.options.map((_, i) => i)) : q.options.map((_, i) => i),
    ),
    current: 0,
    answers: {},
    flagged: [],
    skipped: [],
    startedAt: new Date().toISOString(),
  };
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
