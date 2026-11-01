import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildLevelMeshes, defaultWallHeight, hipOnLevel, hipOverRect, roofZ, roofsOnLevel, DEFAULT_OVERHANG, DEFAULT_PITCH, type RectOutline } from '../../src';
import { testHistory } from '../helpers';

const p = (x: number, y: number) => ({ x, y });

function room(width = 240, depth = 144) {
  const ctx = testHistory();
  const typeId = Object.values(ctx.history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
  const drawn = ctx.history.dispatch('wall.draw', {
    levelId: ctx.baseLevelId,
    typeId,
    points: [p(0, 0), p(width, 0), p(width, depth), p(0, depth)],
    closed: true,
  });
  if (!drawn.ok) throw new Error(drawn.error);
  return ctx;
}

function outline(spanX: number, spanY: number, plate = 96): RectOutline {
  return { x0: 0, x1: spanX, y0: 0, y1: spanY, plateX0: plate, plateX1: plate, plateY0: plate, plateY1: plate, generatedFrom: ['a', 'b', 'c', 'd'] };
}

function covers(poly: { x: number; y: number }[], point: { x: number; y: number }): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ab = Math.hypot(b.x - a.x, b.y - a.y);
    if (Math.abs(Math.hypot(point.x - a.x, point.y - a.y) + Math.hypot(b.x - point.x, b.y - point.y) - ab) < 0.05) return true;
  }
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

