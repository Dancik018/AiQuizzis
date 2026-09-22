import { cachedAnswer, cacheAnswer } from './storage';
import { questionSchema, ready, type Question } from './model';
export async function questionHash(q: Question, generate: boolean, model: string) {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      'quiz-verified-v3',
      model,
      generate,
      q.question,
      q.options,
      q.sourceAnswer,
      q.rawSourceText,
    ]),
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
    status: 'verified',
    correctOptionIndices: parsed.data.correctOptionIndices,
    answerLeakage: false,
    verification: parsed.data.verification,
  };
}
export async function writeAnswer(key: string, q: Question) {
  if (ready(q)) await cacheAnswer(key, q);
}
