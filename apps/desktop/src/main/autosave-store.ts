import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { RecoveryEntry } from '../shared/ipc';
import { writeFileAtomic } from './fs-utils';

const DOC_ID = /^[A-Za-z0-9-]{1,64}$/;

interface StoredAutosave extends RecoveryEntry {
  text: string;
}

export function isValidDocId(docId: unknown): docId is string {
  return typeof docId === 'string' && DOC_ID.test(docId);
}

/** One autosave file per open document, in `<userData>/autosave`. Anything left at launch is recoverable. */
export class AutosaveStore {
  constructor(private readonly dir: string) {}

  private fileFor(docId: string): string {
    if (!isValidDocId(docId)) throw new Error('Invalid document id');
    return join(this.dir, `${docId}.json`);
  }

  async write(entry: Omit<StoredAutosave, 'savedAt'>, savedAt = new Date().toISOString()): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const stored: StoredAutosave = { ...entry, savedAt };
    await writeFileAtomic(this.fileFor(entry.docId), JSON.stringify(stored));
  }

  async read(docId: string): Promise<StoredAutosave | null> {
    try {
      const parsed = JSON.parse(await readFile(this.fileFor(docId), 'utf8')) as Partial<StoredAutosave>;
      if (typeof parsed.text !== 'string' || parsed.docId !== docId) return null;
      return {
        docId,
        title: typeof parsed.title === 'string' ? parsed.title : 'Untitled',
        savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
        originalPath: typeof parsed.originalPath === 'string' ? parsed.originalPath : null,
        text: parsed.text,
      };
    } catch {
      return null;
    }
  }

  async list(): Promise<RecoveryEntry[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const entries: RecoveryEntry[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const stored = await this.read(name.slice(0, -'.json'.length));
      if (stored) entries.push({ docId: stored.docId, title: stored.title, savedAt: stored.savedAt, originalPath: stored.originalPath });
    }
    return entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  async clear(docId: string): Promise<void> {
    await rm(this.fileFor(docId), { force: true });
  }
}
