import test from 'node:test';
import assert from 'node:assert/strict';
import { provider } from '../src/lib/ai';
import { detectQuestions } from '../src/lib/detection';
import { needsAnalysis, ready } from '../src/lib/model';
test('foreign-language verdict is saved without demanding an invented answer or retrying it', async () => {
  const oldFetch = globalThis.fetch,
    oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-test-only';
  try {
    globalThis.fetch = async (_url, init) => {
      const input = JSON.parse(JSON.parse(String(init?.body)).input[1].content)
        .untrustedQuestions[0];
      const item = {
        id: input.id,
        question: '',
        type: 'multiple_choice',
        language: 'foreign',
        languageConfidence: 1,
        correctOptionIndices: [],
        correctAnswer: '',
        generatedOptions: [],
        answerConfidence: 0,
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
    const q = detectQuestions(
      [
        { text: 'CS. Pons:', page: 1 },
        { text: 'A. Alpha', page: 1 },
        { text: 'B. Beta', page: 1 },
      ],
      'f',
      'f.pdf',
    ).questions[0];
    const result = (await provider().solve([q], false)).questions[0];
    assert.equal(result.language, 'foreign');
    assert.equal(needsAnalysis(result), false);
    assert.equal(ready(result), false);
    assert.equal(result.correctAnswer, '');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});

test('compact independent verifier preserves original multiple-answer choices', async () => {
  const oldFetch = globalThis.fetch,
    oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-test-only';
  const q = detectQuestions(
    [
      { text: 'CM. Selectați numerele pare:', page: 1 },
      ...['2', '3', '4', '5', '7'].map((text, i) => ({
        text: `${String.fromCharCode(65 + i)}. ${text}`,
        page: 1,
      })),
    ],
    'multi',
    'multi.pdf',
  ).questions[0];
  q.language = 'ro';
  q.languageConfidence = 1;
  q.passes = [{ question: q.question, answer: '2; 4', indices: [0, 2], confidence: 1 }];
  try {
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const input = JSON.parse(request.input[1].content).untrustedQuestions[0];
      assert.equal(input.type, 'multiple');
      assert.equal(input.correctAnswer, undefined);
      assert.equal(input.candidates, undefined);
      assert.deepEqual(input.options, ['2', '3', '4', '5', '7']);
      return Response.json({
        id: 'test',
        object: 'response',
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                annotations: [],
                text: JSON.stringify({
                  questions: [{ id: input.id, q: '', a: '2; 4', i: [0, 2], c: 1, issues: [] }],
                }),
              },
            ],
          },
        ],
      });
    };
    const result = (await provider().solve([q], false, true)).questions[0];
    assert.equal(result.type, 'multiple');
    assert.deepEqual(result.options, q.options);
    assert.deepEqual(result.correctOptionIndices, [0, 2]);
    assert.equal(result.verification, 'independent');
    assert.equal(ready(result), true);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});
