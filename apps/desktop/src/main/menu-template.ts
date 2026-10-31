import type { MenuItemConstructorOptions } from 'electron';
import type { MenuCommand, Platform } from '../shared/ipc';

export interface MenuContext {
  platform: Platform;
  appName: string;
  devTools: boolean;
  send(command: MenuCommand): void;
  showAbout(): void;
}

const sep: MenuItemConstructorOptions = { type: 'separator' };

/** Items for features that do not exist yet are present but disabled, so the menu structure is stable. */
function pending(label: string, accelerator?: string): MenuItemConstructorOptions {
  return accelerator === undefined ? { label, enabled: false } : { label, accelerator, enabled: false };
}

export function buildMenuTemplate(ctx: MenuContext): MenuItemConstructorOptions[] {
  const mac = ctx.platform === 'darwin';

  const appMenu: MenuItemConstructorOptions = {
    label: ctx.appName,
    submenu: [
      { role: 'about' },
      sep,
      pending('Settings…', 'Cmd+,'),
      sep,
      { role: 'services' },
      sep,
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      sep,
      { role: 'quit' },
    ],
  };

  const file: MenuItemConstructorOptions = {
    label: '&File',
    submenu: [
      pending('New Plan', 'CmdOrCtrl+N'),
      pending('Open…', 'CmdOrCtrl+O'),
      pending('Open Recent'),
      sep,
      pending('Save', 'CmdOrCtrl+S'),
      pending('Save As…', 'CmdOrCtrl+Shift+S'),
      sep,
      pending('Export'),
      sep,
      { role: 'close', label: 'Close Window' },
      ...(mac ? [] : [sep, { role: 'quit', label: 'E&xit' } satisfies MenuItemConstructorOptions]),
    ],
  };

  const edit: MenuItemConstructorOptions = {
    label: '&Edit',
    submenu: [
      pending('Undo', 'CmdOrCtrl+Z'),
      pending('Redo', mac ? 'Cmd+Shift+Z' : 'Ctrl+Y'),
      sep,
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'delete' },
      sep,
      { role: 'selectAll' },
      ...(mac ? [] : [sep, pending('Preferences…', 'Ctrl+,')]),
    ],
  };

  const build: MenuItemConstructorOptions = {
    label: '&Build',
    submenu: [
      pending('Walls'),
      pending('Doors'),
      pending('Windows'),
      pending('Cabinets'),
      pending('Stairs'),
      pending('Roof'),
      sep,
      pending('Dimensions'),
      pending('Text'),
    ],
  };

  const view: MenuItemConstructorOptions = {
    label: '&View',
    submenu: [
      { label: 'Reset Layout', click: () => ctx.send('view.resetLayout') },
      sep,
      { role: 'togglefullscreen' },
      ...(ctx.devTools
        ? [sep, { role: 'reload' }, { role: 'toggleDevTools' }] satisfies MenuItemConstructorOptions[]
        : []),
    ],
  };

  const threeD: MenuItemConstructorOptions = {
    label: '&3D',
    submenu: [pending('Perspective View'), pending('Orbit Camera'), pending('Walkthrough Camera')],
  };

  const tools: MenuItemConstructorOptions = {
    label: '&Tools',
    submenu: [pending('Materials List'), sep, pending('Import Library Folder…')],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: '&Window',
    submenu: mac
      ? [{ role: 'minimize' }, { role: 'zoom' }, sep, { role: 'front' }]
      : [{ role: 'minimize' }, { role: 'close' }],
  };

  const help: MenuItemConstructorOptions = {
    label: '&Help',
    role: 'help',
    submenu: mac ? [] : [{ label: `About ${ctx.appName}`, click: () => ctx.showAbout() }],
  };

  return [...(mac ? [appMenu] : []), file, edit, build, view, threeD, tools, windowMenu, help];
}
