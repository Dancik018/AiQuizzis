import { normalize, type Question, type TextLine } from './model';
import { sanitizeQuestion } from './question-safety';

export function detectLanguage(text: string): {
  language: Question['language'];
  languageConfidence: number;
} {
  const t = ` ${normalize(text)} `;
  const score = (words: string[]) => words.reduce((n, w) => n + (t.includes(` ${w} `) ? 1 : 0), 0);
  const ro = score([
    'care',
    'este',
    'sunt',
    'ce',
    'reprezinta',
    'dintre',
    'urmatoarele',
    'raspuns',
    'functie',
    'functia',
    'pentru',
    'intr',
    'unui',
    'unei',
    'cum',
    'cand',
    'unde',
    'explicati',
    'definiti',
    'descrieti',
    'identificati',
    'selectati',
    'indicati',
    'alegeti',
    'numiti',
    'enumerati',
    'se',
    'prin',
    'in',
    'si',
    'nu',
  ]);
  const en = score([
    'what',
    'which',
    'the',
    'is',
    'are',
    'how',
    'does',
    'when',
    'where',
    'explain',
    'define',
    'select',
  ]);
  const fr = score([
    'quel',
    'quelle',
    'quelles',
    'est',
    'les',
    'pour',
    'dans',
    'comment',
    'expliquez',
  ]);
  if (/[\u0400-\u04ff]/.test(text) && ro < 2)
    return { language: 'foreign', languageConfidence: 0.98 };
  if (ro >= 2 && ro > en && ro > fr)
    return { language: 'ro', languageConfidence: Math.min(0.99, 0.86 + ro * 0.02) };
  if ((en >= 2 || fr >= 2) && Math.max(en, fr) > ro)
    return { language: 'foreign', languageConfidence: 0.95 };
  if (ro >= 1 && /[ăâîșțşţ]/i.test(text)) return { language: 'ro', languageConfidence: 0.85 };
  return { language: 'uncertain', languageConfidence: 0.4 };
}

const numbered = /^\s*\d{1,5}\s*[.)\-:]\s*(.+)/;
const option = /^\s*[+✓✔*]?\s*([A-La-l])\s*[.)\-:]\s*(.+)/;
const questionStart =
  /^(?:care|ce|cum|când|cand|unde|de ce|câte|cate|cât|cat|explicați|explicati|definiți|definiti|descrieți|descrieti|identificați|identificati|selectați|selectati|indicați|indicati|alegeți|alegeti|numiți|numiti|enumerați|enumerati|what|which|how|define|explain|quel|quelle|что|какой)\b/i;
const irrelevant =
  /^(?:(?:ministerul|universitatea|facultatea|catedra|disciplina|profesor|student|autor|data|test(?:ul)? nr|pagina|page)\b|\d+\s*(?:\/\s*\d+)?$)/i;

