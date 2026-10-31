import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test';

interface AppFixtures {
  userData: string;
  electronApp: ElectronApplication;
  window: Page;
  consoleErrors: string[];
}

export function launchApp(userData: string, extraEnv: Record<string, string> = {}): Promise<ElectronApplication> {
  const env = { ...process.env, FW_TEST: '1', FW_USER_DATA: userData, ...extraEnv } as Record<string, string>;
  delete env.ELECTRON_RENDERER_URL;
  // FW_E2E_EXECUTABLE points at a packaged app (e.g. release/x/win-unpacked/Framewright.exe) to test the real build.
  const packaged = process.env.FW_E2E_EXECUTABLE;
  return electron.launch(packaged ? { executablePath: packaged, args: [], env } : { args: [resolve(__dirname, '../out/main/index.js')], env });
}

/** Answer every native message box with the given button index (1 = "Don't Save" in the save prompt). */
export async function answerMessageBoxes(app: ElectronApplication, response: number): Promise<void> {
  await app.evaluate(({ dialog }, r) => {
    dialog.showMessageBox = (async () => ({ response: r, checkboxChecked: false })) as typeof dialog.showMessageBox;
  }, response);
}

export async function closeApp(app: ElectronApplication): Promise<void> {
  await answerMessageBoxes(app, 1).catch(() => undefined);
  await app.close().catch(() => undefined);
}

export const test = base.extend<AppFixtures>({
  userData: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'framewright-e2e-'));
    await use(dir);
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  },
  electronApp: async ({ userData }, use) => {
    const app = await launchApp(userData);
    await use(app);
    await closeApp(app);
  },
  consoleErrors: async ({}, use) => {
    await use([]);
  },
  window: async ({ electronApp, consoleErrors }, use) => {
    const page = await readyWindow(electronApp, consoleErrors);
    await use(page);
  },
});

export async function readyWindow(app: ElectronApplication, consoleErrors: string[] = []): Promise<Page> {
  const page = await app.firstWindow();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  await page.waitForSelector('.toolbar');
  return page;
}

export { expect } from '@playwright/test';

export async function blockedRequests(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => {
    const hook = (globalThis as Record<string, unknown>).__framewrightTest as { blockedRequests(): string[] };
    return [...hook.blockedRequests()];
  });
}

/** Click an application menu item by its label path, e.g. ['File', 'Save As…']. */
export async function clickMenu(app: ElectronApplication, path: string[]): Promise<void> {
  await app.evaluate(({ Menu, BrowserWindow }, labels) => {
    const strip = (label: string) => label.replace(/&(&?)/g, '$1').replace(/^\d /, '');
    let items = Menu.getApplicationMenu()?.items ?? [];
    let target: Electron.MenuItem | undefined;
    for (const label of labels) {
      target = items.find((item) => strip(item.label) === label);
      if (!target) throw new Error(`Menu item not found: ${labels.join(' > ')}`);
      items = target.submenu?.items ?? [];
    }
    if (!target?.enabled) throw new Error(`Menu item disabled: ${labels.join(' > ')}`);
    target.click(undefined, BrowserWindow.getAllWindows()[0], undefined as never);
  }, path);
}

export async function menuItem(app: ElectronApplication, path: string[]): Promise<{ label: string; enabled: boolean } | null> {
  return app.evaluate(({ Menu }, labels) => {
    let items = Menu.getApplicationMenu()?.items ?? [];
    let target: Electron.MenuItem | undefined;
    for (const label of labels) {
      target = items.find((item) => item.label.replace(/&/g, '').startsWith(label));
      if (!target) return null;
      items = target.submenu?.items ?? [];
    }
    return target ? { label: target.label, enabled: target.enabled } : null;
  }, path);
}

export async function windowTitle(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle() ?? '');
}
