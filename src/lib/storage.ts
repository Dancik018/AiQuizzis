import { openDB } from 'idb';
import type { DocumentSet, QuizSession } from './model';
const database = () =>
  openDB('aiquiz', 1, {
    upgrade(db) {
      db.createObjectStore('documents', { keyPath: 'id' });
      db.createObjectStore('sessions', { keyPath: 'id' });
    },
  });
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
