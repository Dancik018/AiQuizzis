import { legacyStudyMaterial } from './study-legacy';
import { segmentStudy } from './study-material';
import { z } from 'zod';
import { ready, type DocumentSet, type Question, type TextLine } from './model';
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
  analysisVersion?: 1 | 2;
  pagesScanned?: number;
  wordsScanned?: number;
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
export const studyMaterial = (lines: TextLine[], version: 1 | 2 = 2) =>
  version === 1 ? legacyStudyMaterial(lines) : segmentStudy(lines);
export function studyAnalysis(
  lines: TextLine[],
  selection?: Pick<StudyConfig, 'sections' | 'pageFrom' | 'pageTo'>,
  version: 1 | 2 = 2,
) {
  const all = studyMaterial(lines, version);
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
  const maximum = Math.min(
    200,
    pageLimit,
    units.length,
    version === 1
      ? Math.floor(words / 18)
      : Math.max(units.filter((u) => /[:=]/.test(u.text)).length, Math.floor(words / 18)),
  );
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
