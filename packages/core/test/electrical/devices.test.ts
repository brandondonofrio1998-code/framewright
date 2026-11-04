import { describe, expect, it } from 'vitest';
import { buildLevelMeshes, materialsList, pointInsideMesh } from '../../src';
import { testHistory } from '../helpers';

describe('electrical', () => {
  it('places a receptacle and a switch on a wall, and a light on the ceiling', () => {
    const { history, baseLevelId } = testHistory();
    const typeId = Object.values(history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
    const drawn = history.dispatch('wall.draw', { levelId: baseLevelId, typeId, points: [{ x: 0, y: 0 }, { x: 240, y: 0 }] });
    if (!drawn.ok) throw new Error(drawn.error);
    const wallId = drawn.value[0]!;
    const receptacle = history.dispatch('electrical.create', {
      levelId: baseLevelId,
      device: 'receptacle',
      p: { x: 80, y: -8 },
      hostWallId: wallId,
      hostT: 80,
      side: 'right',
    });
    if (!receptacle.ok) throw new Error(receptacle.error);
    const switched = history.dispatch('electrical.setDevice', { id: receptacle.value, device: 'switch' });
    if (!switched.ok) throw new Error(switched.error);
    expect(history.doc.elements[receptacle.value]).toMatchObject({ device: 'switch' });
    expect(history.dispatch('electrical.setDevice', { id: receptacle.value, device: 'light' }).ok).toBe(false);

    const light = history.dispatch('electrical.create', { levelId: baseLevelId, device: 'light', p: { x: 40, y: 40 } });
    if (!light.ok) throw new Error(light.error);
    const names = materialsList(history.doc).filter((line) => line.category === 'Electrical').map((line) => line.name);
    expect(names).toEqual(['Lights', 'Switches']);

    const parts = buildLevelMeshes(history.doc, baseLevelId);
    const box = parts.filter((part) => part.elementId === receptacle.value);
    expect(pointInsideMesh(box, [80, -4, 48])).toBe(true);
    const lamp = parts.filter((part) => part.elementId === light.value);
    expect(pointInsideMesh(lamp, [40, 40, 96.6])).toBe(true);

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
      history.dispatch('electrical.create', {
        levelId: baseLevelId,
        device: 'receptacle',
        p: { x: 160, y: -8 },
        hostWallId: wallId,
        hostT: 160,
        side: 'right',
      }).ok,
    ).toBe(false);
  });
});
