import { test, expect } from '@playwright/test';
import { docxFixture } from './fixtures';

test('multiple correct answers use independent selections and set-based grading', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'multiple.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxFixture([
      { text: '1. Care dintre următoarele numere sunt pare?', page: 1 },
      { text: 'A. 2', page: 1 },
      { text: 'B. 3', page: 1 },
      { text: 'C. 4', page: 1 },
      { text: 'Raspuns: A, C', page: 1 },
    ]),
  });
  await expect(page.getByText('1 pregătite', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Quiz Rapid', exact: true }).click();
  await expect(page.getByText('Selectează toate răspunsurile corecte.')).toBeVisible();
  await expect(page.locator('.answer.correct')).toHaveCount(0);
  await page.locator('.answer').filter({ hasText: /^\w4$/ }).click();
  await page.locator('.answer').filter({ hasText: /^\w2$/ }).click();
  await page.getByRole('button', { name: 'Verifică', exact: true }).click();
  await expect(page.locator('.feedback')).toContainText('Corect!');
});

test('history resumes the same 100-question session and confirms restart', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'history.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxFixture(),
  });
  await expect(page.getByText('450 pregătite', { exact: true })).toBeVisible();
  await page.locator('.document-footer').getByRole('button', { name: 'Generează Quiz' }).click();
  await page.getByLabel('Număr întrebări').selectOption('100');
  await page.getByRole('button', { name: 'Începe Quiz' }).click();
  await page.locator('.answer').filter({ hasText: /^\w2$/ }).click();
  await page.getByRole('button', { name: 'Verifică', exact: true }).click();
  await page.getByRole('button', { name: 'Următoarea', exact: true }).click();
  await page.getByRole('button', { name: 'Salvează și ieși' }).click();
  await page.reload();
  await expect(page.getByText('Continuă de unde ai rămas')).toHaveCount(0);
  await page.getByRole('button', { name: /Istoric/ }).click();
  await expect(page.locator('.history-row')).toHaveCount(1);
  await expect(page.locator('.history-row')).toContainText('1 / 100 răspunse');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Reîncepe', exact: true }).click();
  await expect(page.locator('.history-row')).toContainText('1 / 100 răspunse');
  await page.getByRole('button', { name: 'Continuă Quiz', exact: true }).click();
  await expect(page.getByText('ÎNTREBAREA 2 / 100', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Finalizează quiz', exact: true }).click();
  await page.getByRole('button', { name: 'Finalizează', exact: true }).click();
  await expect(page.locator('.result-panel h1')).toHaveText('1%');
  await page.getByRole('button', { name: /Istoric/ }).click();
  await expect(page.locator('.history-row')).toHaveCount(1);
  await expect(page.locator('.history-row')).toContainText('1%');
});

test('manual quiz never shows an embedded Bohr answer before submission', async ({ page }) => {
  await page.route('**/api/config', (r) =>
    r.fulfill({
      json: {
        ai: true,
        provider: 'openai',
        batchSize: 20,
        minReady: 20,
        providers: [{ id: 'openai', maxQuestions: 20, tokenBudget: 16000, intervalMs: 0 }],
      },
    }),
  );
  await page.route('**/api/solve', (r) => {
    const q = r.request().postDataJSON().questions[0];
    expect(q.question).not.toContain('Pe orbite');
    return r.fulfill({
      json: {
        questions: [
          {
            ...q,
            status: 'verified',
            solved: true,
            language: 'ro',
            languageConfidence: 0.99,
            answerConfidence: 0.99,
            correctAnswer: 'Pe orbite circulare staționare, cu moment cinetic cuantizat.',
            answerLeakage: false,
          },
        ],
      },
    });
  });
  await page.goto('/');
  await page.getByLabel('Generează variante pentru întrebările fără opțiuni').uncheck();
  await page.locator('input[type=file]').setInputFiles({
    name: 'bohr.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxFixture([
      {
        text: 'Conform primului postulat al lui Bohr, electronii se rotesc pe ce tip de orbite? Pe orbite circulare staționare, cu moment cinetic cuantizat.',
        page: 1,
      },
    ]),
  });
  await expect(page.getByText('1 pregătite', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Quiz Rapid', exact: true }).click();
  await expect(page.locator('.quiz-question')).toHaveText(
    'Conform primului postulat al lui Bohr, electronii se rotesc pe ce tip de orbite?',
  );
  await expect(
    page.getByText('Pe orbite circulare staționare, cu moment cinetic cuantizat.', { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('.feedback')).toHaveCount(0);
});
