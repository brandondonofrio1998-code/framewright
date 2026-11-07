import { describe, expect, it } from 'vitest';
import { defaultWallHeight, pointInPolygon, roofZ, roofsOnLevel } from '../../src';
import { testHistory } from '../helpers';

const p = (x: number, y: number) => ({ x, y });

function closed(points: { x: number; y: number }[]) {
  const ctx = testHistory();
  const typeId = Object.values(ctx.history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
  const drawn = ctx.history.dispatch('wall.draw', { levelId: ctx.baseLevelId, typeId, points, closed: true });
  if (!drawn.ok) throw new Error(drawn.error);
  return ctx;
}

function wallOn(doc: ReturnType<typeof closed>['history']['doc'], ax: number, ay: number, bx: number, by: number): string {
  const wall = Object.values(doc.elements).find((el) => {
    if (el.kind !== 'wall') return false;
    const a = doc.elements[el.a];
    const b = doc.elements[el.b];
    if (a?.kind !== 'wallNode' || b?.kind !== 'wallNode') return false;
    const near = (u: { x: number; y: number }, x: number, y: number) => Math.abs(u.x - x) < 1 && Math.abs(u.y - y) < 1;
    return (near(a.p, ax, ay) && near(b.p, bx, by)) || (near(a.p, bx, by) && near(b.p, ax, ay));
  });
  if (wall?.kind !== 'wall') throw new Error('missing wall');
  return wall.id;
}

function heightAt(doc: ReturnType<typeof closed>['history']['doc'], levelId: string, point: { x: number; y: number }): number {
  const hits = roofsOnLevel(doc, levelId).filter((plane) => pointInPolygon(point, plane.polygon));
  if (hits.length === 0) throw new Error(`no roof over ${point.x},${point.y}`);
  return Math.min(...hits.map((plane) => roofZ(plane, point)));
}

describe('roof choices on each wall', () => {
  it('gives one eave a steeper pitch than the others', () => {
    const ctx = closed([p(0, 0), p(240, 0), p(240, 144), p(0, 144)]);
    const south = wallOn(ctx.history.doc, 0, 0, 240, 0);
    const set = ctx.history.dispatch('wall.update', { wallIds: [south], changes: { roofPitch: 12 } });
    if (!set.ok) throw new Error(set.error);
    const built = ctx.history.dispatch('roof.build', { levelId: ctx.baseLevelId });
    if (!built.ok) throw new Error(built.error);
    const plate = defaultWallHeight(ctx.history.doc.levels, ctx.history.doc.levelOrder, ctx.baseLevelId);
    const half = 3.59375;
    const southRise = heightAt(ctx.history.doc, ctx.baseLevelId, { x: 120, y: -half + 18 }) - plate;
    const northRise = heightAt(ctx.history.doc, ctx.baseLevelId, { x: 120, y: 144 + half - 18 }) - plate;
    expect(southRise).toBeGreaterThan(16);
    expect(southRise).toBeLessThan(22);
    expect(northRise).toBeGreaterThan(7);
    expect(northRise).toBeLessThan(12);
  });

  it('runs the roof into a gable end on a wing', () => {
    const ctx = closed([p(0, 0), p(240, 0), p(240, 96), p(96, 96), p(96, 192), p(0, 192)]);
    const end = wallOn(ctx.history.doc, 0, 192, 96, 192);
    const set = ctx.history.dispatch('wall.update', { wallIds: [end], changes: { gableEnd: true } });
    if (!set.ok) throw new Error(set.error);
    const built = ctx.history.dispatch('roof.build', { levelId: ctx.baseLevelId });
    if (!built.ok) throw new Error(built.error);
    const planes = roofsOnLevel(ctx.history.doc, ctx.baseLevelId);
    expect(planes.every((plane) => !plane.generatedFrom.includes(end))).toBe(true);
    expect(planes.some((plane) => pointInPolygon({ x: 40, y: 140 }, plane.polygon))).toBe(true);
    expect(planes.some((plane) => pointInPolygon({ x: 180, y: 150 }, plane.polygon))).toBe(false);
  });
});
