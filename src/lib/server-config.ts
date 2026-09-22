// Imported by server modules only. No credentials or environment values enter client modules.
export const positiveInt = (value: string | undefined, fallback: number, max: number) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.min(max, Math.floor(number)) : fallback;
};
export const quizSettings = () => ({
  batchSize: positiveInt(process.env.QUIZ_BATCH_SIZE, 50, 100),
  concurrency: positiveInt(process.env.QUIZ_CONCURRENCY, 5, 10),
  minReady: positiveInt(process.env.QUIZ_MIN_READY_QUESTIONS, 20, 100),
  generationBatchSize: positiveInt(process.env.QUIZ_GENERATION_BATCH_SIZE, 16, 40),
});
export const openAIModel = () =>
  process.env.OPENAI_MODEL?.trim() || process.env.AI_MODEL?.trim() || 'gpt-5.6-luna';
