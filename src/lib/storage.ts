import { openDB } from 'idb';
import type { DocumentSet, QuizSession } from './model';
import { sanitizeQuestion } from './question-safety';
import { repairDocument } from './document-repair';
let owner = '';
let cacheConnection: ReturnType<typeof openDB> | undefined;
const versions = new Map<string, number>();
let writes = Promise.resolve<unknown>(undefined);
export function setStorageAccount(id: string) {
  if (owner && owner !== id) throw new Error('Reîncarcă pagina pentru schimbarea contului.');
  owner = id;
}
export async function accountFetch(url: string, init: RequestInit = {}) {
  if (!owner) throw new Error('Autentifică-te pentru a continua.');
  const headers = new Headers(init.headers);
  headers.set('x-aiquiz-account', owner);
  return fetch(url, { ...init, headers, cache: 'no-store' });
}
async function json(url: string, init: RequestInit = {}) {
  const r = await accountFetch(url, init);
  const result = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(result.error || 'Datele nu au putut fi salvate în cont. Reîncearcă.');
  return result;
}
const cacheDatabase = () => {
  if (!owner) throw new Error('Autentificare necesară.');
  return (cacheConnection ||= openDB(`aiquiz-cache-${owner}`, 1, {
    upgrade(db) {
      db.createObjectStore('answers');
    },
  }));
};
export async function cachedAnswer(key: string) {
  return (await cacheDatabase()).get('answers', key);
}
export async function cacheAnswer(key: string, value: unknown) {
  return (await cacheDatabase()).put('answers', value, key);
}
async function load<T extends { id: string }>(kind: 'documents' | 'sessions'): Promise<T[]> {
  const result = await json('/api/data?kind=' + kind);
  return result.items.map((row: { data: T; version: number }) => {
    versions.set(kind + ':' + row.data.id, row.version);
    return row.data;
  });
}
function save(kind: 'documents' | 'sessions', data: DocumentSet | QuizSession) {
  const snapshot = structuredClone(data),
    key = kind + ':' + data.id;
  const task = writes
    .catch(() => {})
    .then(async () => {
      const isNewDocument = kind === 'documents' && !versions.has(key);
      const result = await json('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, data: snapshot, version: versions.get(key) || 0 }),
      });
      versions.set(key, result.version);
      if (isNewDocument) window.dispatchEvent(new Event('aiquiz-account-changed'));
    });
  writes = task;
  return task;
}
export async function getDocuments(): Promise<DocumentSet[]> {
  const docs = await load<DocumentSet>('documents');
  const repaired = docs.map(repairDocument);
  for (let i = 0; i < docs.length; i++) if (repaired[i] !== docs[i]) await putDocument(repaired[i]);
  return repaired.map((d) => ({ ...d, questions: d.questions.map(sanitizeQuestion) }));
}
export async function putDocument(doc: DocumentSet) {
  return save('documents', { ...doc, questions: doc.questions.map(sanitizeQuestion) });
}
export async function deleteDocument(id: string) {
  await json('/api/data', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  versions.delete('documents:' + id);
}
export async function getSessions(): Promise<QuizSession[]> {
  return (await load<QuizSession>('sessions')).map((s) => ({
    ...s,
    status: s.completedAt ? 'completed' : 'in_progress',
    questions: s.questions.map(sanitizeQuestion),
  }));
}
export async function putSession(session: QuizSession) {
  return save('sessions', {
    ...session,
    status: session.completedAt ? 'completed' : 'in_progress',
    updatedAt: session.updatedAt || new Date().toISOString(),
    questions: session.questions.map(sanitizeQuestion),
  });
}
