import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test';

interface AppFixtures {
  electronApp: ElectronApplication;
  window: Page;
  consoleErrors: string[];
}

export const test = base.extend<AppFixtures>({
  electronApp: async ({}, use) => {
    const userData = mkdtempSync(join(tmpdir(), 'framewright-e2e-'));
    const env = { ...process.env, FW_TEST: '1', FW_USER_DATA: userData } as Record<string, string>;
    delete env.ELECTRON_RENDERER_URL;
    const app = await electron.launch({ args: [resolve(__dirname, '../out/main/index.js')], env });
    await use(app);
    await app.close();
    rmSync(userData, { recursive: true, force: true });
  },
  consoleErrors: async ({}, use) => {
    await use([]);
  },
  window: async ({ electronApp, consoleErrors }, use) => {
    const page = await electronApp.firstWindow();
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    await page.waitForSelector('.toolbar');
    await use(page);
  },
});

export { expect } from '@playwright/test';

export async function blockedRequests(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => {
    const hook = (globalThis as Record<string, unknown>).__framewrightTest as { blockedRequests(): string[] };
    return [...hook.blockedRequests()];
  });
}
