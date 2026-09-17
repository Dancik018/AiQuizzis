import type { Worker as OcrWorker } from 'tesseract.js';

async function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('OCR_TIMEOUT')), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// One local worker per document. Images never leave the browser.
export function createBrowserOcr() {
  let pending: Promise<OcrWorker> | undefined;
  let worker: OcrWorker | undefined;
  let disposed = false;
  let report: (stage: string, progress: number) => void = () => {};
  async function dispose() {
    disposed = true;
    const active = worker;
    worker = undefined;
    if (active) await active.terminate();
  }
  return {
    dispose,
    async recognize(canvas: HTMLCanvasElement, onProgress: typeof report) {
      report = onProgress;
      try {
        pending ??= import('tesseract.js').then(async ({ createWorker, OEM, PSM }) => {
          const created = await createWorker(['ron', 'eng'], OEM.LSTM_ONLY, {
            workerPath: '/ocr/worker.min.js',
            corePath: '/ocr/core',
            langPath: '/ocr/lang',
            workerBlobURL: false,
            cachePath: 'aiquiz-ocr-v1',
            logger: ({ status, progress }) => {
              if (!disposed)
                report(
                  status === 'recognizing text'
                    ? 'Recunoaștere text'
                    : 'Se încarcă motorul OCR gratuit',
                  status === 'recognizing text' ? progress : 0,
                );
            },
            errorHandler: () => {},
          });
          if (disposed) {
            await created.terminate();
            throw new Error('OCR_CLOSED');
          }
          worker = created;
          await created.setParameters({ tessedit_pageseg_mode: PSM.AUTO, user_defined_dpi: '150' });
          return created;
        });
        const active = await bounded(pending, 90000);
        const result = await bounded(active.recognize(canvas), 120000);
        return result.data.text;
      } catch (error) {
        await dispose();
        throw new Error(
          error instanceof Error && error.message === 'OCR_TIMEOUT'
            ? 'OCR a depășit timpul disponibil pe acest dispozitiv. Reîncearcă pe un calculator sau cu un PDF mai mic.'
            : 'Motorul OCR gratuit nu a putut procesa pagina. Verifică conexiunea și reîncearcă. Nu este necesară o cheie API.',
        );
      }
    },
  };
}
