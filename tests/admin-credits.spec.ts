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
  let deleted = false;
  await page.route('**/api/account', (r) => r.fulfill({ json: { user: admin } }));
  await page.route('**/api/auth', (r) => r.fulfill({ json: { configured: true, google: true } }));
  await page.route('**/api/data**', (r) => r.fulfill({ json: { items: [] } }));
  await page.route('**/api/admin**', async (r) => {
    if (r.request().method() === 'DELETE') {
      expect(r.request().postDataJSON()).toEqual({ id: user.id, email: user.email });
      deleted = true;
      await r.fulfill({ json: { ok: true } });
    } else if (r.request().method() === 'POST') {
      const amount = r.request().postDataJSON().credits;
      changes.push(amount);
      user.credits += amount;
      await r.fulfill({ json: { ok: true } });
    } else
      await r.fulfill({
        json: { users: deleted ? [admin] : [admin, user], total: deleted ? 1 : 2 },
      });
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
  const remove = page.getByRole('button', { name: 'Șterge definitiv contul', exact: true });
  await expect(remove).toHaveCount(1);
  page.once('dialog', (d) => d.dismiss());
  await remove.click();
  expect(deleted).toBe(false);
  page.once('dialog', (d) => d.accept('wrong@example.test'));
  await remove.click();
  await expect(page.locator('.admin-shell').getByRole('alert')).toContainText('nu corespunde');
  expect(deleted).toBe(false);
  page.once('dialog', (d) => d.accept(user.email));
  await remove.click();
  await expect(page.locator('.admin-shell').getByRole('status')).toContainText('au fost șterse');
  await expect(page.getByRole('heading', { name: user.email, exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: admin.email, exact: true })).toBeVisible();
});
