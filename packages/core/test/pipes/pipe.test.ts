import { describe, expect, it } from 'vitest';
import { buildLevelMeshes, materialsList, pipeCenter, pipeSize, pointInsideMesh } from '../../src';
import { testHistory } from '../helpers';

describe('pipes', () => {
  it('draws a supply and can switch it to a drain', () => {
    const { history, baseLevelId } = testHistory();
    const created = history.dispatch('pipe.create', {
      levelId: baseLevelId,
      a: { x: 0, y: 0 },
      b: { x: 120, y: 0 },
      service: 'supply',
    });
    if (!created.ok) throw new Error(created.error);
    const pipe = history.doc.elements[created.value];
    expect(pipe).toMatchObject({ kind: 'pipe', service: 'supply' });
    expect(pipeSize({ service: 'supply' })).toBe(0.75);
    expect(materialsList(history.doc).find((line) => line.name === 'Supply pipe')?.quantity).toBeCloseTo(10, 3);

    let parts = buildLevelMeshes(history.doc, baseLevelId).filter((part) => part.elementId === created.value);
    expect(pointInsideMesh(parts, [60, 0.1, pipeCenter({ service: 'supply' })])).toBe(true);

    const drained = history.dispatch('pipe.service', { id: created.value, service: 'drain' });
    if (!drained.ok) throw new Error(drained.error);
    expect(materialsList(history.doc).find((line) => line.name === 'Drain pipe')?.quantity).toBeCloseTo(10, 3);
    parts = buildLevelMeshes(history.doc, baseLevelId).filter((part) => part.elementId === created.value);
    expect(pointInsideMesh(parts, [60, 0.2, pipeCenter({ service: 'drain' })])).toBe(true);
    expect(pointInsideMesh(parts, [60, 0.1, pipeCenter({ service: 'supply' })])).toBe(false);

    expect(history.dispatch('pipe.create', { levelId: baseLevelId, a: { x: 0, y: 0 }, b: { x: 6, y: 0 }, service: 'supply' }).ok).toBe(false);
  });
});
