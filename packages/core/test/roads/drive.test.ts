import { describe, expect, it } from 'vitest';
import { buildLevelMeshes, materialsList, pointInsideMesh } from '../../src';
import { testHistory } from '../helpers';

describe('roads', () => {
  it('builds a 12 foot driveway between two clicks', () => {
    const { history, baseLevelId } = testHistory();
    const created = history.dispatch('road.create', { levelId: baseLevelId, a: { x: 0, y: 0 }, b: { x: 240, y: 0 } });
    if (!created.ok) throw new Error(created.error);
    expect(history.doc.elements[created.value]).toMatchObject({ width: 144 });
    expect(materialsList(history.doc).find((line) => line.name === 'Driveway')?.quantity).toBeCloseTo((240 * 144) / 144, 3);
    const parts = buildLevelMeshes(history.doc, baseLevelId);
    expect(pointInsideMesh(parts.filter((part) => part.elementId === created.value), [120, 20, -0.5])).toBe(true);
    expect(history.dispatch('road.create', { levelId: baseLevelId, a: { x: 0, y: 0 }, b: { x: 40, y: 0 } }).ok).toBe(false);
    const widened = history.dispatch('road.width', { id: created.value, width: 192 });
    if (!widened.ok) throw new Error(widened.error);
    expect(history.doc.elements[created.value]).toMatchObject({ width: 192 });
  });
});
