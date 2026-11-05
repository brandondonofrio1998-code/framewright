import { describe, expect, it } from 'vitest';
import { buildLevelMeshes, materialsList, pointInsideMesh } from '../../src';
import { testHistory } from '../helpers';

describe('plumbing', () => {
  it('places a supply and a drain on a wall, and a drain on the floor', () => {
    const { history, baseLevelId } = testHistory();
    const typeId = Object.values(history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
    const drawn = history.dispatch('wall.draw', { levelId: baseLevelId, typeId, points: [{ x: 0, y: 0 }, { x: 240, y: 0 }] });
    if (!drawn.ok) throw new Error(drawn.error);
    const wallId = drawn.value[0]!;
    const supply = history.dispatch('plumbing.create', {
      levelId: baseLevelId,
      fixture: 'supply',
      p: { x: 80, y: -8 },
      hostWallId: wallId,
      hostT: 80,
      side: 'right',
    });
    if (!supply.ok) throw new Error(supply.error);
    const drained = history.dispatch('plumbing.setFixture', { id: supply.value, fixture: 'drain' });
    if (!drained.ok) throw new Error(drained.error);
    expect(history.doc.elements[supply.value]).toMatchObject({ fixture: 'drain' });

    const floor = history.dispatch('plumbing.create', { levelId: baseLevelId, fixture: 'drain', p: { x: 40, y: 40 } });
    if (!floor.ok) throw new Error(floor.error);
    expect(history.dispatch('plumbing.setFixture', { id: floor.value, fixture: 'supply' }).ok).toBe(false);
    const names = materialsList(history.doc).filter((line) => line.category === 'Plumbing').map((line) => line.name);
    expect(names).toEqual(['Drains']);

    const parts = buildLevelMeshes(history.doc, baseLevelId);
    expect(pointInsideMesh(parts.filter((part) => part.elementId === supply.value), [80, -4, 12])).toBe(true);
    expect(pointInsideMesh(parts.filter((part) => part.elementId === floor.value), [40, 40, 0.2])).toBe(true);

    const door = history.dispatch('opening.place', {
      kind: 'door',
      wallId,
      t: 160,
      width: 36,
      height: 80,
      side: 'left',
      hinge: 'start',
      style: 'hinged',
    });
    if (!door.ok) throw new Error(door.error);
    expect(
      history.dispatch('plumbing.create', {
        levelId: baseLevelId,
        fixture: 'supply',
        p: { x: 160, y: -8 },
        hostWallId: wallId,
        hostT: 160,
        side: 'right',
      }).ok,
    ).toBe(false);
  });
});
