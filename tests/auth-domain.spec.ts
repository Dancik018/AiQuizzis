import { test, expect } from '@playwright/test';
test('OAuth keeps the verifier cookie and callback on the canonical domain', async ({
  request,
}) => {
  const alias = await request.get('http://127.0.0.1:3000/api/auth/google', { maxRedirects: 0 });
  expect(alias.status()).toBe(303);
  expect(alias.headers().location).toBe('http://localhost:3000/api/auth/google');
  expect(alias.headers()['set-cookie']).toBeUndefined();
  const start = await request.get('/api/auth/google', { maxRedirects: 0 });
  expect(start.status()).toBe(303);
  const target = new URL(start.headers().location);
  expect(target.origin).toBe('https://aiquiz-test.invalid');
  expect(target.searchParams.get('redirect_to')).toBe('http://localhost:3000/auth/callback');
  expect(target.searchParams.get('code_challenge')).toBeTruthy();
  expect(start.headers()['set-cookie']).toContain('code-verifier');
  const invalid = await request.get('/auth/callback', { maxRedirects: 0 });
  expect(invalid.headers().location).toBe('http://localhost:3000/?authError=1');
});
