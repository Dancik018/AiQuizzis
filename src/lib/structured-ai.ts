import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { aiProviderName, apiKey } from './ai-config';

type Message = { role: 'system' | 'user'; content: string };

export async function structuredAI<T>(
  schema: z.ZodType<T>,
  name: string,
  input: Message[],
  maxTokens: number,
): Promise<T> {
  let output: unknown;
  if (aiProviderName() === 'openai') {
    const client = new OpenAI({ apiKey: apiKey(), timeout: 45000, maxRetries: 0 });
    const response = await client.responses.parse({
      model: process.env.AI_MODEL?.trim() || 'gpt-4.1-mini',
      store: false,
      max_output_tokens: maxTokens,
      input,
      text: { format: zodTextFormat(schema, name) },
    });
    output = response.output_parsed;
  } else {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) throw new Error('GEMINI_MISSING');
    if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new Error('GEMINI_KEY_FORMAT');
    const model = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
    if (!/^[A-Za-z0-9._-]+$/.test(model)) throw new Error('AI_MODEL_INVALID');
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          systemInstruction: {
            parts: input.filter((m) => m.role === 'system').map((m) => ({ text: m.content })),
          },
          contents: input
            .filter((m) => m.role === 'user')
            .map((m) => ({ role: 'user', parts: [{ text: m.content }] })),
          generationConfig: {
            responseMimeType: 'application/json',
            responseJsonSchema: z.toJSONSchema(schema),
            // Reserve output space for the default model's internal reasoning.
            maxOutputTokens: maxTokens + 2048,
            ...(model === 'gemini-2.5-flash' ? { thinkingConfig: { thinkingBudget: 1024 } } : {}),
          },
        }),
      },
    );
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const details = Array.isArray(json?.error?.details) ? json.error.details : [];
      const daily = details.some((d: { violations?: { quotaId?: string }[] }) =>
        d.violations?.some((v) => /PerDay|Daily|PerMonth/i.test(v.quotaId || '')),
      );
      const invalidKey = details.some((d: { reason?: string }) => d.reason === 'API_KEY_INVALID');
      const retry = details.find((d: { retryDelay?: string }) => d.retryDelay)?.retryDelay;
      throw Object.assign(new Error('GEMINI_ERROR'), {
        status: response.status,
        code: daily ? 'DAILY_QUOTA' : invalidKey ? 'invalid_api_key' : '',
        retryAfter: retry
          ? Math.ceil(parseFloat(retry))
          : Number(response.headers.get('retry-after')) || 60,
      });
    }
    const candidate = json?.candidates?.[0];
    if (candidate?.finishReason !== 'STOP') throw new Error('AI_INVALID');
    const text = candidate.content?.parts
      ?.filter((p: { thought?: boolean }) => !p.thought)
      .map((p: { text?: string }) => p.text || '')
      .join('');
    try {
      output = JSON.parse(text || '');
    } catch {
      throw new Error('AI_INVALID');
    }
  }
  const parsed = schema.safeParse(output);
  if (!parsed.success) throw new Error('AI_INVALID');
  return parsed.data;
}
