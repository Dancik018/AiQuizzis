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
  const upstreamCode =
    typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  const failure = (message: string, code: string, status = 503) =>
    Response.json({ error: message, code }, { status });
  if (code === 'GROQ_MISSING')
    return failure(
      'Adaugă GROQ_API_KEY în Vercel, apoi redeploy.',
      'AI_MISSING',
    );
  if (status === 413 || upstreamCode === 'context_length_exceeded')
    return failure('Lotul este prea mare. Va fi împărțit automat.', 'TOO_LARGE', 413);
  if (code === 'GEMINI_MISSING')
    return failure(
      'Configurează GEMINI_API_KEY în Vercel folosind o cheie din Google AI Studio, apoi redeploy.',
      'AI_MISSING',
    );
  if (code === 'GEMINI_KEY_FORMAT')
    return failure(
      'GEMINI_API_KEY are un format invalid. Copiază cheia direct din Google AI Studio, fără spații sau ghilimele.',
      'AI_KEY_FORMAT',
    );
  if (code === 'AI_PROVIDER_INVALID')
    return failure('AI_PROVIDER trebuie să fie groq, gemini sau openai în Vercel.', 'AI_CONFIG');
  if (code === 'AI_MODEL_INVALID')
    return failure('GEMINI_MODEL are un format invalid.', 'AI_MODEL');
  if (upstreamCode === 'DAILY_QUOTA')
    return failure(
      'Cota zilnică sau lunară a furnizorului este epuizată. Progresul este salvat; se încearcă furnizorul de rezervă, dacă este configurat.',
      'AI_QUOTA',
    );
  if (code === 'AI_KEY_FORMAT')
    return failure(
      'Valoarea OPENAI_API_KEY din Vercel are un format invalid. Copiază cheia nouă direct din OpenAI, fără ghilimele, spații sau bare inverse, apoi redeploy. Nu copia cheia dintr-un mesaj formatat.',
      'AI_KEY_FORMAT',
    );
  // Never expose upstream messages: authentication errors can contain credentials.
  if (status === 401 || upstreamCode === 'invalid_api_key')
    return failure(
      'Cheia serviciului AI este invalidă sau revocată. Înlocuiește cheia furnizorului selectat în Vercel, apoi redeploy. Documentul este salvat.',
      'AI_AUTH',
    );
  if (
    [
      'insufficient_quota',
      'billing_hard_limit_reached',
      'organization_spend_limit_exceeded',
      'project_spend_limit_exceeded',
      'organization_usage_limit_exceeded',
    ].includes(upstreamCode)
  )
    return failure(
      'OpenAI nu are credite disponibile sau a atins limita de cheltuieli. Verifică facturarea și limitele proiectului OpenAI, apoi reîncearcă loturile rămase. Documentul este salvat.',
      'AI_QUOTA',
    );
  if (status === 403)
    return failure(
      'Cheia AI nu are permisiunea necesară. Verifică accesul proiectului la model și disponibilitatea serviciului în regiunea ta.',
      'AI_ACCESS',
    );
  if (status === 404 || upstreamCode === 'model_not_found')
    return failure(
      'Modelul AI configurat nu este disponibil pentru acest proiect. Verifică OPENAI_MODEL (sau GROQ_MODEL/GEMINI_MODEL) în Vercel și accesul contului la model, apoi redeploy.',
      'AI_MODEL',
    );
  if (
    error instanceof Error &&
    ['APIConnectionTimeoutError', 'TimeoutError', 'AbortError'].includes(error.name)
  )
    return failure(
      'Serviciul AI nu a răspuns la timp. Reîncearcă loturile rămase; întrebările deja rezolvate sunt salvate.',
      'AI_TIMEOUT',
      504,
    );
  if (status === 400)
    return failure(
      'Serviciul AI a respins cererea. Verifică modelul configurat și suportul pentru răspunsuri structurate.',
      'AI_REQUEST',
    );
  if (code === 'AI_MISSING')
    return Response.json(
      {
        error:
          'AI nu este configurat. Adaugă GROQ_API_KEY sau GEMINI_API_KEY în Vercel și redeploy. Poți verifica manual întrebările.',
        code,
      },
      { status: 503 },
    );
  if (code === 'RATE_LIMIT' || status === 429) {
    const err = error as { retryAfter?: number; headers?: Headers };
    const raw = err.retryAfter ?? Number(err.headers?.get?.('retry-after'));
    const retryAfter = Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : 60;
    return Response.json(
      {
        error:
          'Limită temporară de cereri AI. Progresul este salvat; procesarea poate continua după pauză.',
        code: 'RATE_LIMIT',
        retryAfter,
      },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }
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
      code: code === 'AI_INVALID' ? 'AI_INVALID' : 'PROVIDER_ERROR',
      upstreamStatus: status || undefined,
    },
    { status: 502 },
  );
}
