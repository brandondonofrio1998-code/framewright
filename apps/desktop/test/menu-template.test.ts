import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { Platform } from '../src/shared/ipc';
import { buildMenuTemplate, EMPTY_MENU_STATE, type MenuState } from '../src/main/menu-template';

function build(platform: Platform, state: MenuState = EMPTY_MENU_STATE, devTools = false) {
  const send = vi.fn();
  const showAbout = vi.fn();
  const clearRecent = vi.fn();
  const template = buildMenuTemplate({ platform, appName: 'Framewright', devTools, state, send, showAbout, clearRecent });
  return { template, send, showAbout, clearRecent };
}

const label = (item: MenuItemConstructorOptions) => (item.label ?? '').replace(/&/g, '');
const submenu = (item: MenuItemConstructorOptions | undefined) => (item?.submenu ?? []) as MenuItemConstructorOptions[];
const top = (template: MenuItemConstructorOptions[], name: string) => template.find((item) => label(item) === name);
const find = (items: MenuItemConstructorOptions[], name: string) => items.find((item) => label(item) === name);
const click = (item: MenuItemConstructorOptions | undefined) => (item?.click as () => void)();

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
    click(find(submenu(top(template, 'Help')), 'About Framewright'));
    expect(showAbout).toHaveBeenCalledOnce();
  });

  it('file commands use CmdOrCtrl shortcuts and reach the renderer', () => {
    const { template, send } = build('win32');
    const file = submenu(top(template, 'File'));
    const expected: [string, string, string][] = [
      ['New Plan', 'CmdOrCtrl+N', 'file.new'],
      ['Open…', 'CmdOrCtrl+O', 'file.open'],
      ['Save', 'CmdOrCtrl+S', 'file.save'],
      ['Save As…', 'CmdOrCtrl+Shift+S', 'file.saveAs'],
    ];
    for (const [name, accelerator, type] of expected) {
      const item = find(file, name);
      expect(item?.accelerator).toBe(accelerator);
      click(item);
      expect(send).toHaveBeenLastCalledWith({ type });
    }
    click(find(file, 'Export Materials…'));
    expect(send).toHaveBeenLastCalledWith({ type: 'file.exportMaterials' });
    click(find(file, 'Export Sheet…'));
    expect(send).toHaveBeenLastCalledWith({ type: 'file.exportSheet' });
    click(find(file, 'Export DXF…'));
    expect(send).toHaveBeenLastCalledWith({ type: 'file.exportDxf' });
    click(find(file, 'Export glTF…'));
    expect(send).toHaveBeenLastCalledWith({ type: 'file.exportGlb' });
    click(find(file, 'Import DXF…'));
    expect(send).toHaveBeenLastCalledWith({ type: 'file.importDxf' });
  });

  it('undo/redo are disabled without history and labelled with the command', () => {
    const edit = (p: Platform, state?: MenuState) => submenu(top(build(p, state).template, 'Edit'));
    expect(edit('win32')[0]).toMatchObject({ label: 'Undo', enabled: false });
    const withHistory = edit('win32', { ...EMPTY_MENU_STATE, undoLabel: 'Add Level', redoLabel: 'Edit Level' });
    expect(withHistory[0]).toMatchObject({ label: 'Undo Add Level', enabled: true, accelerator: 'CmdOrCtrl+Z' });
    expect(withHistory[1]).toMatchObject({ label: 'Redo Edit Level', enabled: true, accelerator: 'Ctrl+Y' });
    expect(edit('darwin', { ...EMPTY_MENU_STATE, redoLabel: 'X' })[1]?.accelerator).toBe('Cmd+Shift+Z');
  });

  it('lists recent plans, escapes ampersands, and can clear them', () => {
    const recent = [
      { handle: 'h1', displayName: 'Smith & Sons', path: 'C:\\plans\\Smith & Sons.fwplan' },
      { handle: 'h2', displayName: 'Cabin', path: 'C:\\plans\\Cabin.fwplan' },
    ];
    const { template, send, clearRecent } = build('win32', { ...EMPTY_MENU_STATE, recent });
    const items = submenu(find(submenu(top(template, 'File')), 'Open Recent'));
    expect(items[0]?.label).toBe('&1 Smith && Sons');
    expect(items[0]?.sublabel).toBe(recent[0]?.path);
    click(items[1]);
    expect(send).toHaveBeenLastCalledWith({ type: 'file.openHandle', handle: 'h2' });
    click(find(items, 'Clear Recent'));
    expect(clearRecent).toHaveBeenCalledOnce();

    const empty = submenu(find(submenu(top(build('win32').template, 'File')), 'Open Recent'));
    expect(empty).toEqual([{ label: 'No Recent Plans', enabled: false }]);
  });

  it('sends Reset Layout to the renderer', () => {
    const { template, send } = build('win32');
    click(find(submenu(top(template, 'View')), 'Reset Layout'));
    expect(send).toHaveBeenCalledWith({ type: 'view.resetLayout' });
  });

  it('opens the elevation and the section', () => {
    const { template, send } = build('win32');
    const view = submenu(top(template, 'View'));
    click(find(view, 'Elevation'));
    expect(send).toHaveBeenLastCalledWith({ type: 'view.showElevation' });
    click(find(view, 'Section'));
    expect(send).toHaveBeenLastCalledWith({ type: 'view.showSection' });
  });

  it('opens the orbit view, the walkthrough, and the camera list', () => {
    const { template, send } = build('win32');
    const items = submenu(top(template, '3D'));
    click(find(items, 'Perspective View'));
    expect(send).toHaveBeenLastCalledWith({ type: 'view.show3d', mode: 'orbit' });
    click(find(items, 'Orthographic View'));
    expect(send).toHaveBeenLastCalledWith({ type: 'view.show3d', mode: 'orbit', projection: 'orthographic' });
    click(find(items, 'Orbit Camera'));
    expect(send).toHaveBeenLastCalledWith({ type: 'view.show3d', mode: 'orbit' });
    click(find(items, 'Walkthrough Camera'));
    expect(send).toHaveBeenLastCalledWith({ type: 'view.show3d', mode: 'walk' });
    click(find(items, 'Save Camera…'));
    expect(send).toHaveBeenLastCalledWith({ type: 'view.cameras' });
  });

  it('activates the text tool', () => {
    const { template, send } = build('win32');
    const item = find(submenu(top(template, 'Build')), 'Text');
    expect(item?.enabled).not.toBe(false);
    click(item);
    expect(send).toHaveBeenLastCalledWith({ type: 'tool.activate', tool: 'text' });
  });

  it('Build Roof asks for a gable', () => {
    const { template, send } = build('win32');
    click(find(submenu(top(template, 'Build')), 'Roof'));
    expect(send).toHaveBeenLastCalledWith({ type: 'build.roof' });
    click(find(submenu(top(template, 'Build')), 'Hip Roof'));
    expect(send).toHaveBeenLastCalledWith({ type: 'build.hip' });
    click(find(submenu(top(template, 'Build')), 'Foundation'));
    expect(send).toHaveBeenLastCalledWith({ type: 'foundation.build' });
  });

  it('Build activates plan tools', () => {
    const { template, send } = build('win32');
    const items = submenu(top(template, 'Build'));
    for (const [name, tool] of [
      ['Select Objects', 'select'],
      ['Walls', 'walls'],
      ['Break Wall', 'break'],
      ['Doors', 'doors'],
      ['Windows', 'windows'],
      ['Objects', 'objects'],
      ['Stairs', 'stairs'],
      ['Dimensions', 'dimensions'],
    ] as const) {
      click(find(items, name));
      expect(send).toHaveBeenLastCalledWith({ type: 'tool.activate', tool });
    }
  });

  it('Delete and Fill Window show their keys without stealing them from text fields', () => {
    const { template, send } = build('win32');
    const del = find(submenu(top(template, 'Edit')), 'Delete');
    expect(del).toMatchObject({ accelerator: 'Delete', registerAccelerator: false });
    click(del);
    expect(send).toHaveBeenLastCalledWith({ type: 'edit.delete' });
    expect(find(submenu(top(template, 'View')), 'Fill Window')).toMatchObject({ accelerator: 'F', registerAccelerator: false });
    click(find(submenu(top(template, 'View')), 'Zoom In'));
    expect(send).toHaveBeenLastCalledWith({ type: 'view.zoomIn' });
  });

  it('toggles dark mode and a plan layer from the View menu', () => {
    const { template, send } = build('win32');
    const view = submenu(top(template, 'View'));
    const dark = find(view, 'Dark Mode');
    expect(dark).toMatchObject({ type: 'checkbox', checked: false });
    click(dark);
    expect(send).toHaveBeenLastCalledWith({ type: 'view.toggleDark' });
    const layers = find(view, 'Layers');
    const walls = find(submenu(layers), 'Walls');
    expect(walls).toMatchObject({ type: 'checkbox', checked: true });
    click(walls);
    expect(send).toHaveBeenLastCalledWith({ type: 'view.layer', layer: 'walls' });
    const plan = find(submenu(layers), 'Plan');
    expect(plan).toMatchObject({ type: 'radio', checked: true });
    click(find(submenu(layers), 'New Layer Set'));
    expect(send).toHaveBeenLastCalledWith({ type: 'view.layerSetNew' });
  });

  it('only exposes reload/devtools when dev tools are enabled', () => {
    const roles = (devTools: boolean) => submenu(top(build('win32', EMPTY_MENU_STATE, devTools).template, 'View')).map((i) => i.role);
    expect(roles(false)).not.toContain('toggleDevTools');
    expect(roles(true)).toContain('toggleDevTools');
  });
});
