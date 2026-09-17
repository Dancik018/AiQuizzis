import { z } from 'zod';
import { questionSchema } from '@/lib/model';
import { provider } from '@/lib/ai';
import { body, apiError } from '@/lib/api';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    const data = await body(
      req,
      z.object({
        questions: z.array(questionSchema).min(1).max(10),
        generateOptions: z.boolean().default(false),
      }),
    );
    return Response.json(await provider().solve(data.questions, data.generateOptions));
  } catch (error) {
    return apiError(error);
  }
}
