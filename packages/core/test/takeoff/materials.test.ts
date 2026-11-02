import { describe, expect, it } from 'vitest';
import { materialsCsv, materialsList, roomFace, roomsOnLevel } from '../../src';
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

const qty = (lines: { name: string; quantity: number }[], name: string) => lines.find((line) => line.name === name)?.quantity;

describe('materials list', () => {
  it('is empty before there are walls', () => {
    const ctx = testHistory();
    expect(materialsList(ctx.history.doc)).toEqual([]);
  });

  it('counts sheet goods, studs, plates, and the floor of a room', () => {
    const ctx = room();
    const lines = materialsList(ctx.history.doc);
    expect(qty(lines, 'Lap siding')).toBeCloseTo(518, 3);
    expect(qty(lines, 'OSB sheathing 7/16"')).toBeCloseTo(518, 3);
    expect(qty(lines, 'Gypsum board 1/2"')).toBeCloseTo(518, 3);
    const floor = roomsOnLevel(ctx.history.doc, ctx.baseLevelId).reduce((sum, room) => sum + (roomFace(ctx.history.doc, room)?.area ?? 0), 0) / 144;
    expect(qty(lines, 'Finished floor')).toBeCloseTo(floor, 3);
    expect(qty(lines, 'Studs')).toBeGreaterThan(40);
    expect(qty(lines, 'Plates')).toBeCloseTo(192, 0);
    const csv = materialsCsv(lines);
    expect(csv.startsWith('Category,Item,Quantity,Unit\n')).toBe(true);
    expect(csv).toContain('Walls,Lap siding,');
  });

  it('subtracts a door from every sheet layer', () => {
    const ctx = room();
    const wall = Object.values(ctx.history.doc.elements).find((el) => el.kind === 'wall' && el.levelId === ctx.baseLevelId);
    if (wall?.kind !== 'wall') throw new Error('missing wall');
    const placed = ctx.history.dispatch('opening.place', {
      kind: 'door',
      wallId: wall.id,
      t: 120,
      width: 36,
      height: 80,
      side: 'left',
      hinge: 'start',
      style: 'hinged',
    });
    if (!placed.ok) throw new Error(placed.error);
    const lines = materialsList(ctx.history.doc);
    expect(qty(lines, 'Lap siding')).toBeCloseTo(518 - (36 * 80) / 144, 3);
    expect(qty(lines, 'Door 3\'-0" × 6\'-8"')).toBe(1);
  });
});
