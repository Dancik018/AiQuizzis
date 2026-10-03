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
              { index: 0, valid: true, confidence: 0.97, correctIndex: 0 },
              { index: 1, valid: false, confidence: 0.5, correctIndex: null },
              { index: 2, valid: true, confidence: 0.97, correctIndex: 0 },
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

test('choice verification is blind and rejects a confident disagreement', async () => {
  const d = prepareStudy(doc, config),
    unit = studyAnalysis(lines).units[0];
  const ai: typeof structuredAI = async (schema, name, messages) => {
    if (name === 'study_questions')
      return schema.parse({
        questions: [
          {
            unitId: unit.id,
            concept: 'Portul P0',
            question: 'Care este portul protocolului P0?',
            kind: 'multiple_choice',
            difficulty: 'medium',
            options: ['1000', '2', '3', '4'],
            correctIndex: 0,
            answer: '1000',
            quote: unit.text,
          },
        ],
      });
    const payload = JSON.parse(messages[1].content);
    assert.ok(
      payload.questions.every(
        (q: Record<string, unknown>) =>
          !('answer' in q) && !('correctIndex' in q) && !('explanation' in q),
      ),
    );
    return schema.parse({ checks: [{ index: 0, valid: true, confidence: 1, correctIndex: 1 }] });
  };
  assert.deepEqual(await generateStudy(d, [unit.id], ai), []);
});

test('underfilled first pass automatically revisits source and reaches exactly the requested count', async () => {
  const initial = prepareStudy(doc, { ...config, count: 35 });
  let saved = structuredClone(initial);
  let first = true;
  const passes = new Set<number>();
  await processStudy(
    initial,
    () => {},
    () => false,
    {
      save: async (d) => {
        saved = structuredClone(d);
      },
      sleep: async () => {},
      request: async () => {
        const pass = saved.study!.generationPass!;
        passes.add(pass);
        const count = pass === 1 ? (first ? 13 : 0) : 5;
        first = false;
        const current = saved.questions.filter(ready).length;
        return Response.json({
          questions: saved.questions
            .filter((q) => !ready(q))
            .slice(0, count)
            .map((q, i) => solved(q, current + i)),
        });
      },
    },
  );
  assert.equal(saved.questions.filter(ready).length, 35);
  assert.ok(passes.has(2));
  assert.equal(saved.study!.exhausted, false);
  assert.equal(saved.study!.complete, true);
});

test('reanalysis is bounded when source yields nothing and old exhausted documents can resume', async () => {
  const initial = prepareStudy(doc, { ...config, count: 10 });
  initial.questions[0] = solved(initial.questions[0], 0);
  initial.study!.complete = true;
  initial.study!.exhausted = true;
  initial.study!.queue = [];
  let saved = structuredClone(initial);
  let calls = 0;
  await processStudy(
    initial,
    () => {},
    () => false,
    {
      save: async (d) => {
        saved = structuredClone(d);
      },
      sleep: async () => {},
      request: async () => {
        calls++;
        return Response.json({ questions: [] });
      },
    },
  );
  assert.ok(calls > 0 && calls < 1000);
  assert.equal(saved.study!.generationPass, 4);
  assert.ok(saved.study!.exhausted);
  assert.deepEqual(saved.questions[0], initial.questions[0]);
});

test('continuing a v2 result upgrades source analysis without losing accepted answers or selected count', async () => {
  const initial = prepareStudy(doc, { ...config, count: 35 });
  initial.study!.analysisVersion = 2;
  initial.study!.exhausted = true;
  initial.study!.complete = true;
  initial.study!.queue = [];
  initial.questions[0] = solved(initial.questions[0], 0);
  let saved = initial;
  await processStudy(
    initial,
    () => {},
    () => true,
    {
      save: async (d) => {
        saved = structuredClone(d);
      },
      sleep: async () => {},
      request: async () => {
        throw new Error('Stopped processing must not call AI');
      },
    },
  );
  assert.equal(saved.study!.analysisVersion, 3);
  assert.equal(saved.study!.config.count, 35);
  assert.equal(saved.questions[0].correctAnswer, initial.questions[0].correctAnswer);
  assert.ok(saved.study!.queue.length);
  assert.equal(saved.study!.complete, false);
});

