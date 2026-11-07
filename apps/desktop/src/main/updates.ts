import { spawn } from 'node:child_process';
import { createWriteStream, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { app, dialog, net, shell, type BrowserWindow, type MessageBoxOptions } from 'electron';
import { assetForPlatform, parseRelease, versionNewer } from '../shared/release';
import { latestReleaseUrl } from '../shared/network-policy';
import { setUpdatesEnabled } from './security';

interface UpdatePreference {
  enabled: boolean;
}

let enabled = false;

export function updatesEnabled(): boolean {
  return enabled;
}

export function loadUpdatePreference(): void {
  try {
    const parsed = JSON.parse(readFileSync(preferencePath(), 'utf8')) as UpdatePreference;
    enabled = parsed.enabled === true;
  } catch {
    enabled = false;
  }
  setUpdatesEnabled(enabled);
}

export async function setUpdateChecks(win: BrowserWindow | null, next: boolean): Promise<void> {
  enabled = next;
  setUpdatesEnabled(next);
  await writeFile(preferencePath(), JSON.stringify({ enabled: next } satisfies UpdatePreference), 'utf8');
  if (next) await checkForUpdates(win, { promptToEnable: false, quiet: false });
}

/** Looks at the newest GitHub release. Startup checks stay quiet when this copy is current or the network is down. */
export async function checkForUpdates(win: BrowserWindow | null, options: { promptToEnable: boolean; quiet: boolean }): Promise<void> {
  if (!enabled) {
    if (!options.promptToEnable) return;
    const choice = await ask(win, {
      type: 'question',
      buttons: ['Allow', 'Not Now'],
      defaultId: 1,
      cancelId: 1,
      message: 'Look for a newer Framewright on GitHub?',
      detail: 'This is the only internet connection the app makes. Plans stay on this computer. Turn it off later from Help.',
    });
    if (choice.response !== 0) return;
    enabled = true;
    setUpdatesEnabled(true);
    await writeFile(preferencePath(), JSON.stringify({ enabled: true } satisfies UpdatePreference), 'utf8');
  }

  let release;
  try {
    const response = await net.fetch(latestReleaseUrl(), {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Framewright/${app.getVersion()}` },
    });
    if (response.status === 404) {
      if (!options.quiet) await info(win, 'No release has been published yet.', `This copy is ${app.getVersion()}.`);
      return;
    }
    if (!response.ok) throw new Error(`GitHub responded ${response.status}`);
    release = parseRelease(await response.json());
  } catch {
    if (!options.quiet) await info(win, 'Framewright could not reach GitHub.', 'The app keeps working offline.');
    return;
  }
  if (!release || !versionNewer(release.version, app.getVersion())) {
    if (!options.quiet) await info(win, `Framewright ${app.getVersion()} is the newest release.`, '');
    return;
  }
  const asset = assetForPlatform(release.assets, process.platform);
  if (!asset) {
    if (!options.quiet) await info(win, `Framewright ${release.version} is available.`, 'That release has no installer for this computer.');
    return;
  }
  const download = await ask(win, {
    type: 'info',
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1,
    message: `Framewright ${release.version} is available.`,
    detail: `This copy is ${app.getVersion()}. The download comes from the GitHub release.`,
  });
  if (download.response !== 0) return;
  try {
    const file = await downloadAsset(asset.url, asset.name);
    await installDownloaded(win, file);
  } catch {
    await info(win, 'The update could not be downloaded.', 'The app keeps working offline.');
  }
}

async function downloadAsset(url: string, name: string): Promise<string> {
  const response = await net.fetch(url, { headers: { 'User-Agent': `Framewright/${app.getVersion()}` } });
  if (!response.ok || !response.body) throw new Error(`Download failed ${response.status}`);
  const file = join(tmpdir(), name);
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(file));
  return file;
}

async function installDownloaded(win: BrowserWindow | null, file: string): Promise<void> {
  if (process.platform === 'win32') {
    const choice = await ask(win, {
      type: 'question',
      buttons: ['Quit and Install', 'Not Now'],
      defaultId: 0,
      cancelId: 1,
      message: 'The installer is ready.',
      detail: 'Framewright will quit and open it.',
    });
    if (choice.response !== 0) return;
    spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
    app.quit();
    return;
  }
  await shell.openPath(file);
  await info(win, 'The disk image is open.', 'Drag Framewright to Applications, then open the new copy.');
}

function preferencePath(): string {
  return join(app.getPath('userData'), 'updates.json');
}

function ask(win: BrowserWindow | null, options: MessageBoxOptions): ReturnType<typeof dialog.showMessageBox> {
  return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
}

async function info(win: BrowserWindow | null, message: string, detail: string): Promise<void> {
  await ask(win, { type: 'info', message, detail });
}
