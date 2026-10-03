import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { DOMParser } from '@xmldom/xmldom';
import { extractDocx, pdfTextLines } from './extract';
import type { TextLine } from './model';
// Resolve external assets at runtime: Turbopack rewrites literal require.resolve calls.
const runtimeRequire = createRequire(path.join(process.cwd(), 'package.json'));
function resolveAsset(specifier: string): string {
  return runtimeRequire.resolve(specifier);
}
// A single worker per invocation bounds WASM memory. Each page is committed before the next.
export async function openServerDocument(bytes: Uint8Array, extension: 'pdf' | 'docx') {
  if (extension === 'docx') {
    const parser = new DOMParser({
      onError: (level) => {
        if (level !== 'warning') throw new Error('DOCX_INVALID');
      },
    });
    const lines = extractDocx(bytes, parser as unknown as globalThis.DOMParser);
    if (!lines.some((l) => l.text.trim())) throw new Error('SCAN_EMPTY');
    return {
      pages: Math.max(...lines.map((l) => l.page)),
      read: async (page: number) => lines.filter((l) => l.page === page),
      dispose: async () => {},
    };
  }
  if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes('%PDF-'))
    throw new Error('SCAN_INVALID');
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfRoot = path.dirname(resolveAsset('pdfjs-dist/package.json'));
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    path.join(pdfRoot, 'legacy/build/pdf.worker.mjs'),
  ).href;
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    useSystemFonts: false,
    standardFontDataUrl: path.join(pdfRoot, 'standard_fonts').replaceAll('\\', '/') + '/',
    cMapUrl: path.join(pdfRoot, 'cmaps').replaceAll('\\', '/') + '/',
    cMapPacked: true,
    wasmUrl: path.join(pdfRoot, 'wasm').replaceAll('\\', '/') + '/',
  });
  let pdf: Awaited<typeof task.promise>;
  try {
    pdf = await task.promise;
  } catch (error) {
    await task.destroy();
    throw error;
  }
  if (pdf.numPages > 5000) {
    await task.destroy();
    throw new Error('SCAN_PAGES');
  }
  let worker: import('tesseract.js').Worker | undefined;
  let ocrCount = 0;
  return {
    pages: pdf.numPages,
    get ocrCount() {
      return ocrCount;
    },
    async read(n: number, study = false): Promise<TextLine[]> {
      const page = await pdf.getPage(n);
      try {
        const content = await page.getTextContent();
        const items = content.items.filter(
          (i): i is import('pdfjs-dist/types/src/display/api').TextItem => 'str' in i,
        );
        const length = items
          .map((i) => i.str)
          .join('')
          .replace(/\s/g, '').length;
        const operators = await page.getOperatorList();
        const image = operators.fnArray.some((fn) =>
          [pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject].includes(fn),
        );
        if (length >= 15 && !(study && length < 250 && image))
          return pdfTextLines(items, operators, pdfjs.OPS, n);
        // A truly blank page needs no OCR.
        if (!image && !length && !operators.fnArray.length) return [];
        if (!worker) {
          const { createWorker, OEM, PSM } = await import('tesseract.js');
          worker = await createWorker(['ron', 'eng'], OEM.LSTM_ONLY, {
            workerPath: resolveAsset('tesseract.js/src/worker-script/node/index.js'),
            corePath: resolveAsset('tesseract.js-core'),
            langPath: path.join(process.cwd(), 'public/ocr/lang'),
            cachePath: '/tmp',
            cacheMethod: 'readOnly',
            gzip: true,
          });
          await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, user_defined_dpi: '150' });
        }
        const original = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: Math.min(2, 2400 / Math.max(original.width, original.height)),
        });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const render = page.render({
          canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
          viewport,
          canvas: canvas as unknown as HTMLCanvasElement,
        });
        await render.promise;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const result = await Promise.race([
            worker.recognize(canvas.toBuffer('image/png')),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('SCAN_TIMEOUT')), 70000);
            }),
          ]);
          ocrCount++;
          const text = result.data.text;
          const lines: TextLine[] = text
            .split('\n')
            .filter((t) => t.trim())
            .map((text) => ({ text, page: n }));
          const recognized = text.toLowerCase().replace(/\s+/g, ' ');
          for (const item of items)
            if (item.str.trim() && !recognized.includes(item.str.trim().toLowerCase()))
              lines.push({ text: item.str, page: n });
          return lines;
        } finally {
          clearTimeout(timer);
          canvas.width = 1;
          canvas.height = 1;
        }
      } finally {
        page.cleanup();
      }
    },
    async dispose() {
      if (worker) await worker.terminate();
      await task.destroy();
    },
  };
}
