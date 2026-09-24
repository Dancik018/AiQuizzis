import { test, expect } from '@playwright/test';
test('unauthenticated visitors cannot upload or access cloud data, admin or AI', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bine ai revenit' })).toBeVisible();
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  for (const path of ['/api/account', '/api/admin', '/api/data?kind=documents'])
    expect((await request.get(path)).status()).toBe(401);
  for (const path of ['/api/solve', '/api/analyze', '/api/evaluate', '/api/admin', '/api/data'])
    expect((await request.post(path, { data: {} })).status()).toBe(401);
  const reserved = await request.post('/api/auth', {
    data: { action: 'signup', email: 'ursud09@gmail.com', password: 'not-a-real-password-123' },
  });
  expect(reserved.status()).toBe(400);
});
