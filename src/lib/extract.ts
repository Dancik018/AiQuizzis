import { unzipSync, strFromU8 } from 'fflate';
import type { TextLine } from './model';
import { createBrowserOcr } from './ocr';

export const MAX_FILE_SIZE = 50 * 1024 * 1024;
export function validateFile(file: Pick<File, 'name' | 'type' | 'size'>) {
  const ext = file.name.toLowerCase().split('.').pop();
  if (!['pdf', 'docx'].includes(ext || '')) throw new Error('Selectează un document PDF sau DOCX.');
  const expected =
    ext === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (file.type && file.type !== expected && file.type !== 'application/octet-stream')
    throw new Error('Tipul fișierului nu corespunde extensiei.');
  if (!file.size) throw new Error('Documentul este gol.');
  if (file.size > MAX_FILE_SIZE) throw new Error('Documentul depășește limita de 50 MB.');
  return ext as 'pdf' | 'docx';
}
const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const elements = (node: Element | Document, name: string) =>
  Array.from(node.getElementsByTagNameNS(ns, name));
const val = (node: Element | undefined, attr = 'val') => node?.getAttributeNS(ns, attr) || '';
function parseXml(text: string, parser?: DOMParser) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Document XML nesigur.');
  const doc = (parser || new DOMParser()).parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length)
    throw new Error('Structura DOCX este deteriorată.');
  return doc;
}
export function extractDocx(buffer: Uint8Array, parser?: DOMParser): TextLine[] {
  if (buffer[0] !== 80 || buffer[1] !== 75) throw new Error('Fișierul nu este un DOCX valid.');
  let expanded = 0;
  const zip = unzipSync(buffer, {
    filter(file) {
      if (!['word/document.xml', 'word/numbering.xml', 'word/styles.xml'].includes(file.name))
        return false;
      expanded += file.originalSize;
      if (expanded > 40 * 1024 * 1024) throw new Error('Documentul decomprimat este prea mare.');
      return true;
    },
  });
  if (!zip['word/document.xml']) throw new Error('Arhiva nu conține un document Word valid.');
  const doc = parseXml(strFromU8(zip['word/document.xml']), parser);
  const numbering = zip['word/numbering.xml']
    ? parseXml(strFromU8(zip['word/numbering.xml']), parser)
    : null;
  const counters = new Map<string, number>();
  let page = 1;
  return elements(doc, 'p').flatMap((p) => {
    const runs = elements(p, 'r');
    let text = runs
      .map((r) =>
        Array.from(r.childNodes)
          .filter((n): n is Element => n.nodeType === 1)
          .map((n) =>
            n.localName === 't'
              ? n.textContent
              : n.localName === 'tab'
                ? '\t'
                : n.localName === 'br'
                  ? '\n'
                  : '',
          )
          .join(''),
      )
      .join('')
      .trim();
    if (!text) return [];
    const numId = val(elements(p, 'numId')[0]);
    const level = val(elements(p, 'ilvl')[0]) || '0';
    let numbered = false;
    if (numId && numbering) {
      const num = elements(numbering, 'num').find((n) => val(n, 'numId') === numId);
      const abstractId = num ? val(elements(num, 'abstractNumId')[0]) : '';
      const abstract = elements(numbering, 'abstractNum').find(
        (n) => val(n, 'abstractNumId') === abstractId,
      );
      const lvl = abstract && elements(abstract, 'lvl').find((n) => val(n, 'ilvl') === level);
      const format = lvl ? val(elements(lvl, 'numFmt')[0]) : '';
      const key = `${numId}-${level}`;
      const count =
        (counters.get(key) ?? (Number(lvl ? val(elements(lvl, 'start')[0]) : 1) || 1) - 1) + 1;
      counters.set(key, count);
      if (/Letter/.test(format)) text = `${String.fromCharCode(65 + ((count - 1) % 26))}. ${text}`;
      else if (format === 'decimal') {
        text = `${count}. ${text}`;
        numbered = true;
      }
    }
    const style = val(elements(p, 'pStyle')[0]);
    const colored = runs.map((r) => val(elements(r, 'color')[0])).find((c) => c && c !== 'auto');
    let ancestor = p.parentNode as Element | null;
    let inTable = false;
    while (ancestor) {
      if (ancestor.localName === 'tbl') inTable = true;
      ancestor = ancestor.parentNode as Element | null;
    }
    const line: TextLine = {
      text,
      page,
      color: colored ? `#${colored}` : '#000000',
      bold: elements(p, 'b').length > 0,
      underline: elements(p, 'u').length > 0,
      italic: elements(p, 'i').length > 0,
      font: val(elements(p, 'rFonts')[0], 'ascii'),
      fontSize: Number(val(elements(p, 'sz')[0])) / 2 || undefined,
      kind: inTable ? 'table' : /heading|titre/i.test(style) ? 'heading' : 'paragraph',
      numbered,
    };
    page +=
      elements(p, 'br').filter((b) => val(b, 'type') === 'page').length +
      elements(p, 'lastRenderedPageBreak').length;
    return text.split('\n').map((t) => ({ ...line, text: t }));
  });
}

