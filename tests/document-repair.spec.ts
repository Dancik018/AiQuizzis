import { test, expect } from './browser-fixture';
import { detectQuestions } from '../src/lib/detection';

test('saved merged translations repair on reload, with a clear notice and image filter', async ({
  page,
}) => {
  await page.route('**/api/config', (r) => r.fulfill({ json: { ai: false } }));
  await page.goto('/');
  const lines = [
    { text: '1. CS. Care este varianta corectă?', page: 1 },
    ...[
      'A. unu',
      'B. doi',
      'C. trei',
      'D. patru',
      'E. cinci',
      'SC. Which is the correct option?',
      'A. one',
      'B. two',
      'C. three',
      'D. four',
      'E. five',
      '2. CM. Selectați structurile indicate în imagine:',
      'A. Prima structură',
      'B. A doua structură',
    ].map((text) => ({ text, page: 1 })),
  ];
  const qs = detectQuestions(lines, 'repair', 'repair.pdf').questions;
  qs[0].options = [...qs[0].options, ...qs[0].options, ...qs[0].options];
  qs[0].originalOptions = [...qs[0].options];
  await page.evaluate(
    async (doc) => {
      const request = indexedDB.open('aiquiz', 1);
      const db = await new Promise<IDBDatabase>(
        (resolve) => (request.onsuccess = () => resolve(request.result)),
      );
      await new Promise<void>((resolve) => {
        const tx = db.transaction('documents', 'readwrite');
        tx.objectStore('documents').put(doc);
        tx.oncomplete = () => resolve();
      });
      db.close();
    },
    {
      id: 'repair',
      name: 'repair.pdf',
      createdAt: '2026-09-23',
      lines,
      questions: qs,
      pages: 1,
      status: 'partial',
      rejected: 0,
      duplicates: 0,
    },
  );
  await page.reload();
  await expect(page.getByText(/Am reparat separarea/)).toBeVisible();
  await page.getByRole('button', { name: 'Vezi întrebările' }).click();
  await expect(page.getByText('Pagina 1 · 5 variante')).toBeVisible();
  await page.getByRole('combobox').selectOption('images');
  await expect(page.getByText('Necesită imaginea sursă')).toBeVisible();
  await expect(page.getByText(/Consultă diagrama de la pagina 1/)).toBeVisible();
});
