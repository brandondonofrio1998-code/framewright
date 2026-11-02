import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannel, isMenuCommand, type FileRef, type FramewrightApi } from '../shared/ipc';

function subscribe<T>(channel: string, accept: (value: unknown) => value is T, listener: (value: T) => void) {
  const handler = (_event: IpcRendererEvent, value: unknown) => {
    if (accept(value)) listener(value);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.off(channel, handler);
  };
}

const isFileRef = (value: unknown): value is FileRef =>
  typeof value === 'object' && value !== null && typeof (value as FileRef).handle === 'string';

const api: FramewrightApi = {
  app: {
    info: () => ipcRenderer.invoke(IpcChannel.appInfo),
    ready: () => ipcRenderer.send(IpcChannel.rendererReady),
    showMessage: (request) => ipcRenderer.invoke(IpcChannel.showMessage, request),
    confirmDiscard: (title) => ipcRenderer.invoke(IpcChannel.confirmDiscard, title),
    setDocState: (state) => ipcRenderer.send(IpcChannel.docState, state),
    closeWindow: () => ipcRenderer.send(IpcChannel.closeWindow),
  },
  file: {
    openDialog: () => ipcRenderer.invoke(IpcChannel.fileOpenDialog),
    openHandle: (handle) => ipcRenderer.invoke(IpcChannel.fileOpenHandle, handle),
    save: (handle, text) => ipcRenderer.invoke(IpcChannel.fileSave, handle, text),
    saveAs: (suggestedName, text) => ipcRenderer.invoke(IpcChannel.fileSaveAs, suggestedName, text),
    exportCsv: (suggestedName, text) => ipcRenderer.invoke(IpcChannel.fileExportCsv, suggestedName, text),
    exportPdf: (suggestedName, data) => ipcRenderer.invoke(IpcChannel.fileExportPdf, suggestedName, data),
    exportDxf: (suggestedName, text) => ipcRenderer.invoke(IpcChannel.fileExportDxf, suggestedName, text),
    exportGlb: (suggestedName, data) => ipcRenderer.invoke(IpcChannel.fileExportGlb, suggestedName, data),
    importDxf: () => ipcRenderer.invoke(IpcChannel.fileImportDxf),
    recent: () => ipcRenderer.invoke(IpcChannel.recentList),
    onOpenRequest: (listener) => subscribe(IpcChannel.openRequest, isFileRef, listener),
  },
  autosave: {
    write: (payload) => ipcRenderer.invoke(IpcChannel.autosaveWrite, payload),
    clear: (docId) => ipcRenderer.invoke(IpcChannel.autosaveClear, docId),
    list: () => ipcRenderer.invoke(IpcChannel.autosaveList),
    read: (docId) => ipcRenderer.invoke(IpcChannel.autosaveRead, docId),
  },
  menu: {
    onCommand: (listener) => subscribe(IpcChannel.menuCommand, isMenuCommand, listener),
  },
};

contextBridge.exposeInMainWorld('fw', api);
