import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { structuredAI, parseStructuredJSON } from '../src/lib/structured-ai';
import { quizSettings, openAIModel } from '../src/lib/server-config';
import type { BatchUsage } from '../src/lib/model';
test('OpenAI uses configured model, low reasoning, strict Responses JSON and usage without secrets', async () => {
  const previous = {
    key: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL,
    fetch: globalThis.fetch,
  };
  process.env.OPENAI_API_KEY = 'sk-test-not-real';
  process.env.OPENAI_MODEL = 'gpt-5.6-luna';
  let usage: BatchUsage | undefined;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), 'https://api.openai.com/v1/responses');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, 'gpt-5.6-luna');
      assert.deepEqual(body.reasoning, { effort: 'low' });
      assert.equal(body.store, false);
      assert.equal(body.text.format.strict, true);
      assert.ok(!JSON.stringify(body).includes('sk-test'));
      return Response.json({
        id: 'test',
        object: 'response',
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '{"answer":"2"}', annotations: [] }],
          },
        ],
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
      });
    };
    assert.deepEqual(
      await structuredAI(
        z.object({ answer: z.string() }),
        'answer',
        [],
        100,
        'openai',
        false,
        (u) => {
          usage = u;
        },
      ),
      { answer: '2' },
    );
    assert.equal(usage?.totalTokens, 120);
    assert.equal(usage?.model, 'gpt-5.6-luna');
    assert.ok(usage!.estimatedCostUSD! > 0);
    assert.deepEqual(parseStructuredJSON('```json\n{"answer":"2"}\n```'), { answer: '2' });
    assert.throws(() => parseStructuredJSON('{"answer":'), /AI_INVALID/);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous.key;
    if (previous.model === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = previous.model;
  }
});
test('environment settings allow 50-question batches and 5 or 10 parallel workers', () => {
  const old = process.env.QUIZ_CONCURRENCY;
  process.env.QUIZ_CONCURRENCY = '10';
  assert.equal(quizSettings().concurrency, 10);
  delete process.env.QUIZ_CONCURRENCY;
  assert.equal(quizSettings().concurrency, 5);
  assert.equal(quizSettings().batchSize, 50);
  assert.equal(quizSettings().minReady, 20);
  assert.equal(openAIModel(), 'gpt-5.6-luna');
  if (old !== undefined) process.env.QUIZ_CONCURRENCY = old;
});
