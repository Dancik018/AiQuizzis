import { unzipSync, strFromU8 } from 'fflate';
import type { TextLine } from './model';

export const MAX_FILE_SIZE = 30 * 1024 * 1024;
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
  if (file.size > MAX_FILE_SIZE) throw new Error('Documentul depășește limita de 30 MB.');
  return ext as 'pdf' | 'docx';
}
const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const elements = (node: Element | Document, name: string) =>
  Array.from(node.getElementsByTagNameNS(ns, name));
const val = (node: Element | undefined, attr = 'val') => node?.getAttributeNS(ns, attr) || '';
function parseXml(text: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Document XML nesigur.');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Structura DOCX este deteriorată.');
  return doc;
}
export function extractDocx(buffer: Uint8Array): TextLine[] {
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
  const doc = parseXml(strFromU8(zip['word/document.xml']));
  const numbering = zip['word/numbering.xml']
    ? parseXml(strFromU8(zip['word/numbering.xml']))
    : null;
  const counters = new Map<string, number>();
  let page = 1;
  return elements(doc, 'p').flatMap((p) => {
    const runs = elements(p, 'r');
    let text = runs
      .map((r) =>
        Array.from(r.children)
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
    let ancestor = p.parentElement;
    let inTable = false;
    while (ancestor) {
      if (ancestor.localName === 'tbl') inTable = true;
      ancestor = ancestor.parentElement;
    }
    const line: TextLine = {
      text,
      page,
      color: colored ? `#${colored}` : '#000000',
      bold: elements(p, 'b').length > 0,
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

export type ExtractionProgress = { stage: string; completed: number; total: number };
export async function extractFile(
  file: File,
  progress: (p: ExtractionProgress) => void,
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
  try {
    const pdf = await task.promise;
    const lines: TextLine[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      progress({ stage: 'Extragere pagini PDF', completed: n - 1, total: pdf.numPages });
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const items = content.items.filter(
        (i): i is import('pdfjs-dist/types/src/display/api').TextItem => 'str' in i,
      );
      if (
        items
          .map((i) => i.str)
          .join('')
          .replace(/\s/g, '').length < 15
      ) {
        progress({ stage: `OCR — pagina ${n}`, completed: n - 1, total: pdf.numPages });
        const viewport = page.getViewport({
          scale: Math.min(2, 2000 / page.getViewport({ scale: 1 }).width),
        });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, viewport }).promise;
        const response = await fetch('/api/ocr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: canvas.toDataURL('image/jpeg', 0.82).split(',')[1] }),
        });
        canvas.width = 0;
        canvas.height = 0;
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'OCR indisponibil.');
        lines.push(
          ...String(result.text)
            .split('\n')
            .map((text) => ({ text, page: n })),
        );
      } else {
        const operators = await page.getOperatorList();
        const colorByText = new Map<string, string>();
        let color = '#000000';
        const stack: string[] = [];
        for (let j = 0; j < operators.fnArray.length; j++) {
          const fn = operators.fnArray[j],
            args = operators.argsArray[j];
          if (fn === pdfjs.OPS.save) stack.push(color);
          if (fn === pdfjs.OPS.restore) color = stack.pop() || '#000000';
          if (fn === pdfjs.OPS.setFillRGBColor)
            color = typeof args[0] === 'string' ? args[0] : `rgb(${Array.from(args).join(',')})`;
          if (fn === pdfjs.OPS.setFillGray) color = `gray(${args[0]})`;
          if (fn === pdfjs.OPS.showText && Array.isArray(args[0])) {
            const text = args[0]
              .map((g: { unicode?: string } | number) =>
                typeof g === 'object' ? g.unicode || '' : '',
              )
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
      }
      page.cleanup();
      progress({ stage: 'Extragere pagini PDF', completed: n, total: pdf.numPages });
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
    await task.destroy();
  }
}
