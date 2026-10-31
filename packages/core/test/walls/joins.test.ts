import { describe, expect, it } from 'vitest';
import { computeWallGeometry, polygonArea, wallsOnLevel, type PlanDocument, type Vec2, type WallGeometry } from '../../src';
import { testHistory } from '../helpers';

const EXT = 0.75 + 0.4375 + 5.5 + 0.5;
const INT = 0.5 + 3.5 + 0.5;
const p = (x: number, y: number): Vec2 => ({ x, y });

function build(draws: { points: Vec2[]; closed?: boolean; type: 'Exterior 2x6' | 'Interior 2x4' }[]) {
  const { history, baseLevelId } = testHistory();
  for (const d of draws) {
    const typeId = Object.values(history.doc.wallTypes).find((t) => t.name === d.type)!.id;
    const r = history.dispatch('wall.draw', { levelId: baseLevelId, typeId, points: d.points, ...(d.closed && { closed: true }) });
    if (!r.ok) throw new Error(r.error);
  }
  const doc = history.doc;
  return { doc, geometry: computeWallGeometry(doc, baseLevelId), levelId: baseLevelId };
}

/** The geometry of the wall whose centerline runs from a to b (in that direction). */
function wallFrom(doc: PlanDocument, levelId: string, geometry: Map<string, WallGeometry>, a: Vec2, b: Vec2): WallGeometry {
  const near = (u: Vec2, v: Vec2) => Math.hypot(u.x - v.x, u.y - v.y) < 1e-6;
  const wall = wallsOnLevel(doc, levelId).find((w) => {
    const g = geometry.get(w.id)!;
    return near(g.a, a) && near(g.b, b);
  });
  if (!wall) throw new Error(`no wall ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  return geometry.get(wall.id)!;
}

function expectPoint(actual: Vec2 | undefined, expected: Vec2) {
  expect(actual?.x).toBeCloseTo(expected.x, 9);
  expect(actual?.y).toBeCloseTo(expected.y, 9);
}

describe('wall joins', () => {
  const h = EXT / 2;
  const hi = INT / 2;

  it('L corner: faces miter to the outer and inner corners, free ends are capped', () => {
    const { doc, geometry, levelId } = build([{ points: [p(0, 0), p(120, 0), p(120, 96)], type: 'Exterior 2x6' }]);
    const south = wallFrom(doc, levelId, geometry, p(0, 0), p(120, 0));
    expectPoint(south.leftFace[1], p(120 - h, h));
    expectPoint(south.rightFace[1], p(120 + h, -h));
    expect(south.endKinds).toEqual(['free', 'joined']);
    expect(south.caps).toHaveLength(1);
    expectPoint(south.caps[0]![0], p(0, h));
    expectPoint(south.caps[0]![1], p(0, -h));

    const east = wallFrom(doc, levelId, geometry, p(120, 0), p(120, 96));
    expectPoint(east.leftFace[0], p(120 - h, h));
    expectPoint(east.rightFace[0], p(120 + h, -h));

    // Layer boundaries stop on the 45° miter line x + y = 120.
    const siding = south.layers[0]!;
    expect(siding.fn).toBe('finish');
    expectPoint(siding.polygon[2], p(120 - h + 0.75, h - 0.75));
  });

  it('closed room: wall outlines tile the band between outer and inner rectangles exactly', () => {
    const { geometry } = build([{ points: [p(0, 0), p(240, 0), p(240, 144), p(0, 144)], closed: true, type: 'Exterior 2x6' }]);
    const total = [...geometry.values()].reduce((sum, g) => sum + Math.abs(polygonArea(g.footprint)), 0);
    expect(total).toBeCloseTo(2 * EXT * (240 + 144), 6);
    for (const g of geometry.values()) {
      expect(g.caps).toEqual([]);
      const layerArea = g.layers.reduce((sum, l) => sum + Math.abs(polygonArea(l.polygon)), 0);
      expect(layerArea).toBeCloseTo(Math.abs(polygonArea(g.footprint)), 6);
    }
  });

  it('T join: the through wall runs on, the branch butts into its face', () => {
    const { doc, geometry, levelId } = build([
      { points: [p(-60, 0), p(60, 0)], type: 'Interior 2x4' },
      { points: [p(0, 0), p(0, 48)], type: 'Interior 2x4' },
    ]);
    const branch = wallFrom(doc, levelId, geometry, p(0, 0), p(0, 48));
    expect(branch.endKinds[0]).toBe('joined');
    expectPoint(branch.leftFace[0], p(-hi, hi));
    expectPoint(branch.rightFace[0], p(hi, hi));
    for (const [start] of branch.layerLines) expect(start.y).toBeCloseTo(hi, 9);

    const west = wallFrom(doc, levelId, geometry, p(-60, 0), p(0, 0));
    const east = wallFrom(doc, levelId, geometry, p(0, 0), p(60, 0));
    expect(west.endKinds).toEqual(['free', 'through']);
    expectPoint(west.leftFace[1], p(-hi, hi));
    expectPoint(east.leftFace[0], p(hi, hi));
    // The far face and the layer lines continue straight through the junction.
    expectPoint(west.rightFace[1], p(0, -hi));
    expectPoint(east.rightFace[0], p(0, -hi));
    for (const [, end] of west.layerLines) expect(end.x).toBeCloseTo(0, 9);
  });

  it('X join: one pair runs through, the other pair butts into it', () => {
    const { geometry } = build([
      { points: [p(-60, 0), p(60, 0)], type: 'Interior 2x4' },
      { points: [p(0, -60), p(0, 60)], type: 'Interior 2x4' },
    ]);
    const kinds = [...geometry.values()].flatMap((g) => g.endKinds.filter((k) => k !== 'free'));
    expect(kinds.sort()).toEqual(['joined', 'joined', 'through', 'through']);
  });

  it('prefers the thicker collinear pair as the through wall', () => {
    const { doc, geometry, levelId } = build([
      { points: [p(0, -60), p(0, 60)], type: 'Interior 2x4' },
      { points: [p(-60, 0), p(60, 0)], type: 'Exterior 2x6' },
    ]);
    expect(wallFrom(doc, levelId, geometry, p(-60, 0), p(0, 0)).endKinds[1]).toBe('through');
    expect(wallFrom(doc, levelId, geometry, p(0, 0), p(0, 60)).endKinds[0]).toBe('joined');
  });

  it('collinear walls of one type read as a single continuous wall', () => {
    const { doc, geometry, levelId } = build([{ points: [p(0, 0), p(100, 0), p(200, 0)], type: 'Exterior 2x6' }]);
    const first = wallFrom(doc, levelId, geometry, p(0, 0), p(100, 0));
    expectPoint(first.leftFace[1], p(100, h));
    expectPoint(first.rightFace[1], p(100, -h));
    expect(first.caps).toHaveLength(1);
  });

  it('very acute joins are capped square instead of spiking', () => {
    const { doc, geometry, levelId } = build([{ points: [p(100, 0), p(0, 0), p(100, 10)], type: 'Exterior 2x6' }]);
    const flat = wallFrom(doc, levelId, geometry, p(100, 0), p(0, 0));
    expectPoint(flat.leftFace[1], p(0, -h));
    expectPoint(flat.rightFace[1], p(0, h));
    expect(Math.abs(polygonArea(flat.footprint))).toBeCloseTo(100 * EXT, 6);
  });

  it('mixed thicknesses meet without gaps at an L', () => {
    const { doc, geometry, levelId } = build([
      { points: [p(0, 0), p(120, 0)], type: 'Exterior 2x6' },
      { points: [p(120, 0), p(120, 96)], type: 'Interior 2x4' },
    ]);
    const south = wallFrom(doc, levelId, geometry, p(0, 0), p(120, 0));
    const east = wallFrom(doc, levelId, geometry, p(120, 0), p(120, 96));
    expectPoint(south.rightFace[1], p(120 + hi, -h));
    expectPoint(east.rightFace[0], p(120 + hi, -h));
    expectPoint(south.leftFace[1], p(120 - hi, h));
    expectPoint(east.leftFace[0], p(120 - hi, h));
  });
});
