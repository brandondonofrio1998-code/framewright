import { describe, expect, it } from 'vitest';
import { buildLevelMeshes, defaultWallHeight, pointInsideMesh, starterById, type MeshPart, type Vec2 } from '../../src';
import { testHistory } from '../helpers';

const p = (x: number, y: number): Vec2 => ({ x, y });

function setup() {
  const ctx = testHistory();
  const typeId = Object.values(ctx.history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
  const draw = (points: Vec2[], closed = false) => {
    const result = ctx.history.dispatch('wall.draw', { levelId: ctx.baseLevelId, typeId, points, ...(closed ? { closed } : {}) });
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };
  const meshes = () => buildLevelMeshes(ctx.history.doc, ctx.baseLevelId);
  return { ...ctx, typeId, draw, meshes };
}

const ofId = (parts: MeshPart[], id: string) => parts.filter((part) => part.elementId === id);

describe('level meshes', () => {
  it('extrudes wall layers up to the level height and leaves a door opening empty', () => {
    const s = setup();
    const [bottom] = s.draw([p(0, 0), p(240, 0), p(240, 144), p(0, 144)], true);
    const door = s.history.dispatch('opening.place', {
      kind: 'door',
      wallId: bottom!,
      t: 120,
      width: 36,
      height: 80,
      side: 'left',
      hinge: 'start',
      style: 'hinged',
    });
    if (!door.ok) throw new Error(door.error);
    const win = s.history.dispatch('opening.place', {
      kind: 'window',
      wallId: bottom!,
      t: 40,
      width: 36,
      height: 48,
      sill: 32,
      side: 'right',
      hinge: 'start',
      style: 'double-hung',
    });
    if (!win.ok) throw new Error(win.error);

    const parts = s.meshes();
    const wall = ofId(parts, bottom!);
    const height = defaultWallHeight(s.history.doc.levels, s.history.doc.levelOrder, s.baseLevelId);
    const zs = wall.flatMap((part) => [...part.positions].filter((_, i) => i % 3 === 2));
    expect(Math.max(...zs)).toBeCloseTo(height, 3);
    expect(Math.min(...zs)).toBeCloseTo(0, 3);

    const materials = new Set(wall.map((part) => part.materialId));
    const byName = Object.values(s.history.doc.materials);
    expect(materials.has(byName.find((m) => m.name.startsWith('Lap siding'))!.id)).toBe(true);
    expect(materials.has(byName.find((m) => m.name.startsWith('Gypsum'))!.id)).toBe(true);

    // The stud cavity is framed, so a bay is empty and a stud is solid. y = 0 is in that cavity.
    expect(pointInsideMesh(wall, [120, 0.15, 40])).toBe(false);
    expect(pointInsideMesh(wall, [16.9, 0.15, 40])).toBe(true);
    expect(pointInsideMesh(wall, [72, 0.15, 40])).toBe(false);
    expect(pointInsideMesh(wall, [72, 2.6, 40])).toBe(true);
    expect(pointInsideMesh(wall, [40, 2.6, 16])).toBe(true);
    expect(pointInsideMesh(wall, [40, 2.6, 56])).toBe(false);
    expect(pointInsideMesh(wall, [30, 0.15, height + 12])).toBe(false);

    // Off the center of a face, so the ray does not ride the diagonal between two triangles.
    expect(pointInsideMesh(ofId(parts, door.value), [120, 0, 30])).toBe(true);
    expect(pointInsideMesh(ofId(parts, win.value), [40, 0, 48])).toBe(true);

    const floors = parts.filter((part) => part.role === 'floor');
    expect(floors).toHaveLength(1);
    expect(pointInsideMesh(floors, [120, 72, -0.3])).toBe(true);
  });

  it('builds a box for a hosted cabinet', () => {
    const s = setup();
    const [bottom] = s.draw([p(0, 0), p(240, 0)]);
    const def = starterById('starter.base-24')!;
    const placed = s.history.dispatch('object.place', { levelId: s.baseLevelId, def, hostWallId: bottom!, hostT: 48, side: 'left' });
    if (!placed.ok) throw new Error(placed.error);
    const [box] = ofId(s.meshes(), placed.value);
    expect(box?.role).toBe('panel');
    const object = s.history.doc.elements[placed.value];
    if (object?.kind !== 'object') throw new Error('missing object');
    expect(pointInsideMesh([box!], [object.p.x, object.p.y, 17])).toBe(true);
    const zs = [...box!.positions].filter((_, i) => i % 3 === 2);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(34.5, 3);
  });
});
