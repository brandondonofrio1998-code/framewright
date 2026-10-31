import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AutosaveStore, isValidDocId } from '../src/main/autosave-store';
import { FileHandles } from '../src/main/file-handles';
import { displayNameFor, isOpenablePlanPath, planPathFromArgv, withPlanExtension, writeFileAtomic } from '../src/main/fs-utils';
import { MAX_RECENT, RecentFiles } from '../src/main/recent-files';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fw-main-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('fs-utils', () => {
  it('writes atomically, keeps a .bak of the previous version, and leaves no temp files', async () => {
    const file = join(dir, 'plan.fwplan');
    await writeFileAtomic(file, 'v1', { backup: true });
    await writeFileAtomic(file, 'v2', { backup: true });
    expect(readFileSync(file, 'utf8')).toBe('v2');
    expect(readFileSync(`${file}.bak`, 'utf8')).toBe('v1');
    expect(readdirSync(dir).sort()).toEqual(['plan.fwplan', 'plan.fwplan.bak']);
  });

  it('handles extensions and display names', () => {
    expect(withPlanExtension(join(dir, 'House'))).toBe(join(dir, 'House.fwplan'));
    expect(withPlanExtension(join(dir, 'House.FWPLAN'))).toBe(join(dir, 'House.FWPLAN'));
    expect(withPlanExtension(join(dir, 'House.plan'))).toBe(join(dir, 'House.plan.fwplan'));
    expect(displayNameFor(join(dir, 'Smith Residence.fwplan'))).toBe('Smith Residence');
    expect(isOpenablePlanPath('a.fwplan') && isOpenablePlanPath('b.PLAN') && !isOpenablePlanPath('c.json')).toBe(true);
  });

  it('finds a plan path in argv and ignores flags and the executable', () => {
    expect(planPathFromArgv(['Framewright.exe', '--flag', 'C:\\x\\House.fwplan'])).toBe('C:\\x\\House.fwplan');
    expect(planPathFromArgv(['Framewright.exe', '--allow-file-access-from-files'])).toBeNull();
    expect(planPathFromArgv(['C:\\weird.fwplan'])).toBeNull();
  });
});

describe('FileHandles', () => {
  it('issues one stable opaque handle per path and resolves only known handles', () => {
    const handles = new FileHandles();
    const a = handles.register(join(dir, 'a.fwplan'));
    expect(handles.register(join(dir, 'a.fwplan')).handle).toBe(a.handle);
    expect(a.handle).not.toContain('a.fwplan');
    expect(handles.resolve(a.handle)).toBe(join(dir, 'a.fwplan'));
    expect(handles.resolve('made-up')).toBeNull();
    expect(handles.resolve(42)).toBeNull();
  });
});

describe('RecentFiles', () => {
  it('keeps most recent first, de-duplicates, prunes missing files and caps the list', async () => {
    const recent = new RecentFiles(join(dir, 'recent.json'));
    const paths = Array.from({ length: MAX_RECENT + 2 }, (_, i) => join(dir, `p${i}.fwplan`));
    for (const p of paths) {
      writeFileSync(p, '{}');
      await recent.add(p);
    }
    await recent.add(paths[3]!);
    const list = await recent.list();
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]).toBe(paths[3]);
    expect(new Set(list).size).toBe(list.length);

    rmSync(paths[3]!);
    expect(await recent.list()).not.toContain(paths[3]);
    await recent.clear();
    expect(await recent.list()).toEqual([]);
  });

  it('treats a corrupt store as empty', async () => {
    writeFileSync(join(dir, 'recent.json'), '{nope');
    expect(await new RecentFiles(join(dir, 'recent.json')).list()).toEqual([]);
  });
});

describe('AutosaveStore', () => {
  it('writes, lists newest first, reads and clears', async () => {
    const store = new AutosaveStore(join(dir, 'autosave'));
    await store.write({ docId: 'doc-a', title: 'A', originalPath: null, text: '{"a":1}' }, '2026-01-01T00:00:00Z');
    await store.write({ docId: 'doc-b', title: 'B', originalPath: 'C:\\b.fwplan', text: '{"b":1}' }, '2026-01-02T00:00:00Z');
    expect((await store.list()).map((e) => e.docId)).toEqual(['doc-b', 'doc-a']);
    expect(await store.read('doc-b')).toMatchObject({ title: 'B', originalPath: 'C:\\b.fwplan', text: '{"b":1}' });
    await store.clear('doc-b');
    expect((await store.list()).map((e) => e.docId)).toEqual(['doc-a']);
  });

  it('rejects document ids that could escape the folder', async () => {
    expect(isValidDocId('../../evil')).toBe(false);
    expect(isValidDocId('3f0c2a4e-1b7d-4c55-9a51-0d6f3e2b9c01')).toBe(true);
    const store = new AutosaveStore(join(dir, 'autosave'));
    await expect(store.write({ docId: '..\\x', title: '', originalPath: null, text: '' })).rejects.toThrow('Invalid document id');
  });

  it('skips unreadable entries and returns [] for a missing folder', async () => {
    const store = new AutosaveStore(join(dir, 'autosave'));
    expect(await store.list()).toEqual([]);
    await store.write({ docId: 'ok', title: 'ok', originalPath: null, text: '{}' });
    writeFileSync(join(dir, 'autosave', 'broken.json'), 'not json');
    expect((await store.list()).map((e) => e.docId)).toEqual(['ok']);
  });
});
