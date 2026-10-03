import { z } from 'zod';
import { account, checkDatabase, privateJSON } from '@/lib/account-server';
import { body, apiError } from '@/lib/api';
import { questionSchema } from '@/lib/model';
import { hydrateSource, ownedScan, SOURCE_BUCKET } from '@/lib/scan-storage';
import { studyConfigSchema, studyAnalysis } from '@/lib/study';
const document = z
  .object({
    id: z.string().min(1).max(100),
    extractionJob: z.string().uuid().optional(),
    name: z.string().max(300),
    questions: z.array(questionSchema).max(5000),
    lines: z
      .array(
        z.object({ text: z.string().max(12000), page: z.number().int().positive() }).passthrough(),
      )
      .max(100000),
  })
  .passthrough();
const session = z
  .object({
    id: z.string().min(1).max(100),
    questions: z.array(questionSchema).max(5000),
    current: z.number().int().min(0),
    answers: z.record(z.string(), z.unknown()),
    config: z.object({ mode: z.enum(['practice', 'exam']) }).passthrough(),
  })
  .passthrough();
export async function GET(req: Request) {
  try {
    const { db, user } = await account(req);
    const kind = new URL(req.url).searchParams.get('kind');
    if (kind !== 'documents' && kind !== 'sessions') throw new Error('INVALID_DATA');
    const result = await db
      .from(kind === 'documents' ? 'documents' : 'quiz_sessions')
      .select('data,version')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    checkDatabase(result.error);
    return privateJSON({ items: result.data });
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(req: Request) {
  try {
    const { db, user } = await account(req);
    const data = await body(
      req,
      z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('documents'),
          data: document,
          version: z.number().int().min(0),
        }),
        z.object({ kind: z.literal('sessions'), data: session, version: z.number().int().min(0) }),
      ]),
      3500000,
    );
    if (data.kind === 'documents' && data.data.questions.some((q) => q.documentId !== data.data.id))
      throw new Error('INVALID_DATA');
    if (data.kind === 'documents' && data.data.extractionJob) {
      const job = await ownedScan(db, user.id, data.data.extractionJob);
      if (job.status !== 'complete' || job.name !== data.data.name || data.data.lines.length)
        throw new Error('INVALID_DATA');
    }
    if (data.kind === 'documents' && data.data.study) {
      const state = z
        .object({
          config: studyConfigSchema,
          analysisVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
        })
        .parse(data.data.study);
      const source = await hydrateSource(db, user.id, data.data);
      const capacity = studyAnalysis(source.lines, state.config, state.analysisVersion || 1);
      if (
        state.config.count > capacity.maximum ||
        data.data.questions.length > state.config.count ||
        state.config.pageTo < state.config.pageFrom
      )
        throw new Error('INVALID_DATA');
    }
    if (
      data.data.questions.some((q) => q.generationMode === 'study') &&
      data.data.questions.length > 200
    )
      throw new Error('INVALID_DATA');
    const result = await db.rpc(data.kind === 'documents' ? 'save_document' : 'save_quiz', {
      payload: data.data,
      expected_version: data.version,
    });
    checkDatabase(result.error);
    return privateJSON({ version: result.data });
  } catch (e) {
    return apiError(e);
  }
}
export async function DELETE(req: Request) {
  try {
    const { db, user } = await account(req);
    const data = await body(req, z.object({ id: z.string().min(1).max(100) }), 1024);
    const old = await db
      .from('documents')
      .select('data')
      .eq('user_id', user.id)
      .eq('id', data.id)
      .single();
    const result = await db.rpc('delete_document', { doc_id: data.id });
    checkDatabase(result.error);
    if (old.data?.data.extractionJob) {
      try {
        const job = await ownedScan(db, user.id, old.data.data.extractionJob);
        const cleanup = await db.rpc('cancel_scan', { job: job.id });
        if (!cleanup.error)
          await db.storage
            .from(SOURCE_BUCKET)
            .remove([`${user.id}/${job.id}/source.${job.extension}`]);
      } catch {
        /* Document deletion succeeded; source cleanup can be retried separately. */
      }
    }
    return privateJSON({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
