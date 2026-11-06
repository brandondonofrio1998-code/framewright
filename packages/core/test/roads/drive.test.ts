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
    const sloped = history.dispatch('road.fall', { id: created.value, fall: 24 });
    if (!sloped.ok) throw new Error(sloped.error);
    const ramp = buildLevelMeshes(history.doc, baseLevelId).filter((part) => part.elementId === created.value);
    expect(pointInsideMesh(ramp, [20, 20, -3])).toBe(true);
    expect(pointInsideMesh(ramp, [220, 20, -23])).toBe(true);
    expect(pointInsideMesh(ramp, [220, 20, -0.5])).toBe(false);
    expect(history.dispatch('road.fall', { id: created.value, fall: 200 }).ok).toBe(false);
    const leveled = history.dispatch('road.fall', { id: created.value, fall: 0 });
    if (!leveled.ok) throw new Error(leveled.error);
    expect(history.doc.elements[created.value]).not.toHaveProperty('fall');
    expect(history.dispatch('road.create', { levelId: baseLevelId, a: { x: 0, y: 0 }, b: { x: 40, y: 0 } }).ok).toBe(false);
    const widened = history.dispatch('road.width', { id: created.value, width: 192 });
    if (!widened.ok) throw new Error(widened.error);
    expect(history.doc.elements[created.value]).toMatchObject({ width: 192 });
  });
});
