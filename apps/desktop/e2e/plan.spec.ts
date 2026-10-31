import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { clickMenu, expect, menuItem, test } from './fixtures';

interface Vec2 {
  x: number;
  y: number;
}

interface SavedPlan {
  elements: Record<string, { kind: string; p?: Vec2; a?: unknown; b?: unknown; offset?: number }>;
}

/** Page coordinates of a model point (inches, Y up), read from the plan view's current viewport. */
async function screenOf(window: Page, p: Vec2): Promise<Vec2> {
  const plan = window.getByTestId('plan-view');
  await expect(plan).toHaveAttribute('data-scale', /\d/);
  // The dock lays out over a few frames after launch; measure once the panel stops moving.
  let box = (await plan.boundingBox())!;
  await expect
    .poll(async () => {
      const prev = box;
      await window.waitForTimeout(50);
      box = (await plan.boundingBox())!;
      return JSON.stringify(prev) === JSON.stringify(box);
    })
    .toBe(true);
  const view = await plan.evaluate((el: HTMLElement) => ({
    scale: Number(el.dataset.scale),
    cx: Number(el.dataset.cx),
    cy: Number(el.dataset.cy),
  }));
  return {
    x: box.x + box.width / 2 + (p.x - view.cx) * view.scale,
    y: box.y + box.height / 2 - (p.y - view.cy) * view.scale,
  };
}

/** Zooms out until the model rectangle (plus a margin for clicks beside it) fits in the plan panel, whatever the screen size. */
async function showModel(app: ElectronApplication, window: Page, min: Vec2, max: Vec2): Promise<void> {
  const MARGIN_PX = 60;
  for (let i = 0; i < 12; i++) {
    const box = (await window.getByTestId('plan-view').boundingBox())!;
    const a = await screenOf(window, min);
    const b = await screenOf(window, max);
    const fits =
      a.x - MARGIN_PX >= box.x && b.x + MARGIN_PX <= box.x + box.width && b.y - MARGIN_PX >= box.y && a.y + MARGIN_PX <= box.y + box.height;
    if (fits) return;
    const before = await window.getByTestId('plan-view').getAttribute('data-scale');
    await clickMenu(app, ['View', 'Zoom Out']);
    await expect(window.getByTestId('plan-view')).not.toHaveAttribute('data-scale', before!);
  }
  throw new Error('Plan panel too small to show the test model');
}

/** Edit > Undo/Redo carry the command name ("Undo Draw Wall"), so match by prefix. */
async function undoRedo(app: ElectronApplication, kind: 'Undo' | 'Redo'): Promise<void> {
  const item = await menuItem(app, ['Edit', kind]);
  expect(item?.enabled).toBe(true);
  await clickMenu(app, ['Edit', item!.label.replace(/&(&?)/g, '$1')]);
}

async function clickAt(window: Page, p: Vec2): Promise<void> {
  const s = await screenOf(window, p);
  await window.mouse.move(s.x, s.y);
  await window.mouse.click(s.x, s.y);
}

async function dragFrom(window: Page, from: Vec2, to: Vec2): Promise<void> {
  const a = await screenOf(window, from);
  const b = await screenOf(window, to);
  await window.mouse.move(a.x, a.y);
  await window.mouse.down();
  await window.mouse.move(b.x, b.y, { steps: 8 });
  await window.mouse.up();
}

/** Types a length (and optional angle) into the box that opens when you type while drawing. */
async function typeLength(window: Page, length: string, angle?: string): Promise<void> {
  await window.keyboard.press(length[0]!);
  const input = window.getByLabel('Wall length', { exact: true }).last();
  await expect(input).toBeFocused();
  await input.pressSequentially(length.slice(1));
  if (angle !== undefined) await window.getByLabel('Wall angle').fill(angle);
  await input.press('Enter');
  await expect(window.getByRole('group', { name: 'Typed length' })).toHaveCount(0);
}

async function savePlan(app: ElectronApplication, dir: string, name: string): Promise<SavedPlan> {
  const target = join(dir, name);
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
  }, target);
  await clickMenu(app, ['File', 'Save As…']);
  const saved = `${target}.fwplan`;
  await expect.poll(() => existsSync(saved)).toBe(true);
  return JSON.parse(readFileSync(saved, 'utf8')) as SavedPlan;
}

const ofKind = (plan: SavedPlan, kind: string) => Object.values(plan.elements).filter((el) => el.kind === kind);
const nodePoints = (plan: SavedPlan) =>
  ofKind(plan, 'wallNode')
    .map((n) => ({ x: Math.round(n.p!.x * 1000) / 1000, y: Math.round(n.p!.y * 1000) / 1000 }))
    .sort((a, b) => a.x - b.x || a.y - b.y);

// CI runner screens are about 1024x768; use that size everywhere so coordinates behave the same locally.
test.beforeEach(async ({ electronApp, window }) => {
  await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    win.unmaximize();
    win.setContentSize(1000, 640);
  });
  await expect.poll(() => window.evaluate(() => globalThis.innerWidth)).toBe(1000);
});

// A 20' x 12' room with its lower-left corner at (-120, -72).
const ROOM = { x0: -120, y0: -72, x1: 120, y1: 72 };

