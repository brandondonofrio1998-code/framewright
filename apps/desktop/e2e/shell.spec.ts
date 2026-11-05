import { blockedRequests, clickMenu, expect, test } from './fixtures';

test('opens the workspace with toolbar, docked panels and status bar', async ({ window, consoleErrors }) => {
  await expect(window).toHaveTitle('Framewright');
  for (const label of ['Select Objects', 'Walls', 'Break Wall', 'Doors', 'Windows', 'Objects', 'Stairs', 'Deck', 'Electrical', 'Plumbing', 'Site', 'Roof', 'Hip Roof', 'Foundation', 'Dimensions', 'Text']) {
    await expect(window.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  for (const tab of ['Plan', 'Elevation', 'Section', '3D', 'Sheet', 'Library', 'Levels', 'Properties', 'Materials']) {
    await expect(window.locator('.dv-tab', { hasText: tab })).toHaveCount(1);
  }
  await expect(window.getByTestId('status-tool')).toBeVisible();
  expect(consoleErrors).toEqual([]);
  await window.screenshot({ path: test.info().outputPath('workspace.png') });
});

test('dark mode and hiding walls are view choices', async ({ electronApp, window, consoleErrors }) => {
  await clickMenu(electronApp, ['View', 'Dark Mode']);
  await expect.poll(() => window.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await clickMenu(electronApp, ['View', 'Layers', 'Walls']);
  await expect.poll(() => window.evaluate(() => document.documentElement.dataset.hidden ?? '')).toContain('walls');
  await clickMenu(electronApp, ['View', 'Dark Mode']);
  await expect.poll(() => window.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  expect(consoleErrors).toEqual([]);
});

test('renderer is sandboxed and only sees the preload API', async ({ window }) => {
  const exposure = await window.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>).require,
    process: typeof (globalThis as Record<string, unknown>).process,
    apiKeys: Object.keys((globalThis as unknown as Window).fw).sort(),
    origin: location.origin,
  }));
  expect(exposure).toEqual({ require: 'undefined', process: 'undefined', apiKeys: ['app', 'autosave', 'file', 'menu'], origin: 'app://framewright' });
});

test('menu bar follows platform conventions', async ({ electronApp, window }) => {
  await expect(window.locator('.toolbar')).toBeVisible();
  const { platform, labels, fileItems } = await electronApp.evaluate(({ Menu }) => {
    const items = Menu.getApplicationMenu()?.items ?? [];
    const strip = (label: string) => label.replace(/&/g, '');
    const file = items.find((item) => strip(item.label) === 'File');
    return {
      platform: process.platform,
      labels: items.map((item) => strip(item.label)),
      fileItems: file?.submenu?.items.map((item) => item.role ?? strip(item.label)) ?? [],
    };
  });
  const standard = ['File', 'Edit', 'Build', 'View', '3D', 'Tools', 'Window', 'Help'];
  expect(labels).toEqual(platform === 'darwin' ? ['Framewright', ...standard] : standard);
  expect(fileItems.includes('quit')).toBe(platform !== 'darwin');
});

test('View > Reset Layout restores closed panels', async ({ electronApp, window }) => {
  const libraryTab = window.locator('.dv-tab', { hasText: 'Library' });
  await libraryTab.hover();
  await libraryTab.locator('.dv-default-tab-action').click();
  await expect(libraryTab).toHaveCount(0);

  await electronApp.evaluate(({ Menu }) => {
    const view = Menu.getApplicationMenu()?.items.find((item) => item.label.replace(/&/g, '') === 'View');
    view?.submenu?.items.find((item) => item.label === 'Reset Layout')?.click();
  });
  await expect(libraryTab).toHaveCount(1);
});

test('app:// serves the CSP and refuses paths outside the renderer bundle', async ({ window }) => {
  const result = await window.evaluate(async () => {
    const index = await fetch('/index.html');
    const escape1 = await fetch('app://framewright/../main/index.js');
    const escape2 = await fetch('app://framewright/%2e%2e/main/index.js');
    const escape3 = await fetch('app://framewright/..%2fmain%2findex.js');
    return {
      csp: index.headers.get('content-security-policy'),
      meta: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? null,
      escapes: [escape1.status, escape2.status, escape3.status],
    };
  });
  expect(result.csp).toContain("default-src 'none'");
  expect(result.csp).toContain("frame-ancestors 'none'");
  expect(result.meta).toBe(result.csp?.replace("; frame-ancestors 'none'", ''));
  expect(result.escapes).toEqual([404, 404, 404]);
});

test('no outbound requests during a session, and attempts are blocked', async ({ electronApp, window }) => {
  await window.waitForLoadState('load');
  expect(await blockedRequests(electronApp)).toEqual([]);

  const target = 'https://example.com/probe';
  const rendererFetch = await window.evaluate(async (url) => {
    try {
      await fetch(url);
      return 'succeeded';
    } catch {
      return 'blocked';
    }
  }, target);
  expect(rendererFetch).toBe('blocked');

  const mainFetch = await electronApp.evaluate(async ({ net }, url) => {
    try {
      await net.fetch(url);
      return 'succeeded';
    } catch {
      return 'blocked';
    }
  }, target);
  expect(mainFetch).toBe('blocked');
  expect(await blockedRequests(electronApp)).toContain(target);
});
