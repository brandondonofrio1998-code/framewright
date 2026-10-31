import { describe, expect, it } from 'vitest';
import { DEFAULT_CEILING_HEIGHT, DEFAULT_FLOOR_DEPTH, checkInvariants, defaultWallHeight } from '../../src';
import { testHistory } from '../helpers';

const STORY = DEFAULT_CEILING_HEIGHT + DEFAULT_FLOOR_DEPTH;

describe('level commands', () => {
  it('adds a level above, stacked on the one below', () => {
    const { history, baseLevelId } = testHistory();
    const r = history.dispatch('level.create', { position: 'above', referenceId: baseLevelId });
    if (!r.ok) throw new Error(r.error);
    const level = history.doc.levels[r.value];
    expect(level).toMatchObject({ name: 'Level 2', elevation: STORY });
    expect(history.doc.levelOrder).toEqual([baseLevelId, r.value]);
  });

  it('adds a bottom level below without moving the existing stack', () => {
    const { history, baseLevelId } = testHistory();
    const r = history.dispatch('level.create', { position: 'below', referenceId: baseLevelId });
    if (!r.ok) throw new Error(r.error);
    expect(history.doc.levels[baseLevelId]?.elevation).toBe(0);
    expect(history.doc.levels[r.value]).toMatchObject({ name: 'Lower Level', elevation: -STORY });
    expect(history.doc.levelOrder[0]).toBe(r.value);
  });

  it('inserting between levels pushes the upper levels up', () => {
    const { history, baseLevelId } = testHistory();
    const l2 = history.dispatch('level.create', { position: 'above', referenceId: baseLevelId });
    if (!l2.ok) throw new Error(l2.error);
    history.dispatch('level.create', { position: 'below', referenceId: l2.value });
    expect(history.doc.levels[l2.value]?.elevation).toBeCloseTo(2 * STORY, 9);
    expect(checkInvariants(history.doc)).toEqual([]);
  });

  it('keeps names unique', () => {
    const { history, baseLevelId } = testHistory();
    history.dispatch('level.update', { id: baseLevelId, changes: { name: 'Level 2' } });
    const r = history.dispatch('level.create', { position: 'above', referenceId: baseLevelId });
    if (!r.ok) throw new Error(r.error);
    expect(history.doc.levels[r.value]?.name).toBe('Level 2 2');
  });

  it('changing a ceiling height restacks the levels above', () => {
    const { history, baseLevelId } = testHistory();
    const l2 = history.dispatch('level.create', { position: 'above', referenceId: baseLevelId });
    if (!l2.ok) throw new Error(l2.error);
    history.dispatch('level.update', { id: baseLevelId, changes: { ceilingHeight: 109.125 } });
    expect(history.doc.levels[l2.value]?.elevation).toBeCloseTo(109.125 + DEFAULT_FLOOR_DEPTH, 9);
    history.dispatch('level.update', { id: l2.value, changes: { floorDepth: 10 } });
    expect(history.doc.levels[l2.value]?.elevation).toBeCloseTo(119.125, 9);
  });

  it('only the bottom level accepts an explicit elevation', () => {
    const { history, baseLevelId } = testHistory();
    const l2 = history.dispatch('level.create', { position: 'above', referenceId: baseLevelId });
    if (!l2.ok) throw new Error(l2.error);
    expect(history.dispatch('level.update', { id: l2.value, changes: { elevation: 500 } }).ok).toBe(false);
    history.dispatch('level.update', { id: baseLevelId, changes: { elevation: 24 } });
    expect(history.doc.levels[l2.value]?.elevation).toBeCloseTo(24 + STORY, 9);
  });

  it.each([
    [{ name: '   ' }, 'Name cannot be empty.'],
    [{ ceilingHeight: 0 }, 'Ceiling height must be greater than zero.'],
    [{ floorDepth: -1 }, 'Floor depth must be zero or more.'],
    [{ ceilingHeight: Number.NaN }, 'Ceiling height is out of range.'],
  ])('rejects %j', (changes, error) => {
    const { history, baseLevelId } = testHistory();
    expect(history.dispatch('level.update', { id: baseLevelId, changes })).toEqual({ ok: false, error });
  });

  it('deleting a level removes its elements and restacks; the last level cannot be deleted', () => {
    const { history, baseLevelId } = testHistory();
    expect(history.dispatch('level.delete', { id: baseLevelId })).toEqual({ ok: false, error: 'A plan needs at least one level.' });

    const l2 = history.dispatch('level.create', { position: 'above', referenceId: baseLevelId });
    const l3 = history.dispatch('level.create', { position: 'above', referenceId: l2.ok ? l2.value : '' });
    if (!l2.ok || !l3.ok) throw new Error('setup failed');
    history.dispatch('level.update', { id: l2.value, changes: { ceilingHeight: 200 } });
    history.dispatch('level.delete', { id: l2.value });
    expect(history.doc.levelOrder).toEqual([baseLevelId, l3.value]);
    expect(history.doc.levels[l3.value]?.elevation).toBeCloseTo(STORY, 9);
  });

  it('default wall height reaches the underside of the floor above', () => {
    const { history, baseLevelId } = testHistory();
    const { levels, levelOrder } = history.doc;
    expect(defaultWallHeight(levels, levelOrder, baseLevelId)).toBe(DEFAULT_CEILING_HEIGHT);
    const l2 = history.dispatch('level.create', { position: 'above', referenceId: baseLevelId });
    if (!l2.ok) throw new Error(l2.error);
    expect(defaultWallHeight(history.doc.levels, history.doc.levelOrder, baseLevelId)).toBe(STORY);
  });
});

describe('settings and title', () => {
  it('changes units and rejects unknown formats', () => {
    const { history } = testHistory();
    const metric = { system: 'metric', unit: 'mm', decimals: 0 } as const;
    expect(history.dispatch('settings.update', { lengthFormat: metric }).ok).toBe(true);
    expect(history.doc.settings.lengthFormat).toEqual(metric);
    expect(history.undoLabel).toBe('Change Units');
    const bad = { system: 'metric', unit: 'furlong', decimals: 0 } as unknown as typeof metric;
    expect(history.dispatch('settings.update', { lengthFormat: bad }).ok).toBe(false);
  });

  it('renames the plan', () => {
    const { history } = testHistory();
    history.dispatch('document.rename', { title: '  Smith Residence ' });
    expect(history.doc.meta.title).toBe('Smith Residence');
  });
});
