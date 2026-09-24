import { z } from 'zod';
import { account, requireDocument } from '@/lib/account-server';
import { provider } from '@/lib/ai';
import { body, apiError } from '@/lib/api';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    const context = await account(req);
    const data = await body(
      req,
      z.object({
        documentId: z.string().min(1).max(100),
        questionId: z.string().min(1).max(100),
        question: z.string().min(2).max(12000),
        expected: z.string().min(1).max(8000),
        answer: z.string().min(1).max(8000),
      }),
    );
    const { document } = await requireDocument(req, data.documentId, 1, context);
    const q = document.questions.find((q: { id: string }) => q.id === data.questionId);
    if (!q) throw new Error('DOCUMENT_NOT_FOUND');
    return Response.json(await provider().evaluate(q.question, q.correctAnswer, data.answer));
  } catch (error) {
    return apiError(error);
  }
}