export function detectQuestions(lines: TextLine[], documentId: string, source: string) {
  const candidates: Question[] = [];
  let current: Question | null = null;
  let lastOption = false;
  let rejected = 0;
  let duplicates = 0;
  const seen = new Set<string>();
  const finish = () => {
    if (!current) return;
    current = sanitizeQuestion(current);
    if (
      current.status === 'verified' &&
      /medical|anatom|hormon|pancreas|bohr|electron|protocol|memori|nerv|arter|celul|tehnic|fizic|chimic/i.test(
        current.question,
      )
    ) {
      current.status = 'verifying';
      current.solved = false;
    }
    const lang = detectLanguage(current.question);
    Object.assign(current, lang);
    current.type =
      current.options.length >= 2
        ? /\bCM\b|răspunsurile corecte|afirmațiile corecte|select all/i.test(current.question) ||
          (current.correctOptionIndices?.length || 0) > 1
          ? 'multiple'
          : 'multiple_choice'
        : 'open';
    current.originalOptions = [...current.options];
    const key = normalize(current.question) + '|' + current.options.map(normalize).join('|');
    if (lang.language === 'foreign') rejected++;
    else if (seen.has(key)) duplicates++;
    else {
      seen.add(key);
      candidates.push(current);
    }
    current = null;
  };
  const repetition = new Map<string, Set<number>>();
  for (const line of lines) {
    const key = normalize(line.text);
    if (!repetition.has(key)) repetition.set(key, new Set());
    repetition.get(key)!.add(line.page);
  }
  for (const line of lines) {
    const raw = line.text.trim();
    if (!raw) continue;
    // Inline variants are split only at explicit letter markers preceded by whitespace.
    const fragments = raw.split(/\s+(?=[A-Da-d][.)]\s+)/);
    for (const text of fragments) {
      const opt = text.match(option);
      if (opt && current) {
        if (/^\s*[+✓✔*]|[✓✔]|\(corect\)/i.test(text) || line.bold || line.underline) {
          current.sourceAnswer =
            `${current.sourceAnswer || ''} Indiciu editorial, necesită verificare: ${opt[1].toUpperCase()}.`.trim();
        }
        current.options.push(opt[2].trim());
        lastOption = true;
        continue;
      }
      const answer = text.match(
        /^(?:răspuns(?:ul)?(?: corect)?|raspuns(?:ul)?(?: corect)?|answer|r|corect|varianta corect[ăa])\s*:\s*(.+)$/i,
      );
      if (answer && current) {
        current.sourceAnswer = answer[1].trim();
        const letters = answer[1].trim().match(/^[A-L](?:\s*[,;+/]\s*[A-L])+[.]?$/i);
        if (letters) {
          current.correctOptionIndices = (letters[0].match(/[A-L]/gi) || []).map(
            (c) => c.toUpperCase().charCodeAt(0) - 65,
          );
          current.correctOptionIndex = current.correctOptionIndices[0];
          current.correctAnswer = current.correctOptionIndices
            .map((i) => current!.options[i])
            .filter(Boolean)
            .join('; ');
          current.answerSource = 'document';
          if (current.correctOptionIndices.every((i) => i >= 0 && i < current!.options.length)) {
            current.status = 'verified';
            current.answerConfidence = 1;
            current.solved = true;
          }
          continue;
        }
        const idx = /^[A-La-l][.)]?$/.test(answer[1].trim())
          ? answer[1].trim().toUpperCase().charCodeAt(0) - 65
          : -1;
        if (idx >= 0 && idx < current.options.length) {
          current.correctOptionIndex = idx;
          current.correctAnswer = current.options[idx];
        } else if (idx < 0) {
          current.correctAnswer = answer[1].trim();
          const matching = current.options.findIndex(
            (o) => normalize(o) === normalize(current!.correctAnswer),
          );
          if (matching >= 0) current.correctOptionIndex = matching;
        }
        if (current.correctAnswer) {
          current.answerSource = 'document';
          current.status = 'verified';
          current.answerConfidence = 1;
          current.solved = true;
        }
        continue;
      }
      const num = text.match(numbered);
      const body = num ? num[1] : text;
      if (irrelevant.test(body) && !questionStart.test(body) && !body.includes('?')) continue;
      if (
        (repetition.get(normalize(text))?.size ?? 0) >= 3 &&
        !num &&
        !questionStart.test(text) &&
        !text.includes('?') &&
        !opt
      )
        continue;
      const starts = Boolean(
        num || line.numbered || questionStart.test(body) || (!current && body.includes('?')),
      );
      if (starts) {
        finish();
        lastOption = false;
        current = {
          id: `${documentId}-${candidates.length + rejected + duplicates}`,
          documentId,
          source,
          page: line.page,
          color: line.color,
          question: body,
          type: 'open',
          options: [],
          originalOptions: [],
          correctOptionIndex: null,
          correctAnswer: '',
          explanation: '',
          language: 'uncertain',
          languageConfidence: 0,
          answerConfidence: 0,
          reviewed: false,
          solved: false,
        };
      } else if (current) {
        if (lastOption && current.options.length)
          current.options[current.options.length - 1] += ` ${text}`;
        else current.question += ` ${text}`;
      }
    }
  }
  finish();
  // Flag near-exact stems, but preserve distinct variants and all uncertain matches.
  const fingerprints = new Map<string, Question>();
  for (const q of candidates) {
    const fingerprint = normalize(q.question);
    const prior = fingerprints.get(fingerprint);
    if (prior) {
      q.possibleDuplicate = true;
      prior.possibleDuplicate = true;
    } else fingerprints.set(fingerprint, q);
  }
  return { questions: candidates, rejected, duplicates };
}

export function combineQuestions(questions: Question[]) {
  const seen = new Set<string>();
  return questions.filter((q) => {
    const key = normalize(q.question) + '|' + q.options.map(normalize).sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