export function pdfTextLines(
  items: import('pdfjs-dist/types/src/display/api').TextItem[],
  operators: { fnArray: number[]; argsArray: unknown[][] },
  ops: typeof import('pdfjs-dist').OPS,
  n: number,
): TextLine[] {
  const lines: TextLine[] = [];
  const colorByText = new Map<string, string>();
  let color = '#000000';
  const stack: string[] = [];
  for (let j = 0; j < operators.fnArray.length; j++) {
    const fn = operators.fnArray[j],
      args = operators.argsArray[j];
    if (fn === ops.save) stack.push(color);
    if (fn === ops.restore) color = stack.pop() || '#000000';
    if (fn === ops.setFillRGBColor)
      color =
        typeof args[0] === 'string' ? args[0] : `rgb(${Array.from(args as number[]).join(',')})`;
    if (fn === ops.setFillGray) color = `gray(${args[0]})`;
    if (fn === ops.showText && Array.isArray(args[0])) {
      const text = args[0]
        .map((g: { unicode?: string } | number) => (typeof g === 'object' ? g.unicode || '' : ''))
        .join('');
      colorByText.set(text.trim(), color);
    }
  }
  // Preserve PDF content stream order; line boundaries use geometry and explicit EOL.
  let line: TextLine | null = null;
  for (const item of items) {
    const x = item.transform[4],
      y = item.transform[5];
    if (line && (Math.abs((line.y || 0) - y) > 3 || x < (line.x || 0) - 10)) {
      lines.push(line);
      line = null;
    }
    if (!line)
      line = {
        text: '',
        page: n,
        x,
        y,
        font: item.fontName,
        fontSize: Math.abs(item.transform[3]),
        color: colorByText.get(item.str.trim()),
        bold: /bold/i.test(item.fontName),
        italic: /italic/i.test(item.fontName),
      };
    line.text += `${line.text && !line.text.endsWith(' ') ? ' ' : ''}${item.str}`;
    if (item.hasEOL) {
      lines.push(line);
      line = null;
    }
  }
  if (line) lines.push(line);

  return lines;
}

