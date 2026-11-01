import type { MenuItemConstructorOptions } from 'electron';
import type { FileRef, MenuCommand, Platform, ToolId } from '../shared/ipc';

export interface MenuState {
  undoLabel: string | null;
  redoLabel: string | null;
  recent: FileRef[];
}

export const EMPTY_MENU_STATE: MenuState = { undoLabel: null, redoLabel: null, recent: [] };

export interface MenuContext {
  platform: Platform;
  appName: string;
  devTools: boolean;
  state: MenuState;
  send(command: MenuCommand): void;
  showAbout(): void;
  clearRecent(): void;
}

const sep: MenuItemConstructorOptions = { type: 'separator' };

/** Items for features that do not exist yet are present but disabled, so the menu structure is stable. */
function pending(label: string, accelerator?: string): MenuItemConstructorOptions {
  return accelerator === undefined ? { label, enabled: false } : { label, accelerator, enabled: false };
}

/** Escapes `&` so Windows does not treat file names as mnemonics. */
const literal = (text: string) => text.replace(/&/g, '&&');

function recentSubmenu(ctx: MenuContext): MenuItemConstructorOptions[] {
  if (ctx.state.recent.length === 0) return [{ label: 'No Recent Plans', enabled: false }];
  return [
    ...ctx.state.recent.map(
      (file, i): MenuItemConstructorOptions => ({
        label: ctx.platform === 'darwin' ? literal(file.displayName) : `&${(i + 1) % 10} ${literal(file.displayName)}`,
        sublabel: file.path,
        click: () => ctx.send({ type: 'file.openHandle', handle: file.handle }),
      }),
    ),
    sep,
    { label: 'Clear Recent', click: () => ctx.clearRecent() },
  ];
}

export function buildMenuTemplate(ctx: MenuContext): MenuItemConstructorOptions[] {
  const mac = ctx.platform === 'darwin';
  const { undoLabel, redoLabel } = ctx.state;

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
      { label: 'New Plan', accelerator: 'CmdOrCtrl+N', click: () => ctx.send({ type: 'file.new' }) },
      { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => ctx.send({ type: 'file.open' }) },
      { label: 'Open Recent', submenu: recentSubmenu(ctx) },
      sep,
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => ctx.send({ type: 'file.save' }) },
      { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => ctx.send({ type: 'file.saveAs' }) },
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
      {
        label: undoLabel ? `Undo ${literal(undoLabel)}` : 'Undo',
        accelerator: 'CmdOrCtrl+Z',
        enabled: undoLabel !== null,
        click: () => ctx.send({ type: 'edit.undo' }),
      },
      {
        label: redoLabel ? `Redo ${literal(redoLabel)}` : 'Redo',
        accelerator: mac ? 'Cmd+Shift+Z' : 'Ctrl+Y',
        enabled: redoLabel !== null,
        click: () => ctx.send({ type: 'edit.redo' }),
      },
      sep,
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      // Shown but not registered, so the key still edits text fields; the renderer handles it.
      { label: 'Delete', accelerator: 'Delete', registerAccelerator: false, click: () => ctx.send({ type: 'edit.delete' }) },
      sep,
      { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: () => ctx.send({ type: 'edit.selectAll' }) },
      ...(mac ? [] : [sep, pending('Preferences…', 'Ctrl+,')]),
    ],
  };

  const tool = (label: string, id: ToolId): MenuItemConstructorOptions => ({
    label,
    click: () => ctx.send({ type: 'tool.activate', tool: id }),
  });

  const build: MenuItemConstructorOptions = {
    label: '&Build',
    submenu: [
      tool('Select Objects', 'select'),
      sep,
      tool('Walls', 'walls'),
      tool('Break Wall', 'break'),
      tool('Doors', 'doors'),
      tool('Windows', 'windows'),
      tool('Objects', 'objects'),
      pending('Stairs'),
      pending('Roof'),
      sep,
      tool('Dimensions', 'dimensions'),
      pending('Text'),
    ],
  };

  const view: MenuItemConstructorOptions = {
    label: '&View',
    submenu: [
      { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => ctx.send({ type: 'view.zoomIn' }) },
      { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => ctx.send({ type: 'view.zoomOut' }) },
      { label: 'Fill Window', accelerator: 'F', registerAccelerator: false, click: () => ctx.send({ type: 'view.fit' }) },
      sep,
      { label: 'Elevation', click: () => ctx.send({ type: 'view.showElevation' }) },
      { label: 'Section', click: () => ctx.send({ type: 'view.showSection' }) },
      sep,
      { label: 'Reset Layout', click: () => ctx.send({ type: 'view.resetLayout' }) },
      sep,
      { role: 'togglefullscreen' },
      ...(ctx.devTools
        ? [sep, { role: 'reload' }, { role: 'toggleDevTools' }] satisfies MenuItemConstructorOptions[]
        : []),
    ],
  };

  const threeD: MenuItemConstructorOptions = {
    label: '&3D',
    submenu: [
      { label: 'Perspective View', click: () => ctx.send({ type: 'view.show3d', mode: 'orbit' }) },
      { label: 'Orbit Camera', click: () => ctx.send({ type: 'view.show3d', mode: 'orbit' }) },
      { label: 'Walkthrough Camera', click: () => ctx.send({ type: 'view.show3d', mode: 'walk' }) },
      { label: 'Save Camera…', click: () => ctx.send({ type: 'view.cameras' }) },
    ],
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
