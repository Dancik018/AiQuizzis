import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeQuestion,
  detectAnswerLeakage,
  sanitizeQuestion,
} from '../src/lib/question-safety';
import { detectQuestions } from '../src/lib/detection';
import { ready } from '../src/lib/model';
import { provider } from '../src/lib/ai';

test('embedded source answers including Bohr never enter the displayed question', () => {
  for (const [question, answer] of [
    ['Care este capitala Franței?', 'Paris.'],
    ['Ce hormon este secretat de pancreas?', 'Insulina.'],
    [
      'Conform primului postulat al lui Bohr, electronii se rotesc pe ce tip de orbite?',
      'Pe orbite circulare staționare, cu moment cinetic cuantizat.',
    ],
  ]) {
    const input = `${question} ${answer}`;
    assert.deepEqual(normalizeQuestion(input), {
      question,
      answer,
      explanation: '',
      changed: true,
    });
    const q = detectQuestions([{ text: input, page: 1 }], 'd', 'source.pdf').questions[0];
    assert.equal(q.question, question);
    assert.equal(q.sourceAnswer, answer);
    assert.equal(q.correctAnswer, answer);
    assert.equal(ready(q), false);
    assert.equal(sanitizeQuestion(q).question, question);
  }
  assert.equal(normalizeQuestion('Care este formula apei?').answer, '');
  for (const marker of ['Răspuns:', 'R:', 'Answer:', 'Corect:', 'Varianta corectă:']) {
    const value = normalizeQuestion(
      `Care este capitala? ${marker} Paris. Explicație: Este capitala Franței.`,
    );
    assert.equal(value.question, 'Care este capitala?');
    assert.equal(value.answer, 'Paris.');
  }
  assert.equal(detectAnswerLeakage('Unde se află CHIȘINĂU ?', 'chisinau'), true);
  assert.equal(detectAnswerLeakage('Care este formula apei?', 'H₂O'), false);
});

test('independent verifier disagreement invokes judge; only validated answers become ready', async () => {
  const oldFetch = globalThis.fetch,
    oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-test-only';
  const q = detectQuestions(
    [{ text: 'Ce hormon este secretat de pancreas?', page: 1 }],
    'test',
    'test.docx',
  ).questions[0];
  let calls = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const input = JSON.parse(request.input[1].content).untrustedQuestions[0];
      calls++;
      assert.equal(input.stage, ['solver', 'verifier', 'judge'][calls - 1]);
      if (calls === 2) {
        assert.equal(input.candidates, undefined);
        assert.equal(input.sourceAnswer, undefined);
      }
      if (calls === 3) assert.equal(input.candidates.length, 2);
      const item = {
        id: input.id,
        question: q.question,
        type: 'open',
        language: 'ro',
        languageConfidence: 0.99,
        correctOptionIndices: [],
        correctAnswer: calls === 2 ? 'Glucagon' : 'Insulină',
        generatedOptions: [],
        answerConfidence: 0.99,
        explanation: '',
        answerLeakage: false,
        needsVerification: false,
      };
      return Response.json({
        id: 'test',
        object: 'response',
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'output_text', text: JSON.stringify({ questions: [item] }), annotations: [] },
            ],
          },
        ],
      });
    };
    const ai = provider();
    const first = (await ai.solve([q], false)).questions[0];
    assert.equal(first.status, 'verifying');
    assert.equal(ready(first), false);
    const second = (await ai.solve([first], false, true)).questions[0];
    assert.equal(second.status, 'verifying');
    const final = (await ai.solve([second], false, true)).questions[0];
    assert.equal(final.verification, 'judge');
    assert.equal(ready(final), true);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});

test('compact generation preserves exact answer identity and requires independent verification', async () => {
  const oldFetch = globalThis.fetch,
    oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-test-only';
  const q = detectQuestions(
    [{ text: 'Care este rezultatul adunării 86 cu 1?', page: 1 }],
    'index',
    'index.pdf',
  ).questions[0];
  let invalid = false;
  try {
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const input = JSON.parse(request.input[1].content).untrustedQuestions[0];
      assert.equal(input.id, 'q0');
      const item = {
        id: input.id,
        q: '',
        a: '87',
        d: invalid ? ['87', '86', '88'] : ['85', '86', '88'],
        lang: 'ro',
        lc: 1,
        c: 1,
        unsafe: false,
        review: false,
      };
      return Response.json({
        id: 'test',
        object: 'response',
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'output_text', text: JSON.stringify({ questions: [item] }), annotations: [] },
            ],
          },
        ],
      });
    };
    const result = (await provider().solve([q], true)).questions[0];
    assert.equal(result.correctAnswer, '87');
    assert.deepEqual(result.correctOptionIndices, [0]);
    assert.equal(result.status, 'verifying');
    assert.equal(ready(result), false);
    invalid = true;
    assert.equal((await provider().solve([q], true)).questions.length, 0);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});

test('compact independent verification sees no prior answer and escalates ambiguity', async () => {
  const oldFetch = globalThis.fetch,
    oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-test-only';
  const q = detectQuestions(
    [{ text: 'Care este capitala Franței?', page: 1 }],
    'verify',
    'verify.pdf',
  ).questions[0];
  let calls = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      const req = JSON.parse(String(init?.body));
      const input = JSON.parse(req.input[1].content).untrustedQuestions[0];
      calls++;
      const item =
        calls === 1
          ? {
              id: input.id,
              q: '',
              a: 'Paris',
              d: ['Roma', 'Madrid', 'Berlin'],
              lang: 'ro',
              lc: 1,
              c: 1,
              unsafe: false,
              review: false,
            }
          : { id: input.id, q: '', a: 'Paris', i: [0], c: 1, issues: ['ambiguous'] };
      if (calls === 2) {
        assert.equal(input.sourceAnswer, undefined);
        assert.equal(input.correctAnswer, undefined);
        assert.equal(input.candidates, undefined);
        assert.deepEqual(input.options, ['Paris', 'Roma', 'Madrid', 'Berlin']);
      }
      return Response.json({
        id: 'test',
        object: 'response',
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'output_text', text: JSON.stringify({ questions: [item] }), annotations: [] },
            ],
          },
        ],
      });
    };
    const first = (await provider().solve([q], true)).questions[0];
    const second = (await provider().solve([first], true, true)).questions[0];
    assert.equal(second.status, 'verifying');
    assert.equal(ready(second), false);
    assert.equal(second.passes?.length, 2);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});
