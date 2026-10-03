import { test, expect } from './browser-fixture';
import { pdfFixture } from './fixtures';
test('cloud extraction bypasses device parsing and restores a 501-page source after refresh', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 1 }),
  );
  await page.route('**/api/config', (r) =>
    r.fulfill({ json: { ai: false, ocr: true, batchSize: 20, minReady: 20, providers: [] } }),
  );
  const id = '00000000-0000-4000-8000-000000000011';
  const lines = Array.from({ length: 501 }, (_, i) => ({
    text: `${i + 1}. Care este funcția protocolului experimental P${i + 1}?`,
    page: i + 1,
  }));
  let created = false,
    steps = 0,
    workerRequested = false;
  await page.route('**/pdf.worker.min.mjs', (r) => {
    workerRequested = true;
    return r.abort();
  });
  const job = () => ({
    id,
    name: 'large.pdf',
    size: 1000,
    extension: 'pdf',
    study: false,
    pages: 501,
    next_page: steps >= 2 ? 502 : 241,
    status: steps >= 2 ? 'complete' : 'processing',
  });
  await page.route('**/api/scan**', async (r) => {
    const request = r.request();
    if (request.method() === 'GET') {
      const url = new URL(request.url());
      if (url.searchParams.has('job'))
        return r.fulfill({
          json: {
            chunks:
              Number(url.searchParams.get('from')) === 0
                ? [{ first_page: 1, last_page: 501, lines }]
                : [],
          },
        });
      return r.fulfill({ json: { available: true, jobs: created ? [job()] : [] } });
    }
    const data = request.postDataJSON();
    if (data.action === 'create') {
      created = true;
      return r.fulfill({
        json: {
          job: id,
          publishableKey: 'sb_publishable_fixture',
          uploadURL: `https://fixture.supabase.co/storage/v1/object/upload/sign/quiz-sources/user/${id}/source.pdf?token=temporary-upload`,
        },
      });
    }
    if (data.action === 'step') {
      steps++;
      return r.fulfill({ json: { job: job() } });
    }
    return r.fulfill({ json: { ok: true } });
  });
  await page.route('https://fixture.storage.supabase.co/storage/v1/upload/resumable/sign**', (r) =>
    r.fulfill({
      status: 201,
      headers: {
        location: 'https://fixture.storage.supabase.co/storage/v1/upload/resumable/upload-one',
        'upload-offset': r.request().headers()['upload-length'] || '0',
        'tus-resumable': '1.0.0',
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'Location, Upload-Offset, Tus-Resumable',
      },
      body: '',
    }),
  );
  await page.goto('/');
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'large.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await pdfFixture([{ text: 'Test document', page: 1 }])),
    });
  await expect(page.locator('.document-card')).toContainText('501 întrebări');
  expect(steps).toBe(2);
  expect(workerRequested).toBe(false);
  // Source text is separately paginated; each quiz/save payload stays small.
  const saved = await page.evaluate(async () => {
    const request = indexedDB.open('aiquiz', 1);
    const db = await new Promise<IDBDatabase>((r) => (request.onsuccess = () => r(request.result)));
    const op = db.transaction('documents').objectStore('documents').getAll();
    return new Promise<{ lines: unknown[]; extractionJob?: string }[]>(
      (r) => (op.onsuccess = () => r(op.result)),
    );
  });
  expect(saved[0].lines).toEqual([]);
  expect(saved[0].extractionJob).toBe(id);
  await page.reload();
  await expect(page.locator('.document-card')).toContainText('501 întrebări');
  expect(steps).toBe(2);
  expect(workerRequested).toBe(false);
});

test('completed scans stay out of the upload area while interrupted scans remain resumable', async ({
  page,
}) => {
  await page.route('**/api/scan**', (r) =>
    r.fulfill({
      json: {
        available: true,
        jobs: [
          {
            id: '00000000-0000-4000-8000-000000000031',
            name: 'finished.pdf',
            size: 1000,
            extension: 'pdf',
            study: true,
            pages: 1,
            next_page: 2,
            status: 'complete',
          },
          {
            id: '00000000-0000-4000-8000-000000000032',
            name: 'interrupted.pdf',
            size: 1000,
            extension: 'pdf',
            study: true,
            pages: 500,
            next_page: 101,
            status: 'processing',
          },
        ],
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByText('interrupted.pdf', { exact: true })).toBeVisible();
  await expect(page.getByText('finished.pdf', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continuă scanarea', exact: true })).toHaveCount(1);
});
