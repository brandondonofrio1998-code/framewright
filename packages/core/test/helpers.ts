import { createDocument, documentCommands, History, type PlanDocument } from '../src';

export function idCounter(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

export const FIXED_NOW = '2026-01-01T00:00:00.000Z';

export function testDocument(newId = idCounter()): PlanDocument {
  return createDocument({ newId, now: FIXED_NOW, appVersion: '0.0.0-test' });
}

export function testHistory(options: { now?: () => number } = {}) {
  const newId = idCounter();
  const doc = testDocument(newId);
  const history = new History(doc, documentCommands, { newId }, options);
  return { history, newId, baseLevelId: doc.levelOrder[0] as string };
}
