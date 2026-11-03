import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  checkInvariants,
  nodesOnLevel,
  wallEnds,
  wallsAtNode,
  wallsOnLevel,
  type Dimension,
  type PlanDocument,
  type Vec2,
} from '../../src';
import { testHistory } from '../helpers';

function setup() {
  const ctx = testHistory();
  const doc = ctx.history.doc;
  const typeId = (name: string) => Object.values(doc.wallTypes).find((t) => t.name === name)!.id;
  const exterior = typeId('Exterior 2x6');
  const interior = typeId('Interior 2x4');
  const draw = (points: Vec2[], options: { closed?: boolean; type?: string } = {}) => {
    const result = ctx.history.dispatch('wall.draw', {
      levelId: ctx.baseLevelId,
      typeId: options.type ?? exterior,
      points,
      ...(options.closed !== undefined && { closed: options.closed }),
    });
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };
  const walls = () => wallsOnLevel(ctx.history.doc, ctx.baseLevelId);
  const nodes = () => nodesOnLevel(ctx.history.doc, ctx.baseLevelId);
  return { ...ctx, exterior, interior, draw, walls, nodes };
}

const p = (x: number, y: number): Vec2 => ({ x, y });
const ends = (doc: PlanDocument, id: string) => {
  const wall = doc.elements[id];
  if (wall?.kind !== 'wall') throw new Error('not a wall');
  return wallEnds(doc, wall);
};
const degrees = (doc: PlanDocument, levelId: string) =>
  nodesOnLevel(doc, levelId)
    .map((n) => wallsAtNode(doc, n.id).length)
    .sort();

