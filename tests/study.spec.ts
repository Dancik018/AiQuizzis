import { PDFDocument, StandardFonts } from 'pdf-lib';
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

test('study PDF reads rasterized lesson text even when the title is selectable', async ({
  page,
}) => {
  await page.goto('/');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1100;
    canvas.height = 400;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 1100, 400);
    ctx.fillStyle = 'black';
    ctx.font = '28px Arial';
    [
      'Senzorul experimental ALBATROS masoara temperatura.',
      'Valorile sunt raportate in grade Celsius la fiecare minut.',
      'Aparatul nu masoara presiunea si nu masoara lumina.',
      'Rezultatele se salveaza dupa fiecare sesiune de laborator.',
    ].forEach((t, i) => ctx.fillText(t, 25, 60 + i * 65));
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const pdf = await PDFDocument.create();
  const sheet = pdf.addPage([600, 400]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  sheet.drawText('Material de laborator pentru studiu', { x: 20, y: 370, size: 18, font });
  sheet.drawImage(await pdf.embedPng(Buffer.from(png, 'base64')), {
    x: 15,
    y: 100,
    width: 570,
    height: 210,
  });
  await page.route('**/api/study', (r) =>
    r.fulfill({ status: 503, json: { code: 'AI_QUOTA', error: 'Test OCR finalizat' } }),
  );
  await page.locator('input[type=file]').setInputFiles({
    name: 'lesson-image.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  });
  await page.getByRole('button', { name: 'Document cu informații / material de studiu' }).click();
  await expect(page.getByRole('dialog', { name: 'Material de studiu' })).toBeVisible({
    timeout: 90000,
  });
  await page.getByLabel('Număr personalizat').fill('1');
  await page.getByRole('button', { name: 'Generează din material' }).click();
  await expect(page.getByText('Test OCR finalizat')).toBeVisible();
  const text = await page.evaluate(async () => {
    const req = indexedDB.open('aiquiz', 1);
    const db = await new Promise<IDBDatabase>(
      (resolve) => (req.onsuccess = () => resolve(req.result)),
    );
    const get = db.transaction('documents').objectStore('documents').getAll();
    const docs = await new Promise<DocumentSet[]>(
      (resolve) => (get.onsuccess = () => resolve(get.result)),
    );
    db.close();
    return docs.flatMap((d) => d.lines.map((l) => l.text)).join(' ');
  });
  expect(text).toContain('ALBATROS');
  expect(text.toLowerCase()).toContain('celsius');
  const originalId = await page.evaluate(async () => {
    const req = indexedDB.open('aiquiz', 1);
    const db = await new Promise<IDBDatabase>(
      (resolve) => (req.onsuccess = () => resolve(req.result)),
    );
    const get = db.transaction('documents').objectStore('documents').getAll();
    const docs = await new Promise<DocumentSet[]>(
      (resolve) => (get.onsuccess = () => resolve(get.result)),
    );
    const d = docs[0];
    const placeholder = { ...d.questions[0] };
    d.questions[0] = {
      ...placeholder,
      question: 'Ce masoara senzorul?',
      correctAnswer: 'temperatura',
      solved: true,
      status: 'verified',
      answerConfidence: 1,
    };
    d.questions.push({ ...placeholder, id: `${d.id}-study-1` });
    d.study!.config.count = 2;
    d.study!.exhausted = true;
    d.study!.complete = true;
    d.study!.queue = [];
    await new Promise<void>((resolve) => {
      const tx = db.transaction('documents', 'readwrite');
      tx.objectStore('documents').put(d);
      tx.oncomplete = () => resolve();
    });
    db.close();
    return d.id;
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Rescanează PDF-ul cu OCR' })).toBeVisible();
  await page.locator(`input[id="rescan-${originalId}"]`).setInputFiles({
    name: 'lesson-image.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.getByText('Test OCR finalizat')).toBeVisible({ timeout: 90000 });
  await expect(page.getByText('1 pregătite', { exact: true })).toBeVisible();
  const ids = await page.evaluate(async () => {
    const req = indexedDB.open('aiquiz', 1);
    const db = await new Promise<IDBDatabase>(
      (resolve) => (req.onsuccess = () => resolve(req.result)),
    );
    const get = db.transaction('documents').objectStore('documents').getAllKeys();
    const result = await new Promise<IDBValidKey[]>(
      (resolve) => (get.onsuccess = () => resolve(get.result)),
    );
    db.close();
    return result;
  });
  expect(ids).toEqual([originalId]);
});
