import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, checkInvariants, loadDocument, migrate, serializeDocument, type Migration, type PlanDocument } from '../../src';
import { testDocument } from '../helpers';

const fixture = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8');

function mustLoad(text: string) {
  const r = loadDocument(text);
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe('serialize / load', () => {
  it('round-trips a new document exactly', () => {
    const doc = testDocument();
    const r = mustLoad(serializeDocument(doc));
    expect(r.doc).toEqual(doc);
    expect(r.repairs).toEqual([]);
    expect(r.migratedFrom).toBeNull();
  });

  it('rounds numbers to 1e-6 and normalizes -0', () => {
    const doc = testDocument();
    const id = doc.levelOrder[0] as string;
    const tweaked: PlanDocument = { ...doc, levels: { [id]: { ...doc.levels[id]!, elevation: -0, ceilingHeight: 97.12500000042 } } };
    const text = serializeDocument(tweaked);
    expect(text).toContain('"ceilingHeight": 97.125,');
    expect(text).toContain('"elevation": 0,');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('refuses to save a document that breaks invariants', () => {
    const doc = testDocument();
    expect(() => serializeDocument({ ...doc, levelOrder: [] })).toThrow(/invalid document/);
  });
});

describe('frozen fixtures', () => {
  it('v1/two-levels.fwplan loads cleanly', () => {
    const r = mustLoad(fixture('v1/two-levels.fwplan'));
    expect(r.repairs).toEqual([]);
    expect(r.doc.levelOrder).toEqual(['lvl-1', 'lvl-2']);
    expect(r.doc.elements['w-1']).toMatchObject({ kind: 'wall', a: 'n-1', b: 'n-2', height: null });
    expect(checkInvariants(r.doc)).toEqual([]);
  });
});

describe('rejections', () => {
  it.each([
    ['binary or non-JSON content', 'PK\u0003\u0004 binary', 'not-json'],
    ['JSON from another app', '{"version": 12, "walls": []}', 'not-framewright'],
    ['an array', '[]', 'not-framewright'],
    ['missing schema version', '{"format":"framewright-plan"}', 'invalid'],
  ])('rejects %s', (_label, text, code) => {
    expect(loadDocument(text)).toMatchObject({ ok: false, code });
  });

  it('refuses files from a newer app version with an explanation', () => {
    const r = loadDocument(JSON.stringify({ format: 'framewright-plan', schemaVersion: CURRENT_SCHEMA_VERSION + 1 }));
    expect(r).toMatchObject({ ok: false, code: 'too-new' });
    expect(!r.ok && r.error).toMatch(/newer version of Framewright/);
  });

  it('describes schema problems', () => {
    const raw = JSON.parse(fixture('v1/two-levels.fwplan'));
    raw.levels['lvl-1'].ceilingHeight = -5;
    delete raw.meta;
    const r = loadDocument(JSON.stringify(raw));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('levels.lvl-1.ceilingHeight');
    expect(!r.ok && r.error).toContain('meta');
  });
});

describe('repairs on load', () => {
  it('fixes broken references and reports each fix', () => {
    const raw = JSON.parse(fixture('v1/two-levels.fwplan'));
    raw.levelOrder = ['lvl-1'];
    raw.levels['lvl-2'].elevation = 1;
    raw.elements['n-9'] = { id: 'n-9', levelId: 'lvl-1', kind: 'wallNode', p: { x: 5, y: 5 } };
    raw.elements['w-2'] = { id: 'w-2', levelId: 'lvl-1', kind: 'wall', a: 'n-1', b: 'n-missing', typeId: 'wt-int', height: null, baseOffset: 0 };
    raw.elements['x-1'] = { id: 'x-1', levelId: 'lvl-gone', kind: 'wallNode', p: { x: 0, y: 0 } };

    const r = mustLoad(JSON.stringify(raw));
    expect(r.repairs).toEqual([
      'Rebuilt level order',
      'Restacked level elevations',
      'Removed wallNode x-1 on a missing level',
      'Removed invalid wall w-2',
      'Removed unused wall node n-9',
    ]);
    expect(r.doc.levelOrder).toEqual(['lvl-1', 'lvl-2']);
    expect(r.doc.levels['lvl-2']?.elevation).toBeCloseTo(109.75, 9);
    expect(Object.keys(r.doc.elements).sort()).toEqual(['n-1', 'n-2', 'w-1']);
    expect(checkInvariants(r.doc)).toEqual([]);
  });

  it('assigns a wall type when the referenced one is missing', () => {
    const raw = JSON.parse(fixture('v1/two-levels.fwplan'));
    raw.elements['w-1'].typeId = 'wt-gone';
    const r = mustLoad(JSON.stringify(raw));
    expect(r.doc.elements['w-1']).toMatchObject({ typeId: 'wt-int' });
    expect(r.repairs).toEqual(['Assigned a default wall type to wall w-1']);
  });
});

describe('migrate', () => {
  const table = new Map<number, Migration>([
    [1, (d) => ({ ...d, addedIn2: true })],
    [2, (d) => ({ ...d, renamed: d.addedIn2, addedIn2: undefined })],
  ]);

  it('applies each step in order and bumps the version', () => {
    expect(migrate({ schemaVersion: 1 }, 1, table, 3)).toEqual({ schemaVersion: 3, renamed: true, addedIn2: undefined });
    expect(migrate({ schemaVersion: 2, addedIn2: 'x' }, 2, table, 3)).toMatchObject({ schemaVersion: 3, renamed: 'x' });
  });

  it('fails loudly when a step is missing', () => {
    expect(() => migrate({}, 1, new Map(), 2)).toThrow('No migration from schema version 1');
  });
});
