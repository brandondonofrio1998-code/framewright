import { create } from 'zustand';
import {
  createDocument,
  documentCommands,
  History,
  type DispatchResult,
  type DocumentCommands,
  type Id,
  type PayloadOf,
  type PlanDocument,
  type ResultOf,
} from '@framewright/core';
import type { FileRef } from '../../../shared/ipc';

export const newId = () => crypto.randomUUID();

let appVersion = '0.0.0';
export function setAppVersion(version: string): void {
  appVersion = version;
}
export function getAppVersion(): string {
  return appVersion;
}

export function blankDocument(): PlanDocument {
  return createDocument({ newId, now: new Date().toISOString(), appVersion });
}

export const history = new History(blankDocument(), documentCommands, { newId });

export interface DocumentState {
  doc: PlanDocument;
  /** Increments on every change, including undo/redo and document replacement. */
  revision: number;
  dirty: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  file: FileRef | null;
  activeLevelId: Id;
}

function snapshot(): Omit<DocumentState, 'file' | 'activeLevelId' | 'revision'> {
  return {
    doc: history.doc,
    dirty: history.dirty,
    undoLabel: history.undoLabel,
    redoLabel: history.redoLabel,
  };
}

export const useDocument = create<DocumentState>(() => ({
  ...snapshot(),
  revision: 0,
  file: null,
  activeLevelId: history.doc.levelOrder[0] ?? '',
}));

history.subscribe(() => {
  useDocument.setState((state) => {
    const doc = history.doc;
    const activeLevelId = doc.levels[state.activeLevelId] ? state.activeLevelId : (doc.levelOrder[0] ?? '');
    return { ...snapshot(), revision: state.revision + 1, activeLevelId };
  });
});

export function dispatch<K extends keyof DocumentCommands & string>(
  type: K,
  payload: PayloadOf<DocumentCommands[K]>,
): DispatchResult<ResultOf<DocumentCommands[K]>> {
  return history.dispatch(type, payload);
}

export function setActiveLevel(id: Id): void {
  if (history.doc.levels[id]) useDocument.setState({ activeLevelId: id });
}

export function replaceDocument(doc: PlanDocument, file: FileRef | null, options: { dirty?: boolean } = {}): void {
  useDocument.setState({ file, activeLevelId: doc.levelOrder[0] ?? '' });
  history.reset(doc, options);
}

export function markSaved(written: PlanDocument, file: FileRef): void {
  history.markSaved(written);
  useDocument.setState({ file, dirty: history.dirty });
}

export function documentTitle(state: Pick<DocumentState, 'file' | 'doc'>): string {
  return state.file?.displayName ?? (state.doc.meta.title || 'Untitled');
}
