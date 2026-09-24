import { test as base, expect } from '@playwright/test';
// Legacy functional UI tests use an authenticated account and an isolated browser-backed
// cloud transport fixture. Real authorization/RLS is tested separately, without this fixture.
export const test = base.extend({
  page: async ({ page }, providePage) => {
    await page.addInitScript(() => {
      const r = indexedDB.open('aiquiz', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('documents', { keyPath: 'id' });
        r.result.createObjectStore('sessions', { keyPath: 'id' });
      };
    });
    await page.route('**/api/account', (r) =>
      r.fulfill({
        json: {
          user: {
            id: 'e2e-user',
            email: 'learner@example.test',
            is_admin: false,
            credits: 2,
            disabled: false,
            must_change_password: false,
            created_at: '2026-09-23',
          },
        },
      }),
    );
    await page.route('**/api/auth', (r) =>
      r.fulfill({ json: { configured: true, google: false } }),
    );
    const versions = new Map<string, number>();
    await page.route('**/api/data**', async (r) => {
      const method = r.request().method();
      const data = method === 'GET' ? null : r.request().postDataJSON();
      const kind =
        method === 'GET'
          ? new URL(r.request().url()).searchParams.get('kind')
          : method === 'DELETE'
            ? 'documents'
            : data.kind;
      const items = await page
        .evaluate(
          async ({ method, data, kind }) => {
            const request = indexedDB.open('aiquiz', 1);
            const db = await new Promise<IDBDatabase>(
              (resolve) => (request.onsuccess = () => resolve(request.result)),
            );
            const result = await new Promise<unknown>((resolve) => {
              const tx = db.transaction(kind, method === 'GET' ? 'readonly' : 'readwrite');
              const store = tx.objectStore(kind);
              const op =
                method === 'GET'
                  ? store.getAll()
                  : method === 'DELETE'
                    ? store.delete(data.id)
                    : store.put(data.data);
              op.onsuccess = () => resolve(op.result);
            });
            db.close();
            return result;
          },
          { method, data, kind },
        )
        .catch(async (error: Error) => {
          if (!/Execution context was destroyed|Target page.*closed/.test(error.message))
            throw error;
          await r.abort().catch(() => {});
          return null;
        });
      if (items === null) return;
      if (method === 'GET')
        return r.fulfill({
          json: {
            items: (items as { id: string }[]).map((d) => ({
              data: d,
              version: versions.get(kind + ':' + d.id) || 1,
            })),
          },
        });
      const version = (versions.get(kind + ':' + data?.data?.id) || 0) + 1;
      versions.set(kind + ':' + data?.data?.id, version);
      await r.fulfill({ json: { version, ok: true } });
    });
    await providePage(page);
  },
});
export { expect };

export type { Page } from '@playwright/test';
