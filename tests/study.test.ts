import test from 'node:test';
import assert from 'node:assert/strict';
import { studyAnalysis, studyConfigSchema, studyReady } from '../src/lib/study';
import { prepareStudy, processStudy } from '../src/lib/study-processing';
import { generateStudy, groundedCandidate } from '../src/lib/study-generation';
import { createQuiz, hydrateQuiz } from '../src/lib/quiz';
import { ready, type DocumentSet, type Question } from '../src/lib/model';
import type { structuredAI } from '../src/lib/structured-ai';
const lines = Array.from({ length: 240 }, (_, i) => ({
  text: `Protocolul experimental P${i} transmite mesajele numai prin portul ${1000 + i}. Acest port este rezervat pentru laboratorul numărul ${i}, iar datele sunt confirmate înainte de următoarea transmisie, conform regulilor din curs.`,
  page: Math.floor(i / 8) + 1,
}));
const doc: DocumentSet = {
  id: 'study-test',
  name: 'Curs.pdf',
  createdAt: new Date().toISOString(),
  questions: [],
  lines,
  pages: 30,
  rejected: 0,
  duplicates: 0,
  status: 'extracted',
};
const config = {
  sections: ['section-0'],
  pageFrom: 1,
  pageTo: 30,
  count: 40,
  kind: 'multiple_choice' as const,
  difficulty: 'medium' as const,
};
const solved = (q: Question, i: number): Question => ({
  ...q,
  question: `Care este portul protocolului P${i}?`,
  correctAnswer: `${1000 + i}`,
  type: 'multiple_choice',
  options: [`${1000 + i}`, '2', '3', '4'],
  correctOptionIndex: 0,
  status: 'verified',
  solved: true,
  answerConfidence: 0.95,
});
test('capacity is bounded by selected source and hard limit, not raw page count', () => {
  assert.equal(studyAnalysis(lines).maximum, 200);
  assert.ok(studyAnalysis(lines, { ...config, pageTo: 1 }).maximum < 20);
  assert.equal(studyAnalysis([]).maximum, 0);
  assert.equal(studyAnalysis([{ text: 'Titlu', page: 200 }]).maximum, 0);
  assert.equal(studyAnalysis([...lines, ...lines]).maximum, 200);
  assert.throws(() => studyConfigSchema.parse({ ...config, count: 201 }));
  assert.throws(() => prepareStudy(doc, { ...config, pageTo: 1, count: 40 }));
  assert.equal(studyAnalysis(lines, { ...config, sections: [] }).maximum, 0);
});
test('quiz starts at 20 and hydration removes exhausted slots without changing answers', () => {
  const d = prepareStudy(doc, config);
  d.questions = d.questions.map((q, i) => (i < 19 ? solved(q, i) : q));
  assert.equal(studyReady(d), false);
  d.questions[19] = solved(d.questions[19], 19);
  assert.equal(studyReady(d), true);
  const s = createQuiz(
    d.questions,
    {
      count: 0,
      mode: 'practice',
      shuffleQuestions: false,
      shuffleOptions: true,
      includeMC: true,
      includeOpen: true,
    },
    'Study',
    true,
  );
  assert.equal(s.questions.length, 40);
  s.answers[s.questions[0].id] = { value: '1000', correct: true, submitted: true };
  const exhausted = d.questions.map((q, i) =>
    i < 23 ? solved(q, i) : { ...q, status: 'failed' as const, solveError: 'Epuizat' },
  );
  const next = hydrateQuiz(s, exhausted);
  assert.equal(next.questions.length, 23);
  assert.deepEqual(next.answers, s.answers);
  assert.deepEqual(next.optionOrders[0], s.optionOrders[0]);
  assert.equal(next.questions.filter(ready).length, 23);
  const small = prepareStudy(doc, { ...config, count: 10 });
  small.questions = small.questions.map(solved);
  assert.equal(studyReady(small), true);
});
test('grounding rejects fabricated quotes, answer leakage, duplicate concepts and invalid options', () => {
  const units = studyAnalysis(lines).units;
  const c = {
    unitId: units[0].id,
    concept: 'port P0',
    question: 'Care este portul protocolului P0?',
    kind: 'multiple_choice' as const,
    difficulty: 'medium' as const,
    options: ['1000', '2', '3', '4'],
    correctIndex: 0,
    answer: '1000',
    explanation: 'Din material',
    quote: units[0].text,
  };
  assert.equal(groundedCandidate(c, units, []), true);
  assert.equal(groundedCandidate({ ...c, quote: 'Citat inventat fără sursă' }, units, []), false);
  assert.equal(
    groundedCandidate(
      { ...c, question: 'Protocolul folosește 1000. Ce port folosește?' },
      units,
      [],
    ),
    false,
  );
  assert.equal(groundedCandidate({ ...c, correctIndex: 9 }, units, []), false);
  assert.equal(groundedCandidate({ ...c, options: ['1000', '1000', '3', '4'] }, units, []), false);
});
test('independent verification controls acceptance and stable IDs', async () => {
  const d = prepareStudy(doc, config),
    units = studyAnalysis(lines).units.slice(0, 3);
  let calls = 0;
  const ai: typeof structuredAI = async (schema) => {
    calls++;
    return schema.parse(
      calls === 1
        ? {
            questions: units.map((u, i) => ({
              unitId: u.id,
              concept: `port P${i}`,
              question: `Care este portul protocolului P${i}?`,
              kind: 'multiple_choice',
              difficulty: 'medium',
              options: [`${1000 + i}`, '2', '3', '4'],
              correctIndex: 0,
              answer: `${1000 + i}`,
              explanation: 'Conform materialului.',
              quote: u.text,
            })),
          }
        : {
            checks: [
              { index: 0, valid: true, confidence: 0.97 },
              { index: 1, valid: false, confidence: 0.5 },
              { index: 2, valid: true, confidence: 0.97 },
            ],
          },
    );
  };
  const result = await generateStudy(
    d,
    units.map((u) => u.id),
    ai,
  );
  assert.equal(calls, 2);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, d.questions[0].id);
  assert.equal(result[1].id, d.questions[1].id);
  assert.ok(result.every((q) => q.sourceQuote && q.verification === 'independent' && ready(q)));
});

