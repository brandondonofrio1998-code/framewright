import { describe, expect, it } from 'vitest';
import { buildLevelMeshes, buildPlanDisplayList, floorJoists, foundationsOnLevel, materialsList, pointInPolygon, pointInsideMesh, slabOnLevel, studCenters, FLOOR_FINISH, FOOTING_DEPTH, FOOTING_WIDTH, SLAB_THICKNESS, STEM_THICKNESS } from '../../src';
import { testHistory } from '../helpers';

const p = (x: number, y: number) => ({ x, y });

function room(points: { x: number; y: number }[]) {
  const ctx = testHistory();
  const typeId = Object.values(ctx.history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
  const drawn = ctx.history.dispatch('wall.draw', { levelId: ctx.baseLevelId, typeId, points, closed: true });
  if (!drawn.ok) throw new Error(drawn.error);
  return ctx;
}

describe('slab foundations', () => {
  it('refuses a wall that does not close', () => {
    const ctx = testHistory();
    const typeId = Object.values(ctx.history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
    const drawn = ctx.history.dispatch('wall.draw', { levelId: ctx.baseLevelId, typeId, points: [p(0, 0), p(120, 0)] });
    if (!drawn.ok) throw new Error(drawn.error);
    expect(slabOnLevel(ctx.history.doc, ctx.baseLevelId).ok).toBe(false);
  });

  it('puts the slab inside an 8 inch stem wall, on a footing', () => {
    const ctx = room([p(0, 0), p(240, 0), p(240, 144), p(0, 144)]);
    const built = slabOnLevel(ctx.history.doc, ctx.baseLevelId);
    if (!built.ok) throw new Error(built.error);
    expect(built.slabs).toHaveLength(1);
    const slab = built.slabs[0]!;
    expect(slab.polygon).toHaveLength(4);
    expect(slab.footings).toHaveLength(4);
    expect(slab.stems).toHaveLength(4);
    expect(slab.thickness).toBe(SLAB_THICKNESS);
    expect(slab.stemThickness).toBe(STEM_THICKNESS);
    expect(pointInPolygon(p(120, 72), slab.polygon)).toBe(true);
    expect(pointInPolygon(p(-3, -3), slab.polygon)).toBe(false);
    expect(slab.stems.some((stem) => pointInPolygon(p(-3, -3), stem))).toBe(true);
    expect(slab.stems.some((stem) => pointInPolygon(p(-6, -6), stem))).toBe(false);
    expect(slab.footings.some((footing) => pointInPolygon(p(-7, 72), footing))).toBe(true);
  });

  it('follows an L-shaped outline', () => {
    const ctx = room([p(0, 0), p(200, 0), p(200, 80), p(80, 80), p(80, 160), p(0, 160)]);
    const built = ctx.history.dispatch('foundation.build', { levelId: ctx.baseLevelId });
    if (!built.ok) throw new Error(built.error);
    const [foundation] = foundationsOnLevel(ctx.history.doc, ctx.baseLevelId);
    expect(foundation?.polygon).toHaveLength(6);
    expect(foundation?.footings).toHaveLength(6);
    expect(foundation?.stems).toHaveLength(6);
    expect(foundation?.footingWidth).toBe(FOOTING_WIDTH);
    expect(Object.values(ctx.history.doc.materials).some((material) => material.name === 'Concrete')).toBe(true);
  });

  it('replaces an existing foundation, and undo takes it away', () => {
    const ctx = room([p(0, 0), p(240, 0), p(240, 144), p(0, 144)]);
    const first = ctx.history.dispatch('foundation.build', { levelId: ctx.baseLevelId });
    if (!first.ok) throw new Error(first.error);
    const again = ctx.history.dispatch('foundation.build', { levelId: ctx.baseLevelId, thickness: 6 });
    if (!again.ok) throw new Error(again.error);
    expect(foundationsOnLevel(ctx.history.doc, ctx.baseLevelId)[0]?.thickness).toBe(6);
    ctx.history.undo();
    expect(foundationsOnLevel(ctx.history.doc, ctx.baseLevelId)[0]?.thickness).toBe(SLAB_THICKNESS);
    ctx.history.undo();
    expect(foundationsOnLevel(ctx.history.doc, ctx.baseLevelId)).toHaveLength(0);
  });

  it('sits under the floor and continues down through the footing', () => {
    const ctx = room([p(0, 0), p(240, 0), p(240, 144), p(0, 144)]);
    const built = ctx.history.dispatch('foundation.build', { levelId: ctx.baseLevelId });
    if (!built.ok) throw new Error(built.error);
    const elevation = ctx.history.doc.levels[ctx.baseLevelId]!.elevation;
    const id = foundationsOnLevel(ctx.history.doc, ctx.baseLevelId)[0]!.id;
    const zs = buildLevelMeshes(ctx.history.doc, ctx.baseLevelId)
      .filter((part) => part.elementId === id)
      .flatMap((part) => [...part.positions].filter((_, i) => i % 3 === 2));
    expect(Math.max(...zs)).toBeCloseTo(elevation - FLOOR_FINISH, 3);
    expect(Math.min(...zs)).toBeCloseTo(elevation - FLOOR_FINISH - SLAB_THICKNESS - FOOTING_DEPTH, 3);
    const outlines = buildPlanDisplayList(ctx.history.doc, ctx.baseLevelId).filter((item) => item.prims.some((prim) => prim.t === 'polyline' && prim.pen === 'foundation'));
    expect(outlines).toHaveLength(1);
  });

  it('raises the stem above the floor', () => {
    const ctx = room([p(0, 0), p(240, 0), p(240, 144), p(0, 144)]);
    const built = ctx.history.dispatch('foundation.build', { levelId: ctx.baseLevelId });
    if (!built.ok) throw new Error(built.error);
    const foundation = foundationsOnLevel(ctx.history.doc, ctx.baseLevelId)[0]!;
    const raised = ctx.history.dispatch('foundation.setRise', { id: foundation.id, stemRise: 24 });
    if (!raised.ok) throw new Error(raised.error);
    const elevation = ctx.history.doc.levels[ctx.baseLevelId]!.elevation;
    const top = elevation - FLOOR_FINISH;
    const parts = buildLevelMeshes(ctx.history.doc, ctx.baseLevelId).filter((part) => part.elementId === foundation.id);
    const zs = parts.flatMap((part) => [...part.positions].filter((_, i) => i % 3 === 2));
    expect(Math.max(...zs)).toBeCloseTo(top + 24, 3);
    expect(Math.min(...zs)).toBeCloseTo(top - SLAB_THICKNESS - FOOTING_DEPTH, 3);
    expect(pointInsideMesh(parts, [120, -1, top + 12])).toBe(true);
    expect(pointInsideMesh(parts, [120, 40, top + 12])).toBe(false);
    const tooTall = ctx.history.dispatch('foundation.setRise', { id: foundation.id, stemRise: 200 });
    expect(tooTall.ok).toBe(false);
  });

  it('drops the slab to leave a basement under the floor', () => {
    const ctx = room([p(0, 0), p(240, 0), p(240, 144), p(0, 144)]);
    const built = ctx.history.dispatch('foundation.build', { levelId: ctx.baseLevelId });
    if (!built.ok) throw new Error(built.error);
    const foundation = foundationsOnLevel(ctx.history.doc, ctx.baseLevelId)[0]!;
    const opened = ctx.history.dispatch('foundation.setClearance', { id: foundation.id, clearance: 96 });
    if (!opened.ok) throw new Error(opened.error);
    const elevation = ctx.history.doc.levels[ctx.baseLevelId]!.elevation;
    const floorBottom = elevation - FLOOR_FINISH;
    const parts = buildLevelMeshes(ctx.history.doc, ctx.baseLevelId).filter((part) => part.elementId === foundation.id);
    const zs = parts.flatMap((part) => [...part.positions].filter((_, i) => i % 3 === 2));
    expect(Math.max(...zs)).toBeCloseTo(floorBottom, 3);
    expect(Math.min(...zs)).toBeCloseTo(floorBottom - 96 - SLAB_THICKNESS - FOOTING_DEPTH, 3);
    expect(pointInsideMesh(parts, [120, 72, floorBottom - 48])).toBe(false);
    expect(pointInsideMesh(parts, [120, -1, floorBottom - 48])).toBe(true);
    expect(pointInsideMesh(parts, [120, 72, floorBottom - 96 - 1])).toBe(true);
    const short = ctx.history.dispatch('foundation.setClearance', { id: foundation.id, clearance: 4 });
    if (!short.ok) throw new Error(short.error);
    expect(floorJoists(foundationsOnLevel(ctx.history.doc, ctx.baseLevelId)[0]!, floorBottom)).toHaveLength(0);
  });

  it('spans a rectangular basement with 2x10 joists', () => {
    const ctx = room([p(0, 0), p(240, 0), p(240, 144), p(0, 144)]);
    const built = ctx.history.dispatch('foundation.build', { levelId: ctx.baseLevelId });
    if (!built.ok) throw new Error(built.error);
    const foundation = foundationsOnLevel(ctx.history.doc, ctx.baseLevelId)[0]!;
    const opened = ctx.history.dispatch('foundation.setClearance', { id: foundation.id, clearance: 96 });
    if (!opened.ok) throw new Error(opened.error);
    const floorBottom = ctx.history.doc.levels[ctx.baseLevelId]!.elevation - FLOOR_FINISH;
    const current = foundationsOnLevel(ctx.history.doc, ctx.baseLevelId)[0]!;
    const joists = floorJoists(current, floorBottom);
    const xs = current.polygon.map((pt) => pt.x);
    const ys = current.polygon.map((pt) => pt.y);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    const span = Math.min(spanX, spanY);
    const run = Math.max(spanX, spanY);
    expect(joists).toHaveLength(studCenters(run).length);
    expect(joists[0]!.z1 - joists[0]!.z0).toBeCloseTo(9.25, 5);
    expect(joists[0]!.length).toBeCloseTo(span + 16, 3);
    const parts = buildLevelMeshes(ctx.history.doc, ctx.baseLevelId).filter((part) => part.elementId === foundation.id);
    const minX = Math.min(...xs);
    const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
    expect(pointInsideMesh(parts, [minX + 0.4, midY, floorBottom - 2])).toBe(true);
    expect(pointInsideMesh(parts, [minX + 8, midY, floorBottom - 2])).toBe(false);
    const lines = materialsList(ctx.history.doc);
    const row = lines.find((line) => line.name === 'Floor joists');
    expect(row?.quantity).toBeCloseTo((joists.length * joists[0]!.length) / 12, 3);
  });

  it('joists both bays of an L-shaped basement', () => {
    const ctx = room([p(0, 0), p(200, 0), p(200, 80), p(80, 80), p(80, 160), p(0, 160)]);
    const built = ctx.history.dispatch('foundation.build', { levelId: ctx.baseLevelId });
    if (!built.ok) throw new Error(built.error);
    const opened = ctx.history.dispatch('foundation.setClearance', { id: foundationsOnLevel(ctx.history.doc, ctx.baseLevelId)[0]!.id, clearance: 96 });
    if (!opened.ok) throw new Error(opened.error);
    const foundation = foundationsOnLevel(ctx.history.doc, ctx.baseLevelId)[0]!;
    const floorBottom = ctx.history.doc.levels[ctx.baseLevelId]!.elevation - FLOOR_FINISH;
    const joists = floorJoists(foundation, floorBottom);
    const center = (pts: { x: number; y: number }[]) => ({
      x: pts.reduce((sum, pt) => sum + pt.x, 0) / pts.length,
      y: pts.reduce((sum, pt) => sum + pt.y, 0) / pts.length,
    });
    const centers = joists.map((joist) => center(joist.polygon));
    expect(centers.some((c) => c.y < 70)).toBe(true);
    expect(centers.some((c) => c.y > 100 && c.x < 70)).toBe(true);
    expect(centers.some((c) => c.x > 120 && c.y > 100)).toBe(false);
    expect(pointInPolygon(p(150, 120), foundation.polygon)).toBe(false);
  });

  it('rebuilds when a wall moves', () => {
    const ctx = room([p(0, 0), p(240, 0), p(240, 144), p(0, 144)]);
    const built = ctx.history.dispatch('foundation.build', { levelId: ctx.baseLevelId });
    if (!built.ok) throw new Error(built.error);
    const before = JSON.stringify(foundationsOnLevel(ctx.history.doc, ctx.baseLevelId)[0]!.polygon);
    const wallId = built.value[0] ? Object.values(ctx.history.doc.elements).find((el) => el.kind === 'wall')!.id : '';
    const moved = ctx.history.dispatch('wall.move', { wallIds: [wallId], delta: { x: 0, y: 36 } });
    if (!moved.ok) throw new Error(moved.error);
    expect(JSON.stringify(foundationsOnLevel(ctx.history.doc, ctx.baseLevelId)[0]!.polygon)).not.toBe(before);
  });
});
