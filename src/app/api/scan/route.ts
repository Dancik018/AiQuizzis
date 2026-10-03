import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { account, checkDatabase, privateJSON } from '@/lib/account-server';
import { body, apiError } from '@/lib/api';
import { openServerDocument } from '@/lib/scan-server';
import { ownedScan, SOURCE_BUCKET } from '@/lib/scan-storage';
export const runtime = 'nodejs';
export const maxDuration = 120;
const id = z.string().uuid();
// Optional warm-instance cache only: Storage and saved chunks are always the source of truth.
let active = 0;
let cached: { key: string; bytes: Uint8Array; expires: number } | undefined;
export async function GET(req: Request) {
  try {
    const { db, user } = await account(req);
    const url = new URL(req.url),
      job = url.searchParams.get('job');
    if (!job) {
      const result = await db
        .from('scan_jobs')
        .select('id,name,size,extension,study,pages,next_page,status')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (result.error) return privateJSON({ available: false, jobs: [] });
      return privateJSON({ available: true, jobs: result.data });
    }
    await ownedScan(db, user.id, id.parse(job));
    const from = z.coerce
      .number()
      .int()
      .min(0)
      .max(5000)
      .parse(url.searchParams.get('from') || 0);
    const result = await db
      .from('scan_chunks')
      .select('first_page,last_page,lines')
      .eq('job_id', job)
      .order('first_page')
      .range(from, from + 24);
    checkDatabase(result.error);
    const chunks = [];
    let size = 0;
    for (const chunk of result.data || []) {
      const bytes = Buffer.byteLength(JSON.stringify(chunk));
      if (size + bytes > 2500000 && chunks.length) break;
      size += bytes;
      chunks.push(chunk);
    }
    return privateJSON({ chunks });
  } catch (e) {
    return scanError(e);
  }
}
export async function POST(req: Request) {
  let release: (() => Promise<void>) | undefined;
  let slot = false;
  let document: Awaited<ReturnType<typeof openServerDocument>> | undefined;
  try {
    const { db, user } = await account(req);
    const data = await body(
      req,
      z.discriminatedUnion('action', [
        z.object({
          action: z.literal('create'),
          name: z.string().min(1).max(300),
          size: z.number().int().positive().max(52428800),
          extension: z.enum(['pdf', 'docx']),
          study: z.boolean(),
        }),
        z.object({ action: z.literal('step'), job: id }),
        z.object({ action: z.literal('cancel'), job: id }),
      ]),
      2048,
    );
    if (data.action === 'create') {
      if (!data.name.toLowerCase().endsWith('.' + data.extension)) throw new Error('SCAN_INVALID');
      const created = await db.rpc('create_scan', {
        file_name: data.name,
        file_size: data.size,
        file_extension: data.extension,
        study_mode: data.study,
      });
      checkDatabase(created.error);
      const key = `${user.id}/${created.data}/source.${data.extension}`;
      const signed = await db.storage.from(SOURCE_BUCKET).createSignedUploadUrl(key);
      if (signed.error) {
        await db.rpc('cancel_scan', { job: created.data });
        throw new Error('SCAN_SETUP');
      }
      return privateJSON({ job: created.data, uploadURL: signed.data.signedUrl });
    }
    const job = await ownedScan(db, user.id, data.job);
    if (data.action === 'cancel') {
      const result = await db.rpc('cancel_scan', { job: job.id });
      checkDatabase(result.error);
      await db.storage.from(SOURCE_BUCKET).remove([`${user.id}/${job.id}/source.${job.extension}`]);
      return privateJSON({ ok: true });
    }
    if (job.status === 'complete') return privateJSON({ job });
    if (active >= 2)
      return Response.json(
        { code: 'SCAN_BUSY', error: 'Se așteaptă un loc liber pentru scanare.' },
        { status: 409, headers: { 'Retry-After': '3' } },
      );
    active++;
    slot = true;
    const token = randomUUID();
    const claim = await db.rpc('claim_scan', { job: job.id, token });
    checkDatabase(claim.error);
    if (!claim.data)
      return Response.json(
        { code: 'SCAN_BUSY', error: 'Scanarea este deja în curs. Progresul este salvat.' },
        { status: 409, headers: { 'Retry-After': '5' } },
      );
    release = async () => {
      await db.rpc('release_scan', { job: job.id, token });
    };
    const started = Date.now();
    const key = `${user.id}/${job.id}/source.${job.extension}`;
    let bytes: Uint8Array;
    if (cached?.key === key && cached.expires > Date.now()) bytes = cached.bytes;
    else {
      const source = await db.storage.from(SOURCE_BUCKET).download(key);
      if (source.error || !source.data) throw new Error('SCAN_UPLOAD');
      if (source.data.size !== job.size) throw new Error('SCAN_INVALID');
      bytes = new Uint8Array(await source.data.arrayBuffer());
      cached = { key, bytes, expires: Date.now() + 300000 };
    }
    document = await openServerDocument(bytes, job.extension);
    let first = job.next_page;
    let buffer: import('@/lib/model').TextLine[] = [];
    let chunkSize = 0;
    const commit = async (last: number) => {
      const result = await db.rpc('save_scan_chunk', {
        job: job.id,
        token,
        first,
        last,
        total: document!.pages,
        content: buffer,
      });
      checkDatabase(result.error);
      first = last + 1;
      buffer = [];
      chunkSize = 0;
    };
    try {
      for (let n = job.next_page; n <= document.pages && n < job.next_page + 40; n++) {
        const before = 'ocrCount' in document ? document.ocrCount || 0 : 0;
        const lines = await document.read(n, job.study);
        const size = Buffer.byteLength(JSON.stringify(lines));
        if (chunkSize + size > 1800000 && n > first) await commit(n - 1);
        buffer.push(...lines);
        chunkSize += size;
        const ocr = 'ocrCount' in document ? document.ocrCount || 0 : 0;
        const end =
          n === document.pages ||
          n === job.next_page + 39 ||
          Date.now() - started > 30000 ||
          ocr >= 2;
        if (ocr > before || n - first >= 7 || end) await commit(n);
        if (end) break;
      }
    } catch (e) {
      if (buffer.length) await commit(buffer.at(-1)!.page);
      throw e;
    }
    const saved = await ownedScan(db, user.id, job.id);
    // Only extracted text is retained. Completed scans no longer need the temporary original.
    if (saved.status === 'complete') await db.storage.from(SOURCE_BUCKET).remove([key]);
    return privateJSON({ job: saved });
  } catch (e) {
    return scanError(e);
  } finally {
    try {
      await document?.dispose();
    } finally {
      await release?.();
      if (slot) active--;
    }
  }
}
function scanError(e: unknown) {
  const code = e instanceof Error ? e.message : '';
  const messages: Record<string, string> = {
    SCAN_SETUP: 'Scanarea pe server trebuie activată în Supabase. Contactează administratorul.',
    SCAN_UPLOAD: 'Fișierul nu este încă încărcat complet. Reîncearcă încărcarea.',
    SCAN_NOT_FOUND: 'Scanarea nu există în contul tău.',
    SCAN_LIMIT:
      'Ai deja trei scanări neterminate. Continuă sau elimină una înainte de o nouă încărcare.',
    SCAN_EMPTY: 'Documentul nu conține text utilizabil.',
    SCAN_PAGES: 'Documentul depășește limita de 5.000 de pagini.',
    SCAN_INVALID: 'Fișierul încărcat nu este valid.',
    SCAN_TIMEOUT:
      'Pagina a depășit timpul de scanare. Paginile finalizate sunt păstrate; reîncearcă.',
    DOCX_INVALID: 'Structura documentului Word este deteriorată.',
    SCAN_STORAGE: 'Progresul nu a putut fi salvat. Reîncearcă; paginile finalizate sunt păstrate.',
  };
  if (code in messages)
    return Response.json(
      { code, error: messages[code] },
      { status: code === 'SCAN_NOT_FOUND' ? 404 : 503 },
    );
  if (e instanceof Error && /password/i.test(e.name + e.message))
    return Response.json(
      {
        code: 'SCAN_PASSWORD',
        error: 'PDF-ul este protejat cu parolă. Încarcă o copie deblocată.',
      },
      { status: 422 },
    );
  return apiError(e);
}
