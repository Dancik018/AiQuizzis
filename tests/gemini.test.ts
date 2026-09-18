import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { structuredAI } from '../src/lib/structured-ai';
import { provider } from '../src/lib/ai';
import { apiError } from '../src/lib/api';
import { detectQuestions } from '../src/lib/detection';

test('Gemini transport uses server-side headers and validates output, identities and original options', async () => {
  const oldFetch = globalThis.fetch;
  const oldProvider = process.env.AI_PROVIDER,
    oldKey = process.env.GEMINI_API_KEY;
  process.env.AI_PROVIDER = 'gemini';
  process.env.GEMINI_API_KEY = 'AQ.test-key-not-real';
  let result: unknown = { answer: '2' };
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /^https:\/\/generativelanguage.googleapis.com\/v1beta\/models\//);
    assert.ok(!String(url).includes('test-key'));
    assert.equal((init?.headers as Record<string, string>)['x-goog-api-key'], 'AQ.test-key-not-real');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.ok(body.generationConfig.responseJsonSchema);
    assert.ok(body.systemInstruction.parts.length);
    return Response.json({
      candidates: [
        { finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result) }] } },
      ],
    });
  };
  try {
    const schema = z.object({ answer: z.string() });
    assert.deepEqual(
      await structuredAI(
        schema,
        'answer',
        [
          { role: 'system', content: 'test' },
          { role: 'user', content: 'test' },
        ],
        100,
      ),
      { answer: '2' },
    );
    result = { answer: 2 };
    await assert.rejects(
      structuredAI(schema, 'answer', [{ role: 'system', content: 'test' }], 100),
      /AI_INVALID/,
    );
    const questions = detectQuestions(
      [
        { text: '1. Care este rezultatul adunarii 1 cu 1?', page: 1 },
        { text: 'A. 1', page: 1 },
        { text: 'B. 2', page: 1 },
      ],
      'doc',
      'test.pdf',
    ).questions;
    const answer = {
      id: questions[0].id,
      language: 'ro',
      languageConfidence: 0.99,
      correctOptionIndex: 1,
      correctAnswer: '2',
      generatedOptions: [],
      answerConfidence: 0.99,
      explanation: 'Adunare.',
    };
    result = { questions: [answer] };
    assert.equal((await provider().solve(questions, false)).questions[0].correctAnswer, '2');
    result = { questions: [{ ...answer, correctAnswer: 'rewritten option' }] };
    await assert.rejects(provider().solve(questions, false), /AI_INVALID/);
    result = { questions: [{ ...answer, id: 'invented-id' }] };
    await assert.rejects(provider().solve(questions, false), /AI_INVALID/);
    globalThis.fetch = async () =>
      Response.json(
        { error: { details: [{ violations: [{ quotaId: 'GenerateRequestsPerDay' }] }] } },
        { status: 429 },
      );
    await assert.rejects(structuredAI(schema, 'answer', [], 100), (asyncError) => {
      assert.equal((asyncError as { code: string }).code, 'DAILY_QUOTA');
      return true;
    });
    globalThis.fetch = async () =>
      Response.json({ error: { details: [{ retryDelay: '17s' }] } }, { status: 429 });
    try {
      await structuredAI(schema, 'answer', [], 100);
      assert.fail('expected failure');
    } catch (error) {
      const response = apiError(error);
      assert.equal(response.status, 429);
      assert.equal(response.headers.get('retry-after'), '17');
    }
  } finally {
    globalThis.fetch = oldFetch;
    if (oldProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = oldProvider;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldKey;
  }
});
