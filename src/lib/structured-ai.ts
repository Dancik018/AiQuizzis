import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { aiProviderName, apiKey, type ProviderName } from './ai-config';
import { openAIModel } from './server-config';
import { estimatedCost } from './pricing';
import type { BatchUsage } from './model';

type Message = { role: 'system' | 'user'; content: string };
export function parseStructuredJSON(text: string): unknown {
  // Repair transport wrappers only; never invent missing content or execute document text.
  const cleaned = text
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1');
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error('AI_INVALID');
  }
}

export async function structuredAI<T>(
  schema: z.ZodType<T>,
  name: string,
  input: Message[],
  maxTokens: number,
  selected: ProviderName = aiProviderName(),
  strong = false,
  onUsage?: (usage: BatchUsage) => void,
): Promise<T> {
  const started = Date.now();
  const report = (
    model: string,
    inputTokens = 0,
    outputTokens = 0,
    totalTokens = inputTokens + outputTokens,
  ) => {
    const usage = {
      model,
      inputTokens,
      outputTokens,
      totalTokens,
      durationMs: Date.now() - started,
      estimatedCostUSD:
        selected === 'openai' ? estimatedCost(model, inputTokens, outputTokens) : undefined,
    };
    onUsage?.(usage);
    console.info('ai_usage', JSON.stringify({ provider: selected, task: name, ...usage }));
  };
  const client = new OpenAI({ apiKey: apiKey(), timeout: 45000, maxRetries: 0 });
  const model = openAIModel();
  const response = await client.responses.create({
    model,
    ...(/^(gpt-5|gpt-6|o[134])/.test(model)
      ? { reasoning: { effort: strong ? ('medium' as const) : ('low' as const) } }
      : {}),
    store: false,
    max_output_tokens: maxTokens,
    input,
    text: { format: zodTextFormat(schema, name) },
  });
  report(
    model,
    response.usage?.input_tokens,
    response.usage?.output_tokens,
    response.usage?.total_tokens,
  );
  if (response.status !== 'completed') throw new Error('AI_INVALID');
  const output = parseStructuredJSON(response.output_text || '');
  const parsed = schema.safeParse(output);
  if (!parsed.success) throw new Error('AI_INVALID');
  return parsed.data;
}
