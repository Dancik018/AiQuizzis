import { test, expect } from '@playwright/test';
import { docxFixture } from './fixtures';

const document = {
  name: 'retry.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  buffer: docxFixture([
    { text: '1. Care este rezultatul adunarii 1 cu 1?', page: 1 },
    { text: 'A. 1', page: 1 },
    { text: 'B. 2', page: 1 },
  ]),
};

test('rate-limit wait can be stopped and its deadline survives refresh', async ({ page }) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { ai: true, provider: 'gemini', batchSize: 10, requestIntervalMs: 0 } }),
  );
  let calls = 0;
  await page.route('**/api/solve', (route) => {
    calls++;
    return route.fulfill({
      status: 429,
      headers: { 'Retry-After': '30' },
      json: { code: 'RATE_LIMIT', error: 'Temporary limit' },
    });
  });
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles(document);
  await expect(page.getByText(/Reîncercare automată în/)).toBeVisible();
  await page.getByRole('button', { name: 'Oprește după lotul curent' }).click();
  await expect(page.getByRole('button', { name: 'Reîncearcă loturile rămase' })).toBeEnabled();
  await page.reload();
  await page.getByRole('button', { name: 'Reîncearcă loturile rămase' }).click();
  await expect(page.getByText(/Următorul lot în/)).toBeVisible();
  expect(calls).toBe(1);
  await page.getByRole('button', { name: 'Oprește după lotul curent' }).click();
});

test('temporary limit automatically retries the same batch and enables quiz', async ({ page }) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { ai: true, provider: 'gemini', batchSize: 10, requestIntervalMs: 0 } }),
  );
  let calls = 0;
  let id = '';
  await page.route('**/api/solve', (route) => {
    const q = route.request().postDataJSON().questions[0];
    calls++;
    if (calls === 1) {
      id = q.id;
      return route.fulfill({
        status: 429,
        headers: { 'Retry-After': '2' },
        json: { code: 'RATE_LIMIT', error: 'Temporary limit' },
      });
    }
    expect(q.id).toBe(id);
    return route.fulfill({
      json: {
        questions: [
          {
            id: q.id,
            language: 'ro',
            languageConfidence: 0.99,
            correctOptionIndex: 1,
            correctAnswer: '2',
            generatedOptions: [],
            answerConfidence: 0.99,
            explanation: 'Adunare.',
          },
        ],
      },
    });
  });
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles(document);
  await expect(page.getByText(/Reîncercare automată în/)).toBeVisible();
  await expect(page.getByText('1 pregătite', { exact: true })).toBeVisible();
  expect(calls).toBe(2);
  await page.getByRole('button', { name: 'Quiz Rapid', exact: true }).click();
  await expect(page.locator('.quiz-question')).toContainText('1 cu 1');
});

test('daily quota stops without retrying or losing the saved document', async ({ page }) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { ai: true, provider: 'gemini', batchSize: 10, requestIntervalMs: 0 } }),
  );
  let calls = 0;
  await page.route('**/api/solve', (route) => {
    calls++;
    return route.fulfill({
      status: 503,
      json: { code: 'AI_QUOTA', error: 'Cota zilnică este epuizată.' },
    });
  });
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles(document);
  await expect(page.getByText('Cota zilnică este epuizată.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reîncearcă loturile rămase' })).toBeEnabled();
  await page.reload();
  await expect(page.getByText('retry.docx', { exact: true })).toBeVisible();
  expect(calls).toBe(1);
});