export type ExtractionProgress = { stage: string; completed: number; total: number };
export async function extractFile(
  file: File,
  progress: (p: ExtractionProgress) => void,
  options: { studyMaterial?: boolean } = {},
): Promise<{ lines: TextLine[]; pages: number }> {
  const ext = validateFile(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (ext === 'docx') {
    progress({ stage: 'Extragere structură DOCX', completed: 0, total: 1 });
    const lines = extractDocx(bytes);
    progress({ stage: 'Extragere structură DOCX', completed: 1, total: 1 });
    if (!lines.length) throw new Error('Documentul nu conține text.');
    return { lines, pages: Math.max(...lines.map((l) => l.page)) };
  }
  if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes('%PDF-'))
    throw new Error('Fișierul nu este un PDF valid.');
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
  const device: { hardwareConcurrency?: number; deviceMemory?: number } =
    typeof navigator === 'undefined' ? {} : navigator;
  const memory = (device as { deviceMemory?: number }).deviceMemory;
  const touchDevice = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const concurrency =
    !touchDevice &&
    options.studyMaterial &&
    (device.hardwareConcurrency || 2) >= 6 &&
    (!memory || memory >= 8)
      ? 2
      : 1;
  const ocrWorkers = Array.from({ length: concurrency }, () => createBrowserOcr());
  try {
    const pdf = await task.promise;
    const lines: TextLine[] = [];
    let completedPages = 0;
    const extractPage = async (n: number, workerIndex: number) => {
      const lines: TextLine[] = [];
      const report = (p: ExtractionProgress) => progress({ ...p, completed: completedPages });
      report({ stage: 'Extragere pagini PDF', completed: completedPages, total: pdf.numPages });
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const items = content.items.filter(
        (i): i is import('pdfjs-dist/types/src/display/api').TextItem => 'str' in i,
      );
      const selectableText = items
        .map((i) => i.str)
        .join(' ')
        .trim();
      const textLength = selectableText.replace(/\s/g, '').length;
      // Slides may have a selectable title over a rasterized lesson or diagram.
      const sparseOperators =
        options.studyMaterial && textLength < 250 ? await page.getOperatorList() : null;
      const hasImage = sparseOperators?.fnArray.some((fn) =>
        [pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject].includes(fn),
      );
      if (textLength < 15 || (options.studyMaterial && textLength < 250 && hasImage)) {
        report({ stage: `OCR — pagina ${n}`, completed: n - 1, total: pdf.numPages });
        const original = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: Math.min(2, 2400 / Math.max(original.width, original.height)),
        });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        try {
          await page.render({ canvas, viewport }).promise;
          const text = await ocrWorkers[workerIndex].recognize(canvas, (stage, fraction) =>
            report({
              stage:
                stage +
                ' — pagina ' +
                n +
                '/' +
                pdf.numPages +
                (fraction > 0 ? ' · ' + Math.round(fraction * 100) + '%' : ''),
              completed: n - 1,
              total: pdf.numPages,
            }),
          );
          lines.push(...text.split('\n').map((text) => ({ text, page: n })));
          // Keep exact selectable statements when OCR misreads or omits them.
          const recognized = text.toLowerCase().replace(/\s+/g, ' ');
          for (const item of items)
            if (item.str.trim() && !recognized.includes(item.str.trim().toLowerCase()))
              lines.push({ text: item.str, page: n });
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      } else {
        const operators = await page.getOperatorList();
        lines.push(...pdfTextLines(items, operators, pdfjs.OPS, n));
      }
      page.cleanup();
      completedPages++;
      report({ stage: 'Extragere pagini PDF', completed: completedPages, total: pdf.numPages });
      return lines;
    };
    for (let first = 1; first <= pdf.numPages; first += concurrency) {
      // Keep memory bounded and join in page order even when OCR finishes out of order.
      const pages = Array.from(
        { length: Math.min(concurrency, pdf.numPages - first + 1) },
        (_, i) => extractPage(first + i, i),
      );
      const results = await Promise.allSettled(pages);
      const failure = results.find((r) => r.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      for (const result of results) if (result.status === 'fulfilled') lines.push(...result.value);
    }
    if (!lines.some((l) => l.text.trim()))
      throw new Error('Documentul nu conține text utilizabil.');
    return { lines, pages: pdf.numPages };
  } catch (error) {
    if (error instanceof Error && /password/i.test(error.name + error.message))
      throw new Error('PDF-ul este protejat cu parolă. Încarcă o copie deblocată.');
    if (error instanceof Error && /invalid pdf/i.test(error.message))
      throw new Error('PDF-ul este deteriorat sau invalid.');
    throw error;
  } finally {
    await Promise.all(ocrWorkers.map((ocr) => ocr.dispose()));
    await task.destroy();
  }
}
