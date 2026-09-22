import test from 'node:test';
import assert from 'node:assert/strict';
import { apiError } from '../src/lib/api';
import { apiKey } from '../src/lib/ai-config';
import { z } from 'zod';

test('oversized requests split with 413 and invalid fields have safe actionable errors', async () => {
  const oversized = apiError(new Error('TOO_LARGE'));
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, 'TOO_LARGE');
  const input = z.object({ provider: z.literal('openai') }).safeParse({ provider: 'old-version' });
  assert.equal(input.success, false);
  if (!input.success) {
    const error = await apiError(input.error).json();
    assert.equal(error.code, 'CLIENT_OUTDATED');
    assert.match(error.error, /Actualizează/);
    assert.ok(!JSON.stringify(error).includes('old-version'));
  }
});

test('provider failures explain recovery without leaking upstream secrets', async () => {
  for (const [status, code, expected] of [
    [401, 'invalid_api_key', 'AI_AUTH'],
    [429, 'insufficient_quota', 'AI_QUOTA'],
    [429, 'project_spend_limit_exceeded', 'AI_QUOTA'],
    [429, 'rate_limit_exceeded', 'RATE_LIMIT'],
    [403, '', 'AI_ACCESS'],
    [404, 'model_not_found', 'AI_MODEL'],
    [400, '', 'AI_REQUEST'],
    [500, '', 'PROVIDER_ERROR'],
  ] as const) {
    const error = Object.assign(new Error('private-credential-must-not-leak'), { status, code });
    const result = await apiError(error).json();
    assert.equal(result.code, expected);
    assert.ok(!JSON.stringify(result).includes('private-credential'));
  }
});

test('copied key formatting fails locally and valid key surrounding whitespace is trimmed', async () => {
  const saved = process.env.OPENAI_API_KEY;
  try {
    process.env.OPENAI_API_KEY = 'sk-test\\_not-real';
    assert.throws(apiKey, /AI_KEY_FORMAT/);
    assert.equal((await apiError(new Error('AI_KEY_FORMAT')).json()).code, 'AI_KEY_FORMAT');
    process.env.OPENAI_API_KEY = '  sk-test_not-real\n';
    assert.equal(apiKey(), 'sk-test_not-real');
  } finally {
    if (saved === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved;
  }
});
