import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
  await expect.poll(async () => Number(await window.getByTestId('plan-view').getAttribute('data-stud-count'))).toBeGreaterThan(20);
  expect(nodePoints(plan)).toEqual([
    { x: ROOM.x0, y: ROOM.y0 },
    { x: ROOM.x0, y: ROOM.y1 },
    { x: ROOM.x1, y: ROOM.y0 },
    { x: ROOM.x1, y: ROOM.y1 },
  ]);
  expect(consoleErrors).toEqual([]);
  await window.screenshot({ path: test.info().outputPath('room.png') });
});

test('shows the room on an architectural sheet', async ({ electronApp, window, consoleErrors }) => {
  await drawRoom(electronApp, window);
  await window.locator('.dv-default-tab-content', { hasText: 'Sheet' }).click();
  const view = window.getByTestId('sheet-view');
  await expect(view).toBeVisible();
  await expect(view).toHaveAttribute('data-scale', /= 1'-0"/);
  const canvas = view.locator('canvas');
  await expect.poll(async () => canvas.evaluate((el: HTMLCanvasElement) => el.width)).toBeGreaterThan(200);
  const dark = await canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d');
    if (!ctx || el.width < 2) return 0;
    const pixels = ctx.getImageData(0, 0, el.width, el.height).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 16) {
      const r = pixels[i] ?? 0;
      const g = pixels[i + 1] ?? 0;
      const b = pixels[i + 2] ?? 0;
      if (r < 60 && g < 60 && b < 60) count++;
    }
    return count;
  });
  expect(dark).toBeGreaterThan(30);
  expect(consoleErrors).toEqual([]);
});

test('exports the sheet as a PDF', async ({ electronApp, window, userData, consoleErrors }) => {
  await drawRoom(electronApp, window);
  const target = join(userData, 'sheet');
  await electronApp.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
  }, target);
  await clickMenu(electronApp, ['File', 'Export Sheet…']);
  const saved = `${target}.pdf`;
  await expect.poll(() => existsSync(saved)).toBe(true);
  const bytes = readFileSync(saved);
  expect(bytes.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  expect(bytes.byteLength).toBeGreaterThan(1500);
  expect(consoleErrors).toEqual([]);
});

test('exports the plan as a DXF', async ({ electronApp, window, userData, consoleErrors }) => {
  await drawRoom(electronApp, window);
  const target = join(userData, 'plan');
  await electronApp.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
  }, target);
  await clickMenu(electronApp, ['File', 'Export DXF…']);
  const saved = `${target}.dxf`;
  await expect.poll(() => existsSync(saved)).toBe(true);
  const text = readFileSync(saved, 'utf8');
  expect(text).toContain('AC1015');
  expect(text).toContain('LWPOLYLINE');
  expect(text).toContain('Room 1');
  expect(consoleErrors).toEqual([]);
});

test('exports the model as a glTF', async ({ electronApp, window, userData, consoleErrors }) => {
  await drawRoom(electronApp, window);
  const target = join(userData, 'model');
  await electronApp.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
  }, target);
  await clickMenu(electronApp, ['File', 'Export glTF…']);
  const saved = `${target}.glb`;
  await expect.poll(() => existsSync(saved)).toBe(true);
  const bytes = readFileSync(saved);
  expect(bytes.subarray(0, 4).toString('utf8')).toBe('glTF');
  expect(bytes.byteLength).toBeGreaterThan(1000);
  expect(consoleErrors).toEqual([]);
});

test('imports a DXF as a reference drawing', async ({ electronApp, window, userData, consoleErrors }) => {
  const file = join(userData, 'site.dxf');
  writeFileSync(file, ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '1', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '120', '21', '0', '0', 'ENDSEC', '0', 'EOF', ''].join('\n'));
  await electronApp.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog;
  }, file);
  await clickMenu(electronApp, ['File', 'Import DXF…']);
  await expect(window.getByTestId('plan-view')).toHaveAttribute('data-cad-count', '1');
  expect(consoleErrors).toEqual([]);
});

