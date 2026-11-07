import { describe, expect, it } from 'vitest';
import { computeWallGeometry, defaultWallHeight, frameLevel, headerDepth, jackCount, studCenters } from '../../src';
import { testHistory } from '../helpers';

const p = (x: number, y: number) => ({ x, y });

function wallOf(length: number) {
  const ctx = testHistory();
  const typeId = Object.values(ctx.history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
  const drawn = ctx.history.dispatch('wall.draw', { levelId: ctx.baseLevelId, typeId, points: [p(0, 0), p(length, 0)] });
  if (!drawn.ok) throw new Error(drawn.error);
  const wallId = drawn.value[0]!;
  const framed = () => {
    const doc = ctx.history.doc;
    return frameLevel(doc, ctx.baseLevelId, computeWallGeometry(doc, ctx.baseLevelId)).find((wall) => wall.wallId === wallId);
  };
  return { ...ctx, wallId, framed };
}

describe('wall framing', () => {
  it('sizes a doubled header and its trimmers from the clear width', () => {
    expect(headerDepth(36)).toBe(3.5);
    expect(headerDepth(48)).toBe(5.5);
    expect(headerDepth(72)).toBe(7.25);
    expect(headerDepth(96)).toBe(9.25);
    expect(headerDepth(120)).toBe(11.25);
    expect(jackCount(36)).toBe(1);
    expect(jackCount(96)).toBe(2);
    expect(jackCount(120)).toBe(3);
  });

  it('spaces studs 16 inches on center and keeps one flush at each end', () => {
    const centers = studCenters(96);
    expect(centers[0]).toBeCloseTo(0.75, 3);
    expect(centers[centers.length - 1]).toBeCloseTo(95.25, 3);
    for (let i = 1; i < centers.length - 1; i++) expect(centers[i]! - centers[i - 1]!).toBeCloseTo(16, 3);
    expect(centers[centers.length - 1]! - centers[centers.length - 2]!).toBeLessThan(16);
  });

  it('frames a straight wall with precut studs between three plates', () => {
    const { framed, history, baseLevelId } = wallOf(96);
    const wall = framed();
    if (!wall) throw new Error('missing framing');
    const height = defaultWallHeight(history.doc.levels, history.doc.levelOrder, baseLevelId);
    const studs = wall.members.filter((member) => member.kind === 'stud');
    expect(studs.length).toBe(studCenters(96).length);
    expect(studs[0]!.z1 - studs[0]!.z0).toBeCloseTo(height - 4.5, 3);
    expect(wall.members.filter((member) => member.kind === 'top-plate')).toHaveLength(2);
    expect(wall.members.filter((member) => member.kind === 'bottom-plate')).toHaveLength(1);
    expect(wall.off1 - wall.off0).toBeCloseTo(5.5, 3);
  });

  it('cuts the bottom plate for a door and bears the header on trimmers', () => {
    const ctx = wallOf(96);
    const door = ctx.history.dispatch('opening.place', {
      kind: 'door',
      wallId: ctx.wallId,
      t: 48,
      width: 36,
      height: 80,
      side: 'left',
      hinge: 'start',
      style: 'hinged',
    });
    if (!door.ok) throw new Error(door.error);
    const wall = ctx.framed();
    if (!wall) throw new Error('missing framing');
    const plate = wall.members.filter((member) => member.kind === 'bottom-plate');
    expect(plate.some((member) => member.s0 < 30 && member.s1 > 66)).toBe(false);
    expect(plate.some((member) => member.s1 <= 30.1)).toBe(true);
    expect(plate.some((member) => member.s0 >= 65.9)).toBe(true);
    const header = wall.members.find((member) => member.kind === 'header');
    expect(header?.z0).toBeCloseTo(80, 3);
    expect(header!.z1 - header!.z0).toBeCloseTo(3.5, 3);
    expect(header!.s0).toBeCloseTo(28.5, 3);
    expect(header!.s1).toBeCloseTo(67.5, 3);
    const kings = wall.members.filter((member) => member.kind === 'king');
    expect(kings).toHaveLength(2);
    expect(wall.members.some((member) => member.kind === 'stud' && member.s0 > 30 && member.s1 < 66)).toBe(false);
  });

  it('keeps the bottom plate under a window and adds a sill', () => {
    const ctx = wallOf(96);
    const win = ctx.history.dispatch('opening.place', {
      kind: 'window',
      wallId: ctx.wallId,
      t: 48,
      width: 36,
      height: 48,
      sill: 32,
      side: 'right',
      hinge: 'start',
      style: 'double-hung',
    });
    if (!win.ok) throw new Error(win.error);
    const wall = ctx.framed();
    if (!wall) throw new Error('missing framing');
    const plate = wall.members.find((member) => member.kind === 'bottom-plate');
    expect(plate?.s0).toBeCloseTo(0, 3);
    expect(plate?.s1).toBeCloseTo(96, 3);
    const sill = wall.members.find((member) => member.kind === 'sill');
    expect(sill?.z1).toBeCloseTo(32, 3);
    expect(sill!.z1 - sill!.z0).toBeCloseTo(1.5, 3);
    expect(wall.members.some((member) => member.kind === 'cripple' && member.z1 <= 32)).toBe(true);
  });

  it('drops the butting stud where two walls meet', () => {
    const ctx = testHistory();
    const typeId = Object.values(ctx.history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
    const drawn = ctx.history.dispatch('wall.draw', { levelId: ctx.baseLevelId, typeId, points: [p(0, 0), p(96, 0), p(96, 96)] });
    if (!drawn.ok) throw new Error(drawn.error);
    const framed = frameLevel(ctx.history.doc, ctx.baseLevelId, computeWallGeometry(ctx.history.doc, ctx.baseLevelId));
    const endStuds = framed.flatMap((wall) => wall.members.filter((member) => member.kind === 'stud' && (member.s0 < 2 || member.s1 > 94)));
    const straight = studCenters(96).length * 2;
    const actual = framed.reduce((sum, wall) => sum + wall.members.filter((member) => member.kind === 'stud').length, 0);
    expect(actual).toBeLessThan(straight);
    expect(endStuds.length).toBeGreaterThan(0);
  });
});
