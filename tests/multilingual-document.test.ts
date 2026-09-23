import test from 'node:test';
import assert from 'node:assert/strict';
import { detectQuestions, detectLanguage } from '../src/lib/detection';
import {
  questionSchema,
  ready,
  needsAnalysis,
  type DocumentSet,
  type TextLine,
} from '../src/lib/model';
import { createQuiz } from '../src/lib/quiz';
import { repairDocument } from '../src/lib/document-repair';
import { requiresDiagram, sanitizeQuestion } from '../src/lib/question-safety';

test('300 trilingual CS/CM questions retain five original options, including repeated stems and homoglyph markers', () => {
  const lines: TextLine[] = [];
  for (let n = 0; n < 300; n++) {
    const page = n + 1;
    lines.push({
      text: `${n + 1}. ${n % 2 ? 'СМ' : 'CM'}. Care sunt variantele corecte:`,
      page,
      color: '#0000ff',
    });
    for (let i = 0; i < 5; i++)
      lines.push({ text: `${String.fromCharCode(65 + i)}. Varianta română ${n}-${i}`, page });
    lines.push({
      text: `${n % 2 ? 'MC' : 'CM'}. Which of the following statements are correct:`,
      page,
    });
    for (let i = 0; i < 5; i++)
      lines.push({ text: `${String.fromCharCode(65 + i)}. English option ${n}-${i}`, page });
    lines.push({ text: 'СМ. Какие утверждения являются верными:', page });
    for (let i = 0; i < 5; i++)
      lines.push({ text: `${String.fromCharCode(65 + i)}. Русский вариант ${n}-${i}`, page });
  }
  const result = detectQuestions(lines, 'tri', 'tri.pdf');
  assert.equal(result.questions.length, 300);
  assert.equal(result.rejected, 600);
  for (const q of result.questions) {
    assert.equal(q.options.length, 5);
    assert.equal(q.type, 'multiple');
    assert.ok(questionSchema.safeParse(q).success);
    assert.ok(q.options.every((o) => o.startsWith('Varianta română')));
  }
  assert.notEqual(detectLanguage('CM. Liсhidul cerebrospinal:').language, 'foreign');
});

test('old merged lists repair from source without truncation or losing reviewed additions', () => {
  const lines: TextLine[] = [
    { text: '1. CS. Care este varianta corectă?', page: 1 },
    ...[
      'A. unu',
      'B. doi',
      'C. trei',
      'D. patru',
      'E. cinci',
      'SC. Which is the correct option?',
      'A. one',
      'B. two',
      'C. three',
      'D. four',
      'E. five',
    ].map((text) => ({ text, page: 1 })),
  ];
  const q = detectQuestions(lines, 'd', 'd.pdf').questions[0];
  const broken = {
    ...q,
    id: 'stable-id',
    options: [...q.options, ...q.options, ...q.options],
    originalOptions: [...q.options, ...q.options, ...q.options],
  };
  const manual = { ...q, id: 'manual', question: 'Care este capitala Franței?', reviewed: true };
  const d: DocumentSet = {
    id: 'd',
    name: 'd.pdf',
    createdAt: '2026-09-23',
    pages: 1,
    lines,
    questions: [broken, manual],
    status: 'partial',
    rejected: 0,
    duplicates: 0,
    error: 'invalid',
  };
  const repaired = repairDocument(d);
  assert.equal(repaired.questions[0].id, 'stable-id');
  assert.deepEqual(repaired.questions[0].options, q.options);
  assert.ok(repaired.questions.some((q) => q.id === 'manual'));
  assert.equal(repaired.status, 'extracted');
  assert.equal(repaired.error, undefined);
  assert.equal(repairDocument(repaired), repaired);
  assert.equal(d.questions[0].options.length, 15);
  const originalsOnly = repairDocument({
    ...d,
    questions: [{ ...q, originalOptions: broken.originalOptions }],
  });
  assert.deepEqual(originalsOnly.questions[0].originalOptions, q.options);
  assert.equal(repairDocument(originalsOnly), originalsOnly);
});

test('diagram-dependent questions cannot be solved or played without their missing image', () => {
  const q = detectQuestions(
    [
      { text: '1. CM. Selectați structurile indicate în imagine:', page: 9 },
      { text: 'A. Prima structură', page: 9 },
      { text: 'B. A doua structură', page: 9 },
    ],
    'd',
    'd.pdf',
  ).questions[0];
  assert.equal(q.requiresImage, true);
  assert.equal(needsAnalysis(q), false);
  assert.equal(
    ready({
      ...q,
      reviewed: true,
      solved: true,
      status: 'verified',
      correctAnswer: q.options[0],
      correctOptionIndex: 0,
      correctOptionIndices: [0],
      language: 'ro',
    }),
    false,
  );
  assert.equal(
    sanitizeQuestion({ ...q, question: 'Care structură transportă sângele spre inimă?' })
      .requiresImage,
    false,
  );
});

test('repeated image continuations survive page boundaries and distinct diagrams are not deduplicated', () => {
  const lines: TextLine[] = Array.from({ length: 3 }, (_, i) => [
    { text: `${i + 1}. CM. Numiți structurile indicate în`, page: i + 1 },
    { text: 'imagine:', page: i + 1 },
    { text: 'A. Prima structură', page: i + 1 },
    { text: 'B. A doua structură', page: i + 1 },
  ]).flat();
  const result = detectQuestions(lines, 'images', 'images.pdf');
  assert.equal(result.questions.length, 3);
  assert.ok(result.questions.every((q) => q.requiresImage && q.question.endsWith('imagine:')));
});

test('visual references to arrows or highlighted structures do not trigger blind AI solving', () => {
  assert.equal(requiresDiagram('CM. Prin săgeți sunt evidențiate următoarele formațiuni:'), true);
  assert.equal(requiresDiagram('CM. Selectați structurile evidențiate:'), true);
  assert.equal(requiresDiagram('Ce structuri formează imaginea pe retină?'), false);
});

test('new quizzes exclude exhausted questions instead of waiting forever on failed AI work', () => {
  const q = detectQuestions([{ text: 'Care este capitala Franței?', page: 1 }], 'd', 'd.pdf')
    .questions[0];
  const valid = {
    ...q,
    language: 'ro' as const,
    reviewed: true,
    solved: true,
    correctAnswer: 'Paris',
  };
  const failed = { ...q, id: 'failed', status: 'failed' as const, solveError: 'Review required' };
  const session = createQuiz(
    [valid, failed],
    {
      count: 0,
      mode: 'practice',
      shuffleQuestions: false,
      shuffleOptions: true,
      includeMC: true,
      includeOpen: true,
    },
    'quiz',
    true,
  );
  assert.equal(session.questions.length, 1);
  assert.equal(session.progressive, false);
});
