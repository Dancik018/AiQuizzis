import type { SupabaseClient } from '@supabase/supabase-js';
import type { TextLine } from './model';
export const SOURCE_BUCKET = 'quiz-sources';
export type ScanJob = {
  id: string;
  name: string;
  size: number;
  extension: 'pdf' | 'docx';
  study: boolean;
  pages: number;
  next_page: number;
  status: 'uploading' | 'processing' | 'complete';
};
export async function ownedScan(db: SupabaseClient, owner: string, id: string) {
  const result = await db.from('scan_jobs').select('*').eq('id', id).eq('user_id', owner).single();
  if (result.error || !result.data) throw new Error('SCAN_NOT_FOUND');
  return result.data as ScanJob;
}
const sourceCache = new Map<string, { lines: TextLine[]; bytes: number; expires: number }>();
export async function scanLines(db: SupabaseClient, owner: string, id: string) {
  const job = await ownedScan(db, owner, id);
  if (job.status !== 'complete') throw new Error('SCAN_INCOMPLETE');
  const key = owner + ':' + id,
    hit = sourceCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.lines;
  sourceCache.delete(key);
  const lines: TextLine[] = [];
  // PostgREST's row limit must not truncate a 500+ page source.
  for (let offset = 0; ; offset += 100) {
    const result = await db
      .from('scan_chunks')
      .select('first_page,last_page,lines')
      .eq('job_id', id)
      .order('first_page')
      .range(offset, offset + 99);
    if (result.error) throw new Error('SCAN_STORAGE');
    for (const row of result.data) lines.push(...(row.lines as TextLine[]));
    if (result.data.length < 100) break;
  }
  if (!lines.some((l) => l.text.trim())) throw new Error('SCAN_EMPTY');
  const bytes = Buffer.byteLength(JSON.stringify(lines));
  for (const [key, value] of sourceCache) if (value.expires < Date.now()) sourceCache.delete(key);
  let usage = [...sourceCache.values()].reduce((n, v) => n + v.bytes, 0);
  for (const [key, value] of sourceCache) {
    if (usage + bytes <= 16000000) break;
    sourceCache.delete(key);
    usage -= value.bytes;
  }
  if (bytes <= 16000000) sourceCache.set(key, { lines, bytes, expires: Date.now() + 300000 });
  return lines;
}
export async function hydrateSource<T extends { lines: TextLine[]; extractionJob?: string }>(
  db: SupabaseClient,
  owner: string,
  doc: T,
): Promise<T> {
  return doc.extractionJob ? { ...doc, lines: await scanLines(db, owner, doc.extractionJob) } : doc;
}
