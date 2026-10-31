import { useEffect, useState } from 'react';
import type { AppInfo, MenuCommand, RecoveryEntry } from '../../../shared/ipc';
import { newPlan, openHandle, openPlan, restoreRecovered, save, saveAndClose, saveAs } from '../document/file-actions';
import { history, setAppVersion } from '../document/store';
import { startDocumentSync } from '../document/sync';
import { RecoveryDialog } from './RecoveryDialog';
import { StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';
import { Workspace } from './Workspace';

function isEditable(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return element.isContentEditable || element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}

/** Text fields keep their own undo; everything else undoes document commands. */
function undoOrRedo(kind: 'undo' | 'redo'): void {
  if (isEditable(document.activeElement)) {
    document.execCommand(kind);
    return;
  }
  if (kind === 'undo') history.undo();
  else history.redo();
}

function handleMenu(command: MenuCommand): void {
  switch (command.type) {
    case 'file.new':
      return void newPlan();
    case 'file.open':
      return void openPlan();
    case 'file.openHandle':
      return void openHandle(command.handle);
    case 'file.save':
      return void save();
    case 'file.saveAs':
      return void saveAs();
    case 'file.saveAndClose':
      return void saveAndClose();
    case 'edit.undo':
      return undoOrRedo('undo');
    case 'edit.redo':
      return undoOrRedo('redo');
    case 'view.resetLayout':
      return;
  }
}

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [recovery, setRecovery] = useState<RecoveryEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    let stopSync: (() => void) | null = null;
    const offMenu = window.fw.menu.onCommand(handleMenu);
    const offOpen = window.fw.file.onOpenRequest((file) => void openHandle(file.handle));

    void window.fw.app.info().then(async (result) => {
      if (cancelled) return;
      setAppVersion(result.version);
      setInfo(result);
      stopSync = startDocumentSync(result.autosaveIntervalMs);
      const entries = await window.fw.autosave.list();
      if (!cancelled) {
        setRecovery(entries);
        window.fw.app.ready();
      }
    });

    return () => {
      cancelled = true;
      offMenu();
      offOpen();
      stopSync?.();
    };
  }, []);

  const removeEntry = (docId: string) => setRecovery((entries) => entries.filter((e) => e.docId !== docId));

  return (
    <div className="app" data-platform={info?.platform}>
      <Toolbar />
      <Workspace />
      <StatusBar />
      {recovery.length > 0 && (
        <RecoveryDialog
          entries={recovery}
          onRestore={(entry) => {
            setRecovery([]);
            void restoreRecovered(entry.docId);
          }}
          onDiscard={(entry) => {
            removeEntry(entry.docId);
            void window.fw.autosave.clear(entry.docId);
          }}
          onClose={() => setRecovery([])}
        />
      )}
    </div>
  );
}