test('lists the room on the Materials tab', async ({ electronApp, window, consoleErrors }) => {
  await drawRoom(electronApp, window);
  await window.locator('.dv-default-tab-content', { hasText: 'Materials' }).click();
  const panel = window.locator('.materials-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('row', { name: /OSB sheathing/ })).toContainText('518.0 sq ft');
  await expect(panel.getByRole('row', { name: /Studs/ })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('exports the materials list as a CSV file', async ({ electronApp, window, userData, consoleErrors }) => {
  await drawRoom(electronApp, window);
  await window.locator('.dv-default-tab-content', { hasText: 'Materials' }).click();
  const target = join(userData, 'materials');
  await electronApp.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
  }, target);
  await window.getByRole('button', { name: 'Export CSV' }).click();
  const saved = `${target}.csv`;
  await expect.poll(() => existsSync(saved)).toBe(true);
  const text = readFileSync(saved, 'utf8');
  expect(text.startsWith('Category,Item,Quantity,Unit')).toBe(true);
  expect(text).toContain('OSB sheathing');
  expect(consoleErrors).toEqual([]);
});

test('builds a gable over the room', async ({ electronApp, window, userData, consoleErrors }) => {
  await drawRoom(electronApp, window);
  await window.getByRole('button', { name: 'Roof', exact: true }).click();
  const plan = await savePlan(electronApp, userData, 'roof');
  const roofs = ofKind(plan, 'roofPlane') as unknown as { pitch: number; polygon: Vec2[] }[];
  expect(roofs).toHaveLength(2);
  expect(roofs[0]?.pitch).toBe(6);
  expect(roofs.every((roof) => roof.polygon.length === 4)).toBe(true);
  await window.locator('.dv-default-tab-content', { hasText: '3D' }).click();
  const view = window.getByTestId('view-3d');
  await expect.poll(async () => Number(await view.getAttribute('data-mesh-count'))).toBeGreaterThan(4);
  await expect.poll(async () => Number(await view.getAttribute('data-textured'))).toBeGreaterThan(4);
  const canvas = view.locator('canvas');
  await expect.poll(async () => canvas.evaluate((el: HTMLCanvasElement) => el.width)).toBeGreaterThan(400);
  const sample = await canvas.evaluate((canvas: HTMLCanvasElement) => {
    const gl = canvas.getContext('webgl2');
    if (!gl || canvas.width < 2) return { w: canvas.width, h: canvas.height, brown: -1, colored: -1, center: [] as number[] };
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const mid = ((canvas.height >> 1) * canvas.width + (canvas.width >> 1)) * 4;
    let brown = 0;
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 16) {
      const r = pixels[i] ?? 0;
      const g = pixels[i + 1] ?? 0;
      const b = pixels[i + 2] ?? 0;
      if (r + g + b === 0) continue;
      if (Math.abs(r - 228) <= 14 && Math.abs(g - 231) <= 14 && Math.abs(b - 236) <= 14) continue;
      colored++;
      if (r > 90 && r < 240 && g > 40 && g < 210 && b < 170 && r > g && g > b && r - b > 30) brown++;
    }
    return { w: canvas.width, h: canvas.height, brown, colored, center: [pixels[mid], pixels[mid + 1], pixels[mid + 2]] };
  });
  expect(sample.colored, JSON.stringify(sample)).toBeGreaterThan(800);
  expect(sample.brown, JSON.stringify(sample)).toBeGreaterThan(400);
  expect(consoleErrors).toEqual([]);
  await window.screenshot({ path: test.info().outputPath('roof.png') });
});

test('builds a hip over the room', async ({ electronApp, window, userData, consoleErrors }) => {
  await drawRoom(electronApp, window);
  await window.getByRole('button', { name: 'Hip Roof', exact: true }).click();
  const plan = await savePlan(electronApp, userData, 'hip');
  const roofs = ofKind(plan, 'roofPlane') as unknown as { pitch: number; polygon: Vec2[] }[];
  expect(roofs).toHaveLength(4);
  expect(roofs.every((roof) => roof.pitch === 6)).toBe(true);
  expect(roofs.filter((roof) => roof.polygon.length === 3)).toHaveLength(2);
  expect(roofs.filter((roof) => roof.polygon.length === 4)).toHaveLength(2);
  await window.locator('.dv-default-tab-content', { hasText: '3D' }).click();
  const view = window.getByTestId('view-3d');
  await expect.poll(async () => Number(await view.getAttribute('data-mesh-count'))).toBeGreaterThan(4);
  await expect.poll(async () => Number(await view.getAttribute('data-textured'))).toBeGreaterThan(4);
  const canvas = view.locator('canvas');
  await expect.poll(async () => canvas.evaluate((el: HTMLCanvasElement) => el.width)).toBeGreaterThan(400);
  const sample = await canvas.evaluate((canvas: HTMLCanvasElement) => {
    const gl = canvas.getContext('webgl2');
    if (!gl || canvas.width < 2) return { w: canvas.width, h: canvas.height, brown: -1, colored: -1 };
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let brown = 0;
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 16) {
      const r = pixels[i] ?? 0;
      const g = pixels[i + 1] ?? 0;
      const b = pixels[i + 2] ?? 0;
      if (r + g + b === 0) continue;
      if (Math.abs(r - 228) <= 14 && Math.abs(g - 231) <= 14 && Math.abs(b - 236) <= 14) continue;
      colored++;
      if (r > 90 && r < 240 && g > 40 && g < 210 && b < 170 && r > g && g > b && r - b > 30) brown++;
    }
    return { w: canvas.width, h: canvas.height, brown, colored };
  });
  expect(sample.colored, JSON.stringify(sample)).toBeGreaterThan(800);
  expect(sample.brown, JSON.stringify(sample)).toBeGreaterThan(400);
  expect(consoleErrors).toEqual([]);
  await window.screenshot({ path: test.info().outputPath('hip.png') });
});

