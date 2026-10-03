import test from 'node:test';
import assert from 'node:assert/strict';
import {
  segmentStudy,
  coverageOrder,
  studyContext,
  studyBatches,
  studySentences,
} from '../src/lib/study-material';
import { studyAnalysis, studyMaterial, type StudyUnit } from '../src/lib/study';
import { legacyStudyMaterial } from '../src/lib/study-legacy';

test('v2 preserves short definitions, formulas, negations, decimals and long paragraphs', () => {
  const text =
    'Acest material nu permite conectarea dispozitivului când tensiunea este sub 3.5 volți. '.repeat(
      35,
    ) + 'Condiția finală rămâne obligatorie.';
  const lines = [
    { text: 'RAM: memorie volatilă.', page: 1 },
    { text: 'U=RI', page: 2 },
    { text, page: 3 },
  ];
  const { units } = segmentStudy(lines);
  assert.ok(units.some((u) => u.text === 'RAM: memorie volatilă.'));
  assert.ok(units.some((u) => u.text === 'U=RI'));
  assert.ok(units.some((u) => u.text.includes('nu permite')));
  assert.ok(units.some((u) => u.text.includes('3.5 volți')));
  assert.ok(units.some((u) => u.text.includes('Condiția finală')));
  assert.ok(units.every((u) => u.text.length <= 1200));
  assert.equal(studyAnalysis(lines.slice(0, 1)).maximum, 1);
  assert.deepEqual(studySentences('Conform art. 12, pragul este 3.5 V. Valoarea nu crește.'), [
    'Conform art. 12, pragul este 3.5 V. Valoarea nu crește.',
  ]);
});
test('repeated page titles are removed without removing repeated factual statements', () => {
  const lines = Array.from({ length: 5 }, (_, i) => [
    { text: 'UNIVERSITATEA TEHNICĂ', page: i + 1 },
    { text: `Capitolul ${i + 1}`, page: i + 1 },
    { text: `Conceptul C${i}: definiție de laborator pentru această lecție.`, page: i + 1 },
    { text: 'Memoria RAM este volatilă.', page: i + 1 },
    { text: `Pagina ${i + 1}`, page: i + 1 },
  ]).flat();
  const { units, sections } = segmentStudy(lines);
  assert.equal(sections.length, 5);
  assert.ok(units.every((u) => !u.text.includes('UNIVERSITATEA')));
  assert.ok(units.some((u) => u.text.includes('RAM este volatilă')));
  assert.ok(units.some((u) => u.page === 5));
});
test('short quiz covers beginning, middle and end rather than aliasing a fixed page stride', () => {
  const units: StudyUnit[] = Array.from({ length: 600 }, (_, i) => ({
    id: `unit-${i}`,
    page: Math.floor(i / 20) + 1,
    sectionId: 's',
    section: 'Capitol',
    text: `Concept ${i} reprezintă o definiție importantă în cadrul acestui material.`,
  }));
  const order = coverageOrder(units);
  assert.equal(new Set(order.map((u) => u.id)).size, 600);
  const pages = order.slice(0, 10).map((u) => u.page);
  assert.equal(new Set(pages).size, 10);
  assert.ok(pages.includes(1) && pages.includes(30) && pages.some((p) => p >= 14 && p <= 16));
  const batches = studyBatches(order, 'multiple_choice', 10);
  assert.equal(batches[0].length, 10);
  assert.equal(batches.flat().length, 600);
});
test('context stays inside selected chapters/pages and batches respect text budgets', () => {
  const units: StudyUnit[] = Array.from({ length: 30 }, (_, i) => ({
    id: `unit-${i}`,
    page: i + 1,
    sectionId: i < 10 ? 'a' : 'b',
    section: 'Topic',
    text: 'word '.repeat(240),
  }));
  const selected = units.filter((u) => u.page >= 5 && u.page <= 12);
  const context = studyContext(selected, [units[4], units[9]]);
  assert.ok(context.every((u) => u.page >= 5 && u.page <= 10));
  assert.ok(context.some((u) => u.page === 6));
  const batches = studyBatches(units, 'multiple_choice');
  assert.ok(batches.every((b) => b.length <= 13));
  assert.deepEqual(new Set(batches.flat()), new Set(units.map((u) => u.id)));
});
test('version 1 keeps exact persisted IDs and segmentation after deployment', () => {
  const lines = [
    { text: 'RAM: memorie volatilă.', page: 1 },
    {
      text: 'Acest paragraf conține date concrete despre funcționarea unui protocol și despre verificarea mesajelor înainte de transmiterea lor către utilizatori. Datele sunt confirmate de destinatar pentru fiecare mesaj primit în laborator.',
      page: 2,
    },
  ];
  assert.deepEqual(studyMaterial(lines, 1), legacyStudyMaterial(lines));
  assert.notDeepEqual(studyMaterial(lines, 2), studyMaterial(lines, 1));
});

test('numeric table values are not mistaken for page numbers or running titles', () => {
  const lines = Array.from({ length: 3 }, (_, i) => [
    { text: 'Temperatura admisă:', page: i + 1, kind: 'table' as const },
    { text: '25', page: i + 1, kind: 'table' as const },
    { text: `Pagina ${i + 1}`, page: i + 1 },
  ]).flat();
  const all = segmentStudy(lines)
    .units.map((u) => u.text)
    .join(' ');
  assert.ok(all.includes('Temperatura admisă:'));
  assert.ok(all.includes('25'));
  assert.ok(!all.includes('Pagina'));
});
