import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { structuredAI } from '../src/lib/structured-ai';
import { apiError } from '../src/lib/api';

test('Groq uses strict schema, validates output and preserves rate-limit information', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'test-not-a-real-key';
  let invalid = false;
  const schema = z.object({ answer: z.string() });
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), 'https://api.groq.com/openai/v1/chat/completions');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, 'openai/gpt-oss-120b');
      assert.equal(body.response_format.json_schema.strict, true);
      assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
      return Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({ answer: invalid ? 2 : '2' }),
            },
          },
        ],
      });
    };
    assert.deepEqual(await structuredAI(schema, 'test', [], 100, 'groq'), { answer: '2' });
    invalid = true;
    await assert.rejects(structuredAI(schema, 'test', [], 100, 'groq'), /AI_INVALID/);
    globalThis.fetch = async () =>
      Response.json(
        { error: { message: 'temporary', code: 'rate_limit_exceeded' } },
        {
          status: 429,
          headers: { 'retry-after': '9' },
        },
      );
    await assert.rejects(structuredAI(schema, 'test', [], 100, 'groq'), (error: unknown) => {
      assert.equal(apiError(error).status, 429);
      assert.equal(apiError(error).headers.get('retry-after'), '9');
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  }
});
