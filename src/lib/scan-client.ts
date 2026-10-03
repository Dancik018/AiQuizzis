import { accountFetch } from './storage';
import type { ExtractionProgress } from './extract';
import type { TextLine } from './model';
import type { ScanJob } from './scan-storage';
async function request(url: string, init?: RequestInit) {
  const response = await accountFetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(new Error(data.error || 'Scanarea nu a răspuns. Progresul este păstrat.'), {
      status: response.status,
      code: data.code,
      retryAfter: Number(response.headers.get('retry-after')) || 2,
    });
  return data;
}
const post = (data: unknown) =>
  request('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
export async function scanJobs(): Promise<{ available: boolean; jobs: ScanJob[] }> {
  return request('/api/scan');
}
export async function cancelScan(job: string) {
  return post({ action: 'cancel', job });
}
export async function getScanLines(job: string): Promise<TextLine[]> {
  const lines: TextLine[] = [];
  for (let from = 0; ;) {
    const result = await request(`/api/scan?job=${encodeURIComponent(job)}&from=${from}`);
    if (!result.chunks.length) break;
    for (const chunk of result.chunks) lines.push(...chunk.lines);
    from += result.chunks.length;
  }
  return lines;
}
export async function continueScan(job: ScanJob, progress: (p: ExtractionProgress) => void) {
  let current = job,
    failures = 0;
  while (current.status !== 'complete') {
    progress({
      stage: 'Scanare pe server · ' + current.name,
      completed: Math.max(0, current.next_page - 1),
      total: Math.max(1, current.pages),
    });
    try {
      const result = await post({ action: 'step', job: job.id });
      current = result.job;
      failures = 0;
    } catch (e) {
      const error = e as Error & { status?: number; code?: string; retryAfter?: number };
      if (error.status === 409 || (error.status && error.status >= 500 && ++failures <= 3)) {
        const seconds = Math.min(30, error.retryAfter || failures * 3 || 3);
        progress({
          stage: 'Scanare pe server · reconectare; progresul este salvat',
          completed: Math.max(0, current.next_page - 1),
          total: Math.max(1, current.pages),
        });
        await new Promise((r) => setTimeout(r, seconds * 1000));
        continue;
      }
      throw error;
    }
  }
  progress({
    stage: 'Se pregătește textul scanat',
    completed: current.pages,
    total: current.pages,
  });
  return { lines: await getScanLines(job.id), pages: current.pages, extractionJob: job.id };
}
export async function extractUploadedDocument(
  file: File,
  progress: (p: ExtractionProgress) => void,
  options: { studyMaterial?: boolean } = {},
): Promise<{ lines: TextLine[]; pages: number; extractionJob?: string }> {
  const { validateFile, extractFile } = await import('./extract');
  const extension = validateFile(file);
  const available = await scanJobs();
  // Preserve local processing in installations which have not applied the cloud migration.
  if (!available.available) return extractFile(file, progress, options);
  const created = await post({
    action: 'create',
    name: file.name,
    size: file.size,
    extension,
    study: !!options.studyMaterial,
  });
  const { Upload } = await import('tus-js-client');
  const signed = new URL(created.uploadURL);
  const endpoint = new URL('/storage/v1/upload/resumable/sign', signed.origin);
  endpoint.hostname = endpoint.hostname.replace('.supabase.co', '.storage.supabase.co');
  const objectName = decodeURIComponent(
    signed.pathname.split('/object/upload/sign/quiz-sources/')[1],
  );
  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: endpoint.href,
      headers: {
        'x-signature': signed.searchParams.get('token')!,
        ...(created.publishableKey ? { apikey: created.publishableKey } : {}),
      },
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      retryDelays: [0, 2000, 5000, 10000],
      fingerprint: async () => `aiquiz-${created.job}-${file.size}-${file.lastModified}`,
      metadata: {
        bucketName: 'quiz-sources',
        objectName,
        contentType:
          extension === 'pdf'
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        cacheControl: '0',
      },
      onProgress: (completed, total) =>
        progress({
          stage:
            'Încărcare securizată · ' + Math.floor((completed / Math.max(1, total)) * 100) + '%',
          completed,
          total,
        }),
      onError: () =>
        reject(
          new Error(
            'Încărcarea a fost întreruptă. Verifică conexiunea; poți elimina scanarea neterminată și reîncărca fișierul.',
          ),
        ),
      onSuccess: () => resolve(),
    });
    upload.start();
  });
  return continueScan(
    {
      id: created.job,
      name: file.name,
      size: file.size,
      extension,
      study: !!options.studyMaterial,
      pages: 0,
      next_page: 1,
      status: 'uploading',
    },
    progress,
  );
}
