import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannel, isMenuCommand, type AppInfo, type FramewrightApi, type MenuCommand } from '../shared/ipc';

const api: FramewrightApi = {
  app: {
    info: () => ipcRenderer.invoke(IpcChannel.appInfo) as Promise<AppInfo>,
  },
  menu: {
    onCommand(listener: (command: MenuCommand) => void) {
      const handler = (_event: IpcRendererEvent, command: unknown) => {
        if (isMenuCommand(command)) listener(command);
      };
      ipcRenderer.on(IpcChannel.menuCommand, handler);
      return () => ipcRenderer.off(IpcChannel.menuCommand, handler);
    },
  },
};

contextBridge.exposeInMainWorld('fw', api);
