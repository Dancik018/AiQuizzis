import { z } from 'zod';
import { account, requireDocument, privateJSON } from '@/lib/account-server';
import { body, apiError } from '@/lib/api';
import { generateStudy } from '@/lib/study-generation';
export const runtime = 'nodejs';
export const maxDuration = 120;
export async function POST(req: Request) {
  try {
    const context = await account(req);
    const data = await body(
      req,
      z.object({
        documentId: z.string().min(1).max(100),
        units: z.array(z.string().max(80)).min(1).max(20),
      }),
      4000,
    );
    const { document } = await requireDocument(req, data.documentId, data.units.length, context);
    return privateJSON({ questions: await generateStudy(document, data.units) });
  } catch (e) {
    return apiError(e);
  }
}
