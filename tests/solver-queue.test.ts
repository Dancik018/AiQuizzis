import test from 'node:test';
import assert from 'node:assert/strict';
import { detectQuestions } from '../src/lib/detection';
import { fixtureLines } from './fixtures';
import { defaultProfile, planBatches } from '../src/lib/batching';
import { BatchError, runSolverQueue } from '../src/lib/solver-queue';
import { needsAnalysis, type DocumentSet, type Question } from '../src/lib/model';

const document = (): DocumentSet => ({
  id: 'test',
  name: 'large.pdf',
  createdAt: '2026-09-18',
  pages: 90,
  lines: [],
  rejected: 0,
  duplicates: 0,
  status: 'extracted',
  questions: detectQuestions(
    fixtureLines().filter((l) => !/^Raspuns:/.test(l.text)),
    'test',
    'large.pdf',
  ).questions,
});
const solved = (q: Question): Question => ({
  ...q,
  solved: true,
  language: 'ro',
  languageConfidence: 1,
  answerConfidence: 1,
  correctOptionIndex: q.options.length ? 1 : null,
  correctAnswer: q.options[1] || '451',
});

test('adaptive planning maximizes short batches and shrinks long batches without dropping questions', () => {
  const qs = document().questions;
  const short = planBatches(qs, defaultProfile('openai'));
  assert.ok(short[0].length >= 15 && short[0].length <= 50);
  const long = planBatches(
    qs.map((q) => ({ ...q, question: q.question + ' document'.repeat(600) })),
    defaultProfile('openai'),
  );
  assert.ok(long[0].length < short[0].length);
  assert.deepEqual(
    short.flat().map((q) => q.id),
    qs.map((q) => q.id),
  );
});

test('450 candidates continue through transient errors and poison-question splitting', async () => {
  const doc = document(),
    poison = doc.questions[36].id;
  let time = 0,
    saves = 0,
    firstCalls = 0;
  const successful = new Set<string>();
  let lastFinished = 0;
  const result = await runSolverQueue(doc, [defaultProfile('openai')], false, {
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    shouldStop: () => false,
    update: () => {},
    save: async (d) => {
      saves++;
      assert.ok((d.processing?.finished || 0) >= lastFinished);
      lastFinished = d.processing?.finished || 0;
    },
    solve: async (qs) => {
      time += 500;
      if (firstCalls === 0) {
        firstCalls++;
        throw new BatchError('temporary', 'PROVIDER_ERROR');
      }
      if (qs.some((q) => q.id === poison)) throw new BatchError('bad item', 'AI_INVALID');
      qs.forEach((q) => {
        assert.ok(!successful.has(q.id));
        successful.add(q.id);
      });
      return qs.map(solved);
    },
  });
  assert.equal(result.processing?.finished, 450);
  assert.equal(result.processing?.failed, 1);
  assert.equal(result.questions.filter((q) => q.solved).length, 449);
  assert.equal(result.processing?.queue.length, 0);
  assert.equal(firstCalls, 1);
  assert.ok(saves > 10);
});

test('resume uses saved queue without repeating successful questions', async () => {
  let time = 0,
    stop = false;
  const done = new Set<string>();
  const io = {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
    shouldStop: () => stop,
    update: () => {},
    save: async (d: DocumentSet) => {
      if (d.questions.some((q) => q.solved)) stop = true;
    },
    solve: async (qs: Question[]) => {
      qs.forEach((q) => {
        assert.ok(!done.has(q.id));
        done.add(q.id);
      });
      return qs.map(solved);
    },
  };
  const partial = await runSolverQueue(document(), [defaultProfile('openai')], false, io);
  assert.ok(partial.processing!.queue.length);
  stop = false;
  const complete = await runSolverQueue(partial, [defaultProfile('openai')], false, {
    ...io,
    save: async () => {},
  });
  assert.equal(complete.questions.filter(needsAnalysis).length, 0);
  assert.equal(done.size, 450);
});

test('OpenAI quota exhaustion preserves pending work and does not invent completed attempts', async () => {
  let calls = 0;
  const result = await runSolverQueue(document(), [defaultProfile('openai')], false, {
    now: () => 0,
    sleep: async () => {},
    shouldStop: () => false,
    update: () => {},
    save: async () => {},
    solve: async () => {
      calls++;
      throw new BatchError('quota', 'AI_QUOTA');
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'partial');
  assert.equal(result.processing?.finished, 0);
  assert.ok(result.processing!.queue.length);
});

test('explicit retry resets exhausted semantic passes only for failed questions', async () => {
  const doc = document();
  doc.questions = [
    {
      ...doc.questions[0],
      solved: true,
      status: 'failed',
      strengthened: true,
      solveError: 'unresolved',
      passes: [{ question: 'q', answer: 'a', indices: [], confidence: 0.2 }],
    },
  ];
  const result = await runSolverQueue(doc, [defaultProfile('openai')], false, {
    shouldStop: () => false,
    update: () => {},
    save: async () => {},
    solve: async (qs) => {
      assert.equal(qs[0].passes, undefined);
      return qs.map((q) => ({ ...solved(q), status: 'verified' as const }));
    },
  });
  assert.equal(result.questions[0].status, 'verified');
});
