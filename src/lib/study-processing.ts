import { studyGenerationOrder, studyBatches } from './study-material';
import { accountFetch, putDocument } from './storage';
import { ready, questionSchema, type DocumentSet } from './model';
import { studyAnalysis, studyPlaceholders, type StudyConfig } from './study';
export function prepareStudy(doc: DocumentSet, config: StudyConfig): DocumentSet {
  const a = studyAnalysis(doc.lines, config);
  if (config.count < 1 || config.count > a.maximum || config.count > 200)
    throw new Error(`Alege între 1 și ${a.maximum} întrebări.`);
  const queue = studyBatches(studyGenerationOrder(a.units), config.kind, config.count);
  return {
    ...doc,
    questions: studyPlaceholders(doc, config),
    analysisComplete: true,
    study: {
      analysisVersion: 3,
      generationPass: 1,
      generationConcurrency: 2,
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
  // Old completed documents may be continued without uploading or losing accepted questions.
  if (doc.study.exhausted) {
    if (doc.study.analysisVersion !== 3) {
      const old = studyAnalysis(doc.lines, undefined, doc.study.analysisVersion || 1);
      const allSelected = old.sections.every((s) => doc.study!.config.sections.includes(s.id));
      if (allSelected)
        doc.study.config.sections = studyAnalysis(doc.lines).sections.map((s) => s.id);
      if (allSelected || doc.study.analysisVersion === 2) {
        doc.study.analysisVersion = 3;
        const updated = studyAnalysis(doc.lines, doc.study.config, 3);
        doc.study.maximum = updated.maximum;
        doc.study.recommended = updated.recommended;
        doc.study.concepts = updated.concepts;
        doc.study.topics = updated.topics;
        doc.study.usefulPages = updated.usefulPages;
        doc.study.wordsScanned = updated.words;
        doc.questions = doc.questions.map((q) => ({
          ...q,
          sourceUnitId: q.sourceQuote
            ? updated.units.find((u) => u.page === q.page && u.text.includes(q.sourceQuote!))?.id
            : undefined,
        }));
      }
    }
    doc.study.generationPass = 1;
    doc.study.queue = [];
  }
  doc.study.complete = false;
  doc.study.exhausted = false;
  const sourceOrder = studyGenerationOrder(
    studyAnalysis(doc.lines, doc.study.config, doc.study.analysisVersion || 1).units,
  );
  const sourceLengths = new Map(sourceOrder.map((u) => [u.id, u.text.length]));
  const refill = () => {
    const study = doc.study!;
    if (
      study.queue.length ||
      (study.failedUnits?.length ?? 0) > 0 ||
      doc.questions.filter(ready).length >= study.config.count ||
      (study.generationPass ?? 1) >= 4
    )
      return false;
    study.generationPass = (study.generationPass ?? 1) + 1;
    // Reuse the full local analysis; AI revisits its facts, parsing is not repeated.
    const ordered = sourceOrder;
    const tested = new Map<string, number>();
    for (const q of doc.questions.filter(ready))
      if (q.sourceUnitId) tested.set(q.sourceUnitId, (tested.get(q.sourceUnitId) || 0) + 1);
    const promising = new Set(
      ordered
        .filter((u) => {
          const words = u.text.split(/\s+/).length;
          return (
            words >= 18 &&
            Math.min(4, Math.max(1, Math.floor(words / 12))) > (tested.get(u.id) || 0)
          );
        })
        .map((u) => u.id),
    );
    const prioritized = [
      ...ordered.filter((u) => promising.has(u.id)),
      ...ordered.filter((u) => !promising.has(u.id) && !tested.has(u.id)),
      ...ordered.filter((u) => !promising.has(u.id) && tested.has(u.id)),
    ];
    study.queue = studyBatches(
      prioritized,
      study.config.kind,
      Math.min(20, study.config.count - doc.questions.filter(ready).length),
    );
    return study.queue.length > 0;
  };
  refill();
  doc.status = 'processing';
  doc.error = undefined;
  await save();
  let savedPass = doc.study.generationPass;
  while (
    (doc.study!.queue.length || refill()) &&
    !stopped() &&
    doc.questions.filter(ready).length < doc.study!.config.count
  ) {
    if (savedPass !== doc.study!.generationPass) {
      await save();
      savedPass = doc.study!.generationPass;
    }
    const ids = [...doc.study!.queue[0]];
    let consumed = 1;
    // Prioritize the first playable buffer, then amortize requests over two 20-item lanes.
    if (
      doc.study!.generationBatchLimit !== 20 &&
      ids.length === 20 &&
      doc.questions.filter(ready).length >= Math.min(20, doc.study!.config.count)
    ) {
      let chars = ids.reduce((n, id) => n + (sourceLengths.get(id) || 0), 0);
      for (let i = 1; i < doc.study!.queue.length; i++) {
        const next = doc.study!.queue[i];
        const extra = next.reduce((n, id) => n + (sourceLengths.get(id) || 0), 0);
        if (next.length !== 20 || ids.length + next.length > 40 || chars + extra > 24000) break;
        ids.push(...next);
        chars += extra;
        consumed++;
      }
    }
    let success = false,
      fatal = false;
    const began = Date.now();
    for (let attempt = 0; attempt < 2 && !success; attempt++) {
      const response = await transport
        .request('/api/study', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documentId: doc.id,
            units: ids,
            parallel: ids.length > 20 || doc.study!.generationConcurrency !== 1,
          }),
          signal: AbortSignal.timeout(125000),
        })
        .catch(() => null);
      const result = await response?.json().catch(() => null);
      const parsed = questionSchema.array().max(40).safeParse(result?.questions);
      if (response?.ok && parsed.success) {
        const byId = new Map(
          parsed.data
            .filter((q) => q.documentId === doc.id && q.generationMode === 'study' && ready(q))
            .map((q) => [q.id, q]),
        );
        const expected = Math.min(
          40,
          ids.length,
          doc.study!.config.count - doc.questions.filter(ready).length,
        );
        // Sparse/ambiguous material can benefit from choosing targets across the whole batch.
        if (!result.retryUnits?.length && expected >= 8 && byId.size / expected < 0.35)
          doc.study!.generationConcurrency = 1;
        doc.questions = doc.questions.map((q) => (byId.get(q.id) as typeof q) || q);
        doc.study!.queue.splice(0, consumed);
        const retryUnits = Array.isArray(result.retryUnits)
          ? [
              ...new Set<string>(
                result.retryUnits.filter(
                  (id: unknown) => typeof id === 'string' && ids.includes(id),
                ),
              ),
            ]
          : [];
        if (retryUnits.length) doc.study!.queue.push(retryUnits);
        doc.study!.attempted += ids.length - retryUnits.length;
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
      doc.study!.generationBatchLimit = 20;
      doc.study!.queue.splice(0, consumed);
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
            solveError: 'Nu au fost validate alte întrebări după trecerile suplimentare.',
          },
    );
    doc.error = undefined;
  }
  doc.status = doc.study!.complete ? 'ready' : 'partial';
  await save();
}
