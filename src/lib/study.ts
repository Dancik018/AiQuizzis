import { z } from 'zod';
import { normalize, ready, type DocumentSet, type Question, type TextLine } from './model';
export const studyKinds = [
  'multiple_choice',
  'true_false',
  'short_answer',
  'definition',
  'scenario',
  'mixed',
] as const;
export const studyConfigSchema = z.object({
  sections: z.array(z.string().max(80)).min(1).max(2000),
  pageFrom: z.number().int().min(1),
  pageTo: z.number().int().min(1),
  count: z.number().int().min(1).max(200),
  kind: z.enum(studyKinds),
  difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']),
});
export type StudyConfig = z.infer<typeof studyConfigSchema>;
export type StudyUnit = {
  id: string;
  sectionId: string;
  section: string;
  page: number;
  text: string;
};
export type StudyState = {
  failedUnits?: string[][];
  config: StudyConfig;
  maximum: number;
  recommended: number;
  usefulPages: number;
  concepts: number;
  topics: number;
  queue: string[][];
  complete: boolean;
  exhausted: boolean;
  elapsedMs: number;
  attempted: number;
};
export function studyMaterial(lines: TextLine[]) {
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
export function studyAnalysis(
  lines: TextLine[],
  selection?: Pick<StudyConfig, 'sections' | 'pageFrom' | 'pageTo'>,
) {
  const all = studyMaterial(lines);
  const units = all.units.filter(
    (u) =>
      !selection ||
      (selection.sections.includes(u.sectionId) &&
        u.page >= selection.pageFrom &&
        u.page <= selection.pageTo),
  );
  const words = units.reduce((n, u) => n + u.text.split(/\s+/).length, 0);
  const physical = new Set(units.map((u) => u.page)).size;
  // Word often has no explicit page breaks: report equivalent useful pages, not invented physical pages.
  const usefulPages = Math.min(physical || 1, Math.ceil(words / 150));
  const equivalentPages = Math.max(usefulPages, Math.ceil(words / 450));
  const pageLimit =
    equivalentPages <= 1
      ? 20
      : equivalentPages <= 2
        ? 35
        : equivalentPages <= 5
          ? 60
          : equivalentPages <= 10
            ? 80
            : equivalentPages <= 20
              ? 150
              : 200;
  const maximum = Math.min(200, pageLimit, units.length, Math.floor(words / 18));
  const recommended = Math.min(maximum, Math.max(1, Math.floor((maximum * 0.7) / 5) * 5));
  // Round-robin across sections and pages prevents early batches concentrating on the beginning.
  const groups = new Map<string, StudyUnit[]>();
  for (const u of units) {
    const k = `${u.sectionId}:${u.page}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(u);
  }
  const ordered: StudyUnit[] = [];
  while ([...groups.values()].some((g) => g.length))
    for (const g of groups.values()) if (g.length) ordered.push(g.shift()!);
  return {
    sections: all.sections,
    units: ordered,
    words,
    usefulPages: units.length ? usefulPages : 0,
    equivalentPages: units.length ? equivalentPages : 0,
    topics: new Set(units.map((u) => u.sectionId)).size,
    concepts: units.length,
    maximum,
    recommended: maximum ? recommended : 0,
  };
}
export function studyPlaceholders(doc: DocumentSet, config: StudyConfig): Question[] {
  return Array.from({ length: config.count }, (_, i) => ({
    id: `${doc.id}-study-${i}`,
    documentId: doc.id,
    source: doc.name,
    page: 1,
    question: `Întrebarea ${i + 1} se pregătește din material`,
    type: 'open',
    options: [],
    originalOptions: [],
    correctOptionIndex: null,
    correctAnswer: '',
    explanation: '',
    language: 'ro',
    languageConfidence: 1,
    answerConfidence: 0,
    reviewed: false,
    solved: false,
    status: 'parsing',
    generationMode: 'study',
  }));
}
export const studyReady = (doc: DocumentSet) =>
  !doc.study ||
  (doc.questions.filter(ready).length > 0 &&
    (doc.study.complete ||
      doc.questions.filter(ready).length >=
        Math.min(20, doc.study.config.count, doc.study.maximum)));