describe('hip roofs', () => {
  it('refuses a wall that does not close a rectangle', () => {
    const ctx = testHistory();
    const typeId = Object.values(ctx.history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
    const drawn = ctx.history.dispatch('wall.draw', { levelId: ctx.baseLevelId, typeId, points: [p(0, 0), p(120, 0)] });
    if (!drawn.ok) throw new Error(drawn.error);
    expect(hipOnLevel(ctx.history.doc, ctx.baseLevelId).ok).toBe(false);
  });

  it('hips all four sides, with the ridge along the long direction', () => {
    const ctx = room();
    const built = hipOnLevel(ctx.history.doc, ctx.baseLevelId);
    if (!built.ok) throw new Error(built.error);
    expect(built.roof.planes).toHaveLength(4);
    const plate = defaultWallHeight(ctx.history.doc.levels, ctx.history.doc.levelOrder, ctx.baseLevelId);
    expect(built.roof.plateZ).toBeCloseTo(plate, 3);
    const quads = built.roof.planes.filter((plane) => plane.polygon.length === 4);
    const triangles = built.roof.planes.filter((plane) => plane.polygon.length === 3);
    expect(quads).toHaveLength(2);
    expect(triangles).toHaveLength(2);
    expect(quads.every((plane) => Math.abs(plane.up.x) < 0.01)).toBe(true);
    expect(triangles.every((plane) => Math.abs(plane.up.y) < 0.01)).toBe(true);
    for (const plane of built.roof.planes) {
      const onWall = { x: plane.eave.x + plane.up.x * DEFAULT_OVERHANG, y: plane.eave.y + plane.up.y * DEFAULT_OVERHANG };
      expect(roofZ(plane, onWall)).toBeCloseTo(plate, 3);
      expect(roofZ(plane, plane.eave)).toBeLessThan(plate);
    }
    const [a, b] = quads;
    if (!a || !b) throw new Error('missing slopes');
    const runOf = (plane: typeof a, point: { x: number; y: number }) => (point.x - plane.eave.x) * plane.up.x + (point.y - plane.eave.y) * plane.up.y;
    const ridge = [...a.polygon].sort((p, q) => runOf(a, q) - runOf(a, p))[0]!;
    expect(roofZ(a, ridge)).toBeCloseTo(roofZ(b, ridge), 3);
    expect(roofZ(a, ridge) - plate).toBeCloseTo(((runOf(a, ridge) - DEFAULT_OVERHANG) * DEFAULT_PITCH) / 12, 3);
  });

  it('meets in a point over a square', () => {
    const ctx = room(144, 144);
    const built = hipOnLevel(ctx.history.doc, ctx.baseLevelId);
    if (!built.ok) throw new Error(built.error);
    expect(built.roof.planes.every((plane) => plane.polygon.length === 3)).toBe(true);
    const apex = built.roof.planes[0]!.polygon[2]!;
    for (const plane of built.roof.planes) expect(roofZ(plane, apex)).toBeCloseTo(roofZ(built.roof.planes[0]!, apex), 3);
  });

  it('moves the ridge toward the steeper slopes', () => {
    const equal = hipOverRect(outline(200, 80), { x0: 6, x1: 6, y0: 6, y1: 6 }, 12);
    const steepEnds = hipOverRect(outline(200, 80), { x0: 12, x1: 12, y0: 6, y1: 6 }, 12);
    const steepSides = hipOverRect(outline(200, 80), { x0: 3, x1: 3, y0: 12, y1: 12 }, 12);
    if (!equal.ok || !steepEnds.ok || !steepSides.ok) throw new Error('hip failed');
    const ridgeLength = (planes: { polygon: { x: number; y: number }[]; up: { x: number; y: number }; eave: { x: number; y: number } }[]) => {
      const along = planes.find((plane) => plane.polygon.length === 4 && Math.abs(plane.up.x) < 0.01);
      if (!along) return 0;
      const runOf = (point: { x: number; y: number }) => (point.x - along.eave.x) * along.up.x + (point.y - along.eave.y) * along.up.y;
      const [a, b] = [...along.polygon].sort((p, q) => runOf(q) - runOf(p));
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    expect(ridgeLength(steepEnds.roof.planes)).toBeGreaterThan(ridgeLength(equal.roof.planes));
    const sides = steepSides.roof.planes.filter((plane) => Math.abs(plane.up.y) > 0.9);
    expect(sides).toHaveLength(2);
    expect(sides.every((plane) => plane.polygon.length === 3)).toBe(true);
  });

  it('replaces a gable, and undo brings the gable back', () => {
    const ctx = room();
    const gable = ctx.history.dispatch('roof.build', { levelId: ctx.baseLevelId });
    if (!gable.ok) throw new Error(gable.error);
    const hip = ctx.history.dispatch('roof.hip', { levelId: ctx.baseLevelId, pitches: { x0: 8 } });
    if (!hip.ok) throw new Error(hip.error);
    expect(roofsOnLevel(ctx.history.doc, ctx.baseLevelId)).toHaveLength(4);
    expect(roofsOnLevel(ctx.history.doc, ctx.baseLevelId).some((plane) => plane.pitch === 8)).toBe(true);
    ctx.history.undo();
    expect(roofsOnLevel(ctx.history.doc, ctx.baseLevelId)).toHaveLength(2);
    ctx.history.undo();
    expect(roofsOnLevel(ctx.history.doc, ctx.baseLevelId)).toHaveLength(0);
  });

  it('raises the 3D roof above the plates', () => {
    const ctx = room();
    const built = ctx.history.dispatch('roof.hip', { levelId: ctx.baseLevelId });
    if (!built.ok) throw new Error(built.error);
    const plate = defaultWallHeight(ctx.history.doc.levels, ctx.history.doc.levelOrder, ctx.baseLevelId);
    const zs = buildLevelMeshes(ctx.history.doc, ctx.baseLevelId).flatMap((part) => [...part.positions].filter((_, i) => i % 3 === 2));
    expect(Math.max(...zs)).toBeGreaterThan(plate + 20);
  });

  it('covers the rectangle with the lower envelope of the four planes', () => {
    const span = fc.double({ min: 48, max: 360, noNaN: true });
    const pitch = fc.double({ min: 2, max: 16, noNaN: true });
    fc.assert(
      fc.property(span, span, pitch, pitch, pitch, pitch, fc.double({ min: 0, max: 24, noNaN: true }), (spanX, spanY, x0, x1, y0, y1, overhang) => {
        const built = hipOverRect(outline(spanX, spanY), { x0, x1, y0, y1 }, overhang);
        expect(built.ok, built.ok ? '' : built.error).toBe(true);
        if (!built.ok) return;
        expect(built.roof.planes).toHaveLength(4);
        for (let i = 1; i < 4; i++) {
          for (let j = 1; j < 4; j++) {
            const point = { x: (spanX * i) / 4, y: (spanY * j) / 4 };
            const owners = built.roof.planes.filter((plane) => covers(plane.polygon, point));
            expect(owners.length).toBeGreaterThan(0);
            const lowest = Math.min(...built.roof.planes.map((plane) => roofZ(plane, point)));
            const owned = Math.min(...owners.map((plane) => roofZ(plane, point)));
            expect(Math.abs(owned - lowest)).toBeLessThan(0.05);
          }
        }
      }),
      { numRuns: 40 },
    );
  });
});
