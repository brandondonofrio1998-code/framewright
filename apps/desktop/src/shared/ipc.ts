export const IpcChannel = {
  appInfo: 'fw:app-info',
  menuCommand: 'fw:menu-command',
  showMessage: 'fw:show-message',
  confirmDiscard: 'fw:confirm-discard',
  docState: 'fw:doc-state',
  closeWindow: 'fw:close-window',
  rendererReady: 'fw:renderer-ready',
  openRequest: 'fw:open-request',
  fileOpenDialog: 'fw:file-open-dialog',
  fileOpenHandle: 'fw:file-open-handle',
  fileSave: 'fw:file-save',
  fileSaveAs: 'fw:file-save-as',
  fileExportCsv: 'fw:file-export-csv',
  recentList: 'fw:recent-list',
  autosaveWrite: 'fw:autosave-write',
  autosaveClear: 'fw:autosave-clear',
  autosaveList: 'fw:autosave-list',
  autosaveRead: 'fw:autosave-read',
} as const;

export type Platform = 'darwin' | 'win32' | 'linux';

export interface AppInfo {
  name: string;
  version: string;
  platform: Platform;
  autosaveIntervalMs: number;
}

/** Opaque token for a file the user picked; the renderer never handles raw paths for I/O. */
export type FileHandle = string;

export interface FileRef {
  handle: FileHandle;
  /** File name without extension, for titles. */
  displayName: string;
  /** Full path, for display only (tooltips, recent list). */
  path: string;
}

export interface OpenedFile extends FileRef {
  text: string;
}

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface RecoveryEntry {
  docId: string;
  title: string;
  savedAt: string;
  originalPath: string | null;
}

export interface RecoveredFile extends RecoveryEntry {
  text: string;
  /** Present when the original file still exists. */
  file: FileRef | null;
}

export interface AutosavePayload {
  docId: string;
  title: string;
  handle: FileHandle | null;
  text: string;
}

export interface DocState {
  docId: string;
  title: string;
  dirty: boolean;
  handle: FileHandle | null;
  undoLabel: string | null;
  redoLabel: string | null;
}

export type DiscardChoice = 'save' | 'discard' | 'cancel';

export interface MessageRequest {
  type: 'info' | 'warning' | 'error';
  message: string;
  detail?: string;
}

export type MenuCommand =
  | { type: 'file.new' }
  | { type: 'file.open' }
  | { type: 'file.openHandle'; handle: FileHandle }
  | { type: 'file.save' }
  | { type: 'file.saveAs' }
  | { type: 'file.exportMaterials' }
  | { type: 'file.saveAndClose' }
  | { type: 'edit.undo' }
  | { type: 'edit.redo' }
  | { type: 'edit.delete' }
  | { type: 'edit.selectAll' }
  | { type: 'tool.activate'; tool: ToolId }
  | { type: 'build.roof' }
  | { type: 'build.hip' }
  | { type: 'foundation.build' }
  | { type: 'view.resetLayout' }
  | { type: 'view.fit' }
  | { type: 'view.zoomIn' }
  | { type: 'view.zoomOut' }
  | { type: 'view.showElevation' }
  | { type: 'view.showSection' }
  | { type: 'view.show3d'; mode: 'orbit' | 'walk' }
  | { type: 'view.cameras' };

export const TOOL_IDS = ['select', 'walls', 'break', 'doors', 'windows', 'objects', 'dimensions', 'stairs'] as const;
export type ToolId = (typeof TOOL_IDS)[number];

const SIMPLE_COMMANDS = new Set([
  'file.new',
  'file.open',
  'file.save',
  'file.saveAs',
  'file.exportMaterials',
  'file.saveAndClose',
  'edit.undo',
  'edit.redo',
  'edit.delete',
  'edit.selectAll',
  'view.resetLayout',
  'view.fit',
  'view.zoomIn',
  'view.zoomOut',
  'view.showElevation',
  'view.showSection',
  'view.cameras',
  'build.roof',
  'build.hip',
  'foundation.build',
]);

export function isMenuCommand(value: unknown): value is MenuCommand {
  if (typeof value !== 'object' || value === null) return false;
  const { type, handle, tool } = value as { type?: unknown; handle?: unknown; tool?: unknown };
  if (type === 'file.openHandle') return typeof handle === 'string';
  if (type === 'tool.activate') return (TOOL_IDS as readonly unknown[]).includes(tool);
  if (type === 'view.show3d') {
    const mode = (value as { mode?: unknown }).mode;
    return mode === 'orbit' || mode === 'walk';
  }
  return typeof type === 'string' && SIMPLE_COMMANDS.has(type);
}

export type Unsubscribe = () => void;

export interface FramewrightApi {
  app: {
    info(): Promise<AppInfo>;
    ready(): void;
    showMessage(request: MessageRequest): Promise<void>;
    confirmDiscard(title: string): Promise<DiscardChoice>;
    setDocState(state: DocState): void;
    closeWindow(): void;
  };
  file: {
    openDialog(): Promise<IpcResult<OpenedFile> | null>;
    openHandle(handle: FileHandle): Promise<IpcResult<OpenedFile>>;
    save(handle: FileHandle, text: string): Promise<IpcResult<FileRef>>;
    saveAs(suggestedName: string, text: string): Promise<IpcResult<FileRef> | null>;
    /** Writes a text file the user names. Cancel returns null. This is not a plan. */
    exportCsv(suggestedName: string, text: string): Promise<IpcResult<{ path: string }> | null>;
    recent(): Promise<FileRef[]>;
    onOpenRequest(listener: (file: FileRef) => void): Unsubscribe;
  };
  autosave: {
    write(payload: AutosavePayload): Promise<void>;
    clear(docId: string): Promise<void>;
    list(): Promise<RecoveryEntry[]>;
    read(docId: string): Promise<IpcResult<RecoveredFile>>;
  };
  menu: {
    onCommand(listener: (command: MenuCommand) => void): Unsubscribe;
  };
}
