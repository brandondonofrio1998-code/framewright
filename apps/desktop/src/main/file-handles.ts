import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { FileRef } from '../shared/ipc';
import { displayNameFor } from './fs-utils';

/** Maps opaque handles to paths the user chose through a dialog, the recent list, or the OS. */
export class FileHandles {
  private readonly byHandle = new Map<string, string>();
  private readonly byPath = new Map<string, string>();

  register(path: string): FileRef {
    const absolute = resolve(path);
    const key = process.platform === 'win32' || process.platform === 'darwin' ? absolute.toLowerCase() : absolute;
    let handle = this.byPath.get(key);
    if (!handle) {
      handle = randomUUID();
      this.byPath.set(key, handle);
      this.byHandle.set(handle, absolute);
    }
    return { handle, displayName: displayNameFor(absolute), path: absolute };
  }

  resolve(handle: unknown): string | null {
    return typeof handle === 'string' ? (this.byHandle.get(handle) ?? null) : null;
  }
}