test('builds a slab and footing under the room', async ({ electronApp, window, userData, consoleErrors }) => {
  await drawRoom(electronApp, window);
  await window.getByRole('button', { name: 'Foundation', exact: true }).click();
  const plan = await savePlan(electronApp, userData, 'foundation');
  const foundations = ofKind(plan, 'foundation') as unknown as { thickness: number; footingWidth: number; footings: Vec2[][]; stems: Vec2[][]; polygon: Vec2[] }[];
  expect(foundations).toHaveLength(1);
  expect(foundations[0]?.thickness).toBe(4);
  expect(foundations[0]?.footingWidth).toBe(16);
  expect(foundations[0]?.polygon).toHaveLength(4);
  expect(foundations[0]?.footings).toHaveLength(4);
  expect(foundations[0]?.stems).toHaveLength(4);
  expect(consoleErrors).toEqual([]);
});

test('builds a straight stair up to the level above', async ({ electronApp, window, userData, consoleErrors }) => {
  await drawRoom(electronApp, window);
  await window.locator('.dv-tab', { hasText: 'Levels' }).click();
  await window.getByRole('button', { name: 'Add Level Above' }).click();
  await window.getByRole('button', { name: 'Make Level 1 the active level' }).click();
  await window.getByRole('button', { name: 'Stairs', exact: true }).click();
  await expect(window.getByTestId('status-tool')).toHaveText('Stairs');
  await clickAt(window, { x: -72, y: 0 });
  await clickAt(window, { x: 72, y: 0 });
  const plan = await savePlan(electronApp, userData, 'stairs');
  const stairs = ofKind(plan, 'stair') as unknown as { risers: number; riser: number; tread: number; width: number }[];
  expect(stairs).toHaveLength(1);
  expect(stairs[0]!.risers).toBeGreaterThan(10);
  expect(stairs[0]!.riser).toBeLessThanOrEqual(7.75);
  expect(stairs[0]!.tread).toBeGreaterThanOrEqual(10);
  expect(stairs[0]!.width).toBe(36);
  expect(consoleErrors).toEqual([]);
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

  // With angle snaps on, a 15° step from the wall's far end can win over the grid when zoomed out.
  await window.getByRole('button', { name: 'Angle', exact: true }).click();
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

interface SavedOpening {
  kind: string;
  wallId: string;
  t: number;
  width: number;
  side: string;
  sill?: number;
}

const openings = (plan: SavedPlan) => ofKind(plan, 'door').concat(ofKind(plan, 'window')) as unknown as SavedOpening[];

async function placeDoorAndWindow(app: ElectronApplication, window: Page): Promise<void> {
  await drawRoom(app, window);
  await window.getByRole('button', { name: 'Doors', exact: true }).click();
  await expect(window.getByRole('heading', { name: 'Doors tool' })).toBeVisible();
  // Inside the room, just above the bottom wall's midpoint: snaps to the wall's center, swings inward.
  await clickAt(window, { x: 2, y: ROOM.y0 + 4 });
  await window.getByRole('button', { name: 'Windows', exact: true }).click();
  await clickAt(window, { x: -60, y: ROOM.y1 - 4 });
}

test('places doors and windows on walls, refusing overlaps', async ({ electronApp, window, userData, consoleErrors }) => {
  await placeDoorAndWindow(electronApp, window);
  let plan = await savePlan(electronApp, userData, 'openings');
  const [door] = ofKind(plan, 'door') as unknown as SavedOpening[];
  const [win] = ofKind(plan, 'window') as unknown as SavedOpening[];
  expect(door).toMatchObject({ t: 120, width: 36, side: 'left' });
  // The top wall runs right to left, so x = -60 is 180" from its start, and its outside (+y) is its right.
  expect(win).toMatchObject({ t: 180, width: 36, sill: 32, side: 'right' });

  await window.getByRole('button', { name: 'Doors', exact: true }).click();
  await clickAt(window, { x: -40, y: ROOM.y1 - 4 });
  await expect(window.getByTestId('status-notice')).toHaveText('Openings on the same wall cannot overlap.');
  plan = await savePlan(electronApp, userData, 'refused');
  expect(openings(plan)).toHaveLength(2);
  expect(consoleErrors).toEqual([]);
  await window.screenshot({ path: test.info().outputPath('openings.png') });
});

test('edits, flips, slides and deletes a door; doors ride along when their wall moves', async ({ electronApp, window, userData }) => {
  await placeDoorAndWindow(electronApp, window);
  await window.getByRole('button', { name: 'Select Objects' }).click();
  await clickAt(window, { x: 0, y: ROOM.y0 });
  await expect(window.getByRole('heading', { name: 'Door', exact: true })).toBeVisible();

  const width = window.getByLabel('Door width', { exact: true });
  await width.fill('32');
  await width.press('Enter');
  await window.getByRole('button', { name: 'Flip Side' }).click();
  await window.getByLabel('Door style', { exact: true }).selectOption('pocket');
  let [door] = ofKind(await savePlan(electronApp, userData, 'edited'), 'door') as unknown as (SavedOpening & { style: string })[];
  expect(door).toMatchObject({ width: 32, side: 'right', style: 'pocket', t: 120 });

  await dragFrom(window, { x: 0, y: ROOM.y0 }, { x: 24, y: ROOM.y0 });
  [door] = ofKind(await savePlan(electronApp, userData, 'slid'), 'door') as unknown as (SavedOpening & { style: string })[];
  expect(door!.t).toBe(144);

  await clickAt(window, { x: 0, y: ROOM.y1 });
  await dragFrom(window, { x: 0, y: ROOM.y1 }, { x: 0, y: ROOM.y1 + 24 });
  const moved = await savePlan(electronApp, userData, 'wall-moved');
  const [win] = ofKind(moved, 'window') as unknown as SavedOpening[];
  expect(win!.t).toBe(180);

  await clickAt(window, { x: 24, y: ROOM.y0 });
  await window.getByLabel('Plan view').focus();
  await window.keyboard.press('Delete');
  expect(ofKind(await savePlan(electronApp, userData, 'door-deleted'), 'door')).toHaveLength(0);
});

test('places a cabinet from the library and names the room', async ({ electronApp, window, userData, consoleErrors }) => {
  await drawRoom(electronApp, window);
  await window.getByRole('button', { name: 'Base Cabinet 24', exact: true }).click();
  await expect(window.getByRole('button', { name: 'Base Cabinet 24', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await clickAt(window, { x: 0, y: ROOM.y0 + 6 });
  const width = window.getByLabel('Object width', { exact: true });
  await width.fill('30');
  await width.press('Enter');

  await window.getByRole('button', { name: 'Select Objects' }).click();
  await clickAt(window, { x: 0, y: 0 });
  const name = window.getByLabel('Room name');
  await expect(name).toHaveValue('Room 1');
  await expect(window.getByText('221.2 sq ft')).toBeVisible();
  await name.fill('Kitchen');
  await name.press('Enter');
  await window.getByLabel('Room type').selectOption('kitchen');

  // The cabinet sits on the bottom wall; moving that wall carries it along.
  await clickAt(window, { x: 80, y: ROOM.y0 });
  await dragFrom(window, { x: 80, y: ROOM.y0 }, { x: 80, y: ROOM.y0 + 24 });

  const plan = await savePlan(electronApp, userData, 'furnished');
  const [object] = ofKind(plan, 'object') as unknown as { hostT: number; side: string; p: Vec2 }[];
  const [room] = ofKind(plan, 'room') as unknown as { name: string; roomType: string }[];
  expect(object).toMatchObject({ hostT: 120, side: 'left', params: { width: 30 } });
  expect(object!.p.y).toBeCloseTo(ROOM.y0 + 24 + 7.1875 / 2 + 12, 1);
  expect(room).toMatchObject({ name: 'Kitchen', roomType: 'kitchen' });
  expect(consoleErrors).toEqual([]);
  await window.screenshot({ path: test.info().outputPath('furnished.png') });
});

test('shows the room in the 3D view', async ({ electronApp, window, consoleErrors }) => {
  await drawRoom(electronApp, window);
  await window.locator('.dv-default-tab-content', { hasText: '3D' }).click();
  const view = window.getByTestId('view-3d');
  await expect(view).toBeVisible();
  await expect.poll(async () => Number(await view.getAttribute('data-mesh-count'))).toBeGreaterThan(4);
  await expect.poll(async () => Number(await view.getAttribute('data-textured'))).toBeGreaterThan(4);
  const canvas = view.locator('canvas');
  await expect.poll(async () => canvas.evaluate((el: HTMLCanvasElement) => el.width)).toBeGreaterThan(400);
  const sample = await canvas.evaluate((canvas: HTMLCanvasElement) => {
    const gl = canvas.getContext('webgl2');
    if (!gl || canvas.width < 2) return { w: canvas.width, h: canvas.height, colored: -1, center: [] as number[] };
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const mid = ((canvas.height >> 1) * canvas.width + (canvas.width >> 1)) * 4;
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 16) {
      const r = pixels[i] ?? 0;
      const g = pixels[i + 1] ?? 0;
      const b = pixels[i + 2] ?? 0;
      if (r + g + b === 0) continue;
      if (Math.abs(r - 228) <= 14 && Math.abs(g - 231) <= 14 && Math.abs(b - 236) <= 14) continue;
      colored++;
    }
    return { w: canvas.width, h: canvas.height, colored, center: [pixels[mid], pixels[mid + 1], pixels[mid + 2]] };
  });
  expect(sample.colored, JSON.stringify(sample)).toBeGreaterThan(800);
  expect(consoleErrors).toEqual([]);
  await window.screenshot({ path: test.info().outputPath('perspective.png') });
});

function parseEye(value: string | null): { x: number; y: number; z: number } {
  const [x, y, z] = (value ?? '').split(',').map(Number);
  return { x: x ?? NaN, y: y ?? NaN, z: z ?? NaN };
}

test('walks the room and restores a saved camera', async ({ electronApp, window, consoleErrors }) => {
  await drawRoom(electronApp, window);
  await window.locator('.dv-default-tab-content', { hasText: '3D' }).click();
  const view = window.getByTestId('view-3d');
  await expect.poll(async () => Number(await view.getAttribute('data-textured'))).toBeGreaterThan(4);
  await window.getByRole('button', { name: 'Walk', exact: true }).click();
  await expect(view).toHaveAttribute('data-mode', 'walk');
  await expect.poll(async () => view.getAttribute('data-eye')).toMatch(/,66\.0$/);

  const before = parseEye(await view.getAttribute('data-eye'));
  await window.keyboard.down('w');
  await expect
    .poll(async () => {
      const eye = parseEye(await view.getAttribute('data-eye'));
      return Math.hypot(eye.x - before.x, eye.y - before.y);
    })
    .toBeGreaterThan(6);
  await window.keyboard.up('w');
  const saved = parseEye(await view.getAttribute('data-eye'));

  await window.getByRole('button', { name: 'Camera Views' }).click();
  await window.getByLabel('Camera name').fill('Front door');
  await window.getByRole('button', { name: 'Save camera' }).click();
  await expect(window.getByRole('button', { name: 'Front door', exact: true })).toBeVisible();

  await window.keyboard.down('w');
  await expect
    .poll(async () => {
      const eye = parseEye(await view.getAttribute('data-eye'));
      return Math.hypot(eye.x - saved.x, eye.y - saved.y);
    })
    .toBeGreaterThan(6);
  await window.keyboard.up('w');
  await window.getByRole('button', { name: 'Front door', exact: true }).click();
  await expect
    .poll(async () => {
      const eye = parseEye(await view.getAttribute('data-eye'));
      return Math.hypot(eye.x - saved.x, eye.y - saved.y);
    })
    .toBeLessThan(1.5);

  await undoRedo(electronApp, 'Undo');
  await expect(window.getByRole('button', { name: 'Front door', exact: true })).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
  await window.screenshot({ path: test.info().outputPath('walk.png') });
});

test('shows the room in elevation', async ({ electronApp, window, consoleErrors }) => {
  await drawRoom(electronApp, window);
  await window.locator('.dv-default-tab-content', { hasText: 'Elevation' }).click();
  const view = window.getByTestId('elevation-view');
  await expect(view).toBeVisible();
  await expect.poll(async () => Number(await view.getAttribute('data-line-count'))).toBeGreaterThan(8);
  await view.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(view).toHaveAttribute('data-facing', 'back');
  await view.getByRole('button', { name: 'Front', exact: true }).click();
  await expect(view).toHaveAttribute('data-facing', 'front');
  const canvas = view.locator('canvas');
  await expect.poll(async () => canvas.evaluate((el: HTMLCanvasElement) => el.width)).toBeGreaterThan(300);
  const dark = await canvas.evaluate((node: HTMLCanvasElement) => {
    const ctx = node.getContext('2d');
    if (!ctx || node.width < 2) return -1;
    const pixels = ctx.getImageData(0, 0, node.width, node.height).data;
    let n = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i] ?? 255;
      const g = pixels[i + 1] ?? 255;
      const b = pixels[i + 2] ?? 255;
      if (r < 80 && g < 80 && b < 80) n++;
    }
    return n;
  });
  expect(dark).toBeGreaterThan(40);
  expect(consoleErrors).toEqual([]);
  await window.screenshot({ path: test.info().outputPath('elevation.png') });
});

test('shows the room in section', async ({ electronApp, window, consoleErrors }) => {
  await drawRoom(electronApp, window);
  await window.locator('.dv-default-tab-content', { hasText: 'Section' }).click();
  const view = window.getByTestId('section-view');
  await expect(view).toBeVisible();
  await expect.poll(async () => Number(await view.getAttribute('data-fill-count'))).toBeGreaterThan(0);
  await expect.poll(async () => Number(await view.getAttribute('data-line-count'))).toBeGreaterThan(4);
  await view.getByRole('button', { name: 'Left', exact: true }).click();
  await expect(view).toHaveAttribute('data-facing', 'left');
  const slider = view.getByLabel('Section cut');
  await slider.fill('25');
  await expect(view).toHaveAttribute('data-cut', '0.25');
  const canvas = view.locator('canvas');
  await expect.poll(async () => canvas.evaluate((el: HTMLCanvasElement) => el.width)).toBeGreaterThan(300);
  const filled = await canvas.evaluate((node: HTMLCanvasElement) => {
    const ctx = node.getContext('2d');
    if (!ctx || node.width < 2) return -1;
    const pixels = ctx.getImageData(0, 0, node.width, node.height).data;
    let n = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i] ?? 0;
      const g = pixels[i + 1] ?? 0;
      const b = pixels[i + 2] ?? 0;
      if (r > 190 && r < 250 && g > 170 && g < 235 && b < 220 && r - b > 12) n++;
    }
    return n;
  });
  expect(filled).toBeGreaterThan(40);
  expect(consoleErrors).toEqual([]);
  await window.screenshot({ path: test.info().outputPath('section.png') });
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
