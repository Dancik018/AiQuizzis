import type { Question } from './model';
export type SolverProfile = {
  id: 'openai';
  maxQuestions: number;
  tokenBudget: number;
  intervalMs: number;
  concurrency?: number;
  minReady?: number;
  model?: string;
  generationBatchSize?: number;
};
export const defaultProfile = (id: SolverProfile['id']): SolverProfile => ({
  id,
  maxQuestions: 50,
  tokenBudget: 16000,
  intervalMs: 0,
  concurrency: 5,
  minReady: 20,
  generationBatchSize: 16,
});
export const estimatedOutputTokens = (q: Question, generate: boolean) =>
  generate && !q.options.length
    ? Math.ceil(Math.max(200, 120 + q.question.length * 0.3 + (q.sourceAnswer?.length || 0) * 0.7))
    : Math.ceil(120 + Math.max(0, ...q.options.map((o) => o.length)) / 2.5);
export const estimatedTokens = (q: Question, generate: boolean) =>
  Math.ceil(
    (q.question.length +
      q.options.join(' ').length +
      (q.sourceAnswer?.length || 0) +
      (q.passes?.length === 2 ? JSON.stringify(q.passes).length : 0) +
      q.id.length +
      60) /
      2.5,
  ) + estimatedOutputTokens(q, generate);
export function planBatches(
  questions: Question[],
  profile: SolverProfile,
  generate = false,
): Question[][] {
  const batches: Question[][] = [];
  let batch: Question[] = [],
    tokens = 1400,
    outputTokens = 0,
    bytes = 0;
  for (const q of questions) {
    const cost = estimatedTokens(q, generate),
      size = new TextEncoder().encode(JSON.stringify(q)).length;
    if (
      batch.length &&
      (batch.length >=
        Math.min(
          100,
          profile.maxQuestions,
          generate && (q.options.length === 0 || batch.some((item) => item.options.length === 0))
            ? profile.generationBatchSize || 16
            : 100,
        ) ||
        tokens + cost > profile.tokenBudget ||
        outputTokens + estimatedOutputTokens(q, generate) >
          (generate && (!q.options.length || batch.some((item) => !item.options.length))
            ? 4500
            : 9000) ||
        bytes + size > 300000)
    ) {
      batches.push(batch);
      batch = [];
      tokens = 1400;
      outputTokens = 0;
      bytes = 0;
    }
    batch.push(q);
    tokens += cost;
    outputTokens += estimatedOutputTokens(q, generate);
    bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
