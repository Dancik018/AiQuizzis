import test from 'node:test';
import assert from 'node:assert/strict';
import { detectQuestions } from '../src/lib/detection';
import { createQuiz, hydrateQuiz, quizPriority } from '../src/lib/quiz';
import { runSolverQueue } from '../src/lib/solver-queue';
import { defaultProfile } from '../src/lib/batching';
import { ready, type DocumentSet, type Question } from '../src/lib/model';
const doc = (count = 60): DocumentSet => ({
  id: 'd',
  name: 'd.docx',
  createdAt: '2026-09-19',
  pages: 1,
  lines: [],
  rejected: 0,
  duplicates: 0,
  status: 'extracted',
  questions: detectQuestions(
    Array.from({ length: count }, (_, i) => [
      { text: `${i + 1}. Care este rezultatul adunarii ${i + 1} cu 1?`, page: 1 },
      { text: `A. ${i + 1}`, page: 1 },
      { text: `B. ${i + 2}`, page: 1 },
    ]).flat(),
    'd',
    'd.docx',
  ).questions,
});
const answer = (q: Question): Question => ({
  ...q,
  solved: true,
  language: 'ro',
  languageConfidence: 1,
  answerConfidence: 1,
  correctAnswer: q.options[1],
  correctOptionIndex: 1,
});
const config = {
  count: 0,
  mode: 'practice' as const,
  shuffleQuestions: true,
  shuffleOptions: true,
  includeMC: true,
  includeOpen: true,
};

test('progressive sessions reserve complete shuffled order and hydrate without changing answers or option identity', () => {
  const d = doc(200);
  d.questions = d.questions.map((q, i) => (i < 20 ? answer(q) : q));
  const s = createQuiz(d.questions, config, 'test', true);
  assert.equal(s.questions.length, 200);
  assert.equal(s.questions.filter(ready).length, 20);
  const order = s.questions.map((q) => q.id);
  const hydrated = hydrateQuiz(s, d.questions.map(answer));
  assert.deepEqual(
    hydrated.questions.map((q) => q.id),
    order,
  );
  assert.equal(hydrated.questions.filter(ready).length, 200);
  const played = {
    ...hydrated,
    current: 17,
    answers: { [hydrated.questions[17].id]: { value: 'chosen', submitted: true, correct: true } },
  };
  assert.equal(
    hydrateQuiz(
      played,
      d.questions.map((q) => ({ ...answer(q), options: ['bad', 'changed'] })),
    ),
    played,
  );
  assert.equal(played.current, 17);
  assert.ok(hydrated.optionOrders.every((order) => order.includes(1)));
  assert.deepEqual(quizPriority(hydrated), []);
});

test('partial batch saves 19 answers and retries only missing IDs; priority matches quiz order', async () => {
  const d = doc(40);
  const priority = d.questions.map((q) => q.id).reverse();
  const calls: string[][] = [];
  let clock = 0;
  const result = await runSolverQueue(
    d,
    [{ ...defaultProfile('openai'), intervalMs: 0, maxQuestions: 20 }],
    false,
    {
      priority: () => priority,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      shouldStop: () => false,
      update: () => {},
      save: async () => {},
      solve: async (qs) => {
        calls.push(qs.map((q) => q.id));
        return (calls.length === 1 ? qs.slice(0, -1) : qs).map(answer);
      },
    },
  );
  assert.deepEqual(calls[0], priority.slice(0, 20));
  assert.ok(calls.some((ids) => ids.length === 1 && ids[0] === priority[19]));
  assert.equal(
    calls
      .slice(1)
      .flat()
      .filter((id) => priority.slice(0, 19).includes(id)).length,
    0,
  );
  assert.equal(result.questions.filter(ready).length, 40);
});

test('safe parallelism stays bounded and persists each completed group immediately', async () => {
  const d = doc(80);
  d.questions = d.questions.map((q, i) => (i < 20 ? answer(q) : q));
  let active = 0,
    max = 0,
    savedWhileActive = false;
  await runSolverQueue(
    d,
    [
      {
        ...defaultProfile('openai'),
        maxQuestions: 20,
        intervalMs: 0,
        concurrency: 3,
        tokenBudget: 16000,
      },
    ],
    false,
    {
      shouldStop: () => false,
      update: () => {},
      save: async () => {
        if (active > 0) savedWhileActive = true;
      },
      solve: async (qs) => {
        active++;
        max = Math.max(max, active);
        await new Promise((r) => setTimeout(r, 10 + active * 5));
        active--;
        return qs.map(answer);
      },
    },
  );
  assert.equal(max, 3);
  assert.ok(savedWhileActive);
});

test('bulk options touches only missing options; low-confidence gets one stronger pass', async () => {
  const d = doc(3);
  d.questions = d.questions.map(answer);
  d.questions[1] = {
    ...d.questions[1],
    type: 'open',
    options: [],
    originalOptions: [],
    correctOptionIndex: null,
  };
  const touched: string[] = [];
  const r = await runSolverQueue(d, [{ ...defaultProfile('openai'), intervalMs: 0 }], true, {
    optionsOnly: true,
    shouldStop: () => false,
    update: () => {},
    save: async () => {},
    solve: async (qs) =>
      qs.map((q) => {
        touched.push(q.id);
        return { ...answer(q), options: ['1', '2', '3', '4'], correctAnswer: '2' };
      }),
  });
  assert.deepEqual(touched, [d.questions[1].id]);
  assert.deepEqual(r.questions[0], d.questions[0]);
  const low = doc(1);
  let passes = 0;
  const done = await runSolverQueue(low, [{ ...defaultProfile('openai'), intervalMs: 0 }], false, {
    shouldStop: () => false,
    update: () => {},
    save: async () => {},
    solve: async (qs, _g, _p, strong) => {
      passes++;
      return qs.map((q) => ({ ...answer(q), answerConfidence: strong ? 0.99 : 0.6 }));
    },
  });
  assert.equal(passes, 2);
  assert.equal(done.questions[0].strengthened, true);
  assert.ok(ready(done.questions[0]));
});

test('500 questions use a rolling five-worker pool with stable order and immediate refill', async () => {
  const d = doc(500);
  let active = 0,
    max = 0,
    calls = 0;
  const sizes: number[] = [];
  let slowRunning = false,
    refilledWhileSlow = false;
  const result = await runSolverQueue(
    d,
    [{ ...defaultProfile('openai'), maxQuestions: 50, concurrency: 5, intervalMs: 0 }],
    false,
    {
      shouldStop: () => false,
      update: () => {},
      save: async () => {},
      solve: async (qs) => {
        const call = ++calls;
        sizes.push(qs.length);
        active++;
        max = Math.max(max, active);
        if (call === 2) slowRunning = true;
        if (call > 6 && slowRunning) refilledWhileSlow = true;
        await new Promise((r) => setTimeout(r, call === 2 ? 80 : 5));
        if (call === 2) slowRunning = false;
        active--;
        return qs.map(answer);
      },
    },
  );
  assert.equal(max, 5);
  assert.ok(refilledWhileSlow);
  assert.equal(sizes[0], 20);
  assert.ok(sizes.includes(50));
  assert.equal(result.questions.filter(ready).length, 500);
  assert.deepEqual(
    result.questions.map((q) => q.id),
    d.questions.map((q) => q.id),
  );
});
