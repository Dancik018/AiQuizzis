import { test, expect } from '@playwright/test';
test('unauthenticated visitors cannot upload or access cloud data, admin or AI', async ({
  page,
  request,
}) => {
  await page.goto('/');
  let privateReads = 0;
  page.on('request', (r) => {
    if (r.url().includes('/api/data')) privateReads++;
  });
  await expect(page.getByRole('button', { name: 'Selectează fișier' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bine ai revenit' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Selectează fișier' }).click();
  await expect(page.getByRole('heading', { name: 'Bine ai revenit' })).toBeVisible();
  await expect(page.getByText(/Ai nevoie de un cont pentru a încărca/)).toBeVisible();
  await page.getByRole('button', { name: 'Înapoi la pagina principală' }).click();
  await expect(page.getByRole('button', { name: 'Selectează fișier' })).toBeVisible();
  await page.locator('.upload-zone').evaluate((el) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(['private'], 'test.pdf', { type: 'application/pdf' }));
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
  });
  await expect(page.getByText(/Ai nevoie de un cont pentru a încărca/)).toBeVisible();
  expect(privateReads).toBe(0);
  for (const path of ['/api/account', '/api/admin', '/api/data?kind=documents'])
    expect((await request.get(path)).status()).toBe(401);
  for (const path of ['/api/solve', '/api/analyze', '/api/evaluate', '/api/admin', '/api/data'])
    expect((await request.post(path, { data: {} })).status()).toBe(401);
  expect((await request.delete('/api/admin', { data: {} })).status()).toBe(401);
  const reserved = await request.post('/api/auth', {
    data: { action: 'signup', email: 'ursud09@gmail.com', password: 'not-a-real-password-123' },
  });
  expect(reserved.status()).toBe(400);
});
