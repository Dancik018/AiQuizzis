import { z } from 'zod';
import { provider } from '@/lib/ai';
import { body, apiError } from '@/lib/api';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    const data = await body(
      req,
      z.object({
        question: z.string().min(2).max(12000),
        expected: z.string().min(1).max(8000),
        answer: z.string().min(1).max(8000),
      }),
    );
    return Response.json(await provider().evaluate(data.question, data.expected, data.answer));
  } catch (error) {
    return apiError(error);
  }
}
