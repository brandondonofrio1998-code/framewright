import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import { IpcChannel, type AppInfo, type Platform } from '../shared/ipc';
import { APP_ENTRY_URL } from '../shared/network-policy';
import { DocumentServices } from './documents';
import { planPathFromArgv } from './fs-utils';
import { buildMenuTemplate, EMPTY_MENU_STATE, type MenuState } from './menu-template';
import { handleAppProtocol, registerAppScheme } from './protocol';
import { getBlockedRequests, installSecurity, isTrustedSender } from './security';

const APP_NAME = 'Framewright';
const DEFAULT_AUTOSAVE_MS = 60_000;
const isTest = process.env.FW_TEST === '1';
const devServerUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
const devServerOrigin = devServerUrl ? new URL(devServerUrl).origin : null;
const autosaveIntervalMs = (isTest && Number(process.env.FW_AUTOSAVE_MS)) || DEFAULT_AUTOSAVE_MS;

app.setName(APP_NAME);
if (isTest && process.env.FW_USER_DATA) app.setPath('userData', process.env.FW_USER_DATA);
if (isTest) {
  (globalThis as Record<string, unknown>).__framewrightTest = { blockedRequests: getBlockedRequests };
}

app.enableSandbox();
registerAppScheme();

let services: DocumentServices | null = null;
const pendingOsOpens: string[] = [];

// macOS delivers double-clicked files through this event, possibly before `ready`.
app.on('open-file', (event, path) => {
  event.preventDefault();
  const win = BrowserWindow.getAllWindows()[0];
  if (services && win) services.requestOpen(win, path);
  else pendingOsOpens.push(path);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const initialPath = planPathFromArgv(process.argv);
  if (initialPath) pendingOsOpens.push(initialPath);

  app.on('second-instance', (_event, argv) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const path = planPathFromArgv(argv);
    if (path && services) services.requestOpen(win, path);
  });
  app.whenReady().then(start, (error: unknown) => {
    console.error(error);
    app.exit(1);
  });
}

function start(): void {
  installSecurity(devServerOrigin);
  handleAppProtocol();
  services = new DocumentServices({
    appName: APP_NAME,
    isTrustedSender: (url) => isTrustedSender(url, devServerOrigin),
    onMenuStateChanged: () => void refreshMenu(),
  });
  services.registerIpc();
  ipcMain.handle(IpcChannel.appInfo, (event): AppInfo => {
    if (!isTrustedSender(event.senderFrame?.url, devServerOrigin)) throw new Error('Untrusted sender');
    return { name: APP_NAME, version: app.getVersion(), platform: process.platform as Platform, autosaveIntervalMs };
  });
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
      copyright: 'MIT License. Framewright contributors.',
    });
  }
  installMenu(EMPTY_MENU_STATE);
  void refreshMenu();

  const win = createMainWindow();
  for (const path of pendingOsOpens.splice(0)) services.requestOpen(win, path);

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
  services?.attach(win);
  win.once('ready-to-show', () => win.show());
  win.on('focus', () => void refreshMenu());
  void win.loadURL(devServerUrl ?? APP_ENTRY_URL);
  return win;
}

async function refreshMenu(): Promise<void> {
  if (!services) return;
  const doc = services.docStateFor(BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]);
  installMenu({
    undoLabel: doc?.undoLabel ?? null,
    redoLabel: doc?.redoLabel ?? null,
    recent: await services.recentRefs(),
    dark: doc?.dark ?? false,
    hiddenLayers: doc?.hiddenLayers ?? [],
    layerSets: doc?.layerSets ?? [],
    activeLayerSet: doc?.activeLayerSet ?? null,
  });
}

function installMenu(state: MenuState): void {
  const template = buildMenuTemplate({
    platform: process.platform as Platform,
    appName: APP_NAME,
    devTools: !app.isPackaged,
    state,
    send: (command) => services?.send(BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0], command),
    clearRecent: () => void services?.clearRecent(),
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
