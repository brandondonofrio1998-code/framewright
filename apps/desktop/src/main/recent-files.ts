import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { exists, writeFileAtomic } from './fs-utils';

export const MAX_RECENT = 12;

const samePath = (a: string, b: string) =>
  process.platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase();

/** Most-recent-first list of plan paths, persisted as JSON in the app-data folder. */
export class RecentFiles {
  constructor(private readonly storePath: string) {}

  private async read(): Promise<string[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.storePath, 'utf8'));
      return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
    } catch {
      return [];
    }
  }

  private async write(paths: string[]): Promise<void> {
    await mkdir(dirname(this.storePath), { recursive: true });
    await writeFileAtomic(this.storePath, JSON.stringify(paths, null, 2));
  }

  async add(path: string): Promise<void> {
    const absolute = resolve(path);
    const paths = (await this.read()).filter((p) => !samePath(p, absolute));
    await this.write([absolute, ...paths].slice(0, MAX_RECENT));
  }

  /** Existing files only; missing ones are pruned from the store. */
  async list(): Promise<string[]> {
    const paths = await this.read();
    const present: string[] = [];
    for (const p of paths) if (await exists(p)) present.push(p);
    if (present.length !== paths.length) await this.write(present);
    return present;
  }

  async clear(): Promise<void> {
    await this.write([]);
  }
}
