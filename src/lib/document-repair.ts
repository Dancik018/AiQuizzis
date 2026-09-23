import { detectQuestions } from './detection';
import { normalize, type DocumentSet } from './model';
import { sanitizeQuestion } from './question-safety';

export function repairDocument(doc: DocumentSet): DocumentSet {
  if (
    !doc.lines?.length ||
    !doc.questions.some((q) => q.options.length > 12 || q.originalOptions.length > 12)
  )
    return doc;
  // Rebuild from preserved source lines; never truncate a merged list to fit the API schema.
  const parsed = detectQuestions(doc.lines, doc.id, doc.name);
  if (!parsed.questions.length || parsed.questions.some((q) => q.options.length > 12)) return doc;
  const key = (q: DocumentSet['questions'][number]) =>
    `${q.page}|${normalize(q.question.replace(/^[CС]([MМSЅ])[.:]/u, (_, kind: string) => `C${/[MМ]/u.test(kind) ? 'M' : 'S'}.`))}|${q.options.slice(0, 4).map(normalize).join('|')}`;
  const old = new Map<string, DocumentSet['questions']>();
  for (const q of doc.questions) old.set(key(q), [...(old.get(key(q)) || []), q]);
  const used = new Set<string>();
  const questions = parsed.questions.map((q, i) => {
    const prior = old.get(key(q))?.find((item) => !used.has(item.id));
    if (prior && !used.has(prior.id)) {
      used.add(prior.id);
      if (JSON.stringify(prior.options.map(normalize)) === JSON.stringify(q.options.map(normalize)))
        return sanitizeQuestion({ ...prior, originalOptions: q.originalOptions });
      return { ...q, id: prior.id };
    }
    return { ...q, id: `${doc.id}-repair-${i}` };
  });
  questions.push(
    ...doc.questions
      .filter(
        (q) =>
          q.reviewed && !used.has(q.id) && q.options.length <= 12 && q.originalOptions.length <= 12,
      )
      .map(sanitizeQuestion),
  );
  return {
    ...doc,
    ...parsed,
    questions,
    status: 'extracted',
    processing: undefined,
    retryAt: undefined,
    error: undefined,
    repairNotice:
      'Am reparat separarea întrebărilor și traducerilor din textul salvat. Nu trebuie să încarci din nou documentul.',
  };
}
