import { z } from 'zod';
import { account, requireDocument } from '@/lib/account-server';
import { questionSchema } from '@/lib/model';
import { provider } from '@/lib/ai';
import { body, apiError } from '@/lib/api';
import { availableProviders } from '@/lib/ai-config';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    const context = await account(req);
    const data = await body(
      req,
      z.object({
        questions: z.array(questionSchema).min(1).max(100),
        generateOptions: z.boolean().default(false),
        provider: z.literal('openai').optional(),
        strong: z.boolean().default(false),
      }),
      350000,
    );
    const documentId = data.questions[0].documentId;
    if (data.questions.some((q) => q.documentId !== documentId)) throw new Error('INVALID_DATA');
    const { document } = await requireDocument(req, documentId, data.questions.length, context);
    const ids = new Set(document.questions.map((q: { id: string }) => q.id));
    if (data.questions.some((q) => !ids.has(q.id))) throw new Error('DOCUMENT_NOT_FOUND');
    const selected = data.provider || availableProviders()[0];
    if (!selected || !availableProviders().includes(selected)) throw new Error('AI_MISSING');
    return Response.json({
      ...(await provider(selected).solve(data.questions, data.generateOptions, data.strong)),
      provider: selected,
    });
  } catch (error) {
    return apiError(error);
  }
}
