import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { Platform } from '../src/shared/ipc';
import { buildMenuTemplate } from '../src/main/menu-template';

function build(platform: Platform) {
  const send = vi.fn();
  const showAbout = vi.fn();
  const template = buildMenuTemplate({ platform, appName: 'Framewright', devTools: false, send, showAbout });
  return { template, send, showAbout };
}

const label = (item: MenuItemConstructorOptions) => (item.label ?? '').replace(/&/g, '');
const submenu = (item: MenuItemConstructorOptions | undefined) => (item?.submenu ?? []) as MenuItemConstructorOptions[];
const top = (template: MenuItemConstructorOptions[], name: string) => template.find((item) => label(item) === name);
const find = (items: MenuItemConstructorOptions[], name: string) => items.find((item) => label(item) === name);

const STANDARD = ['File', 'Edit', 'Build', 'View', '3D', 'Tools', 'Window', 'Help'];

describe('menu template', () => {
  it('macOS has an app menu with About, Settings and Quit', () => {
    const { template } = build('darwin');
    expect(template.map(label)).toEqual(['Framewright', ...STANDARD]);
    const roles = submenu(template[0]).map((item) => item.role ?? label(item));
    expect(roles).toEqual(expect.arrayContaining(['about', 'Settings…', 'hide', 'quit']));
    expect(find(submenu(template[0]), 'Settings…')?.accelerator).toBe('Cmd+,');
    expect(submenu(top(template, 'File')).some((item) => item.role === 'quit')).toBe(false);
  });

  it('Windows puts Exit in File, Preferences in Edit and About in Help', () => {
    const { template, showAbout } = build('win32');
    expect(template.map(label)).toEqual(STANDARD);
    expect(submenu(top(template, 'File')).some((item) => item.role === 'quit')).toBe(true);
    expect(find(submenu(top(template, 'Edit')), 'Preferences…')?.accelerator).toBe('Ctrl+,');
    const about = find(submenu(top(template, 'Help')), 'About Framewright');
    (about?.click as () => void)();
    expect(showAbout).toHaveBeenCalledOnce();
  });

  it('uses platform redo shortcuts and CmdOrCtrl for file commands', () => {
    const redo = (p: Platform) => find(submenu(top(build(p).template, 'Edit')), 'Redo')?.accelerator;
    expect(redo('darwin')).toBe('Cmd+Shift+Z');
    expect(redo('win32')).toBe('Ctrl+Y');
    const file = submenu(top(build('win32').template, 'File'));
    expect(find(file, 'Save')?.accelerator).toBe('CmdOrCtrl+S');
    expect(find(file, 'Open…')?.accelerator).toBe('CmdOrCtrl+O');
  });

  it('sends Reset Layout to the renderer', () => {
    const { template, send } = build('win32');
    (find(submenu(top(template, 'View')), 'Reset Layout')?.click as () => void)();
    expect(send).toHaveBeenCalledWith('view.resetLayout');
  });

  it('keeps unbuilt features visible but disabled', () => {
    const { template } = build('win32');
    for (const name of ['Walls', 'Doors', 'Roof']) {
      expect(find(submenu(top(template, 'Build')), name)?.enabled).toBe(false);
    }
  });

  it('only exposes reload/devtools when dev tools are enabled', () => {
    const roles = (devTools: boolean) =>
      submenu(top(buildMenuTemplate({ platform: 'win32', appName: 'F', devTools, send: vi.fn(), showAbout: vi.fn() }), 'View')).map(
        (item) => item.role,
      );
    expect(roles(false)).not.toContain('toggleDevTools');
    expect(roles(true)).toContain('toggleDevTools');
  });
});
