import { test, expect } from '@playwright/test';
import { docxFixture, pdfFixture } from './fixtures';
for (const [format, count] of [
  ['docx', 150],
  ['pdf', 200],
  ['docx', 450],
] as const) {
  test(`progressive ${format} ${count}: play from 20, prepare in background, catch up and resume`, async ({
    page,
  }) => {
    await page.route('**/api/config', (r) =>
      r.fulfill({
        json: {
          ai: true,
          provider: 'openai',
          batchSize: 20,
          providers: [{ id: 'openai', maxQuestions: 20, tokenBudget: 6500, intervalMs: 500 }],
        },
      }),
    );
    let calls = 0;
    let released = false;
    const solvedIds = new Set<string>();
    await page.route('**/api/solve', async (r) => {
      const data = r.request().postDataJSON();
      calls++;
      if (calls > 1) while (!released) await new Promise((resolve) => setTimeout(resolve, 50));
      const questions = data.questions.map((q: { id: string; options: string[] }) => {
        solvedIds.add(q.id);
        return {
          ...q,
          status: 'verified',
          solved: true,
          reviewed: false,
          id: q.id,
          language: 'ro',
          languageConfidence: 1,
          correctOptionIndex: 1,
          correctAnswer: q.options[1],
          generatedOptions: [],
          answerConfidence: 1,
          explanation: '',
        };
      });
      await r.fulfill({ json: { questions } }).catch(() => {});
    });
    const lines = Array.from({ length: count }, (_, i) => [
      { text: `${i + 1}. Care este rezultatul adunarii ${i + 1} cu 1?`, page: 1 },
      { text: `A. ${i + 1}`, page: 1 },
      { text: `B. ${i + 2}`, page: 1 },
    ]).flat();
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles({
      name: `progressive-${count}.${format}`,
      mimeType:
        format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: format === 'pdf' ? await pdfFixture(lines) : docxFixture(lines),
    });
    await expect(page.getByText('20 pregătite', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Quiz Rapid', exact: true }).click();
    await expect(page.getByText(`ÎNTREBAREA 1 / ${count}`, { exact: true })).toBeVisible();
    await page.locator('.answer').filter({ hasText: /^\w2$/ }).click();
    await page.getByRole('button', { name: 'Verifică', exact: true }).click();
    await expect(page.locator('.feedback')).toContainText('Corect');
    await page.getByRole('button', { name: 'Mergi la întrebarea 21', exact: true }).click();
    await expect(page.getByText('Se pregătesc următoarele întrebări...')).toBeVisible();
    released = true;
    await expect(page.locator('.quiz-question')).toContainText('21 cu 1');
    await page.reload();
    await expect(page.getByText(`ÎNTREBAREA 21 / ${count}`, { exact: true })).toBeVisible();
    await expect(page.getByText(`1 răspunse · ${count - 1} nerăspunse`)).toBeVisible();
    await expect(page.getByText(`Pregătire AI: ${count} / ${count}`, { exact: true })).toBeVisible({
      timeout: 60000,
    });
    expect(solvedIds.size).toBe(count);
  });
}

test('manual variants save immediately and bulk generation only sends remaining open questions', async ({
  page,
}) => {
  await page.route('**/api/config', (r) =>
    r.fulfill({
      json: {
        ai: true,
        provider: 'openai',
        batchSize: 20,
        providers: [{ id: 'openai', maxQuestions: 20, tokenBudget: 6500, intervalMs: 0 }],
      },
    }),
  );
  const received: string[] = [];
  await page.route('**/api/solve', (r) => {
    const data = r.request().postDataJSON();
    expect(data.generateOptions).toBe(true);
    return r.fulfill({
      json: {
        questions: data.questions.map((q: { id: string; options: string[] }) => {
          expect(q.options).toHaveLength(0);
          received.push(q.id);
          return {
            ...q,
            status: 'verified',
            solved: true,
            reviewed: false,
            id: q.id,
            language: 'ro',
            languageConfidence: 1,
            correctOptionIndex: 1,
            correctAnswer: '2',
            options: ['1', '2', '3', '4'],
            type: 'multiple_choice',
            generatedOptions: [],
            answerConfidence: 1,
            explanation: '',
          };
        }),
      },
    });
  });
  await page.goto('/');
  await page.getByLabel('Generează variante pentru întrebările fără opțiuni').uncheck();
  await page.locator('input[type=file]').setInputFiles({
    name: 'options.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxFixture([
      { text: '1. Care este rezultatul adunarii 1 cu 1?', page: 1 },
      { text: 'Raspuns: 2', page: 1 },
      { text: '2. Care este rezultatul impartirii 4 la 2?', page: 1 },
      { text: 'Raspuns: 2', page: 1 },
      { text: '3. Care este rezultatul scaderii 3 minus 1?', page: 1 },
      { text: 'A. 1', page: 1 },
      { text: 'B. 2', page: 1 },
      { text: 'Raspuns: B', page: 1 },
    ]),
  });
  await page.getByRole('button', { name: 'Vezi întrebările' }).click();
  await page.getByRole('button', { name: 'Editează întrebarea 1', exact: true }).click();
  await page.getByRole('button', { name: 'Generează variante', exact: true }).click();
  await expect(page.getByLabel('Varianta B', { exact: true })).toHaveValue('2');
  await page.getByRole('button', { name: 'Închide editorul' }).click();
  await page.getByRole('button', { name: 'Generează variante pentru toate', exact: true }).click();
  await expect(page.locator('.row-meta').getByText(/4 variante/)).toHaveCount(2);
  expect(received.length).toBe(2);
  expect(new Set(received).size).toBe(2);
});

