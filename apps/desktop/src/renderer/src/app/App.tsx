import { useEffect, useState } from 'react';
import type { AppInfo, MenuCommand, RecoveryEntry } from '../../../shared/ipc';
import { newPlan, openHandle, openPlan, restoreRecovered, save, saveAndClose, saveAs } from '../document/file-actions';
import { history, setAppVersion } from '../document/store';
import { deleteSelection, isEditable, selectAll, buildFoundation, buildGable, buildHip } from '../editor/actions';
import { setTool } from '../editor/store';
import { startDocumentSync } from '../document/sync';
import { RecoveryDialog } from './RecoveryDialog';
import { StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';
import { Workspace } from './Workspace';

/** Text fields keep their own editing commands; everything else acts on the plan. */
function editCommand(kind: 'undo' | 'redo' | 'delete' | 'selectAll'): void {
  if (isEditable(document.activeElement)) {
    document.execCommand(kind);
    return;
  }
  if (kind === 'undo') history.undo();
  else if (kind === 'redo') history.redo();
  else if (kind === 'delete') deleteSelection();
  else selectAll();
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
      return editCommand('undo');
    case 'edit.redo':
      return editCommand('redo');
    case 'edit.delete':
      return editCommand('delete');
    case 'edit.selectAll':
      return editCommand('selectAll');
    case 'tool.activate':
      return setTool(command.tool);
    case 'build.roof':
      return buildGable();
    case 'build.hip':
      return buildHip();
    case 'foundation.build':
      return buildFoundation();
    case 'view.resetLayout':
    case 'view.fit':
    case 'view.zoomIn':
    case 'view.zoomOut':
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
