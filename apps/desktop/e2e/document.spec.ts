import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  answerMessageBoxes,
  clickMenu,
  closeApp,
  expect,
  launchApp,
  menuItem,
  readyWindow,
  test,
  windowTitle,
} from './fixtures';

async function showLevels(window: Page) {
  await window.locator('.dv-tab', { hasText: 'Levels' }).click();
  await expect(window.locator('.levels-panel')).toBeVisible();
}

const levelCards = (window: Page) => window.locator('.level-card');

async function stubSaveDialog(app: ElectronApplication, filePath: string) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
  }, filePath);
}

async function isEdited(app: ElectronApplication): Promise<boolean> {
  const title = await windowTitle(app);
  return app.evaluate(({ BrowserWindow }, t) => {
    const win = BrowserWindow.getAllWindows()[0];
    return process.platform === 'darwin' ? (win?.isDocumentEdited() ?? false) : t.includes(' * ');
  }, title);
}

/** Kill the app without any shutdown handlers, including its helper processes. */
function crash(app: ElectronApplication): void {
  const pid = app.process().pid;
  if (process.platform === 'win32' && pid !== undefined) execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else app.process().kill('SIGKILL');
}

/** Helper processes of a killed app can hold the single-instance lock for a moment. */
async function relaunch(userData: string, env: Record<string, string>): Promise<ElectronApplication> {
  for (let attempt = 1; ; attempt++) {
    try {
      const app = await launchApp(userData, env);
      await app.firstWindow();
      return app;
    } catch (error) {
      if (attempt >= 20) throw error;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

test('levels: add, stack, edit, undo and redo through the Edit menu', async ({ electronApp, window, consoleErrors }) => {
  await showLevels(window);
  await expect(levelCards(window)).toHaveCount(1);
  await expect.poll(() => menuItem(electronApp, ['Edit', 'Undo'])).toMatchObject({ label: 'Undo', enabled: false });

  await window.getByRole('button', { name: 'Add Level Above' }).click();
  await expect(levelCards(window)).toHaveCount(2);
  await expect(window.getByTestId('level-Level 2')).toHaveAttribute('data-active', 'true');
  await expect.poll(() => menuItem(electronApp, ['Edit', 'Undo'])).toMatchObject({ label: 'Undo Add Level', enabled: true });
  await expect.poll(() => isEdited(electronApp)).toBe(true);

  const upperElevation = window.getByTestId('level-Level 2').locator('.field-readonly');
  const before = await upperElevation.textContent();
  const ceiling = window.getByTestId('level-Level 1').getByLabel('Ceiling height');
  await ceiling.fill(`10'`);
  await ceiling.press('Enter');
  await expect(ceiling).toHaveValue(`10'-0"`);
  await expect(upperElevation).not.toHaveText(before ?? '');

  await ceiling.fill('nonsense');
  await ceiling.press('Enter');
  await expect(ceiling).toHaveAttribute('aria-invalid', 'true');
  await ceiling.press('Escape');
  await expect(ceiling).toHaveValue(`10'-0"`);
  await window.locator('.levels-panel').click({ position: { x: 4, y: 4 } });

  await clickMenu(electronApp, ['Edit', 'Undo Edit Level']);
  await expect(upperElevation).toHaveText(before ?? '');
  await clickMenu(electronApp, ['Edit', 'Undo Add Level']);
  await expect(levelCards(window)).toHaveCount(1);
  await expect.poll(() => isEdited(electronApp)).toBe(false);
  await clickMenu(electronApp, ['Edit', 'Redo Add Level']);
  await expect(levelCards(window)).toHaveCount(2);
  expect(consoleErrors).toEqual([]);
});

test('display units change every length field', async ({ window }) => {
  await showLevels(window);
  const ceiling = window.getByTestId('level-Level 1').getByLabel('Ceiling height');
  await expect(ceiling).toHaveValue(/'/);
  await window.getByLabel('Display units').selectOption('mm');
  await expect(ceiling).toHaveValue('2467 mm');
  await ceiling.fill('2400');
  await ceiling.press('Enter');
  await expect(ceiling).toHaveValue('2400 mm');
});

test('Save As, reopen from Open Recent, and prompt before discarding changes', async ({ electronApp, window, userData }) => {
  await showLevels(window);
  await window.getByRole('button', { name: 'Add Level Above' }).click();

  const target = join(userData, 'House');
  await stubSaveDialog(electronApp, target);
  await clickMenu(electronApp, ['File', 'Save As…']);
  const saved = `${target}.fwplan`;
  await expect.poll(() => existsSync(saved)).toBe(true);
  const json = JSON.parse(readFileSync(saved, 'utf8')) as { format: string; levelOrder: string[] };
  expect(json.format).toBe('framewright-plan');
  expect(json.levelOrder).toHaveLength(2);
  await expect.poll(() => windowTitle(electronApp)).toBe('House — Framewright');
  await expect.poll(() => menuItem(electronApp, ['File', 'Open Recent', 'House'])).toMatchObject({ enabled: true });

  await window.getByRole('button', { name: 'Add Level Above' }).click();
  await expect(levelCards(window)).toHaveCount(3);
  await expect.poll(() => isEdited(electronApp)).toBe(true);

  await answerMessageBoxes(electronApp, 2);
  await clickMenu(electronApp, ['File', 'New Plan']);
  await window.waitForTimeout(300);
  await expect(levelCards(window)).toHaveCount(3);

  await answerMessageBoxes(electronApp, 1);
  await clickMenu(electronApp, ['File', 'New Plan']);
  await expect(levelCards(window)).toHaveCount(1);
  await expect.poll(() => windowTitle(electronApp)).toBe('Untitled — Framewright');

  await clickMenu(electronApp, ['File', 'Open Recent', 'House']);
  await expect(levelCards(window)).toHaveCount(2);
  await expect.poll(() => windowTitle(electronApp)).toBe('House — Framewright');
  expect(await isEdited(electronApp)).toBe(false);

  await window.getByRole('button', { name: 'Add Level Above' }).click();
  await clickMenu(electronApp, ['File', 'Save']);
  await expect.poll(() => (JSON.parse(readFileSync(saved, 'utf8')) as { levelOrder: string[] }).levelOrder.length).toBe(3);
  expect(existsSync(`${saved}.bak`)).toBe(true);
  await expect.poll(() => isEdited(electronApp)).toBe(false);
});

test('recovers autosaved work after a crash', async ({ userData }) => {
  const env = { FW_AUTOSAVE_MS: '200' };
  const first = await launchApp(userData, env);
  const window = await readyWindow(first);
  await showLevels(window);
  await window.getByRole('button', { name: 'Add Level Above' }).click();
  await window.getByRole('button', { name: 'Add Level Above' }).click();
  await expect(levelCards(window)).toHaveCount(3);

  const autosaveDir = join(userData, 'autosave');
  const autosavedLevels = () => {
    const files = existsSync(autosaveDir) ? readdirSync(autosaveDir).filter((f) => f.endsWith('.json')) : [];
    if (files.length !== 1) return null;
    const envelope = JSON.parse(readFileSync(join(autosaveDir, files[0]!), 'utf8')) as { text: string };
    return (JSON.parse(envelope.text) as { levelOrder: string[] }).levelOrder.length;
  };
  await expect.poll(autosavedLevels).toBe(3);
  const proc = first.process();
  crash(first);
  await expect.poll(() => proc.exitCode !== null || proc.signalCode !== null).toBe(true);

  const second = await relaunch(userData, env);
  try {
    const restored = await readyWindow(second);
    const dialog = restored.getByRole('dialog', { name: 'Recover unsaved work' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('never saved');
    await dialog.getByRole('button', { name: 'Restore' }).click();
    await expect(dialog).toBeHidden();
    await showLevels(restored);
    await expect(levelCards(restored)).toHaveCount(3);
    await expect.poll(() => isEdited(second)).toBe(true);
  } finally {
    await closeApp(second);
  }
});
