import { z } from 'zod';

export const questionSchema = z.object({
  id: z.string().min(1).max(100),
  documentId: z.string().max(100),
  question: z.string().min(2).max(12000),
  type: z.enum(['multiple_choice', 'open']),
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
});
export type Question = z.infer<typeof questionSchema>;
export type TextLine = {
  text: string;
  page: number;
  color?: string;
  font?: string;
  fontSize?: number;
  bold?: boolean;
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
  retryAt?: number;
  processing?: {
    queue: { ids: string[]; provider: number; tries: number }[];
    elapsedMs: number;
    finished: number;
    workDone: number;
    failed: number;
    batchSize: number;
    provider: string;
    generateOptions: boolean;
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
  completedAt?: string;
};
export const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
export const ready = (q: Question) =>
  q.language === 'ro' &&
  (q.reviewed || (q.languageConfidence >= 0.8 && q.answerConfidence >= 0.85)) &&
  q.correctAnswer.trim().length > 0 &&
  (q.type === 'open' ||
    (q.options.length >= 2 &&
      q.correctOptionIndex !== null &&
      q.correctOptionIndex < q.options.length));
export const uid = () => crypto.randomUUID();
export const needsAnalysis = (q: Question) =>
  !q.reviewed && q.language !== 'foreign' && (!q.solved || q.language === 'uncertain');
