import { test, expect } from '@playwright/test';
import { docxFixture, pdfFixture, numberedDocxFixture } from './fixtures';

test('real DOCX extraction: 450 questions, review, existing-file quiz, exam, refresh, results and retry', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'acceptance-450.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxFixture(),
  });
  await expect(page.getByText('450 pregătite', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Vezi întrebările' }).click();
  await expect(page.locator('.review-row')).toHaveCount(15);
  await page.getByRole('button', { name: 'Editează întrebarea 1', exact: true }).click();
  await expect(page.getByLabel('Varianta B', { exact: true })).toHaveValue('2');
  await page.getByRole('button', { name: 'Închide editorul' }).click();
  await page.getByRole('button', { name: 'Documente', exact: true }).last().click();
  await page.reload();
  await expect(page.getByText('450 pregătite', { exact: true })).toBeVisible();
  await page.locator('.document-footer').getByRole('button', { name: 'Generează Quiz' }).click();
  await page.getByLabel('Număr întrebări').selectOption('10');
  await page.getByRole('combobox', { name: 'Mod', exact: true }).selectOption('exam');
  await page.getByRole('button', { name: 'Începe Quiz' }).click();
  await expect(page.locator('.quiz-question')).toHaveText('Care este rezultatul adunarii 1 cu 1?');
  await page.locator('.answer').filter({ hasText: /^\w2$/ }).click();
  await page.getByRole('button', { name: 'Salvează răspunsul' }).click();
  await expect(page.locator('.feedback')).toHaveCount(0);
  await expect(page.getByText('1 răspunse · 9 nerăspunse')).toBeVisible();
  await page.reload();
  await expect(page.getByText('1 răspunse · 9 nerăspunse')).toBeVisible();
  await page.getByRole('button', { name: 'Următoarea', exact: true }).click();
  await page.locator('.answer').filter({ hasText: /^\w2$/ }).click();
  await page.getByRole('button', { name: 'Salvează răspunsul' }).click();
  await page.getByRole('button', { name: 'Finalizează quiz', exact: true }).click();
  await page.getByRole('button', { name: 'Finalizează', exact: true }).click();
  await expect(page.locator('.result-panel h1')).toHaveText('10%');
  await page.getByRole('button', { name: 'Reîncearcă greșelile' }).click();
  await expect(page.getByText('ÎNTREBAREA 1 / 1', { exact: true })).toBeVisible();
});

test('real large colored PDF extracts every page and preserves 450 questions', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'acceptance-450.pdf',
    mimeType: 'application/pdf',
    buffer: await pdfFixture(),
  });
  await expect(page.getByText('450 pregătite', { exact: true })).toBeVisible({ timeout: 90000 });
  await page.getByRole('button', { name: 'Quiz Rapid', exact: true }).click();
  await expect(page.getByText('ÎNTREBAREA 1 / 450', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mergi la întrebarea 450', exact: true }).click();
  await expect(page.locator('.quiz-question')).toHaveText(
    'Care este rezultatul adunarii 450 cu 1?',
  );
  await page.getByLabel('Răspunsul tău', { exact: true }).fill('451');
  await page.getByRole('button', { name: 'Verifică', exact: true }).click();
  await expect(page.locator('.feedback')).toContainText('Corect!');
});

test('browser OCR availability and invalid requests return safe Romanian errors', async ({
  request,
}) => {
  const invalid = await request.post('/api/solve', { data: { questions: [] } });
  expect(invalid.status()).toBe(400);
  const config = await request.get('/api/config');
  expect(await config.json()).toMatchObject({ ocr: true, ocrProvider: 'browser' });
  const foreign = await request.post('/api/evaluate', {
    headers: { origin: 'https://attacker.example' },
    data: { question: 'Test', expected: 'Test', answer: 'Test' },
  });
  expect(foreign.status()).toBe(403);
});

test('mobile interface fits viewport and supports dark theme on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Selectează fișier' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Întunecată', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('AI batch failure automatically retries only unfinished items', async ({ page }) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { ai: true, ocr: false, batchSize: 10 } }),
  );
  let calls = 0;
  const received: string[][] = [];
  await page.route('**/api/solve', async (route) => {
    calls++;
    const body = route.request().postDataJSON();
    received.push(body.questions.map((q: { id: string }) => q.id));
    if (calls === 2)
      return route.fulfill({
        status: 502,
        json: { error: 'Lot eșuat pentru testul de recuperare.' },
      });
    await route.fulfill({
      json: {
        questions: body.questions.map((q: { id: string; options: string[] }) => ({
          ...q,
          status: 'verified',
          solved: true,
          reviewed: false,
          id: q.id,
          language: 'ro',
          languageConfidence: 0.99,
          correctOptionIndex: 1,
          correctAnswer: q.options[1],
          generatedOptions: [],
          answerConfidence: 0.99,
          explanation: 'Rezultat de test controlat.',
        })),
      },
    });
  });
  const lines = Array.from({ length: 25 }, (_, i) => [
    { text: `${i + 1}. Care este numarul corect pentru testul ${i + 1}?`, page: 1 },
    { text: 'A. 1', page: 1 },
    { text: 'B. 2', page: 1 },
  ]).flat();
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'batch-retry.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxFixture(lines),
  });
  await expect(page.getByText('25 pregătite', { exact: true })).toBeVisible();
  expect(calls).toBe(4);
  expect(received[3]).toEqual(received[1]);
  expect(
    received
      .slice(1)
      .flat()
      .some((id) => received[0].includes(id)),
  ).toBe(false);
  await page.getByRole('button', { name: 'Quiz Rapid' }).click();
  await page.locator('.answer').filter({ hasText: /^\w2$/ }).click();
  await page.getByRole('button', { name: 'Verifică', exact: true }).click();
  await expect(page.locator('.feedback')).toContainText('Corect!');
});

test('corrupt PDF reports an actionable error without adding fake documents', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'broken.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('not a pdf'),
  });
  await expect(page.locator('.global-error')).toContainText('Fișierul nu este un PDF valid');
  await expect(page.locator('.document-card')).toHaveCount(0);
});

test('Word automatic lists, diacritics, blue Romanian and manual editor persist correctly', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'lists.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: numberedDocxFixture(),
  });
  await expect(page.getByText('2 pregătite', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Vezi întrebările' }).click();
  await page.getByRole('button', { name: 'Editează întrebarea 1', exact: true }).click();
  await expect(page.getByLabel('Varianta B', { exact: true })).toHaveValue('Chișinău');
  await page.getByRole('combobox', { name: 'Tip', exact: true }).selectOption('open');
  await page.getByRole('checkbox', { name: 'Am verificat întrebarea, limba și răspunsul' }).check();
  await page.getByRole('button', { name: 'Salvează', exact: true }).click();
  await page.getByRole('button', { name: 'Documente', exact: true }).last().click();
  await page.reload();
  await page.getByRole('button', { name: 'Quiz Rapid' }).click();
  await page.getByLabel('Răspunsul tău', { exact: true }).fill(' CHISINAU! ');
  await page.getByRole('button', { name: 'Verifică', exact: true }).click();
  await expect(page.locator('.feedback')).toContainText('Corect!');
});
