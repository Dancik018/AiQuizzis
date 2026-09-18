import { z } from 'zod';
import { questionSchema } from '@/lib/model';
import { provider } from '@/lib/ai';
import { body, apiError } from '@/lib/api';
import { availableProviders } from '@/lib/ai-config';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    const data = await body(
      req,
      z.object({
        questions: z.array(questionSchema).min(1).max(40),
        generateOptions: z.boolean().default(false),
        provider: z.enum(['groq', 'gemini', 'openai']).optional(),
      }),
      350000,
    );
    const selected = data.provider || availableProviders()[0];
    if (!selected || !availableProviders().includes(selected)) throw new Error('AI_MISSING');
    return Response.json({
      ...(await provider(selected).solve(data.questions, data.generateOptions)),
      provider: selected,
    });
  } catch (error) {
    return apiError(error);
  }
}
