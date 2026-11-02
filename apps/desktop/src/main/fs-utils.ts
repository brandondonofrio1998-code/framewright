import { randomBytes } from 'node:crypto';
import { copyFile, open, rename, rm, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';

export const PLAN_EXTENSION = '.fwplan';
const OPENABLE_EXTENSIONS = new Set([PLAN_EXTENSION, '.plan']);
export const MAX_PLAN_BYTES = 256 * 1024 * 1024;

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Writes via a temp file + fsync + rename so a crash never leaves a half-written file. */
export async function writeFileAtomic(path: string, data: string | Uint8Array, { backup = false } = {}): Promise<void> {
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  const handle = await open(tmp, 'w');
  try {
    if (typeof data === 'string') await handle.writeFile(data, 'utf8');
    else await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (backup && (await exists(path))) await copyFile(path, `${path}.bak`);
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

export function displayNameFor(path: string): string {
  return basename(path, extname(path));
}

export function withPlanExtension(path: string): string {
  return extname(path).toLowerCase() === PLAN_EXTENSION ? path : `${path}${PLAN_EXTENSION}`;
}

export function isOpenablePlanPath(path: string): boolean {
  return OPENABLE_EXTENSIONS.has(extname(path).toLowerCase());
}

/** Picks a plan file path out of a command line (Windows file association, second instance). */
export function planPathFromArgv(argv: readonly string[]): string | null {
  for (let i = argv.length - 1; i >= 1; i--) {
    const arg = argv[i] ?? '';
    if (!arg.startsWith('-') && isOpenablePlanPath(arg)) return arg;
  }
  return null;
}
