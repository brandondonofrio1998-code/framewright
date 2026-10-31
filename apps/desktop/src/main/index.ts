import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import { IpcChannel, type AppInfo, type MenuCommand, type Platform } from '../shared/ipc';
import { APP_ENTRY_URL } from '../shared/network-policy';
import { buildMenuTemplate } from './menu-template';
import { handleAppProtocol, registerAppScheme } from './protocol';
import { getBlockedRequests, installSecurity, isTrustedSender } from './security';

const APP_NAME = 'Framewright';
const isTest = process.env.FW_TEST === '1';
const devServerUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
const devServerOrigin = devServerUrl ? new URL(devServerUrl).origin : null;

app.setName(APP_NAME);
if (isTest && process.env.FW_USER_DATA) app.setPath('userData', process.env.FW_USER_DATA);
if (isTest) {
  (globalThis as Record<string, unknown>).__framewrightTest = { blockedRequests: getBlockedRequests };
}

app.enableSandbox();
registerAppScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(start, (error: unknown) => {
    console.error(error);
    app.exit(1);
  });
}

function start(): void {
  installSecurity(devServerOrigin);
  handleAppProtocol();
  registerIpc();
  installMenu();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#F4F3F1',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  win.once('ready-to-show', () => win.show());
  void win.loadURL(devServerUrl ?? APP_ENTRY_URL);
  return win;
}

function registerIpc(): void {
  ipcMain.handle(IpcChannel.appInfo, (event): AppInfo => {
    if (!isTrustedSender(event.senderFrame?.url, devServerOrigin)) throw new Error('Untrusted sender');
    return { name: APP_NAME, version: app.getVersion(), platform: process.platform as Platform };
  });
}

function installMenu(): void {
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
      copyright: 'MIT License. Framewright contributors.',
    });
  }
  const template = buildMenuTemplate({
    platform: process.platform as Platform,
    appName: APP_NAME,
    devTools: !app.isPackaged,
    send: (command: MenuCommand) => {
      const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      target?.webContents.send(IpcChannel.menuCommand, command);
    },
    showAbout: () => {
      void dialog.showMessageBox({
        type: 'info',
        title: `About ${APP_NAME}`,
        message: `${APP_NAME} ${app.getVersion()}`,
        detail: 'Offline residential design.\nMIT License. Framewright contributors.',
      });
    },
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