test('parallel study generation is bounded to two calls and combines independently verified unique slots', async () => {
  const d = prepareStudy(doc, config);
  const units = studyAnalysis(lines).units.slice(0, 20);
  let active = 0,
    peak = 0,
    generated = 0;
  const ai: typeof structuredAI = async (schema, name, input) => {
    const data = JSON.parse(input[1].content);
    if (name === 'study_questions') {
      active++;
      peak = Math.max(peak, active);
      generated++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return schema.parse({
        questions: data.targetUnitIds.map((id: string) => {
          const u = units.find((u) => u.id === id)!;
          return {
            unitId: id,
            concept: `fact ${id}`,
            question: `Ce port este asociat protocolului ${id}?`,
            kind: 'multiple_choice',
            difficulty: 'medium',
            options: ['1000', '2', '3', '4'],
            correctIndex: 0,
            answer: '1000',
            quote: u.text,
          };
        }),
      });
    }
    assert.ok(
      data.questions.every(
        (q: Record<string, unknown>) => !('correctIndex' in q) && !('answer' in q),
      ),
    );
    return schema.parse({
      checks: data.questions.map((_: unknown, index: number) => ({
        index,
        valid: true,
        confidence: 0.97,
        correctIndex: 0,
      })),
    });
  };
  const qs = await generateStudy(
    d,
    units.map((u) => u.id),
    ai,
  );
  assert.equal(peak, 2);
  assert.equal(generated, 2);
  assert.equal(qs.length, 20);
  assert.equal(new Set(qs.map((q) => q.id)).size, 20);
});

test('one failed parallel generation preserves verified sibling and reports only failed source IDs', async () => {
  const d = prepareStudy(doc, config),
    units = studyAnalysis(lines).units.slice(0, 20);
  let retries: string[] = [];
  const ai: typeof structuredAI = async (schema, name, input) => {
    const data = JSON.parse(input[1].content);
    if (name === 'study_questions') {
      if (data.targetUnitIds.includes(units[10].id)) throw new Error('AI_TIMEOUT');
      const u = units[0];
      return schema.parse({
        questions: [
          {
            unitId: u.id,
            concept: 'unique port',
            question: 'Ce port folosește protocolul?',
            kind: 'multiple_choice',
            difficulty: 'medium',
            options: ['1000', '2', '3', '4'],
            correctIndex: 0,
            answer: '1000',
            quote: u.text,
          },
        ],
      });
    }
    assert.ok(
      data.questions.every((q: { unitId: string }) =>
        data.source.some((source: { id: string }) => source.id === q.unitId),
      ),
    );
    return schema.parse({ checks: [{ index: 0, valid: true, confidence: 0.97, correctIndex: 0 }] });
  };
  const qs = await generateStudy(
    d,
    units.map((u) => u.id),
    ai,
    {
      onRetryUnits: (ids) => {
        retries = ids;
      },
    },
  );
  assert.equal(qs.length, 1);
  assert.deepEqual(
    retries,
    units.slice(10).map((u) => u.id),
  );
});

test('partial generation retries failed source only and keeps earlier saved answers', async () => {
  const d = prepareStudy(doc, { ...config, count: 4 });
  d.study!.queue = d.study!.queue.slice(0, 1);
  let saved = d;
  const calls: string[][] = [];
  await processStudy(
    d,
    () => {},
    () => false,
    {
      save: async (next) => {
        saved = structuredClone(next);
      },
      sleep: async () => {},
      request: async (_url, init) => {
        const ids = JSON.parse(String(init?.body)).units as string[];
        calls.push(ids);
        const pending = saved.questions.filter((q) => !ready(q));
        return Response.json({
          questions: pending
            .slice(0, 2)
            .map((q, i) => solved(q, saved.questions.filter(ready).length + i)),
          retryUnits: calls.length === 1 ? ids.slice(2) : [],
        });
      },
    },
  );
  assert.equal(saved.questions.filter(ready).length, 4);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], calls[0].slice(2));
  assert.equal(saved.questions[0].correctAnswer, '1000');
});

test('ambiguous low-yield material switches to broader single-call generation automatically', async () => {
  const d = prepareStudy(doc, { ...config, count: 20 });
  d.study!.queue = d.study!.queue.slice(0, 2);
  let saved = d;
  const modes: boolean[] = [];
  await processStudy(
    d,
    () => {},
    () => false,
    {
      save: async (next) => {
        saved = structuredClone(next);
      },
      sleep: async () => {},
      request: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        modes.push(body.parallel);
        const count = modes.length === 1 ? 3 : 17;
        return Response.json({
          questions: saved.questions
            .filter((q) => !ready(q))
            .slice(0, count)
            .map((q, i) => solved(q, saved.questions.filter(ready).length + i)),
        });
      },
    },
  );
  assert.deepEqual(modes, [true, false]);
  assert.equal(saved.questions.filter(ready).length, 20);
  assert.equal(saved.study!.generationConcurrency, 1);
});

