import type { Question } from './model';
export type SolverProfile = {
  id: 'groq' | 'gemini' | 'openai';
  maxQuestions: number;
  tokenBudget: number;
  intervalMs: number;
  concurrency?: number;
  minReady?: number;
  model?: string;
};
export const defaultProfile = (id: SolverProfile['id']): SolverProfile => ({
  id,
  maxQuestions: id === 'openai' ? 50 : 40,
  tokenBudget: id === 'groq' ? 6500 : 16000,
  intervalMs: id === 'groq' ? 55000 : id === 'gemini' ? 13000 : 0,
  concurrency: id === 'openai' ? 5 : 1,
  minReady: 20,
});
export const estimatedTokens = (q: Question, generate: boolean) =>
  Math.ceil((q.question.length + q.options.join(' ').length + q.id.length + 60) / 2.5) +
  (generate && q.options.length === 0 ? 240 : 150);
export function planBatches(
  questions: Question[],
  profile: SolverProfile,
  generate = false,
): Question[][] {
  const batches: Question[][] = [];
  let batch: Question[] = [],
    tokens = 1400,
    bytes = 0;
  for (const q of questions) {
    const cost = estimatedTokens(q, generate),
      size = new TextEncoder().encode(JSON.stringify(q)).length;
    if (
      batch.length &&
      (batch.length >= Math.min(100, profile.maxQuestions) ||
        tokens + cost > profile.tokenBudget ||
        bytes + size > 300000)
    ) {
      batches.push(batch);
      batch = [];
      tokens = 1400;
      bytes = 0;
    }
    batch.push(q);
    tokens += cost;
    bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
