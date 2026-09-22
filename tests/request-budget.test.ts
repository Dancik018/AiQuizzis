import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { body, apiError } from '../src/lib/api';

test('application request budget reports actual remaining time instead of a fresh minute', async () => {
  const oldLimit = process.env.QUIZ_API_REQUESTS_PER_MINUTE,
    oldNow = Date.now;
  process.env.QUIZ_API_REQUESTS_PER_MINUTE = '2';
  let time = 100000;
  Date.now = () => time;
  const request = () =>
    new Request('https://quiz.test/api/solve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': 'budget-test' },
      body: '{}',
    });
  try {
    await body(request(), z.object({}));
    await body(request(), z.object({}));
    time += 59000;
    await assert.rejects(
      () => body(request(), z.object({})),
      (error) => {
        const response = apiError(error);
        assert.equal(response.status, 429);
        assert.equal(response.headers.get('retry-after'), '1');
        return true;
      },
    );
    time += 1001;
    await body(request(), z.object({}));
  } finally {
    Date.now = oldNow;
    if (oldLimit === undefined) delete process.env.QUIZ_API_REQUESTS_PER_MINUTE;
    else process.env.QUIZ_API_REQUESTS_PER_MINUTE = oldLimit;
  }
});
