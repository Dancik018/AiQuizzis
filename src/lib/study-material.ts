import { normalize, type TextLine } from './model';
import type { StudyUnit, StudyConfig } from './study';

// Identical boundaries in Node and the browser (ICU/Intl versions can differ).
export function studySentences(text: string) {
  const result: string[] = [];
  let start = 0;
  for (const match of text.matchAll(/[.!?]+["”»)]*(?=\s|$)/g)) {
    const end = match.index! + match[0].length;
    const prefix = text.slice(start, end);
    if (/(?:\b(?:dr|prof|nr|fig|art|pag|etc|ex|vs|pct|ing)|\b[A-ZĂÂÎȘȚ])\.$/iu.test(prefix))
      continue;
    result.push(prefix);
    start = end;
  }
  if (text.slice(start).trim()) result.push(text.slice(start));
  return result;
}

// One pass over every extracted line. Formatting is evidence, never a language/content filter.
export function segmentStudy(lines: TextLine[], preserveHeadings = false) {
  const units: StudyUnit[] = [],
    sections: { id: string; title: string; page: number }[] = [];
  const sizes = lines
    .map((l) => l.fontSize || 0)
    .filter(Boolean)
    .sort((a, b) => a - b);
  const bodySize = sizes[Math.floor(sizes.length / 2)] || 12;
  const seen = new Set<string>();
  const usedSections = new Set<string>();
  const occurrences = new Map<string, Set<number>>();
  const margins = new Set<TextLine>();
  const pages = new Map<number, TextLine[]>();
  for (const l of lines) {
    if (!pages.has(l.page)) pages.set(l.page, []);
    pages.get(l.page)!.push(l);
  }
  for (const page of pages.values())
    for (const l of [...page.slice(0, 2), ...page.slice(-2)]) {
      margins.add(l);
      const key = normalize(l.text);
      if (!occurrences.has(key)) occurrences.set(key, new Set());
      occurrences.get(key)!.add(l.page);
    }
  let section = { id: 'section-0', title: 'Introducere', page: 1 },
    page = 1,
    buffer = '';
  sections.push(section);
  const flush = () => {
    const text = buffer.trim();
    buffer = '';
    // Short definitions/formulas at a page or section boundary are valuable too.
    if (!text || !/[\p{L}\p{N}]/u.test(text)) return;
    const key = normalize(text);
    if (seen.has(key)) return;
    seen.add(key);
    usedSections.add(section.id);
    units.push({
      id: `unit-${units.length}`,
      sectionId: section.id,
      section: section.title,
      page,
      text,
    });
  };
  for (const line of lines) {
    const text = line.text
      .replace(/\u00ad/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const plainFooter =
      line.kind !== 'table' && pages.get(line.page)?.at(-1) === line && text === String(line.page);
    if (!text || /^pagina\s+\d+(?:\s*\/\s*\d+)?$/i.test(text) || plainFooter) continue;
    const repeatedMargin =
      margins.has(line) && text.length < 160 && (occurrences.get(normalize(text))?.size || 0) >= 3;
    // Repeated running titles only: preserve factual statements even at a page margin.
    if (
      repeatedMargin &&
      line.kind !== 'table' &&
      /\p{L}/u.test(text) &&
      !/[.!?:=]/.test(text) &&
      text.split(/\s+/).length < 15 &&
      !/\b(?:este|sunt|reprezinta|are|contine|permite|determina|nu|poate)\b/.test(normalize(text))
    )
      continue;
    const definition = /^[^.!?:=]{1,60}\s*[:=]\s*\S/.test(text) && !/^capitol/i.test(text);
    const heading =
      !definition &&
      text.length < 160 &&
      !/[.!?]$/.test(text) &&
      (line.kind === 'heading' ||
        (line.fontSize || 0) >= bodySize * 1.2 ||
        /^(?:capitol(?:ul)?|lecția|lectia|secțiunea|sectiunea|unitatea)\s+[\dIVX]+/i.test(text));
    if (heading) {
      flush();
      section = { id: `section-${sections.length}`, title: text, page: line.page };
      sections.push(section);
      page = line.page;
      if (preserveHeadings) {
        buffer = text;
        flush();
      }
      continue;
    }
    if (page !== line.page) {
      flush();
      page = line.page;
    }
    if (definition) flush();
    for (const part of studySentences(text)) {
      let sentence = part.trim();
      while (sentence.length > 1200) {
        const space = sentence.lastIndexOf(' ', 1200),
          end = space > 600 ? space : 1200;
        flush();
        buffer = sentence.slice(0, end);
        flush();
        sentence = sentence.slice(end).trim();
      }
      if (buffer.length + sentence.length > 1200) flush();
      // Repair PDF line-end hyphenation only within the same page/section.
      buffer =
        /\p{L}-$/u.test(buffer) && /^\p{Ll}/u.test(sentence)
          ? buffer.slice(0, -1) + sentence
          : `${buffer} ${sentence}`;
      if (buffer.split(/\s+/).length >= 30 && /[.!?]$/.test(sentence)) flush();
    }
    if (definition) flush();
  }
  flush();
  return { units, sections: sections.filter((s) => usedSections.has(s.id)) };
}

export function educationalWeight(u: StudyUnit) {
  const words = normalize(u.text).split(' ');
  return (
    Math.min(3, new Set(words).size / 15) +
    (/\b(?:este|sunt|reprezint|deoarece|determina|permite|diferenta|depinde|daca)\b/.test(
      normalize(u.text),
    )
      ? 2
      : 0) +
    (/[:=\d]/.test(u.text) ? 1 : 0)
  );
}

// Spread a limited quiz over the FULL selection. Sampling an already interleaved array
// at a fixed stride can accidentally select only one page; use spatial group ordering.
export function coverageOrder(units: StudyUnit[]) {
  const groups = new Map<string, StudyUnit[]>();
  for (const u of [...units].sort((a, b) => Number(a.id.slice(5)) - Number(b.id.slice(5)))) {
    const key = `${u.sectionId}:${u.page}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(u);
  }
  const weights = new Map(units.map((u) => [u.id, educationalWeight(u)]));
  const rows = [...groups.values()].map((g) =>
    g.sort((a, b) => weights.get(b.id)! - weights.get(a.id)!),
  );
  const order: number[] = [];
  if (rows.length) order.push(0);
  if (rows.length > 1) order.push(rows.length - 1);
  const ranges: [number, number][] = [[0, rows.length - 1]];
  for (let cursor = 0; cursor < ranges.length; cursor++) {
    const [left, right] = ranges[cursor];
    if (right - left <= 1) continue;
    const middle = Math.floor((left + right) / 2);
    order.push(middle);
    ranges.push([left, middle], [middle, right]);
  }
  const result: StudyUnit[] = [];
  const depthLimit = rows.reduce((n, r) => Math.max(n, r.length), 0);
  for (let depth = 0; depth < depthLimit; depth++)
    for (const i of order) if (rows[i][depth]) result.push(rows[i][depth]);
  return result;
}

// Context is drawn ONLY from the selected material, never from excluded chapters/pages.
export function studyContext(all: StudyUnit[], targets: StudyUnit[]) {
  const sorted = [...all].sort((a, b) => Number(a.id.slice(5)) - Number(b.id.slice(5)));
  const positions = new Map(sorted.map((u, i) => [u.id, i]));
  const selected = new Map(targets.map((u) => [u.id, u]));
  for (const unit of targets) {
    const i = positions.get(unit.id)!;
    for (const neighbor of [sorted[i - 1], sorted[i + 1]])
      if (
        neighbor &&
        neighbor.sectionId === unit.sectionId &&
        Math.abs(neighbor.page - unit.page) <= 1
      )
        selected.set(neighbor.id, neighbor);
  }
  return [...selected.values()];
}
export function studyBatches(units: StudyUnit[], kind: StudyConfig['kind'], requested = 20) {
  const result: string[][] = [];
  let batch: string[] = [],
    chars = 0;
  const maxItems = Math.max(1, Math.min(requested, kind === 'scenario' ? 12 : 20));
  for (const unit of units) {
    if (batch.length && (batch.length >= maxItems || chars + unit.text.length > 16000)) {
      result.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(unit.id);
    chars += unit.text.length;
  }
  if (batch.length) result.push(batch);
  return result;
}
