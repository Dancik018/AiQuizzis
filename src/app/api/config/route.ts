import { availableProviders } from '@/lib/ai-config';
import { defaultProfile } from '@/lib/batching';
export async function GET() {
  let names: ReturnType<typeof availableProviders> = [];
  try {
    names = availableProviders();
  } catch {}
  const providers = names.map((id) => ({
    ...defaultProfile(id),
    ...(process.env.AI_REQUEST_INTERVAL_MS
      ? {
          intervalMs: Math.min(
            120000,
            Math.max(
              2000,
              Number(process.env.AI_REQUEST_INTERVAL_MS) || defaultProfile(id).intervalMs,
            ),
          ),
        }
      : {}),
  }));
  return Response.json({
    ai: providers.length > 0,
    provider: names[0] || 'unconfigured',
    providers,
    requestIntervalMs: providers[0]?.intervalMs || 0,
    batchSize: 40,
    ocr: true,
    ocrProvider: 'browser',
  });
}
