import { test, expect } from './browser-fixture';
import { docxFixture, pdfFixture } from './fixtures';
import type { DocumentSet } from '../src/lib/model';
test.use({ documentMode: 'study' });
const material = [
  { text: 'Capitol 1 - Sisteme de laborator', page: 1 },
  ...Array.from({ length: 80 }, (_, i) => [
    {
      text: `Protocolul experimental P${i} transmite mesajele numai prin portul ${1000 + i}.`,
      page: 1,
    },
    {
      text: `Acest port este rezervat pentru laboratorul numarul ${i} din cadrul cursului.`,
      page: 1,
    },
    {
      text: 'Datele sunt confirmate inainte de urmatoarea transmisie, conform regulilor stabilite.',
      page: 1,
    },
  ]).flat(),
];
for (const extension of ['pdf', 'docx'])
  test(`study ${extension}: real extraction, capacity, progressive play and refresh`, async ({
    page,
  }) => {
    if (extension === 'docx') await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/config', (r) =>
      r.fulfill({
        json: {
          ai: true,
          ocr: false,
          batchSize: 20,
          minReady: 20,
          providers: [],
          provider: 'openai',
          requestIntervalMs: 0,
        },
      }),
    );
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    await page.route('**/api/study', async (r) => {
      calls++;
      if (calls === 2) await gate;
      const id = r.request().postDataJSON().documentId;
      const doc = await page.evaluate(async (id) => {
        const open = indexedDB.open('aiquiz', 1);
        const db = await new Promise<IDBDatabase>((r) => {
          open.onsuccess = () => r(open.result);
        });
        const req = db.transaction('documents').objectStore('documents').get(id);
        return await new Promise<DocumentSet>((r) => {
          req.onsuccess = () => r(req.result);
        });
      }, id);
      const questions = doc.questions
        .filter((q) => !q.solved)
        .slice(0, 20)
        .map((q, i) => ({
          ...q,
          question: `Ce port este rezervat protocolului P${(calls - 1) * 20 + i}?`,
          type: 'multiple_choice',
          options: ['Portul special', 'Portul secundar', 'Portul auxiliar', 'Portul comun'],
          originalOptions: [],
          correctOptionIndex: 0,
          correctAnswer: 'Portul special',
          status: 'verified',
          solved: true,
          answerConfidence: 0.95,
          verification: 'independent',
          sourceQuote: material[1].text,
          sourceSection: 'Sisteme de laborator',
          conceptKey: q.id,
        }));
      await r.fulfill({ json: { questions } });
    });
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles({
      name: `curs.${extension}`,
      mimeType:
        extension === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: extension === 'pdf' ? await pdfFixture(material) : docxFixture(material),
    });
    await expect(page.getByRole('dialog', { name: 'Tipul documentului' })).toBeVisible();
    await page.getByRole('button', { name: 'Document cu informații / material de studiu' }).click();
    await expect(page.getByRole('dialog', { name: 'Material de studiu' })).toBeVisible();
    await page.screenshot({ path: `work/study-${extension}.png` });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByLabel('Număr personalizat').fill('201');
    await expect(page.getByRole('button', { name: 'Generează din material' })).toBeDisabled();
    await page.getByLabel('Număr personalizat').fill('40');
    await page.getByLabel('Tipul întrebărilor').selectOption('multiple_choice');
    await page.getByRole('button', { name: 'Generează din material' }).click();
    await expect(page.getByText('20 pregătite', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Quiz Rapid', exact: true }).click();
    await expect(page.locator('.quiz-question')).toContainText('Ce port');
    await expect(page.getByText('ÎNTREBAREA 1 / 40', { exact: true })).toBeVisible();
    await page.locator('.answer').filter({ hasText: 'Portul special' }).click();
    await page.getByRole('button', { name: 'Verifică', exact: true }).click();
    await expect(page.locator('.feedback')).toContainText('Corect');
    release();
    await expect(page.getByText('Pregătire AI: 40 / 40', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('1 răspunse · 39 nerăspunse')).toBeVisible();
    expect(calls).toBe(2);
    await page.getByRole('button', { name: 'Mergi la întrebarea 40', exact: true }).click();
    await expect(page.locator('.quiz-question')).toContainText('P39');
  });
