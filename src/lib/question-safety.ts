// This module has no runtime dependency on model.ts: it also guards old saved quizzes.
import type { Question } from './model';
const folded = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
const marker =
  /(?:^|\s)(?:răspuns(?:ul)?(?:\s+corect)?|raspuns(?:ul)?(?:\s+corect)?|r|answer|corect|varianta\s+corectă|varianta\s+corecta)\s*:\s*/i;
export function normalizeQuestion(raw: string) {
  let question = raw.trim(),
    answer = '',
    explanation = '';
  const marked = marker.exec(question);
  if (marked) {
    answer = question.slice(marked.index + marked[0].length).trim();
    question = question.slice(0, marked.index).trim();
  }
  const end = question.indexOf('?');
  if (end >= 0 && question.slice(end + 1).trim()) {
    // Ambiguous follow-up instructions are retained internally for the AI, never shown as a hint.
    answer = question.slice(end + 1).trim() + (answer ? ` ${answer}` : '');
    question = question.slice(0, end + 1).trim();
  }
  const exp = /(?:^|\s)(?:explica[țt]ie|explanation|justificare)\s*:\s*/i.exec(answer);
  if (exp) {
    explanation = answer.slice(exp.index + exp[0].length).trim();
    answer = answer.slice(0, exp.index).trim();
  }
  return { question, answer, explanation, changed: question !== raw.trim() };
}
export function detectAnswerLeakage(question: string, answer: string) {
  if (normalizeQuestion(question).changed || marker.test(question)) return true;
  const q = ` ${folded(question)} `,
    a = folded(answer);
  if (!a) return false;
  // Single-letter/formula/numeric answers often legitimately occur in a problem's premises.
  // Semantic verification handles these rather than deleting essential mathematical context.
  if (a.length >= 4 && q.includes(` ${a} `)) return true;
  const words = a.split(' ');
  if (words.length >= 5) {
    const tokens = folded(question).split(' ');
    for (let i = 0; i <= tokens.length - words.length; i++) {
      const same = words.filter((w, j) => w === tokens[i + j]).length;
      if (same / words.length >= 0.9) return true;
    }
  }
  return false;
}
export const invalidAnswer = (s: string) =>
  !s.trim() ||
  /^(?:unknown|needs verification|nu stiu|nu sunt sigur|probabil|necesita verificare|not sure)$/i.test(
    folded(s),
  );
export function requiresDiagram(text: string) {
  return /\b(?:picture|figure|image)\b|\bsageti\b|\b(?:structur|formatiun|element|organ)\w*\s+(?:evidentiat|numerotat|marcat)\w*\b|\b(?:in|din|pe|aceeasi)\s+(?:imagine|figura)|\b(?:indicat|reprezentat|shown).*\b(?:imagine|figura|figure|picture)\b/.test(
    folded(text),
  );
}
export function sanitizeQuestion(q: Question): Question {
  const clean = normalizeQuestion(q.question);
  const options = q.options.map((o) =>
    o
      .replace(/^\s*(?:\+\s+|[✓✔*]\s*)/, '')
      .replace(/\s*(?:[✓✔]|\((?:corect|correct)\))\s*$/i, '')
      .trim(),
  );
  const answer = q.correctAnswer || clean.answer;
  const leaked = detectAnswerLeakage(clean.question, answer);
  return {
    ...q,
    question: clean.question,
    requiresImage: requiresDiagram(clean.question),
    options,
    rawSourceText: q.rawSourceText || (clean.changed ? q.question : undefined),
    sourceAnswer: q.sourceAnswer || clean.answer || undefined,
    correctAnswer: answer,
    explanation: q.explanation || clean.explanation,
    ...(clean.changed || leaked
      ? { status: 'parsing' as const, solved: false, reviewed: false, answerLeakage: leaked }
      : {}),
  };
}
