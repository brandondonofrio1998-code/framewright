import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { clickMenu, expect, test } from './fixtures';

interface Vec2 {
  x: number;
  y: number;
}

interface SavedPlan {
  elements: Record<string, { kind: string }>;
}

async function screenOf(window: Page, p: Vec2): Promise<Vec2> {
  const plan = window.getByTestId('plan-view');
  await expect(plan).toHaveAttribute('data-scale', /\d/);
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
  throw new Error('Plan panel too small to show the house');
}

async function clickAt(window: Page, p: Vec2): Promise<void> {
  const s = await screenOf(window, p);
  await window.mouse.click(s.x, s.y);
}

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
  await expect.poll(() => existsSync(saved), { timeout: 15_000 }).toBe(true);
  return JSON.parse(readFileSync(saved, 'utf8')) as SavedPlan;
}

test.beforeEach(async ({ electronApp, window }) => {
  await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    win.unmaximize();
    win.setContentSize(1000, 640);
  });
  await expect.poll(() => window.evaluate(() => globalThis.innerWidth)).toBe(1000);
});

test('builds a 24 by 16 foot house with a bedroom wall, a roof, and a foundation', async ({ electronApp, window, userData, consoleErrors }) => {
  await showModel(electronApp, window, { x: -48, y: -48 }, { x: 336, y: 240 });
  await window.getByRole('button', { name: 'Walls', exact: true }).click();
  await clickAt(window, { x: 0, y: 0 });
  await typeLength(window, "24'", '0');
  await typeLength(window, "16'", '90');
  await typeLength(window, "24'", '180');
  await typeLength(window, "16'", '270');
  await window.getByLabel('Plan view').press('Escape');

  const wallType = window.getByLabel('Wall type to draw');
  const interior = await wallType.locator('option').evaluateAll((options) => options.find((option) => option.textContent?.startsWith('Interior'))?.textContent ?? '');
  await wallType.selectOption({ label: interior });
  await clickAt(window, { x: 192, y: 0 });
  await typeLength(window, "16'", '90');
  await window.getByLabel('Plan view').press('Escape');

  await window.getByRole('button', { name: 'Roof', exact: true }).click();
  await window.getByRole('button', { name: 'Foundation', exact: true }).click();
  await window.getByRole('button', { name: 'Doors', exact: true }).click();
  await clickAt(window, { x: 96, y: 4 });

  const plan = await savePlan(electronApp, userData, 'house');
  const kinds = Object.values(plan.elements).map((el) => el.kind);
  expect(kinds.filter((kind) => kind === 'wall').length).toBeGreaterThanOrEqual(5);
  expect(kinds.filter((kind) => kind === 'room')).toHaveLength(2);
  expect(kinds.filter((kind) => kind === 'roofPlane')).toHaveLength(2);
  expect(kinds.filter((kind) => kind === 'foundation')).toHaveLength(1);
  expect(kinds.filter((kind) => kind === 'door')).toHaveLength(1);

  await window.locator('.dv-default-tab-content', { hasText: '3D' }).click();
  await expect.poll(async () => Number(await window.getByTestId('view-3d').getAttribute('data-mesh-count'))).toBeGreaterThan(4);
  await window.locator('.dv-default-tab-content', { hasText: 'Sheet' }).click();
  const sheet = window.getByTestId('sheet-view');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel('Sheet', { exact: true })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('roofs an L-shaped wing', async ({ electronApp, window, userData, consoleErrors }) => {
  await showModel(electronApp, window, { x: -36, y: -36 }, { x: 280, y: 230 });
  await window.getByRole('button', { name: 'Walls', exact: true }).click();
  await clickAt(window, { x: 0, y: 0 });
  await typeLength(window, "20'", '0');
  await typeLength(window, "8'", '90');
  await typeLength(window, "12'", '180');
  await typeLength(window, "8'", '90');
  await typeLength(window, "8'", '180');
  await typeLength(window, "16'", '270');
  await window.getByLabel('Plan view').press('Escape');
  await window.getByRole('button', { name: 'Roof', exact: true }).click();
  const plan = await savePlan(electronApp, userData, 'wing');
  expect(Object.values(plan.elements).filter((el) => el.kind === 'roofPlane').length).toBeGreaterThanOrEqual(6);
  await window.locator('.dv-default-tab-content', { hasText: '3D' }).click();
  await expect.poll(async () => Number(await window.getByTestId('view-3d').getAttribute('data-mesh-count'))).toBeGreaterThan(4);
  expect(consoleErrors).toEqual([]);
});

test('a selected wall can be a gable end at its own pitch', async ({ electronApp, window, userData, consoleErrors }) => {
  await showModel(electronApp, window, { x: -36, y: -36 }, { x: 280, y: 180 });
  await window.getByRole('button', { name: 'Walls', exact: true }).click();
  await clickAt(window, { x: 0, y: 0 });
  await typeLength(window, "20'", '0');
  await typeLength(window, "12'", '90');
  await typeLength(window, "20'", '180');
  await typeLength(window, "12'", '270');
  await window.getByLabel('Plan view').press('Escape');
  await window.getByRole('button', { name: 'Select Objects' }).click();
  await clickAt(window, { x: 120, y: 0 });
  await window.getByLabel('Roof pitch').fill('9');
  await window.getByLabel('Roof pitch').press('Tab');
  await window.getByLabel('Gable end').check();
  await window.getByRole('button', { name: 'Roof', exact: true }).click();
  const plan = await savePlan(electronApp, userData, 'gable-end');
  const walls = Object.values(plan.elements).filter((el) => el.kind === 'wall') as { gableEnd?: boolean; roofPitch?: number }[];
  expect(walls.some((wall) => wall.gableEnd === true && wall.roofPitch === 9)).toBe(true);
  expect(Object.values(plan.elements).filter((el) => el.kind === 'roofPlane').length).toBeGreaterThanOrEqual(3);
  expect(consoleErrors).toEqual([]);
});