test('exact repeated questions reuse validated local cache across documents', async ({ page }) => {
  await page.route('**/api/config', (r) =>
    r.fulfill({
      json: {
        ai: true,
        provider: 'openai',
        batchSize: 50,
        minReady: 20,
        providers: [
          {
            id: 'openai',
            model: 'gpt-5.6-luna',
            maxQuestions: 50,
            tokenBudget: 16000,
            intervalMs: 0,
            concurrency: 5,
          },
        ],
      },
    }),
  );
  let calls = 0;
  await page.route('**/api/solve', (r) => {
    calls++;
    const body = r.request().postDataJSON();
    return r.fulfill({
      json: {
        questions: body.questions.map((q: { id: string; options: string[] }) => ({
          ...q,
          status: 'verified',
          solved: true,
          reviewed: false,
          id: q.id,
          language: 'ro',
          languageConfidence: 1,
          correctOptionIndex: 1,
          correctAnswer: q.options[1],
          generatedOptions: [],
          answerConfidence: 1,
          explanation: '',
        })),
      },
    });
  });
  const buffer = docxFixture([
    { text: '1. Care este rezultatul adunarii 1 cu 1?', page: 1 },
    { text: 'A. 1', page: 1 },
    { text: 'B. 2', page: 1 },
  ]);
  await page.goto('/');
  for (let i = 0; i < 2; i++) {
    await page.locator('input[type=file]').setInputFiles({
      name: `cache-${i}.docx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer,
    });
    await expect(page.getByText('1 pregătite', { exact: true })).toHaveCount(i + 1);
    await expect(
      page.getByRole('button', { name: 'Selectează fișier', exact: true }),
    ).toBeEnabled();
  }
  expect(calls).toBe(1);
});

test('generated options are cached after independent verification without repeating AI', async ({
  page,
}) => {
  await page.route('**/api/config', (r) =>
    r.fulfill({
      json: {
        ai: true,
        provider: 'openai',
        batchSize: 50,
        minReady: 20,
        providers: [
          {
            id: 'openai',
            model: 'gpt-5.6-luna',
            maxQuestions: 50,
            tokenBudget: 16000,
            intervalMs: 0,
            concurrency: 5,
          },
        ],
      },
    }),
  );
  let calls = 0;
  await page.route('**/api/solve', (r) => {
    calls++;
    const body = r.request().postDataJSON();
    return r.fulfill({
      json: {
        questions: body.questions.map((q: { id: string; options: string[] }) => ({
          ...q,
          status: body.strong ? 'verified' : 'verifying',
          verification: body.strong ? 'independent' : 'single',
          strengthened: Boolean(body.strong),
          options: ['1', '2', '3', '4'],
          solved: true,
          reviewed: false,
          id: q.id,
          language: 'ro',
          languageConfidence: 1,
          correctOptionIndex: 1,
          correctAnswer: '2',
          generatedOptions: [],
          answerConfidence: 1,
          explanation: '',
        })),
      },
    });
  });
  const buffer = docxFixture([{ text: '1. Care este rezultatul adunarii 1 cu 1?', page: 1 }]);
  await page.goto('/');
  for (let i = 0; i < 2; i++) {
    await page.locator('input[type=file]').setInputFiles({
      name: `cache-${i}.docx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer,
    });
    await expect(page.getByText('1 pregătite', { exact: true })).toHaveCount(i + 1);
    await expect(
      page.getByRole('button', { name: 'Selectează fișier', exact: true }),
    ).toBeEnabled();
  }
  expect(calls).toBe(2);
});

test('upload before delayed AI configuration starts automatically when configuration arrives', async ({
  page,
}) => {
  let release!: () => void;
  const configReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/config', async (r) => {
    await configReady;
    await r.fulfill({
      json: {
        ai: true,
        provider: 'openai',
        batchSize: 50,
        requestIntervalMs: 0,
        providers: [
          { id: 'openai', maxQuestions: 50, tokenBudget: 16000, intervalMs: 0, concurrency: 5 },
        ],
      },
    });
  });
  let calls = 0;
  await page.route('**/api/solve', (r) => {
    calls++;
    const body = r.request().postDataJSON();
    return r.fulfill({
      json: {
        questions: body.questions.map((q: Record<string, unknown>) => ({
          ...q,
          status: 'verified',
          solved: true,
          reviewed: false,
          language: 'ro',
          languageConfidence: 1,
          correctOptionIndex: 1,
          correctOptionIndices: [1],
          correctAnswer: '2',
          answerConfidence: 1,
          explanation: '',
        })),
      },
    });
  });
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'delayed-config.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxFixture([
      { text: '1. Care este rezultatul adunării 1 cu 1?', page: 1 },
      { text: 'A. 1', page: 1 },
      { text: 'B. 2', page: 1 },
    ]),
  });
  await expect(page.getByText('delayed-config.docx', { exact: true })).toBeVisible();
  expect(calls).toBe(0);
  release();
  await expect(page.getByText('1 pregătite', { exact: true })).toBeVisible();
  expect(calls).toBe(1);
});
