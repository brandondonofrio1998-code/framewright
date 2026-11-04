import { describe, expect, it } from 'vitest';
import { hiddenLayersOf, loadDocument, serializeDocument } from '../../src';
import { testHistory } from '../helpers';

describe('layer sets', () => {
  it('hides a layer on the plan and keeps a second set', () => {
    const ctx = testHistory();
    const toggled = ctx.history.dispatch('layerSet.toggle', { layer: 'walls' });
    if (!toggled.ok) throw new Error(toggled.error);
    expect(ctx.history.doc.layerSets?.map((set) => set.name)).toEqual(['Plan']);
    expect(hiddenLayersOf(ctx.history.doc)).toEqual(['walls']);

    const created = ctx.history.dispatch('layerSet.create', {});
    if (!created.ok) throw new Error(created.error);
    expect(ctx.history.doc.layerSets?.map((set) => set.name)).toEqual(['Plan', 'Set 2']);
    expect(hiddenLayersOf(ctx.history.doc)).toEqual(['walls']);

    const plan = ctx.history.doc.layerSets?.[0];
    const second = ctx.history.doc.layerSets?.[1];
    if (!plan || !second) throw new Error('missing set');
    const back = ctx.history.dispatch('layerSet.use', { id: plan.id });
    if (!back.ok) throw new Error(back.error);
    const shown = ctx.history.dispatch('layerSet.toggle', { layer: 'walls' });
    if (!shown.ok) throw new Error(shown.error);
    expect(hiddenLayersOf(ctx.history.doc)).toEqual([]);
    const again = ctx.history.dispatch('layerSet.use', { id: second.id });
    if (!again.ok) throw new Error(again.error);
    expect(hiddenLayersOf(ctx.history.doc)).toEqual(['walls']);

    expect(ctx.history.dispatch('layerSet.toggle', { layer: 'not-a-layer' }).ok).toBe(false);
    const loaded = loadDocument(serializeDocument(ctx.history.doc));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(hiddenLayersOf(loaded.doc)).toEqual(['walls']);
    expect(loaded.doc.layerSets).toHaveLength(2);
  });
});