test('verification overlaps sibling generation and failed verification retries only that lane', async () => {
  const d = prepareStudy(doc, config),
    units = studyAnalysis(lines).units.slice(0, 20);
  let firstVerified = false,
    releaseSibling: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseSibling = resolve;
  });
  let retry: string[] = [];
  const ai: typeof structuredAI = async (schema, name, input) => {
    const data = JSON.parse(input[1].content);
    if (name === 'study_questions') {
      if (data.targetUnitIds.includes(units[10].id)) {
        await gate;
        assert.equal(firstVerified, true);
      }
      return schema.parse({
        questions: data.targetUnitIds.map((id: string) => ({
          unitId: id,
          concept: `fact ${id}`,
          question: `Ce port corespunde protocolului ${id}?`,
          kind: 'multiple_choice',
          difficulty: 'medium',
          options: ['1000', '2', '3', '4'],
          correctIndex: 0,
          answer: '1000',
          quote: units.find((u) => u.id === id)!.text,
        })),
      });
    }
    if (data.questions[0].unitId === units[10].id) {
      assert.ok(data.alreadyTested.includes(`fact ${units[0].id}`));
      throw new Error('AI_TIMEOUT');
    }
    assert.ok(data.source.length < studyAnalysis(lines).units.length);
    assert.ok(
      data.source.every(
        (u: Record<string, unknown>) => Object.keys(u).sort().join(',') === 'id,text',
      ),
    );
    firstVerified = true;
    releaseSibling();
    return schema.parse({
      checks: data.questions.map((_: unknown, index: number) => ({
        index,
        valid: true,
        confidence: 0.97,
        correctIndex: 0,
      })),
    });
  };
  const qs = await generateStudy(
    d,
    units.map((u) => u.id),
    ai,
    {
      onRetryUnits: (ids) => {
        retry = ids;
      },
    },
  );
  assert.equal(qs.length, 10);
  assert.deepEqual(
    retry,
    units.slice(10).map((u) => u.id),
  );
});

test('recovery keeps useful batch throughput instead of shrinking every later pass', async () => {
  const d = prepareStudy(doc, { ...config, count: 40 });
  d.study!.queue = [d.study!.queue[0]];
  let saved = d,
    laterBatch = 0;
  await processStudy(
    d,
    () => {},
    () => laterBatch > 0,
    {
      save: async (next) => {
        saved = structuredClone(next);
      },
      sleep: async () => {},
      request: async (_url, init) => {
        const ids = JSON.parse(String(init?.body)).units;
        if ((saved.study!.generationPass || 1) > 1) laterBatch = ids.length;
        return Response.json({ questions: [] });
      },
    },
  );
  assert.equal(laterBatch, 20);
  assert.equal(saved.study!.complete, false);
});

test('after the first playable buffer, combines up to 40 units without losing queue entries', async () => {
  const d = prepareStudy(doc, { ...config, count: 100 });
  let saved = d;
  const sizes: number[] = [];
  await processStudy(
    d,
    () => {},
    () => false,
    {
      save: async (next) => {
        saved = structuredClone(next);
      },
      sleep: async () => {},
      request: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        sizes.push(body.units.length);
        const done = saved.questions.filter(ready).length;
        return Response.json({
          questions: saved.questions
            .filter((q) => !ready(q))
            .slice(0, body.units.length)
            .map((q, i) => solved(q, done + i)),
        });
      },
    },
  );
  assert.deepEqual(sizes, [20, 40, 40]);
  assert.equal(saved.questions.filter(ready).length, 100);
});

test('a failing 40-unit batch stays split across retries and saved resume state', async () => {
  const d = prepareStudy(doc, { ...config, count: 100 });
  d.questions = d.questions.map((q, i) => (i < 20 ? solved(q, i) : q));
  let saved = d;
  const sizes: number[] = [];
  await processStudy(
    d,
    () => {},
    () => false,
    {
      save: async (next) => {
        saved = structuredClone(next);
      },
      sleep: async () => {},
      request: async (_url, init) => {
        const ids = JSON.parse(String(init?.body)).units;
        sizes.push(ids.length);
        assert.ok(
          sizes.length < 12,
          'split retries must not be merged into the same failing batch',
        );
        if (ids.length > 20) return Response.json({ code: 'AI_INVALID' }, { status: 502 });
        const done = saved.questions.filter(ready).length;
        return Response.json({
          questions: saved.questions
            .filter((q) => !ready(q))
            .slice(0, ids.length)
            .map((q, i) => solved(q, done + i)),
        });
      },
    },
  );
  assert.deepEqual(sizes.slice(0, 2), [40, 40]);
  assert.ok(sizes.slice(2).every((n) => n <= 20));
  assert.equal(saved.study!.generationBatchLimit, 20);
  assert.equal(saved.questions.filter(ready).length, 100);
});
