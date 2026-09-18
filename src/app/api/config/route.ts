import { aiConfigured, aiProviderName } from '@/lib/ai-config';
export async function GET() {
  let provider = 'unconfigured';
  try {
    provider = aiProviderName();
  } catch {}
  return Response.json({
    ai: aiConfigured(),
    provider,
    requestIntervalMs: Math.min(
      60000,
      Math.max(
        2000,
        Number(process.env.AI_REQUEST_INTERVAL_MS) || (provider === 'gemini' ? 13000 : 2000),
      ),
    ),
    ocr: true,
    ocrProvider: 'browser',
    batchSize: Math.min(10, Math.max(1, Number(process.env.AI_BATCH_SIZE) || 10)),
  });
}
