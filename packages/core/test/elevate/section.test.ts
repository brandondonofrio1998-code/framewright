import { describe, expect, it } from 'vitest';
import { buildLevelMeshes, buildSection, defaultWallHeight, pocheFill, type DisplayItem, type MeshPart, type Vec2 } from '../../src';
import { testHistory } from '../helpers';

const p = (x: number, y: number): Vec2 => ({ x, y });

function face(positions: number[], indices: number[], pts: readonly (readonly [number, number, number])[]): void {
  const base = positions.length / 3;
  for (const pt of pts) positions.push(pt[0], pt[1], pt[2]);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function box(id: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): MeshPart {
  const positions: number[] = [];
  const indices: number[] = [];
  face(positions, indices, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]);
  face(positions, indices, [[x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]]);
  face(positions, indices, [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]);
  face(positions, indices, [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]]);
  face(positions, indices, [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]);
  face(positions, indices, [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]]);
  return {
    elementId: id,
    materialId: null,
    role: 'solid',
    positions: Float32Array.from(positions),
    normals: new Float32Array(positions.length),
    uvs: new Float32Array((positions.length / 3) * 2),
    indices: Uint32Array.from(indices),
  };
}

function polys(items: DisplayItem[]) {
  return items.flatMap((item) => item.prims.flatMap((prim) => (prim.t === 'poly' ? [prim] : [])));
}

function lines(items: DisplayItem[]) {
  return items.flatMap((item) => item.prims.flatMap((prim) => (prim.t === 'line' ? [prim] : [])));
}

function span(values: number[]) {
  return { min: Math.min(...values), max: Math.max(...values) };
}

describe('sections', () => {
  it('fills the cut of a box and keeps the outline on that rectangle', () => {
    const items = buildSection([box('a', 0, 0, 0, 10, 4, 8)], 'front', 0.5, () => 'wall.finish');
    const rings = polys(items).flatMap((prim) => prim.rings);
    expect(rings.length).toBeGreaterThan(0);
    const pts = rings.flat();
    const xs = span(pts.map((pt) => pt.x));
    const zs = span(pts.map((pt) => pt.y));
    expect(xs.min).toBeCloseTo(0, 1);
    expect(xs.max).toBeCloseTo(10, 1);
    expect(zs.min).toBeCloseTo(0, 1);
    expect(zs.max).toBeCloseTo(8, 1);
    for (const line of lines(items)) {
      for (const pt of [line.a, line.b]) {
        const onX = pt.x < 0.3 || pt.x > 9.7;
        const onZ = pt.y < 0.3 || pt.y > 7.7;
        expect(onX || onZ).toBe(true);
      }
    }
  });

  it('joins two stacked cuts of the same material into one loop', () => {
    const items = buildSection([box('low', 0, 0, 0, 10, 4, 4), box('high', 0, 0, 4, 10, 4, 8)], 'front', 0.5, () => 'wall.structure');
    const rings = polys(items).flatMap((prim) => prim.rings);
    expect(rings).toHaveLength(1);
    const zs = span(rings[0]!.map((pt) => pt.y));
    expect(zs.min).toBeCloseTo(0, 1);
    expect(zs.max).toBeCloseTo(8, 1);
  });

  it('omits a solid on the near side of the plane and still draws one beyond it', () => {
    const items = buildSection([box('near', 0, 0, 0, 4, 2, 8), box('far', 6, 6, 0, 14, 8, 8)], 'front', 0.125, () => 'wall.finish');
    const cut = polys(items).flatMap((prim) => prim.rings.flat());
    expect(cut.length).toBeGreaterThan(0);
    expect(Math.max(...cut.map((pt) => pt.x))).toBeLessThan(5);
    const drawn = lines(items).flatMap((line) => [line.a.x, line.b.x]);
    expect(Math.max(...drawn)).toBeGreaterThan(12);
  });

  it('cuts the side walls and the floor of a room, and keeps the far wall', () => {
    const ctx = testHistory();
    const typeId = Object.values(ctx.history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
    const drawn = ctx.history.dispatch('wall.draw', { levelId: ctx.baseLevelId, typeId, points: [p(0, 0), p(240, 0), p(240, 144), p(0, 144)], closed: true });
    if (!drawn.ok) throw new Error(drawn.error);
    const doc = ctx.history.doc;
    const items = buildSection(buildLevelMeshes(doc, ctx.baseLevelId), 'front', 0.5, (part) => pocheFill(part.role, part.materialId ? (doc.materials[part.materialId]?.category ?? null) : null));
    const fills = new Set(polys(items).map((prim) => prim.fill));
    expect(fills.has('wall.structure')).toBe(true);
    expect(fills.has('wall.sheathing')).toBe(true);
    expect(fills.has('wall.finish')).toBe(true);
    const rings = polys(items).flatMap((prim) => prim.rings);
    const narrow = rings.filter((ring) => {
      const xs = span(ring.map((pt) => pt.x));
      const zs = span(ring.map((pt) => pt.y));
      return xs.max - xs.min < 12 && zs.max - zs.min > 80;
    });
    expect(narrow.length).toBeGreaterThan(1);
    const floor = rings.some((ring) => {
      const xs = span(ring.map((pt) => pt.x));
      const zs = span(ring.map((pt) => pt.y));
      return xs.max - xs.min > 100 && zs.max - zs.min < 2;
    });
    expect(floor).toBe(true);
    const height = defaultWallHeight(doc.levels, doc.levelOrder, ctx.baseLevelId);
    const farTop = lines(items).some((line) => Math.abs(line.a.y - height) < 1 && Math.abs(line.b.y - height) < 1 && Math.abs(line.a.x - line.b.x) > 80);
    expect(farTop).toBe(true);
  });

  it('maps materials onto the poché fills', () => {
    expect(pocheFill('solid', 'framing')).toBe('wall.structure');
    expect(pocheFill('solid', 'sheathing')).toBe('wall.sheathing');
    expect(pocheFill('solid', 'insulation')).toBe('wall.insulation');
    expect(pocheFill('solid', 'drywall')).toBe('wall.finish');
    expect(pocheFill('solid', 'siding')).toBe('wall.finish');
    expect(pocheFill('floor', null)).toBe('wall.structure');
    expect(pocheFill('panel', null)).toBe('wall.structure');
    expect(pocheFill('glass', null)).toBeNull();
  });
});
