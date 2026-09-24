import { test, expect } from './browser-fixture';
import { docxFixture, pdfFixture, fixtureLines } from './fixtures';

for (const format of ['pdf', 'docx'] as const) {
  test(`${format}: all 450 unanswered questions reach the shared adaptive solver`, async ({
    page,
  }) => {
    await page.route('**/api/config', (route) =>
      route.fulfill({
        json: {
          ai: true,
          provider: 'openai',
          batchSize: 40,
          providers: [{ id: 'openai', maxQuestions: 40, tokenBudget: 6500, intervalMs: 0 }],
        },
      }),
    );
    const sizes: number[] = [];
    const ids = new Set<string>();
    await page.route('**/api/solve', async (route) => {
      const request = route.request().postDataJSON();
      expect(request.provider).toBe('openai');
      sizes.push(request.questions.length);
      await route.fulfill({
        json: {
          provider: 'openai',
          questions: request.questions.map(
            (q: { id: string; question: string; options: string[] }) => {
              expect(ids.has(q.id)).toBe(false);
              ids.add(q.id);
              const number = Number(q.question.match(/adunarii (\d+)/)?.[1]);
              return {
                ...q,
                status: 'verified',
                solved: true,
                reviewed: false,
                id: q.id,
                language: 'ro',
                languageConfidence: 0.99,
                correctOptionIndex: q.options.length ? 1 : null,
                correctAnswer: String(number + 1),
                generatedOptions: [],
                answerConfidence: 0.99,
                explanation: 'Adunare.',
              };
            },
          ),
        },
      });
    });
    const lines = fixtureLines().filter((line) => !line.text.startsWith('Raspuns:'));
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles({
      name: `unsolved-450.${format}`,
      mimeType:
        format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: format === 'pdf' ? await pdfFixture(lines) : docxFixture(lines),
    });
    await expect(page.getByText('450 pregătite', { exact: true })).toBeVisible({ timeout: 60000 });
    expect(ids.size).toBe(450);
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(16);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(40);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(450);
    await page.reload();
    await expect(page.getByText('450 pregătite', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Quiz Rapid', exact: true }).click();
    await expect(page.locator('.quiz-question')).toBeVisible();
    expect(ids.size).toBe(450);
  });
}
