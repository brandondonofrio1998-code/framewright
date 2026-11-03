import { serializeDocument } from '@framewright/core';
import type { DocState } from '../../../shared/ipc';
import { useAppearance } from '../app/appearance';
import { documentTitle, useDocument, type DocumentState } from './store';

function docStateOf(state: DocumentState): DocState {
  return {
    docId: state.doc.meta.id,
    title: documentTitle(state),
    dirty: state.dirty,
    handle: state.file?.handle ?? null,
    undoLabel: state.undoLabel,
    redoLabel: state.redoLabel,
    dark: useAppearance.getState().dark,
    hiddenLayers: useAppearance.getState().hidden,
  };
}

/** Mirrors title/dirty/undo labels to the main process and autosaves unsaved changes. */
export function startDocumentSync(autosaveIntervalMs: number): () => void {
  let lastSent = '';
  const push = (state: DocumentState) => {
    const docState = docStateOf(state);
    const key = JSON.stringify(docState);
    if (key === lastSent) return;
    lastSent = key;
    window.fw.app.setDocState(docState);
  };
  push(useDocument.getState());
  const unsubscribe = useDocument.subscribe(push);
  const unwatchAppearance = useAppearance.subscribe(() => push(useDocument.getState()));

  let autosavedRevision = -1;
  const autosave = () => {
    const state = useDocument.getState();
    if (!state.dirty || state.revision === autosavedRevision) return;
    autosavedRevision = state.revision;
    try {
      void window.fw.autosave.write({
        docId: state.doc.meta.id,
        title: documentTitle(state),
        handle: state.file?.handle ?? null,
        text: serializeDocument(state.doc),
      });
    } catch (error) {
      console.error('Autosave skipped:', error);
    }
  };
  const timer = window.setInterval(autosave, autosaveIntervalMs);
  window.addEventListener('blur', autosave);

  return () => {
    unsubscribe();
    unwatchAppearance();
    window.clearInterval(timer);
    window.removeEventListener('blur', autosave);
  };
}