describe('wall graph commands', () => {
  it('draws a closed room as four walls sharing four corner nodes', () => {
    const s = setup();
    const ids = s.draw([p(0, 0), p(240, 0), p(240, 144), p(0, 144)], { closed: true });
    expect(ids).toHaveLength(4);
    expect(s.nodes()).toHaveLength(4);
    expect(degrees(s.history.doc, s.baseLevelId)).toEqual([2, 2, 2, 2]);
    expect(s.history.undoLabel).toBe('Draw Walls');
  });

  it('a wall ending on another wall splits it into a T join', () => {
    const s = setup();
    s.draw([p(0, 0), p(240, 0)]);
    s.draw([p(100, 0), p(100, 96)], { type: s.interior });
    expect(s.walls()).toHaveLength(3);
    expect(degrees(s.history.doc, s.baseLevelId)).toEqual([1, 1, 1, 3]);
    const hub = s.nodes().find((n) => wallsAtNode(s.history.doc, n.id).length === 3)!;
    expect(hub.p).toEqual(p(100, 0));
  });

  it('crossing walls split each other into an X join', () => {
    const s = setup();
    s.draw([p(0, 0), p(200, 0)]);
    s.draw([p(50, -50), p(50, 50)]);
    expect(s.walls()).toHaveLength(4);
    expect(degrees(s.history.doc, s.baseLevelId)).toEqual([1, 1, 1, 1, 4]);
  });

  it('redrawing over an existing wall creates only the missing stretches', () => {
    const s = setup();
    s.draw([p(0, 0), p(100, 0)]);
    const created = s.draw([p(-50, 0), p(150, 0)]);
    expect(created).toHaveLength(2);
    expect(s.walls()).toHaveLength(3);
    expect(s.history.dispatch('wall.draw', { levelId: s.baseLevelId, typeId: s.exterior, points: [p(0, 0), p(100, 0)] })).toMatchObject({
      ok: true,
      changed: false,
    });
  });

  it('starting a wall on the middle of a collinear wall extends it without overlap', () => {
    const s = setup();
    s.draw([p(0, 0), p(100, 0)]);
    s.draw([p(50, 0), p(200, 0)]);
    const lengths = s.walls().map((w) => {
      const [a, b] = ends(s.history.doc, w.id);
      return Math.hypot(b.x - a.x, b.y - a.y);
    });
    expect(lengths.sort((x, y) => x - y)).toEqual([50, 50, 100]);
  });

  it('moving a wall stretches the walls attached to it', () => {
    const s = setup();
    const [south, east] = s.draw([p(0, 0), p(240, 0), p(240, 144), p(0, 144)], { closed: true });
    expect(s.history.dispatch('wall.move', { wallIds: [east!], delta: p(24, 0) }).ok).toBe(true);
    expect(ends(s.history.doc, south!)).toEqual([p(0, 0), p(264, 0)]);
    expect(ends(s.history.doc, east!)).toEqual([p(264, 0), p(264, 144)]);
    expect(s.history.undoLabel).toBe('Move Wall');
  });

  it('dragging a wall end onto another node merges them; onto a wall makes a T', () => {
    const s = setup();
    s.draw([p(0, 0), p(100, 0)]);
    const [loose] = s.draw([p(0, 50), p(100, 50)]);
    const looseWall = s.history.doc.elements[loose!];
    if (looseWall?.kind !== 'wall') throw new Error();
    s.history.dispatch('wallNode.move', { nodeId: looseWall.a, to: p(0, 0) });
    expect(s.nodes()).toHaveLength(3);

    const [stub] = s.draw([p(300, 50), p(300, 80)]);
    const stubWall = s.history.doc.elements[stub!];
    if (stubWall?.kind !== 'wall') throw new Error();
    s.history.dispatch('wallNode.move', { nodeId: stubWall.a, to: p(50, 0) });
    expect(degrees(s.history.doc, s.baseLevelId)).toContain(3);
    expect(checkInvariants(s.history.doc)).toEqual([]);
  });

  it('moving a node onto the far end of its own neighbour removes the collapsed wall', () => {
    const s = setup();
    const [first] = s.draw([p(0, 0), p(100, 0), p(100, 100)]);
    const wall = s.history.doc.elements[first!];
    if (wall?.kind !== 'wall') throw new Error();
    expect(s.history.dispatch('wallNode.move', { nodeId: wall.b, to: p(0, 0) }).ok).toBe(true);
    expect(s.walls()).toHaveLength(1);
    expect(checkInvariants(s.history.doc)).toEqual([]);
  });

  it('sets a wall length by moving the far end along the wall', () => {
    const s = setup();
    const [id] = s.draw([p(0, 0), p(30, 40)]);
    s.history.dispatch('wall.setLength', { wallId: id!, length: 100 });
    const [a, b] = ends(s.history.doc, id!);
    expect(a).toEqual(p(0, 0));
    expect(b.x).toBeCloseTo(60);
    expect(b.y).toBeCloseTo(80);
    expect(s.history.dispatch('wall.setLength', { wallId: id!, length: 0 })).toMatchObject({ ok: false });
  });

  it('splits a wall and rejects splitting at an end', () => {
    const s = setup();
    const [id] = s.draw([p(0, 0), p(100, 0)]);
    expect(s.history.dispatch('wall.split', { wallId: id!, at: p(40, 3) })).toMatchObject({ ok: true });
    expect(s.walls()).toHaveLength(2);
    expect(s.history.dispatch('wall.split', { wallId: id!, at: p(0, 0) })).toMatchObject({ ok: false });
  });

  it('deleting walls removes nodes nothing uses any more', () => {
    const s = setup();
    const ids = s.draw([p(0, 0), p(100, 0), p(100, 100)]);
    s.history.dispatch('elements.delete', { ids: [ids[1]!] });
    expect(s.walls()).toHaveLength(1);
    expect(s.nodes()).toHaveLength(2);
  });

  it('updates wall type and height, rejecting bad values', () => {
    const s = setup();
    const [id] = s.draw([p(0, 0), p(100, 0)]);
    expect(s.history.dispatch('wall.update', { wallIds: [id!], changes: { typeId: s.interior, height: 120 } }).ok).toBe(true);
    expect(s.history.doc.elements[id!]).toMatchObject({ typeId: s.interior, height: 120 });
    expect(s.history.dispatch('wall.update', { wallIds: [id!], changes: { height: -1 } }).ok).toBe(false);
    expect(s.history.dispatch('wall.update', { wallIds: [id!], changes: { typeId: 'nope' } }).ok).toBe(false);
  });

  it('dimensions follow their wall nodes and keep their last point when the node goes', () => {
    const s = setup();
    const [id] = s.draw([p(0, 0), p(100, 0)]);
    const wall = s.history.doc.elements[id!];
    if (wall?.kind !== 'wall') throw new Error();
    const created = s.history.dispatch('dimension.create', {
      levelId: s.baseLevelId,
      a: { p: p(0, 0), nodeId: wall.a },
      b: { p: p(100, 0), nodeId: wall.b },
      offset: 24,
    });
    if (!created.ok) throw new Error(created.error);
    s.history.dispatch('wall.move', { wallIds: [id!], delta: p(0, 10) });
    const dim = () => s.history.doc.elements[created.value] as Dimension;
    expect(dim().a).toEqual({ p: p(0, 10), nodeId: wall.a });
    s.history.dispatch('elements.delete', { ids: [id!] });
    expect(dim().a).toEqual({ p: p(0, 10) });
    expect(checkInvariants(s.history.doc)).toEqual([]);
  });

  it('every command undoes back to the identical document', () => {
    const s = setup();
    const before = s.history.doc;
    const [south] = s.draw([p(0, 0), p(240, 0), p(240, 144), p(0, 144)], { closed: true });
    s.draw([p(120, 0), p(120, 144)], { type: s.interior });
    s.history.dispatch('wall.move', { wallIds: [south!], delta: p(0, -12) });
    while (s.history.undo());
    expect(s.history.doc).toEqual(before);
  });

  it('property: random drawing and editing keeps the graph valid, and undo restores the start', () => {
    const grid = fc.integer({ min: 0, max: 8 }).map((n) => n * 24);
    const pt = fc.record({ x: grid, y: grid });
    const action = fc.oneof(
      fc.record({ kind: fc.constant('draw' as const), a: pt, b: pt }),
      fc.record({ kind: fc.constant('move' as const), pick: fc.nat(), dx: grid, dy: grid }),
      fc.record({ kind: fc.constant('node' as const), pick: fc.nat(), to: pt }),
      fc.record({ kind: fc.constant('delete' as const), pick: fc.nat() }),
      fc.record({ kind: fc.constant('door' as const), pick: fc.nat(), at: fc.double({ min: 0, max: 1, noNaN: true }) }),
    );
    fc.assert(
      fc.property(fc.array(action, { maxLength: 25 }), (actions) => {
        const s = setup();
        const start = s.history.doc;
        for (const act of actions) {
          const walls = s.walls();
          const nodes = s.nodes();
          if (act.kind === 'draw') {
            if (act.a.x !== act.b.x || act.a.y !== act.b.y) {
              s.history.dispatch('wall.draw', { levelId: s.baseLevelId, typeId: s.exterior, points: [act.a, act.b] });
            }
          } else if (act.kind === 'move' && walls.length > 0) {
            s.history.dispatch('wall.move', { wallIds: [walls[act.pick % walls.length]!.id], delta: p(act.dx - 96, act.dy - 96) });
          } else if (act.kind === 'node' && nodes.length > 0) {
            s.history.dispatch('wallNode.move', { nodeId: nodes[act.pick % nodes.length]!.id, to: act.to });
          } else if (act.kind === 'delete' && walls.length > 0) {
            s.history.dispatch('elements.delete', { ids: [walls[act.pick % walls.length]!.id] });
          } else if (act.kind === 'door' && walls.length > 0) {
            const wall = walls[act.pick % walls.length]!;
            const [a, b] = wallEnds(s.history.doc, wall);
            const t = Math.hypot(b.x - a.x, b.y - a.y) * act.at;
            // Rejected placements (too short, overlapping) are fine; they must just leave the doc valid.
            s.history.dispatch('opening.place', { kind: 'door', wallId: wall.id, t, width: 24, height: 80, side: 'left', hinge: 'start', style: 'hinged' });
          }
          expect(checkInvariants(s.history.doc)).toEqual([]);
        }
        while (s.history.undo());
        expect(s.history.doc).toEqual(start);
      }),
      { numRuns: 150 },
    );
  });
});
