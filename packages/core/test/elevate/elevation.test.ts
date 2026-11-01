import { describe, expect, it } from 'vitest';
import { buildElevation, buildLevelMeshes, defaultWallHeight, type MeshPart, type Vec2 } from '../../src';
import { testHistory } from '../helpers';

const p = (x: number, y: number): Vec2 => ({ x, y });

function face(positions: number[], indices: number[], pts: readonly (readonly [number, number, number])[]): void {
  const base = positions.length / 3;
  for (const pt of pts) positions.push(pt[0], pt[1], pt[2]);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** Outward-wound box. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): MeshPart {
  const positions: number[] = [];
  const indices: number[] = [];
  face(positions, indices, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]);
  face(positions, indices, [[x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]]);
  face(positions, indices, [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]);
  face(positions, indices, [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]]);
  face(positions, indices, [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]);
  face(positions, indices, [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]]);
  return {
    elementId: 'box',
    materialId: null,
    role: 'solid',
    positions: Float32Array.from(positions),
    normals: new Float32Array(positions.length),
    uvs: new Float32Array((positions.length / 3) * 2),
    indices: Uint32Array.from(indices),
  };
}

function lines(parts: MeshPart[], facing: 'front' | 'back' | 'left' | 'right' = 'front') {
  return buildElevation(parts, facing).flatMap((item) => item.prims.flatMap((prim) => (prim.t === 'line' ? [prim] : [])));
}

describe('elevations', () => {
  it('draws the outline of a box and leaves the diagonals out', () => {
    const drawn = lines([box(0, 0, 0, 10, 4, 8)]);
    expect(drawn.length).toBeGreaterThan(0);
    for (const line of drawn) {
      for (const pt of [line.a, line.b]) {
        const onX = pt.x < 0.2 || pt.x > 9.8;
        const onZ = pt.y < 0.2 || pt.y > 7.8;
        expect(onX || onZ, JSON.stringify(pt)).toBe(true);
      }
    }
    const xs = drawn.flatMap((line) => [line.a.x, line.b.x]);
    const zs = drawn.flatMap((line) => [line.a.y, line.b.y]);
    expect(Math.min(...xs)).toBeCloseTo(0, 1);
    expect(Math.max(...xs)).toBeCloseTo(10, 1);
    expect(Math.min(...zs)).toBeCloseTo(0, 1);
    expect(Math.max(...zs)).toBeCloseTo(8, 1);
  });

  it('hides the part of a farther box that sits behind a nearer one', () => {
    const drawn = lines([box(0, 0, 0, 10, 2, 8), box(8, 5, 0, 18, 7, 8)]);
    const nearGround = drawn.some((line) => line.a.y < 0.2 && line.b.y < 0.2 && Math.min(line.a.x, line.b.x) < 1 && Math.max(line.a.x, line.b.x) > 8);
    const farGround = drawn.some((line) => line.a.y < 0.2 && line.b.y < 0.2 && Math.min(line.a.x, line.b.x) > 10.2 && Math.max(line.a.x, line.b.x) > 16);
    const hiddenSeam = drawn.some((line) => Math.abs(line.a.x - 8) < 0.4 && Math.abs(line.b.x - 8) < 0.4 && Math.abs(line.a.y - line.b.y) > 2);
    expect(nearGround).toBe(true);
    expect(farGround).toBe(true);
    expect(hiddenSeam).toBe(false);
  });

  it('shows the jambs and head of a door in the near wall', () => {
    const ctx = testHistory();
    const typeId = Object.values(ctx.history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
    const drawnWalls = ctx.history.dispatch('wall.draw', { levelId: ctx.baseLevelId, typeId, points: [p(0, 0), p(240, 0), p(240, 144), p(0, 144)], closed: true });
    if (!drawnWalls.ok) throw new Error(drawnWalls.error);
    const wallId = drawnWalls.value[0]!;
    const door = ctx.history.dispatch('opening.place', { kind: 'door', wallId, t: 120, width: 36, height: 80, side: 'left', hinge: 'start', style: 'hinged' });
    if (!door.ok) throw new Error(door.error);
    const parts = buildLevelMeshes(ctx.history.doc, ctx.baseLevelId).filter((part) => part.elementId === wallId);
    const elev = lines(parts);
    const height = defaultWallHeight(ctx.history.doc.levels, ctx.history.doc.levelOrder, ctx.baseLevelId);
    const zs = elev.flatMap((line) => [line.a.y, line.b.y]);
    expect(Math.max(...zs)).toBeCloseTo(height, 1);
    const jamb = elev.some((line) => Math.abs(line.a.x - line.b.x) < 0.5 && (Math.abs(line.a.x - 102) < 1.5 || Math.abs(line.a.x - 138) < 1.5) && Math.abs(line.a.y - line.b.y) > 20);
    const head = elev.some((line) => Math.abs(line.a.y - 80) < 1 && Math.abs(line.b.y - 80) < 1 && Math.min(line.a.x, line.b.x) < 110 && Math.max(line.a.x, line.b.x) > 130);
    expect(jamb).toBe(true);
    expect(head).toBe(true);
  });
});
