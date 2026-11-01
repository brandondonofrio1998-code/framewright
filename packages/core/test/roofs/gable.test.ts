import { describe, expect, it } from 'vitest';
import { buildLevelMeshes, buildPlanDisplayList, defaultWallHeight, gableOnLevel, roofZ, roofsOnLevel, DEFAULT_OVERHANG, DEFAULT_PITCH } from '../../src';
import { testHistory } from '../helpers';

const p = (x: number, y: number) => ({ x, y });

function room() {
  const ctx = testHistory();
  const typeId = Object.values(ctx.history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
  const drawn = ctx.history.dispatch('wall.draw', {
    levelId: ctx.baseLevelId,
    typeId,
    points: [p(0, 0), p(240, 0), p(240, 144), p(0, 144)],
    closed: true,
  });
  if (!drawn.ok) throw new Error(drawn.error);
  return ctx;
}

describe('gable roofs', () => {
  it('refuses a wall that does not close a rectangle', () => {
    const ctx = testHistory();
    const typeId = Object.values(ctx.history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
    const drawn = ctx.history.dispatch('wall.draw', { levelId: ctx.baseLevelId, typeId, points: [p(0, 0), p(120, 0)] });
    if (!drawn.ok) throw new Error(drawn.error);
    const built = gableOnLevel(ctx.history.doc, ctx.baseLevelId);
    expect(built.ok).toBe(false);
  });

  it('puts two slopes on a rectangle, bearing on the eave walls and rising to a shared ridge', () => {
    const ctx = room();
    const built = gableOnLevel(ctx.history.doc, ctx.baseLevelId);
    if (!built.ok) throw new Error(built.error);
    const [a, b] = built.roof.planes;
    if (!a || !b) throw new Error('missing slopes');
    expect(a.pitch).toBe(DEFAULT_PITCH);
    expect(Math.hypot(a.up.x, a.up.y)).toBeCloseTo(1, 5);
    expect(a.up.x + b.up.x).toBeCloseTo(0, 5);
    expect(a.up.y + b.up.y).toBeCloseTo(0, 5);
    expect(Math.abs(a.up.x)).toBeLessThan(0.01);
    const plate = defaultWallHeight(ctx.history.doc.levels, ctx.history.doc.levelOrder, ctx.baseLevelId);
    expect(built.roof.plateZ).toBeCloseTo(plate, 3);
    const onWall = { x: a.eave.x + a.up.x * DEFAULT_OVERHANG, y: a.eave.y + a.up.y * DEFAULT_OVERHANG };
    expect(roofZ(a, onWall)).toBeCloseTo(plate, 3);
    const runOf = (plane: typeof a, point: { x: number; y: number }) => (point.x - plane.eave.x) * plane.up.x + (point.y - plane.eave.y) * plane.up.y;
    const ridge = [...a.polygon].sort((p, q) => runOf(a, q) - runOf(a, p))[0]!;
    expect(roofZ(a, ridge)).toBeCloseTo(roofZ(b, ridge), 3);
    expect(roofZ(a, ridge) - plate).toBeCloseTo(((runOf(a, ridge) - DEFAULT_OVERHANG) * DEFAULT_PITCH) / 12, 3);
    expect(roofZ(a, a.eave)).toBeLessThan(plate);
  });

  it('replaces an existing roof, and undo takes it away', () => {
    const ctx = room();
    const first = ctx.history.dispatch('roof.build', { levelId: ctx.baseLevelId });
    if (!first.ok) throw new Error(first.error);
    const again = ctx.history.dispatch('roof.build', { levelId: ctx.baseLevelId, pitch: 8 });
    if (!again.ok) throw new Error(again.error);
    expect(roofsOnLevel(ctx.history.doc, ctx.baseLevelId)).toHaveLength(2);
    expect(roofsOnLevel(ctx.history.doc, ctx.baseLevelId)[0]!.pitch).toBe(8);
    ctx.history.undo();
    expect(roofsOnLevel(ctx.history.doc, ctx.baseLevelId)[0]!.pitch).toBe(DEFAULT_PITCH);
    ctx.history.undo();
    expect(roofsOnLevel(ctx.history.doc, ctx.baseLevelId)).toHaveLength(0);
    const lines = buildPlanDisplayList(ctx.history.doc, ctx.baseLevelId).flatMap((item) => item.prims);
    expect(lines.some((prim) => prim.t === 'polyline' && prim.pen === 'roof')).toBe(false);
  });

  it('raises the 3D roof above the plates', () => {
    const ctx = room();
    const built = ctx.history.dispatch('roof.build', { levelId: ctx.baseLevelId });
    if (!built.ok) throw new Error(built.error);
    const plate = defaultWallHeight(ctx.history.doc.levels, ctx.history.doc.levelOrder, ctx.baseLevelId);
    const zs = buildLevelMeshes(ctx.history.doc, ctx.baseLevelId).flatMap((part) => [...part.positions].filter((_, i) => i % 3 === 2));
    expect(Math.max(...zs)).toBeGreaterThan(plate + 30);
    const outlines = buildPlanDisplayList(ctx.history.doc, ctx.baseLevelId).filter((item) => item.prims.some((prim) => prim.t === 'polyline' && prim.pen === 'roof'));
    expect(outlines).toHaveLength(2);
  });
});
