import { describe, expect, it } from 'vitest';
import { buildLevelMeshes, materialsList, pointInsideMesh } from '../../src';
import { testHistory } from '../helpers';

describe('terrain and plants', () => {
  it('lays a graded lot pad and a tree', () => {
    const { history, baseLevelId } = testHistory();
    const points = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ];
    const lot = history.dispatch('site.lot', { levelId: baseLevelId, points });
    if (!lot.ok) throw new Error(lot.error);
    const graded = history.dispatch('site.grade', { id: lot.value, grade: 0 });
    if (!graded.ok) throw new Error(graded.error);
    const tree = history.dispatch('plant.create', { levelId: baseLevelId, p: { x: 10, y: 10 } });
    if (!tree.ok) throw new Error(tree.error);
    expect(history.doc.elements[tree.value]).toMatchObject({ radius: 96, height: 240 });
    expect(materialsList(history.doc).find((line) => line.name === 'Trees')?.quantity).toBe(1);
    const parts = buildLevelMeshes(history.doc, baseLevelId);
    expect(pointInsideMesh(parts.filter((part) => part.elementId === lot.value), [100, 100, -0.4])).toBe(true);
    expect(pointInsideMesh(parts.filter((part) => part.elementId === tree.value), [10, 12, 20])).toBe(true);
    const cleared = history.dispatch('site.grade', { id: lot.value, grade: null });
    if (!cleared.ok) throw new Error(cleared.error);
    expect(history.doc.elements[lot.value]).not.toHaveProperty('grade');
    const terrace = history.dispatch('site.contour', {
      levelId: baseLevelId,
      points: [
        { x: 20, y: 20 },
        { x: 80, y: 20 },
        { x: 80, y: 80 },
        { x: 20, y: 80 },
      ],
    });
    if (!terrace.ok) throw new Error(terrace.error);
    expect(history.doc.elements[terrace.value]).toMatchObject({ role: 'contour', grade: 12 });
    expect(materialsList(history.doc).find((line) => line.name === 'Terraces')?.quantity).toBeCloseTo((60 * 60) / 144, 3);
    const raised = buildLevelMeshes(history.doc, baseLevelId).filter((part) => part.elementId === terrace.value);
    expect(pointInsideMesh(raised, [40, 50, 11.3])).toBe(true);
    expect(pointInsideMesh(raised, [40, 50, 0])).toBe(false);
    expect(history.dispatch('site.grade', { id: terrace.value, grade: null }).ok).toBe(false);
  });
});