async function drawRoom(app: ElectronApplication, window: Page): Promise<void> {
  await showModel(app, window, { x: ROOM.x0 - 36, y: ROOM.y0 }, { x: ROOM.x1 + 36, y: ROOM.y1 + 30 });
  await window.getByRole('button', { name: 'Walls', exact: true }).click();
  await expect(window.getByTestId('status-tool')).toHaveText('Walls');
  await clickAt(window, { x: ROOM.x0, y: ROOM.y0 });
  await typeLength(window, "20'", '0');
  await typeLength(window, "12'", '90');
  await typeLength(window, "20'", '180');
  await typeLength(window, "12'", '270');
  await window.getByLabel('Plan view').press('Escape');
}

test('draws a room from typed lengths and angles', async ({ electronApp, window, userData, consoleErrors }) => {
  await drawRoom(electronApp, window);
  const plan = await savePlan(electronApp, userData, 'room');
  expect(ofKind(plan, 'wall')).toHaveLength(4);
  expect(nodePoints(plan)).toEqual([
    { x: ROOM.x0, y: ROOM.y0 },
    { x: ROOM.x0, y: ROOM.y1 },
    { x: ROOM.x1, y: ROOM.y0 },
    { x: ROOM.x1, y: ROOM.y1 },
  ]);
  expect(consoleErrors).toEqual([]);
  await window.screenshot({ path: test.info().outputPath('room.png') });
});

test('undo removes walls one at a time and redo restores them', async ({ electronApp, window, userData }) => {
  await drawRoom(electronApp, window);
  await undoRedo(electronApp, 'Undo');
  await undoRedo(electronApp, 'Undo');
  expect(ofKind(await savePlan(electronApp, userData, 'undone'), 'wall')).toHaveLength(2);
  await undoRedo(electronApp, 'Redo');
  expect(ofKind(await savePlan(electronApp, userData, 'redone'), 'wall')).toHaveLength(3);
});

test('selects a wall, edits its length in Properties, and deletes it', async ({ electronApp, window, userData }) => {
  await drawRoom(electronApp, window);
  await window.getByRole('button', { name: 'Select Objects' }).click();
  await clickAt(window, { x: 0, y: ROOM.y0 });

  const length = window.getByLabel('Wall length', { exact: true });
  await expect(length).toHaveValue(`20'-0"`);
  await length.fill(`24'`);
  await length.press('Enter');
  await expect(length).toHaveValue(`24'-0"`);
  const xs = nodePoints(await savePlan(electronApp, userData, 'stretched')).map((p) => p.x);
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(288, 3);

  await window.getByLabel('Plan view').focus();
  await window.keyboard.press('Delete');
  await expect(length).toHaveCount(0);
  expect(ofKind(await savePlan(electronApp, userData, 'deleted'), 'wall')).toHaveLength(3);
});

test('moves a wall and drags a wall end, keeping corners joined', async ({ electronApp, window, userData }) => {
  await drawRoom(electronApp, window);
  await window.getByRole('button', { name: 'Select Objects' }).click();
  await clickAt(window, { x: 0, y: ROOM.y1 });
  await dragFrom(window, { x: 0, y: ROOM.y1 }, { x: 0, y: ROOM.y1 + 24 });
  let points = nodePoints(await savePlan(electronApp, userData, 'moved'));
  expect(points.filter((p) => p.y === ROOM.y1 + 24)).toHaveLength(2);
  expect(ofKind(await savePlan(electronApp, userData, 'moved2'), 'wall')).toHaveLength(4);

  await clickAt(window, { x: ROOM.x1, y: 0 });
  await dragFrom(window, { x: ROOM.x1, y: ROOM.y0 }, { x: ROOM.x1 + 36, y: ROOM.y0 });
  points = nodePoints(await savePlan(electronApp, userData, 'dragged'));
  expect(points).toContainEqual({ x: ROOM.x1 + 36, y: ROOM.y0 });
});

test('breaks a wall and places an attached dimension', async ({ electronApp, window, userData }) => {
  await drawRoom(electronApp, window);
  await window.getByRole('button', { name: 'Break Wall' }).click();
  await clickAt(window, { x: 0, y: ROOM.y0 });
  let plan = await savePlan(electronApp, userData, 'broken');
  expect(ofKind(plan, 'wall')).toHaveLength(5);

  await window.getByRole('button', { name: 'Dimensions', exact: true }).click();
  await clickAt(window, { x: ROOM.x0, y: ROOM.y1 });
  await clickAt(window, { x: ROOM.x1, y: ROOM.y1 });
  await clickAt(window, { x: 0, y: ROOM.y1 + 30 });
  plan = await savePlan(electronApp, userData, 'dimensioned');
  const [dim] = ofKind(plan, 'dimension');
  expect(dim).toMatchObject({ a: { nodeId: expect.any(String) }, b: { nodeId: expect.any(String) } });
  expect(dim!.offset).toBeGreaterThan(20);
  await window.screenshot({ path: test.info().outputPath('dimension.png') });
});

test('status bar shows the cursor position and snap toggles', async ({ window }) => {
  const s = await screenOf(window, { x: 36, y: 24 });
  await window.mouse.move(s.x, s.y);
  await expect(window.getByTestId('status-coords')).toContainText(`3'`);
  const grid = window.getByRole('button', { name: 'Grid', exact: true });
  await expect(grid).toHaveAttribute('aria-pressed', 'true');
  await grid.click();
  await expect(grid).toHaveAttribute('aria-pressed', 'false');
});
