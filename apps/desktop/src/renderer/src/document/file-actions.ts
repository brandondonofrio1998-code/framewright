import { loadDocument, materialsCsv, materialsList, serializeDocument, sheetPdf } from '@framewright/core';
import type { FileHandle, FileRef, IpcResult, OpenedFile } from '../../../shared/ipc';
import { blankDocument, documentTitle, getAppVersion, history, markSaved, replaceDocument, useDocument } from './store';

let saving: Promise<boolean> | null = null;

function serializeForSave(): { written: typeof history.doc; text: string } {
  const written = history.doc;
  const text = serializeDocument({
    ...written,
    meta: { ...written.meta, modified: new Date().toISOString(), appVersion: getAppVersion() },
  });
  return { written, text };
}

async function writeWith(save: (text: string) => Promise<IpcResult<FileRef> | null>): Promise<boolean> {
  const { written, text } = serializeForSave();
  const result = await save(text);
  if (result === null) return false;
  if (!result.ok) {
    await window.fw.app.showMessage({ type: 'error', message: 'The plan could not be saved.', detail: result.error });
    return false;
  }
  markSaved(written, result.value);
  await window.fw.autosave.clear(written.meta.id);
  return true;
}

function serialized(task: () => Promise<boolean>): Promise<boolean> {
  saving ??= task().finally(() => {
    saving = null;
  });
  return saving;
}

export function saveAs(): Promise<boolean> {
  return serialized(() => writeWith((text) => window.fw.file.saveAs(documentTitle(useDocument.getState()), text)));
}

/** Writes the derived materials list. The plan file and its saved state stay as they are. */
export async function exportMaterials(): Promise<void> {
  const state = useDocument.getState();
  const result = await window.fw.file.exportCsv(`${documentTitle(state)} materials`, materialsCsv(materialsList(state.doc)));
  if (result === null) return;
  if (!result.ok) await window.fw.app.showMessage({ type: 'error', message: 'The materials list could not be saved.', detail: result.error });
}

/** Writes the architectural sheet. The plan file and its saved state stay as they are. */
export async function exportSheet(): Promise<void> {
  const state = useDocument.getState();
  const result = await window.fw.file.exportPdf(`${documentTitle(state)} sheet`, await sheetPdf(state.doc, state.activeLevelId));
  if (result === null) return;
  if (!result.ok) await window.fw.app.showMessage({ type: 'error', message: 'The sheet could not be saved.', detail: result.error });
}

export function save(): Promise<boolean> {
  const file = useDocument.getState().file;
  if (!file) return saveAs();
  return serialized(() => writeWith((text) => window.fw.file.save(file.handle, text)));
}

export async function saveAndClose(): Promise<void> {
  if (await save()) window.fw.app.closeWindow();
}

/** Asks to save unsaved changes. Returns false if the user cancelled. */
export async function confirmDiscardChanges(): Promise<boolean> {
  const state = useDocument.getState();
  if (!state.dirty) return true;
  const choice = await window.fw.app.confirmDiscard(documentTitle(state));
  if (choice === 'cancel') return false;
  if (choice === 'save') return save();
  await window.fw.autosave.clear(state.doc.meta.id);
  return true;
}

export async function newPlan(): Promise<void> {
  if (!(await confirmDiscardChanges())) return;
  replaceDocument(blankDocument(), null);
}

async function showOpened(opened: OpenedFile): Promise<void> {
  const result = loadDocument(opened.text);
  if (!result.ok) {
    await window.fw.app.showMessage({ type: 'error', message: `“${opened.displayName}” could not be opened.`, detail: result.error });
    return;
  }
  const changedOnLoad = result.repairs.length > 0 || result.migratedFrom !== null;
  replaceDocument(result.doc, { handle: opened.handle, displayName: opened.displayName, path: opened.path }, { dirty: changedOnLoad });
  if (result.repairs.length > 0) {
    await window.fw.app.showMessage({
      type: 'warning',
      message: `“${opened.displayName}” had problems that were fixed automatically.`,
      detail: `${result.repairs.join('\n')}\n\nSave the plan to keep these fixes.`,
    });
  }
}

export async function openPlan(): Promise<void> {
  if (!(await confirmDiscardChanges())) return;
  const result = await window.fw.file.openDialog();
  if (result === null) return;
  if (!result.ok) {
    await window.fw.app.showMessage({ type: 'error', message: 'The file could not be opened.', detail: result.error });
    return;
  }
  await showOpened(result.value);
}

export async function openHandle(handle: FileHandle): Promise<void> {
  if (!(await confirmDiscardChanges())) return;
  const result = await window.fw.file.openHandle(handle);
  if (!result.ok) {
    await window.fw.app.showMessage({ type: 'error', message: 'The file could not be opened.', detail: result.error });
    return;
  }
  await showOpened(result.value);
}

export async function restoreRecovered(docId: string): Promise<void> {
  if (!(await confirmDiscardChanges())) return;
  const result = await window.fw.autosave.read(docId);
  if (!result.ok) {
    await window.fw.app.showMessage({ type: 'error', message: 'The recovered plan could not be read.', detail: result.error });
    return;
  }
  const loaded = loadDocument(result.value.text);
  if (!loaded.ok) {
    await window.fw.app.showMessage({ type: 'error', message: 'The recovered plan is damaged.', detail: loaded.error });
    return;
  }
  replaceDocument(loaded.doc, result.value.file, { dirty: true });
}
