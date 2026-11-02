import { readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import {
  IpcChannel,
  type AutosavePayload,
  type DiscardChoice,
  type DocState,
  type FileRef,
  type IpcResult,
  type MenuCommand,
  type MessageRequest,
  type OpenedFile,
  type RecoveredFile,
} from '../shared/ipc';
import { AutosaveStore, isValidDocId } from './autosave-store';
import { FileHandles } from './file-handles';
import { exists, MAX_PLAN_BYTES, PLAN_EXTENSION, withPlanExtension, writeFileAtomic } from './fs-utils';
import { RecentFiles } from './recent-files';

const OPEN_FILTERS = [
  { name: 'Framewright Plan', extensions: ['fwplan', 'plan'] },
  { name: 'All Files', extensions: ['*'] },
];
const SAVE_FILTERS = [{ name: 'Framewright Plan', extensions: [PLAN_EXTENSION.slice(1)] }];
const CSV_FILTERS = [{ name: 'CSV', extensions: ['csv'] }];
const PDF_FILTERS = [{ name: 'PDF', extensions: ['pdf'] }];
const DXF_FILTERS = [{ name: 'DXF', extensions: ['dxf'] }];
const GLB_FILTERS = [{ name: 'glTF', extensions: ['glb'] }];

interface WindowState {
  doc: DocState | null;
  forceClose: boolean;
  ready: boolean;
  pendingOpen: FileRef[];
}

export interface DocumentServicesOptions {
  appName: string;
  isTrustedSender(frameUrl: string | undefined): boolean;
  onMenuStateChanged(): void;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function sanitizeFileName(name: string): string {
  const cleaned = [...name].filter((ch) => ch.charCodeAt(0) >= 32 && !'<>:"/\\|?*'.includes(ch)).join('').trim();
  return cleaned === '' ? 'Untitled' : cleaned.slice(0, 120);
}

/** Owns file I/O, recent files, autosave, and per-window unsaved-changes handling. */
export class DocumentServices {
  readonly handles = new FileHandles();
  readonly recent: RecentFiles;
  readonly autosaves: AutosaveStore;
  private readonly windows = new Map<BrowserWindow, WindowState>();
  private quitting = false;

  constructor(private readonly opts: DocumentServicesOptions) {
    const userData = app.getPath('userData');
    this.recent = new RecentFiles(join(userData, 'recent.json'));
    this.autosaves = new AutosaveStore(join(userData, 'autosave'));
    app.on('before-quit', () => {
      this.quitting = true;
    });
  }

  docStateFor(win: BrowserWindow | null | undefined): DocState | null {
    return (win && this.windows.get(win)?.doc) ?? null;
  }

  async recentRefs(): Promise<FileRef[]> {
    return (await this.recent.list()).map((p) => this.handles.register(p));
  }

  async clearRecent(): Promise<void> {
    await this.recent.clear();
    app.clearRecentDocuments();
    this.opts.onMenuStateChanged();
  }

  /** Queue a file from the OS (double-click, argv) for a window; delivered once its renderer is ready. */
  requestOpen(win: BrowserWindow, path: string): void {
    const ref = this.handles.register(path);
    const state = this.windows.get(win);
    if (state?.ready) win.webContents.send(IpcChannel.openRequest, ref);
    else state?.pendingOpen.push(ref);
  }

  send(win: BrowserWindow | null | undefined, command: MenuCommand): void {
    win?.webContents.send(IpcChannel.menuCommand, command);
  }

  attach(win: BrowserWindow): void {
    const state: WindowState = { doc: null, forceClose: false, ready: false, pendingOpen: [] };
    this.windows.set(win, state);

    win.on('page-title-updated', (event) => event.preventDefault());
    win.on('close', (event) => {
      if (state.forceClose || !state.doc?.dirty) return;
      event.preventDefault();
      void this.promptSave(win, state.doc.title).then(async (choice) => {
        if (choice === 'save') this.send(win, { type: 'file.saveAndClose' });
        else if (choice === 'discard') {
          if (state.doc) await this.autosaves.clear(state.doc.docId);
          this.forceClose(win);
        } else this.quitting = false;
      });
    });
    win.on('closed', () => {
      const doc = state.doc;
      this.windows.delete(win);
      if (doc && !doc.dirty) void this.autosaves.clear(doc.docId);
      this.opts.onMenuStateChanged();
    });
  }

  private forceClose(win: BrowserWindow): void {
    const state = this.windows.get(win);
    if (state) state.forceClose = true;
    win.close();
    if (this.quitting) app.quit();
  }

  private async promptSave(win: BrowserWindow, title: string): Promise<DiscardChoice> {
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      message: `Do you want to save the changes you made to “${title}”?`,
      detail: 'Your changes will be lost if you don’t save them.',
      buttons: ['Save', 'Don’t Save', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    return (['save', 'discard', 'cancel'] as const)[response] ?? 'cancel';
  }

  private applyDocState(win: BrowserWindow, doc: DocState): void {
    const state = this.windows.get(win);
    if (!state) return;
    const labelsChanged = state.doc?.undoLabel !== doc.undoLabel || state.doc?.redoLabel !== doc.redoLabel;
    state.doc = doc;
    win.setTitle(`${doc.title}${doc.dirty && process.platform !== 'darwin' ? ' *' : ''} — ${this.opts.appName}`);
    if (process.platform === 'darwin') {
      win.setDocumentEdited(doc.dirty);
      win.setRepresentedFilename(this.handles.resolve(doc.handle) ?? '');
    }
    if (labelsChanged) this.opts.onMenuStateChanged();
  }

  private async readPlan(path: string): Promise<IpcResult<OpenedFile>> {
    try {
      const info = await stat(path);
      if (!info.isFile()) return { ok: false, error: 'That is not a file.' };
      if (info.size > MAX_PLAN_BYTES) return { ok: false, error: 'The file is too large to be a Framewright plan.' };
      const text = await readFile(path, 'utf8');
      const ref = this.handles.register(path);
      await this.remember(ref.path);
      return { ok: true, value: { ...ref, text } };
    } catch (error) {
      return { ok: false, error: `Could not read the file: ${errorMessage(error)}` };
    }
  }

  private async writePlan(path: string, text: unknown): Promise<IpcResult<FileRef>> {
    if (typeof text !== 'string' || text.length > MAX_PLAN_BYTES) return { ok: false, error: 'Invalid plan data.' };
    try {
      await writeFileAtomic(path, text, { backup: true });
      const ref = this.handles.register(path);
      await this.remember(ref.path);
      return { ok: true, value: ref };
    } catch (error) {
      return { ok: false, error: `Could not save the file: ${errorMessage(error)}` };
    }
  }

  private async remember(path: string): Promise<void> {
    await this.recent.add(path);
    app.addRecentDocument(path);
    this.opts.onMenuStateChanged();
  }

  registerIpc(): void {
    const handle = <A extends unknown[], R>(channel: string, fn: (win: BrowserWindow, ...args: A) => R | Promise<R>) =>
      ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
        const win = this.senderWindow(event);
        if (!win) throw new Error('Untrusted sender');
        return fn(win, ...(args as A));
      });
    const on = <A extends unknown[]>(channel: string, fn: (win: BrowserWindow, ...args: A) => void) =>
      ipcMain.on(channel, (event: IpcMainEvent, ...args: unknown[]) => {
        const win = this.senderWindow(event);
        if (win) fn(win, ...(args as A));
      });

    on(IpcChannel.rendererReady, (win) => {
      const state = this.windows.get(win);
      if (!state) return;
      state.ready = true;
      for (const ref of state.pendingOpen.splice(0)) win.webContents.send(IpcChannel.openRequest, ref);
    });
    on(IpcChannel.docState, (win, doc: DocState) => {
      if (isValidDocId(doc?.docId) && typeof doc.title === 'string' && typeof doc.dirty === 'boolean') this.applyDocState(win, doc);
    });
    on(IpcChannel.closeWindow, (win) => this.forceClose(win));

    handle(IpcChannel.showMessage, async (win, req: MessageRequest) => {
      const type = req?.type === 'error' || req?.type === 'warning' ? req.type : 'info';
      await dialog.showMessageBox(win, { type, message: String(req?.message ?? ''), detail: String(req?.detail ?? ''), noLink: true });
    });
    handle(IpcChannel.confirmDiscard, (win, title: unknown) => this.promptSave(win, String(title)));

    handle(IpcChannel.fileOpenDialog, async (win) => {
      const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: OPEN_FILTERS });
      const path = result.filePaths[0];
      return result.canceled || !path ? null : this.readPlan(path);
    });
    handle(IpcChannel.fileOpenHandle, async (_win, fileHandle: unknown) => {
      const path = this.handles.resolve(fileHandle);
      if (!path) return { ok: false, error: 'That file is no longer available.' } satisfies IpcResult<never>;
      if (!(await exists(path))) return { ok: false, error: `The file “${path}” no longer exists.` } satisfies IpcResult<never>;
      return this.readPlan(path);
    });
    handle(IpcChannel.fileSave, async (_win, fileHandle: unknown, text: unknown) => {
      const path = this.handles.resolve(fileHandle);
      if (!path) return { ok: false, error: 'That file is no longer available. Use Save As.' } satisfies IpcResult<never>;
      return this.writePlan(path, text);
    });
    handle(IpcChannel.fileSaveAs, async (win, suggestedName: unknown, text: unknown) => {
      const result = await dialog.showSaveDialog(win, {
        defaultPath: join(app.getPath('documents'), `${sanitizeFileName(String(suggestedName))}${PLAN_EXTENSION}`),
        filters: SAVE_FILTERS,
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      });
      return result.canceled || !result.filePath ? null : this.writePlan(withPlanExtension(result.filePath), text);
    });
    handle(IpcChannel.fileExportCsv, async (win, suggestedName: unknown, text: unknown) => {
      if (typeof text !== 'string' || text.length > MAX_PLAN_BYTES) return { ok: false, error: 'The materials list is too large.' } satisfies IpcResult<never>;
      const result = await dialog.showSaveDialog(win, {
        defaultPath: join(app.getPath('documents'), `${sanitizeFileName(String(suggestedName))}.csv`),
        filters: CSV_FILTERS,
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      });
      if (result.canceled || !result.filePath) return null;
      const path = extname(result.filePath).toLowerCase() === '.csv' ? result.filePath : `${result.filePath}.csv`;
      try {
        await writeFileAtomic(path, text);
        return { ok: true, value: { path } } satisfies IpcResult<{ path: string }>;
      } catch (error) {
        return { ok: false, error: `Could not save the file: ${errorMessage(error)}` } satisfies IpcResult<never>;
      }
    });
    handle(IpcChannel.fileExportPdf, async (win, suggestedName: unknown, data: unknown) => {
      const bytes = data instanceof Uint8Array ? data : null;
      if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_PLAN_BYTES) return { ok: false, error: 'The sheet could not be prepared.' } satisfies IpcResult<never>;
      const result = await dialog.showSaveDialog(win, {
        defaultPath: join(app.getPath('documents'), `${sanitizeFileName(String(suggestedName))}.pdf`),
        filters: PDF_FILTERS,
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      });
      if (result.canceled || !result.filePath) return null;
      const path = extname(result.filePath).toLowerCase() === '.pdf' ? result.filePath : `${result.filePath}.pdf`;
      try {
        await writeFileAtomic(path, bytes);
        return { ok: true, value: { path } } satisfies IpcResult<{ path: string }>;
      } catch (error) {
        return { ok: false, error: `Could not save the file: ${errorMessage(error)}` } satisfies IpcResult<never>;
      }
    });
    handle(IpcChannel.fileExportDxf, async (win, suggestedName: unknown, text: unknown) => {
      if (typeof text !== 'string' || text.length === 0 || text.length > MAX_PLAN_BYTES) return { ok: false, error: 'The drawing could not be prepared.' } satisfies IpcResult<never>;
      const result = await dialog.showSaveDialog(win, {
        defaultPath: join(app.getPath('documents'), `${sanitizeFileName(String(suggestedName))}.dxf`),
        filters: DXF_FILTERS,
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      });
      if (result.canceled || !result.filePath) return null;
      const path = extname(result.filePath).toLowerCase() === '.dxf' ? result.filePath : `${result.filePath}.dxf`;
      try {
        await writeFileAtomic(path, text);
        return { ok: true, value: { path } } satisfies IpcResult<{ path: string }>;
      } catch (error) {
        return { ok: false, error: `Could not save the file: ${errorMessage(error)}` } satisfies IpcResult<never>;
      }
    });
    handle(IpcChannel.fileExportGlb, async (win, suggestedName: unknown, data: unknown) => {
      const bytes = data instanceof Uint8Array ? data : null;
      if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_PLAN_BYTES) return { ok: false, error: 'The model could not be prepared.' } satisfies IpcResult<never>;
      const result = await dialog.showSaveDialog(win, {
        defaultPath: join(app.getPath('documents'), `${sanitizeFileName(String(suggestedName))}.glb`),
        filters: GLB_FILTERS,
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      });
      if (result.canceled || !result.filePath) return null;
      const path = extname(result.filePath).toLowerCase() === '.glb' ? result.filePath : `${result.filePath}.glb`;
      try {
        await writeFileAtomic(path, bytes);
        return { ok: true, value: { path } } satisfies IpcResult<{ path: string }>;
      } catch (error) {
        return { ok: false, error: `Could not save the file: ${errorMessage(error)}` } satisfies IpcResult<never>;
      }
    });
    handle(IpcChannel.fileImportDxf, async (win) => {
      const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: DXF_FILTERS });
      const path = result.filePaths[0];
      if (result.canceled || !path) return null;
      try {
        const info = await stat(path);
        if (info.size > MAX_PLAN_BYTES) return { ok: false, error: 'The DXF is too large.' } satisfies IpcResult<never>;
        const text = await readFile(path, 'utf8');
        const stem = basename(path, extname(path));
        return { ok: true, value: { name: stem, text } } satisfies IpcResult<{ name: string; text: string }>;
      } catch (error) {
        return { ok: false, error: `Could not read the file: ${errorMessage(error)}` } satisfies IpcResult<never>;
      }
    });
    handle(IpcChannel.recentList, () => this.recentRefs());

    handle(IpcChannel.autosaveWrite, async (_win, payload: AutosavePayload) => {
      if (!isValidDocId(payload?.docId) || typeof payload.text !== 'string' || payload.text.length > MAX_PLAN_BYTES) return;
      await this.autosaves.write({
        docId: payload.docId,
        title: String(payload.title ?? 'Untitled').slice(0, 200),
        originalPath: this.handles.resolve(payload.handle),
        text: payload.text,
      });
    });
    handle(IpcChannel.autosaveClear, async (_win, docId: unknown) => {
      if (isValidDocId(docId)) await this.autosaves.clear(docId);
    });
    handle(IpcChannel.autosaveList, () => this.autosaves.list());
    handle(IpcChannel.autosaveRead, async (_win, docId: unknown): Promise<IpcResult<RecoveredFile>> => {
      if (!isValidDocId(docId)) return { ok: false, error: 'Invalid recovery entry.' };
      const stored = await this.autosaves.read(docId);
      if (!stored) return { ok: false, error: 'The recovery file could not be read.' };
      const file = stored.originalPath && (await exists(stored.originalPath)) ? this.handles.register(stored.originalPath) : null;
      return { ok: true, value: { ...stored, file } };
    });
  }

  private senderWindow(event: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | null {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win && this.opts.isTrustedSender(event.senderFrame?.url) ? win : null;
  }
}
