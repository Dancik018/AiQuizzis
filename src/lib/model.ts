import { z } from 'zod';
import { detectAnswerLeakage, invalidAnswer } from './question-safety';

export const questionSchema = z.object({
  id: z.string().min(1).max(100),
  documentId: z.string().max(100),
  question: z.string().min(2).max(12000),
  type: z.enum(['multiple_choice', 'multiple', 'open']),
  correctOptionIndices: z.array(z.number().int().min(0).max(11)).optional(),
  status: z
    .enum(['parsing', 'solving', 'verifying', 'validating', 'verified', 'failed'])
    .optional(),
  rawSourceText: z.string().max(20000).optional(),
  sourceAnswer: z.string().max(8000).optional(),
  answerSource: z.enum(['document', 'ai', 'manual']).optional(),
  answerLeakage: z.boolean().optional(),
  requiresImage: z.boolean().optional(),
  verification: z.enum(['single', 'independent', 'judge']).optional(),
  passes: z
    .array(
      z.object({
        question: z.string(),
        answer: z.string(),
        indices: z.array(z.number().int()),
        confidence: z.number(),
      }),
    )
    .max(3)
    .optional(),
  options: z.array(z.string().min(1).max(4000)).max(12),
  originalOptions: z.array(z.string().max(4000)).max(12),
  correctOptionIndex: z.number().int().min(0).max(11).nullable(),
  correctAnswer: z.string().max(8000),
  explanation: z.string().max(8000),
  language: z.enum(['ro', 'foreign', 'uncertain']),
  languageConfidence: z.number().min(0).max(1),
  answerConfidence: z.number().min(0).max(1),
  reviewed: z.boolean(),
  solved: z.boolean(),
  page: z.number().int().positive(),
  source: z.string().max(300),
  color: z.string().max(100).optional(),
  possibleDuplicate: z.boolean().optional(),
  solveError: z.string().optional(),
  strengthened: z.boolean().optional(),
});
export type Question = z.infer<typeof questionSchema>;
export type TextLine = {
  text: string;
  page: number;
  color?: string;
  font?: string;
  fontSize?: number;
  bold?: boolean;
  underline?: boolean;
  italic?: boolean;
  x?: number;
  y?: number;
  kind?: 'paragraph' | 'heading' | 'table';
  numbered?: boolean;
};
export type DocumentSet = {
  id: string;
  name: string;
  createdAt: string;
  questions: Question[];
  lines: TextLine[];
  pages: number;
  rejected: number;
  duplicates: number;
  status: 'extracted' | 'processing' | 'ready' | 'partial';
  error?: string;
  repairNotice?: string;
  retryAt?: number;
  extractionMs?: number;
  processing?: {
    queue: { ids: string[]; provider: number; tries: number; readyAt?: number; cap?: number }[];
    elapsedMs: number;
    finished: number;
    workDone: number;
    failed: number;
    batchSize: number;
    provider: string;
    generateOptions: boolean;
    optionsOnly?: boolean;
    metrics?: ProcessingMetrics;
  };
  analysisCursor?: number;
  analysisComplete?: boolean;
};
export type QuizConfig = {
  count: number;
  mode: 'practice' | 'exam';
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  includeMC: boolean;
  includeOpen: boolean;
};
export type Answer = {
  value: string;
  optionIndex?: number;
  optionIndices?: number[];
  correct: boolean | null;
  submitted: boolean;
  explanation?: string;
};
export type QuizSession = {
  id: string;
  title: string;
  questions: Question[];
  config: QuizConfig;
  optionOrders: number[][];
  current: number;
  answers: Record<string, Answer>;
  flagged: string[];
  skipped: string[];
  startedAt: string;
  updatedAt?: string;
  status?: 'in_progress' | 'completed';
  completedAt?: string;
  progressive?: boolean;
  bufferStarted?: boolean;
  minReady?: number;
};
export type ProcessingMetrics = {
  requests: number;
  sent: number;
  retries: number;
  rateLimits: number;
  waitMs: number;
  latencyMs: number;
  successful: number;
  recent: { ms: number; count: number }[];
  first20Ms?: number;
  usage?: BatchUsage[];
  cacheHits?: number;
};
export type BatchUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  ids?: string[];
  estimatedCostUSD?: number;
};
export type SolvedQuestions = Question[] & { usage?: BatchUsage; cacheHits?: number };
export const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
export const ready = (q: Question) =>
  (!q.status || q.status === 'verified') &&
  !q.requiresImage &&
  q.options.length <= 12 &&
  !q.answerLeakage &&
  !detectAnswerLeakage(q.question, q.correctAnswer) &&
  !invalidAnswer(q.correctAnswer) &&
  q.language === 'ro' &&
  (q.reviewed || (q.languageConfidence >= 0.8 && q.answerConfidence >= 0.85)) &&
  q.correctAnswer.trim().length > 0 &&
  (q.type === 'open' ||
    (q.options.length >= 2 &&
      (q.type === 'multiple'
        ? Boolean(
            q.correctOptionIndices?.length &&
            q.correctOptionIndices.every((i) => i >= 0 && i < q.options.length),
          )
        : q.correctOptionIndex !== null && q.correctOptionIndex < q.options.length)));
export const uid = () => crypto.randomUUID();
export const needsAnalysis = (q: Question) =>
  !q.requiresImage &&
  !q.reviewed &&
  q.language !== 'foreign' &&
  (!q.solved || q.language === 'uncertain');