test('failed batches split, successful questions persist, exhaustion ends below requested count', async () => {
  const d = prepareStudy(doc, config);
  // First batch is deliberately rejected; second succeeds, then split retry succeeds.
  d.study!.queue = d.study!.queue.slice(0, 2);
  let saved = structuredClone(d),
    saves = 0;
  const sizes: number[] = [];
  await processStudy(
    d,
    () => {},
    () => false,
    {
      save: async (value) => {
        saved = structuredClone(value);
        saves++;
      },
      sleep: async () => {},
      request: async (_url, init) => {
        const ids = JSON.parse(String(init?.body)).units as string[];
        sizes.push(ids.length);
        if (ids.includes(d.study!.queue[0][0]) && ids.length > 10)
          return Response.json({ error: 'Lot prea mare', code: 'AI_INVALID' }, { status: 502 });
        const qs = saved.questions
          .filter((q) => !ready(q))
          .slice(0, ids.length)
          .map((q, i) => solved(q, saved.questions.filter(ready).length + i));
        return Response.json({ questions: qs });
      },
    },
  );
  assert.deepEqual(sizes, [20, 20, 20, 10, 10]);
  assert.equal(saved.questions.filter(ready).length, 40);
  assert.ok(saved.study!.complete);
  assert.ok(saves >= 5);
  const empty = prepareStudy(doc, { ...config, count: 10 });
  empty.study!.queue = empty.study!.queue.slice(0, 2);
  let call = 0;
  await processStudy(
    empty,
    () => {},
    () => false,
    {
      save: async (value) => {
        saved = structuredClone(value);
      },
      sleep: async () => {},
      request: async () =>
        Response.json({ questions: call++ === 0 ? empty.questions.slice(0, 3).map(solved) : [] }),
    },
  );
  assert.equal(saved.questions.filter(ready).length, 3);
  assert.ok(saved.study!.exhausted);
  assert.ok(studyReady(saved));
});

test('quota failure preserves the exact pending queue for resume', async () => {
  const d = prepareStudy(doc, config);
  let saved = structuredClone(d);
  await processStudy(
    d,
    () => {},
    () => false,
    {
      save: async (v) => {
        saved = structuredClone(v);
      },
      sleep: async () => {},
      request: async () =>
        Response.json({ code: 'AI_QUOTA', error: 'Cotă epuizată' }, { status: 503 }),
    },
  );
  assert.deepEqual(saved.study!.queue, d.study!.queue);
  assert.equal(saved.study!.complete, false);
  assert.equal(saved.status, 'partial');
});
