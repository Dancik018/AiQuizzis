import { cachedAnswer, cacheAnswer } from './storage';
import { questionSchema, ready, type Question } from './model';
export async function questionHash(q: Question, generate: boolean, model: string) {
  const bytes = new TextEncoder().encode(
    JSON.stringify(['quiz-v2', model, generate, q.question, q.options]),
  );
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
}
export async function readAnswer(key: string, q: Question): Promise<Question | undefined> {
  const parsed = questionSchema.safeParse(await cachedAnswer(key));
  if (!parsed.success || !ready(parsed.data)) return;
  const {
    options,
    correctAnswer,
    correctOptionIndex,
    answerConfidence,
    language,
    languageConfidence,
    type,
    explanation,
  } = parsed.data;
  return {
    ...q,
    options,
    correctAnswer,
    correctOptionIndex,
    answerConfidence,
    language,
    languageConfidence,
    type,
    explanation,
    solved: true,
  };
}
export async function writeAnswer(key: string, q: Question) {
  if (ready(q)) await cacheAnswer(key, q);
}
