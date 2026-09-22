import { aiConfigured } from '@/lib/ai-config';
import { defaultProfile } from '@/lib/batching';
import { openAIModel, quizSettings } from '@/lib/server-config';
export async function GET() {
  const settings = quizSettings();
  const profile = {
    ...defaultProfile('openai'),
    maxQuestions: settings.batchSize,
    concurrency: settings.concurrency,
    minReady: settings.minReady,
    model: openAIModel(),
    generationBatchSize: settings.generationBatchSize,
  };
  return Response.json({
    ai: aiConfigured(),
    provider: 'openai',
    providers: aiConfigured() ? [profile] : [],
    requestIntervalMs: 0,
    batchSize: settings.batchSize,
    minReady: settings.minReady,
    ocr: true,
    ocrProvider: 'browser',
  });
}
