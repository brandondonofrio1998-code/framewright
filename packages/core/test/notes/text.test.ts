import { describe, expect, it } from 'vitest';
import { buildPlanDisplayList, pickElement, TEXT_SIZE } from '../../src';
import { testHistory } from '../helpers';

const p = (x: number, y: number) => ({ x, y });

describe('text notes', () => {
  it('places a note, edits it, and draws it on the plan', () => {
    const ctx = testHistory();
    const placed = ctx.history.dispatch('text.create', { levelId: ctx.baseLevelId, p: p(10, 20), text: '  Kitchen  ' });
    if (!placed.ok) throw new Error(placed.error);
    const note = ctx.history.doc.elements[placed.value];
    if (note?.kind !== 'text') throw new Error('missing note');
    expect(note.text).toBe('Kitchen');
    expect(note.size).toBe(TEXT_SIZE);
    const empty = ctx.history.dispatch('text.create', { levelId: ctx.baseLevelId, p: p(0, 0), text: '   ' });
    expect(empty.ok).toBe(false);
    const edited = ctx.history.dispatch('text.update', { id: note.id, text: 'Pantry', size: 12 });
    if (!edited.ok) throw new Error(edited.error);
    const shown = buildPlanDisplayList(ctx.history.doc, ctx.baseLevelId).find((item) => item.elementId === note.id);
    expect(shown?.prims).toContainEqual({ t: 'text', p: p(10, 20), s: 'Pantry', size: 12, rot: 0, align: 'left' });
    const hit = pickElement(ctx.history.doc, ctx.baseLevelId, new Map(), p(10, 20), 6);
    expect(hit).toEqual({ kind: 'text', id: note.id });
    ctx.history.dispatch('elements.delete', { ids: [note.id] });
    expect(ctx.history.doc.elements[note.id]).toBeUndefined();
  });
});
