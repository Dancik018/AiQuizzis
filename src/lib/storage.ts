import { openDB } from 'idb';
import type { DocumentSet, QuizSession } from './model';
let connection: ReturnType<typeof openDB> | undefined;
let cacheConnection: ReturnType<typeof openDB> | undefined;
const database = () =>
  (connection ||= openDB('aiquiz', 1, {
    upgrade(db) {
      db.createObjectStore('documents', { keyPath: 'id' });
      db.createObjectStore('sessions', { keyPath: 'id' });
    },
    blocking() {
      void connection?.then((db) => db.close());
      connection = undefined;
    },
  }));
// Separate database avoids blocking existing document tabs on a version upgrade.
const cacheDatabase = () =>
  (cacheConnection ||= openDB('aiquiz-answer-cache', 1, {
    upgrade(db) {
      db.createObjectStore('answers');
    },
    blocking() {
      void cacheConnection?.then((db) => db.close());
      cacheConnection = undefined;
    },
  }));
export async function cachedAnswer(key: string) {
  return (await cacheDatabase()).get('answers', key);
}
export async function cacheAnswer(key: string, answer: unknown) {
  return (await cacheDatabase()).put('answers', answer, key);
}
export async function getDocuments(): Promise<DocumentSet[]> {
  return (await database()).getAll('documents');
}
export async function putDocument(doc: DocumentSet) {
  return (await database()).put('documents', doc);
}
export async function deleteDocument(id: string) {
  return (await database()).delete('documents', id);
}
export async function getSessions(): Promise<QuizSession[]> {
  return (await database()).getAll('sessions');
}
// Serialize writes so rapid typing/navigation cannot let an older snapshot win.
let sessionWrite: Promise<unknown> = Promise.resolve();
export async function putSession(session: QuizSession) {
  const snapshot = structuredClone(session);
  sessionWrite = sessionWrite
    .catch(() => {})
    .then(async () => (await database()).put('sessions', snapshot));
  return sessionWrite;
}
