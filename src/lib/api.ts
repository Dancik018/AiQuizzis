import { z } from 'zod';
// Best-effort per-instance protection; configure Vercel Firewall rate limits for distributed enforcement.
const requests = new Map<string, { count: number; reset: number }>();
export async function body<T>(req: Request, schema: z.ZodType<T>, max = 150000): Promise<T> {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) throw new Error('ORIGIN');
  if (!req.headers.get('content-type')?.includes('application/json')) throw new Error('INVALID');
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'anonymous';
  const now = Date.now();
  for (const [key, value] of requests) if (value.reset < now) requests.delete(key);
  const usage = requests.get(ip) || { count: 0, reset: now + 60000 };
  if (++usage.count > 40) throw new Error('RATE_LIMIT');
  requests.set(ip, usage);
  if (Number(req.headers.get('content-length')) > max) throw new Error('TOO_LARGE');
  const reader = req.body?.getReader();
  if (!reader) throw new Error('INVALID');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Error('TOO_LARGE');
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return schema.parse(JSON.parse(new TextDecoder().decode(bytes)));
}
export function apiError(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : 0;
  if (code === 'AI_MISSING')
    return Response.json(
      {
        error:
          'AI nu este configurat. Administratorul trebuie să adauge OPENAI_API_KEY în Vercel. Poți verifica manual întrebările.',
        code,
      },
      { status: 503 },
    );
  if (code === 'OCR_MISSING')
    return Response.json(
      {
        error:
          'PDF scanat: OCR nu este configurat. Administratorul trebuie să adauge GOOGLE_VISION_API_KEY sau poți încărca un PDF cu text selectabil.',
        code,
      },
      { status: 503 },
    );
  if (code === 'RATE_LIMIT' || status === 429)
    return Response.json(
      { error: 'Prea multe cereri. Așteaptă un minut și reîncearcă lotul.', code: 'RATE_LIMIT' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  if (code === 'ORIGIN') return Response.json({ error: 'Origine nepermisă.' }, { status: 403 });
  if (
    error instanceof z.ZodError ||
    error instanceof SyntaxError ||
    ['INVALID', 'TOO_LARGE'].includes(code)
  )
    return Response.json({ error: 'Date invalide sau prea mari.' }, { status: 400 });
  return Response.json(
    {
      error:
        code === 'AI_INVALID'
          ? 'AI a returnat un rezultat incomplet. Reîncearcă acest lot.'
          : 'Serviciul nu a răspuns corect. Progresul salvat este păstrat; reîncearcă.',
      code: 'PROVIDER_ERROR',
    },
    { status: 502 },
  );
}
