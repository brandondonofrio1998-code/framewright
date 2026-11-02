import { describe, expect, it } from 'vitest';
import { roofsOnLevel } from '../../src';
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

function wallAlongY(doc: ReturnType<typeof room>['history']['doc'], y: number): string {
  const wall = Object.values(doc.elements).find((el) => {
    if (el.kind !== 'wall') return false;
    const a = doc.elements[el.a];
    const b = doc.elements[el.b];
    return a?.kind === 'wallNode' && b?.kind === 'wallNode' && Math.abs(a.p.y - y) < 0.1 && Math.abs(b.p.y - y) < 0.1;
  });
  if (wall?.kind !== 'wall') throw new Error('missing wall');
  return wall.id;
}

function minY(doc: ReturnType<typeof room>['history']['doc'], levelId: string): number {
  return Math.min(...roofsOnLevel(doc, levelId).flatMap((plane) => plane.polygon.map((point) => point.y)));
}

describe('roofs follow wall edits', () => {
  it('moves a gable with the wall, and undo puts it back', () => {
    const ctx = room();
    const built = ctx.history.dispatch('roof.build', { levelId: ctx.baseLevelId });
    if (!built.ok) throw new Error(built.error);
    const before = minY(ctx.history.doc, ctx.baseLevelId);
    const moved = ctx.history.dispatch('wall.move', { wallIds: [wallAlongY(ctx.history.doc, 0)], delta: { x: 0, y: -24 } });
    if (!moved.ok) throw new Error(moved.error);
    expect(minY(ctx.history.doc, ctx.baseLevelId)).toBeCloseTo(before - 24, 2);
    expect(roofsOnLevel(ctx.history.doc, ctx.baseLevelId)[0]!.pitch).toBe(6);
    ctx.history.undo();
    expect(minY(ctx.history.doc, ctx.baseLevelId)).toBeCloseTo(before, 2);
  });

  it('moves a hip with the wall', () => {
    const ctx = room();
    const built = ctx.history.dispatch('roof.hip', { levelId: ctx.baseLevelId, pitches: { y0: 9, y1: 4, x0: 6, x1: 6 } });
    if (!built.ok) throw new Error(built.error);
    const before = minY(ctx.history.doc, ctx.baseLevelId);
    const moved = ctx.history.dispatch('wall.move', { wallIds: [wallAlongY(ctx.history.doc, 0)], delta: { x: 0, y: -24 } });
    if (!moved.ok) throw new Error(moved.error);
    expect(minY(ctx.history.doc, ctx.baseLevelId)).toBeCloseTo(before - 24, 2);
    const pitches = roofsOnLevel(ctx.history.doc, ctx.baseLevelId).map((plane) => plane.pitch).sort((a, b) => a - b);
    expect(pitches).toEqual([4, 6, 6, 9]);
  });

  it('raises the fascia when the walls get taller', () => {
    const ctx = room();
    const built = ctx.history.dispatch('roof.build', { levelId: ctx.baseLevelId });
    if (!built.ok) throw new Error(built.error);
    const walls = Object.values(ctx.history.doc.elements).filter((el) => el.kind === 'wall').map((el) => el.id);
    const edited = ctx.history.dispatch('wall.update', { wallIds: walls, changes: { height: 120 } });
    if (!edited.ok) throw new Error(edited.error);
    const eaves = roofsOnLevel(ctx.history.doc, ctx.baseLevelId).map((plane) => plane.eaveZ);
    expect(eaves.every((z) => Math.abs(z - 114) < 0.01)).toBe(true);
  });

  it('leaves the roof where it was when a corner makes the outline not a rectangle', () => {
    const ctx = room();
    const built = ctx.history.dispatch('roof.build', { levelId: ctx.baseLevelId });
    if (!built.ok) throw new Error(built.error);
    const before = minY(ctx.history.doc, ctx.baseLevelId);
    const corner = Object.values(ctx.history.doc.elements).find((el) => el.kind === 'wallNode' && el.p.x === 0 && el.p.y === 0);
    if (corner?.kind !== 'wallNode') throw new Error('missing corner');
    const moved = ctx.history.dispatch('wallNode.move', { nodeId: corner.id, to: { x: 0, y: -30 } });
    if (!moved.ok) throw new Error(moved.error);
    expect(minY(ctx.history.doc, ctx.baseLevelId)).toBeCloseTo(before, 2);
  });
});
