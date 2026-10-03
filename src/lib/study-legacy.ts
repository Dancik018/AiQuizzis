// Keep persisted version-1 source IDs stable when resuming existing documents.
import { normalize, type TextLine } from './model';
import type { StudyUnit } from './study';
export function legacyStudyMaterial(lines: TextLine[]) {
  const sections: { id: string; title: string; page: number }[] = [];
  const units: StudyUnit[] = [];
  const seen = new Set<string>();
  const sizes = lines
    .map((l) => l.fontSize || 0)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const bodySize = sizes[Math.floor(sizes.length / 2)] || 12;
  let section = { id: 'section-0', title: 'Introducere', page: 1 };
  sections.push(section);
  let buffer = '',
    page = 1;
  const flush = () => {
    const text = buffer.trim();
    buffer = '';
    if (text.split(/\s+/).length < 8 || !/[\p{L}]/u.test(text)) return;
    const key = normalize(text);
    if (seen.has(key)) return;
    seen.add(key);
    units.push({
      id: `unit-${units.length}`,
      sectionId: section.id,
      section: section.title,
      page,
      text,
    });
  };
  for (const line of lines) {
    const text = line.text.trim();
    if (!text || /^\s*(?:pagina\s*)?\d+\s*$/i.test(text)) continue;
    if (
      line.kind === 'heading' ||
      (text.length < 130 && !/[.!?]$/.test(text) && (line.fontSize || 0) >= bodySize * 1.2) ||
      (text.length < 130 &&
        /^(?:capitol|lecția|lectia|secțiunea|sectiunea|unitatea)\s+[\dIVX]+/i.test(text))
    ) {
      flush();
      section = { id: `section-${sections.length}`, title: text, page: line.page };
      sections.push(section);
      continue;
    }
    if (page !== line.page) {
      flush();
      page = line.page;
    }
    for (const sentence of text.match(/[^.!?]+(?:[.!?]+|$)/g) || [text]) {
      if (buffer.length + sentence.length > 1200) flush();
      buffer += ' ' + sentence;
      if (buffer.split(/\s+/).length >= 30) flush();
    }
  }
  flush();
  return { sections: sections.filter((s) => units.some((u) => u.sectionId === s.id)), units };
}
