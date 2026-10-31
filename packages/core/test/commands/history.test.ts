import { describe, expect, it } from 'vitest';
import { testHistory } from '../helpers';

describe('History', () => {
  it('undo and redo restore the exact document', () => {
    const { history, baseLevelId } = testHistory();
    const original = history.doc;
    const r = history.dispatch('level.create', { position: 'above', referenceId: baseLevelId });
    expect(r.ok).toBe(true);
    const afterCreate = history.doc;
    expect(history.undoLabel).toBe('Add Level');

    expect(history.undo()).toBe(true);
    expect(history.doc).toEqual(original);
    expect(history.redoLabel).toBe('Add Level');
    expect(history.redo()).toBe(true);
    expect(history.doc).toEqual(afterCreate);
  });

  it('returns command values and errors without changing the document', () => {
    const { history, baseLevelId } = testHistory();
    const created = history.dispatch('level.create', { position: 'above', referenceId: baseLevelId });
    expect(created.ok && typeof created.value).toBe('string');

    const before = history.doc;
    const r = history.dispatch('level.update', { id: baseLevelId, changes: { ceilingHeight: -1 } });
    expect(r).toEqual({ ok: false, error: 'Ceiling height must be greater than zero.' });
    expect(history.doc).toBe(before);
    expect(history.undoLabel).toBe('Add Level');
  });

  it('a no-op command adds no undo step', () => {
    const { history, baseLevelId } = testHistory();
    const r = history.dispatch('level.update', { id: baseLevelId, changes: { name: 'Level 1' } });
    expect(r).toMatchObject({ ok: true, changed: false });
    expect(history.canUndo).toBe(false);
  });

  it('a new command clears redo', () => {
    const { history, baseLevelId } = testHistory();
    history.dispatch('level.update', { id: baseLevelId, changes: { name: 'A' } });
    history.undo();
    history.dispatch('level.update', { id: baseLevelId, changes: { ceilingHeight: 100 } });
    expect(history.canRedo).toBe(false);
  });

  it('merges same-key commands within the merge window', () => {
    let t = 0;
    const { history, baseLevelId } = testHistory({ now: () => t });
    history.dispatch('level.update', { id: baseLevelId, changes: { name: 'L' } });
    t = 500;
    history.dispatch('level.update', { id: baseLevelId, changes: { name: 'Le' } });
    t = 900;
    history.dispatch('level.update', { id: baseLevelId, changes: { name: 'Lev' } });
    t = 5000;
    history.dispatch('level.update', { id: baseLevelId, changes: { name: 'Levl' } });

    history.undo();
    expect(history.doc.levels[baseLevelId]?.name).toBe('Lev');
    history.undo();
    expect(history.doc.levels[baseLevelId]?.name).toBe('Level 1');
    expect(history.canUndo).toBe(false);
  });

  it('transactions are one undo step and atomic on failure', () => {
    const { history, baseLevelId } = testHistory();
    const ok = history.transaction('Set Up Floors', [
      { type: 'level.create', payload: { position: 'above', referenceId: baseLevelId } },
      { type: 'level.update', payload: { id: baseLevelId, changes: { ceilingHeight: 109.125 } } },
    ]);
    expect(ok.ok).toBe(true);
    expect(history.doc.levelOrder).toHaveLength(2);
    history.undo();
    expect(history.doc.levelOrder).toHaveLength(1);

    const before = history.doc;
    const failed = history.transaction('Broken', [
      { type: 'level.create', payload: { position: 'above', referenceId: baseLevelId } },
      { type: 'level.delete', payload: { id: 'nope' } },
    ]);
    expect(failed.ok).toBe(false);
    expect(history.doc).toBe(before);
  });

  describe('dirty tracking', () => {
    it('is clean at the save point, including after undo/redo back to it', () => {
      const { history, baseLevelId } = testHistory();
      expect(history.dirty).toBe(false);
      history.dispatch('level.update', { id: baseLevelId, changes: { name: 'A' } });
      expect(history.dirty).toBe(true);
      history.markSaved();
      expect(history.dirty).toBe(false);
      history.undo();
      expect(history.dirty).toBe(true);
      history.redo();
      expect(history.dirty).toBe(false);
    });

    it('stays dirty once the saved state is unreachable', () => {
      const { history, baseLevelId } = testHistory();
      history.dispatch('level.update', { id: baseLevelId, changes: { name: 'A' } });
      history.markSaved();
      history.undo();
      history.dispatch('level.update', { id: baseLevelId, changes: { ceilingHeight: 100 } });
      history.undo();
      expect(history.dirty).toBe(true);
    });

    it('does not merge into the saved step', () => {
      let t = 0;
      const { history, baseLevelId } = testHistory({ now: () => t });
      history.dispatch('level.update', { id: baseLevelId, changes: { name: 'A' } });
      history.markSaved();
      t = 10;
      history.dispatch('level.update', { id: baseLevelId, changes: { name: 'AB' } });
      expect(history.dirty).toBe(true);
      history.undo();
      expect(history.dirty).toBe(false);
      expect(history.doc.levels[baseLevelId]?.name).toBe('A');
    });

    it('reset can mark a recovered document dirty', () => {
      const { history } = testHistory();
      history.reset(history.doc, { dirty: true });
      expect(history.dirty).toBe(true);
      expect(history.canUndo).toBe(false);
    });
  });

  it('notifies subscribers with patches and source', () => {
    const { history, baseLevelId } = testHistory();
    const sources: string[] = [];
    const unsubscribe = history.subscribe((change) => sources.push(`${change.source}:${change.patches.length > 0}`));
    history.dispatch('level.update', { id: baseLevelId, changes: { name: 'A' } });
    history.undo();
    history.redo();
    history.reset(history.doc);
    unsubscribe();
    history.undo();
    expect(sources).toEqual(['command:true', 'undo:true', 'redo:true', 'reset:false']);
  });
});
