import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, detectQuestions, combineQuestions } from '../src/lib/detection';
import { normalize, ready } from '../src/lib/model';
import { createQuiz, exactAnswer, results } from '../src/lib/quiz';
import { validateFile } from '../src/lib/extract';
import { fixtureLines } from './fixtures';

test('450 Romanian questions survive multilingual mixed formatting, colors, headers and duplicate cleanup', () => {
  const result = detectQuestions(fixtureLines(), 'fixture', '450.pdf');
  assert.equal(result.questions.length, 450);
  assert.equal(result.rejected, 30);
  assert.equal(result.duplicates, 1);
  assert.equal(result.questions.filter(ready).length, 450);
  assert.equal(result.questions.filter((q) => q.type === 'open').length, 45);
  assert.deepEqual(result.questions[0].options, ['1', '2', '3', '4']);
  assert.equal(result.questions.at(-1)!.question, 'Care este rezultatul adunarii 450 cu 1?');
});
test('Romanian semantics outweigh color and technical English words', () => {
  for (const question of [
    'Care este funcția protocolului HTTP?',
    'Ce reprezintă Random Access Memory?',
    'Care este capitala Republicii Moldova?',
  ])
    assert.equal(detectLanguage(question).language, 'ro');
  for (const question of [
    'What is Random Access Memory?',
    'Какой протокол используется?',
    'Quelle est la capitale de la France?',
  ])
    assert.equal(detectLanguage(question).language, 'foreign');
  assert.equal(detectLanguage('HTTP/2?').language, 'uncertain');
});
test('normalization handles Romanian diacritics and punctuation', () => {
  assert.ok(exactAnswer(' CHIȘINĂU! ', 'Chisinau'));
  assert.equal(normalize('Știință'), 'stiinta');
  assert.ok(!exactAnswer('Nu este Chișinău', 'Chișinău'));
});
test('quiz randomization retains correct original indices and source; results and retry use real answers', () => {
  const questions = detectQuestions(fixtureLines(), 'fixture', '450.pdf').questions;
  const session = createQuiz(
    questions,
    {
      count: 100,
      mode: 'exam',
      includeMC: true,
      includeOpen: false,
      shuffleQuestions: true,
      shuffleOptions: true,
    },
    'Examen',
  );
  assert.equal(session.questions.length, 100);
  session.questions.forEach((q, i) => {
    assert.equal(q.source, '450.pdf');
    assert.deepEqual([...session.optionOrders[i]].sort(), [0, 1, 2, 3]);
    assert.equal(q.options[q.correctOptionIndex!], q.correctAnswer);
  });
  session.answers[session.questions[0].id] = { value: 'yes', correct: true, submitted: true };
  session.answers[session.questions[1].id] = { value: 'no', correct: false, submitted: true };
  assert.deepEqual(results(session), {
    correct: 1,
    incorrect: 1,
    pending: 0,
    unanswered: 98,
    percent: 1,
  });
  assert.equal(combineQuestions([...questions, ...questions]).length, 450);
  for (const count of [10, 100, 450])
    assert.equal(
      createQuiz(
        questions,
        {
          count,
          mode: 'practice',
          includeMC: true,
          includeOpen: true,
          shuffleQuestions: false,
          shuffleOptions: true,
        },
        'test',
      ).questions.length,
      count,
    );
});
test('upload validation rejects extension, MIME, empty and oversized files', () => {
  for (const file of [
    { name: 'x.exe', type: '', size: 50 },
    { name: 'x.pdf', type: 'text/html', size: 50 },
    { name: 'x.docx', type: '', size: 0 },
    { name: 'x.pdf', type: '', size: 32 * 1024 * 1024 },
  ])
    assert.throws(() => validateFile(file));
  assert.equal(validateFile({ name: 'x.PDF', type: 'application/pdf', size: 100 }), 'pdf');
});
