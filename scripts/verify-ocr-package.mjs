import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorker, OEM } from 'tesseract.js';
import { createCanvas } from '@napi-rs/canvas';
// Run the OCR worker using only files actually traced into the production route.
const root = process.cwd();
const traceDir = path.join(root, '.next/server/app/api/scan');
const trace = JSON.parse(readFileSync(path.join(traceDir, 'route.js.nft.json'), 'utf8'));
const temporary = mkdtempSync(path.join(os.tmpdir(), 'aiquizzis-ocr-package-'));
let worker;
try {
  for (const file of trace.files) {
    const source = path.resolve(traceDir, file),
      relative = path.relative(root, source);
    if (
      !relative.startsWith('node_modules' + path.sep) &&
      !relative.startsWith('public' + path.sep)
    )
      continue;
    const target = path.resolve(temporary, relative);
    if (!target.startsWith(temporary + path.sep)) throw Error('Invalid trace path');
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  worker = await createWorker(['ron', 'eng'], OEM.LSTM_ONLY, {
    workerPath: path.join(temporary, 'node_modules/tesseract.js/src/worker-script/node/index.js'),
    langPath: path.join(temporary, 'public/ocr/lang'),
    cachePath: temporary,
    cacheMethod: 'none',
    gzip: true,
  });
  const canvas = createCanvas(1200, 200),
    context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, 1200, 200);
  context.fillStyle = 'black';
  context.font = '32px Arial';
  context.fillText('Portul rezervat pentru laborator este 7788.', 30, 90);
  const result = await worker.recognize(canvas.toBuffer('image/png'));
  if (!result.data.text.includes('7788')) throw Error('Packaged OCR failed recognition');
  console.log('Production-traced Romanian/English OCR worker passed in an isolated directory.');
} finally {
  await worker?.terminate();
  if (
    path.dirname(temporary) === os.tmpdir() &&
    path.basename(temporary).startsWith('aiquizzis-ocr-package-')
  )
    rmSync(temporary, { recursive: true, force: true });
}
