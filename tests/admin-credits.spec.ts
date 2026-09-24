import { test, expect } from '@playwright/test';
test('admin adds and removes the selected amount and cannot overdraw', async ({ page }) => {
  const admin = {
    id: 'admin-test',
    email: 'admin@example.test',
    is_admin: true,
    credits: 0,
    must_change_password: false,
    disabled: false,
    created_at: '2026-09-24',
  };
  const user = {
    ...admin,
    id: 'user-test',
    email: 'user@example.test',
    is_admin: false,
    credits: 5,
  };
  const changes: number[] = [];
  await page.route('**/api/account', (r) => r.fulfill({ json: { user: admin } }));
  await page.route('**/api/auth', (r) => r.fulfill({ json: { configured: true, google: true } }));
  await page.route('**/api/data**', (r) => r.fulfill({ json: { items: [] } }));
  await page.route('**/api/admin**', async (r) => {
    if (r.request().method() === 'POST') {
      const amount = r.request().postDataJSON().credits;
      changes.push(amount);
      user.credits += amount;
      await r.fulfill({ json: { ok: true } });
    } else await r.fulfill({ json: { users: [admin, user], total: 2 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Administrare', exact: true }).click();
  const amount = page.getByRole('spinbutton', {
    name: 'Număr de generări pentru user@example.test',
  });
  await amount.fill('3');
  await page.getByRole('button', { name: 'Elimină generări', exact: true }).click();
  await expect(page.getByText('2 generări disponibile', { exact: true })).toBeVisible();
  expect(changes).toEqual([-3]);
  await amount.fill('4');
  await page.getByRole('button', { name: 'Elimină generări', exact: true }).click();
  await expect(page.locator('.admin-shell').getByRole('alert')).toContainText('cel mult 2');
  expect(changes).toEqual([-3]);
  await amount.fill('2');
  await page.getByRole('button', { name: 'Elimină generări', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Elimină generări', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Adaugă generări', exact: true }).click();
  await expect(page.getByText('2 generări disponibile', { exact: true })).toBeVisible();
  expect(changes).toEqual([-3, -2, 2]);
});
