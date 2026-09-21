import { availableProviders } from '@/lib/ai-config';
import { defaultProfile } from '@/lib/batching';
import { openAIModel, quizSettings } from '@/lib/server-config';
export async function GET() {
  let names: ReturnType<typeof availableProviders> = [];
  try {
    names = availableProviders();
  } catch {}
  const providers = names.map((id) => ({
    ...defaultProfile(id),
    maxQuestions: id === 'openai' ? quizSettings().batchSize : 40,
    minReady: quizSettings().minReady,
    model:
      id === 'openai'
        ? openAIModel()
        : id === 'groq'
          ? process.env.GROQ_MODEL || 'openai/gpt-oss-120b'
          : process.env.GEMINI_MODEL || 'gemini-3.5-flash',
    concurrency: id === 'openai' ? quizSettings().concurrency : 1,
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
    batchSize: quizSettings().batchSize,
    minReady: quizSettings().minReady,
    ocr: true,
    ocrProvider: 'browser',
  });
}
