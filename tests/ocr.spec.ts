import { test, expect, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function scannedPdf(page: Page) {
  const pdf = await PDFDocument.create();
  for (const number of [1, 2]) {
    const png = await page.evaluate((n) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 800;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 1200, 800);
      ctx.fillStyle = 'black';
      ctx.font = '32px Arial';
      const lines = [
        n + '. Care este rezultatul adunarii ' + n + ' cu 1?',
        'A. 0',
        'B. ' + (n + 1),
        'C. 9',
        'Raspuns corect: B',
      ];
      lines.forEach((line, i) => ctx.fillText(line, 70, 100 + i * 70));
      return canvas.toDataURL('image/png');
    }, number);
    const image = await pdf.embedPng(png);
    pdf.addPage([600, 400]).drawImage(image, { x: 0, y: 0, width: 600, height: 400 });
  }
  return Buffer.from(await pdf.save());
}

test('free OCR recognizes two real image-only PDF pages locally with one worker', async ({
  page,
}) => {
  await page.goto('/');
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.locator('input[type=file]').setInputFiles({
    name: 'scanned.pdf',
    mimeType: 'application/pdf',
    buffer: await scannedPdf(page),
  });
  await expect(page.getByText('2 pregătite', { exact: true })).toBeVisible({ timeout: 90000 });
  expect(requests.filter((url) => url.endsWith('/ocr/worker.min.js'))).toHaveLength(1);
  expect(requests.some((url) => url.includes('/api/ocr') || url.includes('googleapis.com'))).toBe(
    false,
  );
  await page.getByRole('button', { name: 'Quiz Rapid', exact: true }).click();
  await page.locator('.answer').filter({ hasText: /^\w2$/ }).click();
  await page.getByRole('button', { name: 'Verifică', exact: true }).click();
  await expect(page.locator('.feedback')).toContainText('Corect!');
  await page.getByRole('button', { name: 'Următoarea', exact: true }).click();
  await expect(page.locator('.quiz-question')).toContainText('2 cu 1');
});

test('OCR worker download failure produces a clear error without fake questions', async ({
  page,
}) => {
  await page.goto('/');
  await page.route('**/ocr/worker.min.js', (route) => route.abort());
  await page.locator('input[type=file]').setInputFiles({
    name: 'scanned.pdf',
    mimeType: 'application/pdf',
    buffer: await scannedPdf(page),
  });
  await expect(page.locator('.global-error')).toContainText('Motorul OCR gratuit', {
    timeout: 30000,
  });
  await expect(page.locator('.document-card')).toHaveCount(0);
});
