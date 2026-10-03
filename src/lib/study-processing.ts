import { coverageOrder, studyBatches } from './study-material';
import { accountFetch, putDocument } from './storage';
import { ready, questionSchema, type DocumentSet } from './model';
import { studyAnalysis, studyPlaceholders, type StudyConfig } from './study';
export function prepareStudy(doc: DocumentSet, config: StudyConfig): DocumentSet {
  const a = studyAnalysis(doc.lines, config);
  if (config.count < 1 || config.count > a.maximum || config.count > 200)
    throw new Error(`Alege între 1 și ${a.maximum} întrebări.`);
  const queue = studyBatches(coverageOrder(a.units), config.kind, config.count);
  return {
    ...doc,
    questions: studyPlaceholders(doc, config),
    analysisComplete: true,
    study: {
      analysisVersion: 2,
      pagesScanned: new Set(doc.lines.map((l) => l.page)).size,
      wordsScanned: a.words,
      config,
      maximum: a.maximum,
      recommended: a.recommended,
      usefulPages: a.usefulPages,
      concepts: a.concepts,
      topics: a.topics,
      queue,
      complete: false,
      exhausted: false,
      elapsedMs: 0,
      attempted: 0,
    },
  };
}
export async function processStudy(
  initial: DocumentSet,
  changed: (d: DocumentSet) => void,
  stopped: () => boolean,
  transport = {
    request: accountFetch,
    save: putDocument,
    sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  },
) {
  const doc = structuredClone(initial);
  if (!doc.study) return;
  doc.study.queue.push(...(doc.study.failedUnits || []));
  doc.study.failedUnits = [];
  const save = async () => {
    await transport.save(doc);
    changed(structuredClone(doc));
  };
  doc.status = 'processing';
  doc.error = undefined;
  await save();
  while (
    doc.study!.queue.length &&
    !stopped() &&
    doc.questions.filter(ready).length < doc.study!.config.count
  ) {
    const ids = doc.study!.queue[0];
    let success = false,
      fatal = false;
    const began = Date.now();
    for (let attempt = 0; attempt < 2 && !success; attempt++) {
      const response = await transport
        .request('/api/study', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentId: doc.id, units: ids }),
          signal: AbortSignal.timeout(125000),
        })
        .catch(() => null);
      const result = await response?.json().catch(() => null);
      const parsed = questionSchema.array().max(20).safeParse(result?.questions);
      if (response?.ok && parsed.success) {
        const byId = new Map(
          parsed.data
            .filter((q) => q.documentId === doc.id && q.generationMode === 'study' && ready(q))
            .map((q) => [q.id, q]),
        );
        doc.questions = doc.questions.map((q) => (byId.get(q.id) as typeof q) || q);
        doc.study!.queue.shift();
        doc.study!.attempted += ids.length;
        success = true;
        doc.error = undefined;
      } else {
        doc.error = result?.error || 'Conexiunea a fost întreruptă. Progresul este salvat.';
        fatal =
          [
            'AI_QUOTA',
            'AI_AUTH',
            'AI_MISSING',
            'AI_KEY_FORMAT',
            'AI_MODEL',
            'AI_ACCESS',
            'DOCUMENT_AI_LIMIT',
            'DOCUMENT_NOT_FOUND',
          ].includes(result?.code) ||
          response?.status === 401 ||
          response?.status === 403;
        if (response?.status === 429 && attempt === 1) fatal = true;
        if (fatal) break;
        if (!attempt) {
          const wait = Math.min(
            120000,
            Math.max(1500, Number(response?.headers.get('Retry-After') || 2) * 1000),
          );
          doc.retryAt = Date.now() + wait;
          await save();
          await transport.sleep(wait);
          doc.retryAt = undefined;
        }
      }
    }
    doc.study!.elapsedMs += Date.now() - began;
    if (!success && !fatal) {
      doc.study!.queue.shift();
      if (ids.length > 1) {
        const half = Math.ceil(ids.length / 2);
        doc.study!.queue.push(ids.slice(0, half), ids.slice(half));
      } else doc.study!.failedUnits!.push(ids);
    }
    await save();
    if (fatal) break;
  }
  doc.study!.queue.push(...doc.study!.failedUnits!);
  doc.study!.failedUnits = [];
  const count = doc.questions.filter(ready).length;
  doc.study!.complete = count >= doc.study!.config.count || !doc.study!.queue.length;
  doc.study!.exhausted = doc.study!.complete && count < doc.study!.config.count;
  if (doc.study!.complete) {
    doc.questions = doc.questions.map((q) =>
      ready(q)
        ? q
        : {
            ...q,
            status: 'failed',
            solveError: 'Materialul selectat nu susține alte întrebări distincte.',
          },
    );
    doc.error = undefined;
  }
  doc.status = doc.study!.complete ? 'ready' : 'partial';
  await save();
}
