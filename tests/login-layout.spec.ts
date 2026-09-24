import { test, expect } from '@playwright/test';
test('login is readable on mobile and desktop and requested captions are absent', async ({
  page,
}) => {
  await page.route('**/api/auth', (r) =>
    r.fulfill({ json: { google: true, email: false, configured: true } }),
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Selectează fișier' })).toBeVisible();
  for (const text of [
    'Învățare asistată de AI',
    'OpenAI · Procesare paralelă cu salvare după fiecare lot.',
    'AIQuiz · Învață în ritmul tău.',
    'Română · Cont securizat · Progres salvat',
    'Progres salvat în cont',
  ])
    await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Autentificare / Creează cont' }).click();
  for (const [width, height, theme] of [
    [1440, 1000, 'light'],
    [390, 844, 'light'],
    [1440, 1000, 'dark'],
    [320, 740, 'dark'],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
    await expect(page.getByRole('heading', { name: 'Bine ai revenit' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Continuă cu Google', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const size = await page.getByRole('textbox', { name: 'Email', exact: true }).boundingBox();
    expect(size!.height).toBeGreaterThanOrEqual(48);
    await page.screenshot({
      path: `work/login-${width}-${theme}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
});
