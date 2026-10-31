import { describe, expect, it } from 'vitest';
import {
  buildPlanDisplayList,
  checkInvariants,
  computeWallGeometry,
  elementsInBox,
  guessExteriorSide,
  openingsOnWall,
  pickElement,
  repairInvariants,
  wallsOnLevel,
  type Door,
  type Opening,
  type PlaceOpening,
  type Prim,
  type Vec2,
  type Wall,
  type WindowOpening,
} from '../../src';
import { testHistory } from '../helpers';

const p = (x: number, y: number): Vec2 => ({ x, y });

function setup() {
  const ctx = testHistory();
  const typeId = Object.values(ctx.history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
  const ok = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };
  const draw = (points: Vec2[]) => ok(ctx.history.dispatch('wall.draw', { levelId: ctx.baseLevelId, typeId, points }));
  const place = (wallId: string, t: number, extra: Partial<PlaceOpening> = {}) =>
    ctx.history.dispatch('opening.place', {
      kind: 'door',
      wallId,
      t,
      width: 36,
      height: 80,
      side: 'left',
      hinge: 'start',
      style: 'hinged',
      ...extra,
    } as PlaceOpening);
  const opening = (id: string) => ctx.history.doc.elements[id] as Opening;
  return { ...ctx, typeId, ok, draw, place, opening };
}

describe('placing openings', () => {
  it('places a door centred at t and a window with a sill', () => {
    const s = setup();
    const [wall] = s.draw([p(0, 0), p(240, 0)]);
    const door = s.ok(s.place(wall!, 60));
    const win = s.ok(s.place(wall!, 180, { kind: 'window', style: 'double-hung', sill: 32, height: 48 } as Partial<PlaceOpening>));
    expect(s.opening(door)).toMatchObject({ kind: 'door', wallId: wall, t: 60, width: 36, levelId: s.baseLevelId });
    expect(s.opening(win)).toMatchObject({ kind: 'window', sill: 32, height: 48 });
    expect(checkInvariants(s.history.doc)).toEqual([]);
  });

  it('rejects openings that overhang the wall or overlap another', () => {
    const s = setup();
    const [wall] = s.draw([p(0, 0), p(120, 0)]);
    expect(s.place(wall!, 10)).toMatchObject({ ok: false, error: 'The opening must fit within the wall.' });
    expect(s.place(wall!, 60, { width: 130 })).toMatchObject({ ok: false, error: `The wall is only 10'-0" long.` });
    s.ok(s.place(wall!, 30));
    expect(s.place(wall!, 60)).toMatchObject({ ok: false, error: 'Openings on the same wall cannot overlap.' });
    expect(s.place(wall!, 66).ok).toBe(true); // touching is fine
  });

  it('moves along and onto another wall, keeping fit rules', () => {
    const s = setup();
    const [w1, w2] = s.draw([p(0, 0), p(120, 0), p(120, 120)]);
    const id = s.ok(s.place(w1!, 30));
    s.ok(s.history.dispatch('opening.move', { id, wallId: w2!, t: 60, side: 'right' }));
    expect(s.opening(id)).toMatchObject({ wallId: w2, t: 60, side: 'right' });
    expect(s.history.dispatch('opening.move', { id, wallId: w2!, t: 110 }).ok).toBe(false);
  });

  it('edits size and style, refusing widths that no longer fit', () => {
    const s = setup();
    const [wall] = s.draw([p(0, 0), p(120, 0)]);
    const id = s.ok(s.place(wall!, 30));
    s.ok(s.history.dispatch('opening.update', { ids: [id], changes: { doorStyle: 'pocket', hinge: 'end', height: 84 } }));
    expect(s.opening(id)).toMatchObject({ style: 'pocket', hinge: 'end', height: 84 });
    expect(s.history.dispatch('opening.update', { ids: [id], changes: { width: 72 } }).ok).toBe(false);
  });
});

describe('openings follow wall edits', () => {
  it('moving a wall carries its openings', () => {
    const s = setup();
    const [wall] = s.draw([p(0, 0), p(240, 0)]);
    const id = s.ok(s.place(wall!, 60));
    s.ok(s.history.dispatch('wall.move', { wallIds: [wall!], delta: p(30, 50) }));
    expect(s.opening(id)).toMatchObject({ wallId: wall, t: 60 });
  });

  it('dragging one end keeps openings fixed relative to the other end', () => {
    const s = setup();
    const [wall] = s.draw([p(0, 0), p(240, 0)]);
    const nearB = s.ok(s.place(wall!, 200));
    const nearA = s.ok(s.place(wall!, 40));
    const nodeA = (s.history.doc.elements[wall!] as { a: string }).a;
    s.ok(s.history.dispatch('wallNode.move', { nodeId: nodeA, to: p(-60, 0) }));
    // Node a moved 60" away; both openings stay where they were in the world.
    expect(s.opening(nearB).t).toBeCloseTo(260);
    expect(s.opening(nearA).t).toBeCloseTo(100);
  });

  it('splitting a wall re-hosts openings on the piece under them, and refuses to split through one', () => {
    const s = setup();
    const [wall] = s.draw([p(0, 0), p(240, 0)]);
    const left = s.ok(s.place(wall!, 40));
    const right = s.ok(s.place(wall!, 200));
    expect(s.history.dispatch('wall.split', { wallId: wall!, at: p(45, 0) })).toMatchObject({
      ok: false,
      error: 'A wall cannot be broken through a door or window.',
    });
    s.ok(s.history.dispatch('wall.split', { wallId: wall!, at: p(120, 0) }));
    const pieces = wallsOnLevel(s.history.doc, s.baseLevelId);
    expect(pieces).toHaveLength(2);
    expect(s.opening(left)).toMatchObject({ wallId: wall, t: 40 });
    const other = pieces.find((w) => w.id !== wall)!;
    expect(s.opening(right).wallId).toBe(other.id);
    expect(s.opening(right).t).toBeCloseTo(80);
    expect(checkInvariants(s.history.doc)).toEqual([]);
  });

  it('a T-junction drawn onto a wall keeps the opening on the correct piece', () => {
    const s = setup();
    const [wall] = s.draw([p(0, 0), p(240, 0)]);
    const id = s.ok(s.place(wall!, 200));
    s.draw([p(120, 0), p(120, 120)]);
    const host = s.history.doc.elements[s.opening(id).wallId]!;
    expect(host.kind).toBe('wall');
    expect(s.opening(id).t).toBeCloseTo(80);
  });

  it('shortening a wall slides openings inward and removes ones that no longer fit; deleting the wall removes them', () => {
    const s = setup();
    const [wall] = s.draw([p(0, 0), p(240, 0)]);
    const door = s.ok(s.place(wall!, 200));
    s.ok(s.history.dispatch('wall.setLength', { wallId: wall!, length: 150 }));
    expect(s.opening(door).t).toBeCloseTo(150 - 18);
    s.ok(s.history.dispatch('wall.setLength', { wallId: wall!, length: 30 }));
    expect(s.history.doc.elements[door]).toBeUndefined();
    s.history.undo();
    s.history.undo();
    expect(s.opening(door).t).toBe(200);
    s.ok(s.history.dispatch('elements.delete', { ids: [wall!] }));
    expect(s.history.doc.elements[door]).toBeUndefined();
  });
});

describe('opening drawing and picking', () => {
  const lines = (prims: Prim[]) => prims.filter((x): x is Extract<Prim, { t: 'line' }> => x.t === 'line');

  it('cuts the wall at the opening, adds jambs, and draws a hinged door leaf with a 90° swing', () => {
    const s = setup();
    const [wall] = s.draw([p(0, 0), p(240, 0)]);
    const id = s.ok(s.place(wall!, 60));
    const items = buildPlanDisplayList(s.history.doc, s.baseLevelId);
    const wallItem = items.find((i) => i.elementId === wall)!;
    // Each face line splits into a piece before and after the door.
    const faces = lines(wallItem.prims).filter((l) => l.pen === 'wall.face' && Math.abs(l.a.y - l.b.y) < 1e-9);
    expect(faces).toHaveLength(4);
    for (const face of faces) {
      const xs = [face.a.x, face.b.x].sort((x, y) => x - y);
      expect(xs[1]! <= 42 + 1e-6 || xs[0]! >= 78 - 1e-6).toBe(true);
    }
    // No fill crosses the opening.
    for (const prim of wallItem.prims) {
      if (prim.t !== 'poly') continue;
      const xs = prim.rings[0]!.map((q) => q.x);
      expect(Math.max(...xs) <= 42 + 1e-6 || Math.min(...xs) >= 78 - 1e-6).toBe(true);
    }
    const doorItem = items.find((i) => i.elementId === id)!;
    expect(doorItem.layer).toBe('openings');
    const arc = doorItem.prims.find((x) => x.t === 'arc') as Extract<Prim, { t: 'arc' }>;
    expect(arc.r).toBeCloseTo(36);
    expect(Math.abs(arc.sweep)).toBeCloseTo(Math.PI / 2);
    // Hinge at the start jamb on the left (+y) face; the leaf stands open toward +y.
    const half = computeWallGeometry(s.history.doc, s.baseLevelId).get(wall!)!.thickness / 2;
    expect(arc.c.x).toBeCloseTo(42);
    expect(arc.c.y).toBeCloseTo(half);
    const leaf = lines(doorItem.prims)[0]!;
    expect(leaf.b.y).toBeCloseTo(half + 36);
  });

  it('draws every door and window style without crashing and with something visible (cased openings only jambs)', () => {
    const s = setup();
    const [wall] = s.draw([p(0, 0), p(1200, 0)]);
    const styles: Partial<PlaceOpening>[] = [
      ...(['hinged', 'double', 'pocket', 'sliding', 'bifold'] as Door['style'][]).map((style) => ({ style })),
      ...(['double-hung', 'casement', 'slider', 'awning', 'fixed'] as WindowOpening['style'][]).map(
        (style) => ({ kind: 'window', style, sill: 30 }) as Partial<PlaceOpening>,
      ),
    ];
    const ids = styles.map((extra, i) => s.ok(s.place(wall!, 60 + i * 100, extra)));
    const items = buildPlanDisplayList(s.history.doc, s.baseLevelId);
    for (const id of ids) expect(items.find((i) => i.elementId === id)!.prims.length).toBeGreaterThan(0);
  });

  it('picks openings ahead of their wall and includes them in box selection', () => {
    const s = setup();
    const [wall] = s.draw([p(0, 0), p(240, 0)]);
    const id = s.ok(s.place(wall!, 60));
    const geometry = computeWallGeometry(s.history.doc, s.baseLevelId);
    expect(pickElement(s.history.doc, s.baseLevelId, geometry, p(60, 1), 2)).toEqual({ kind: 'door', id });
    expect(pickElement(s.history.doc, s.baseLevelId, geometry, p(150, 1), 2)).toEqual({ kind: 'wall', id: wall });
    expect(elementsInBox(s.history.doc, s.baseLevelId, geometry, { minX: 30, minY: -10, maxX: 90, maxY: 10 })).toEqual([id]);
  });
});

describe('exterior side guess', () => {
  it('picks the side facing away from the plan, whichever way each wall was drawn', () => {
    const s = setup();
    const [bottom, right, top, left] = s.draw([p(0, 0), p(240, 0), p(240, 144), p(0, 144), p(0, 0)]);
    const side = (id: string) => guessExteriorSide(s.history.doc, s.history.doc.elements[id] as Wall);
    // Drawn counter-clockwise, so the inside is always on the left.
    expect([bottom, right, top, left].map((id) => side(id!))).toEqual(['right', 'right', 'right', 'right']);
    const [reversed] = s.draw([p(240, -100), p(0, -100)]);
    // The middle of the plan is now above this wall, which runs right to left: its outside (−y) is its left.
    expect(side(reversed!)).toBe('left');
  });
});

describe('opening invariants and repair', () => {
  it('flags and repairs openings that lost their wall or overhang it', () => {
    const s = setup();
    const [wall] = s.draw([p(0, 0), p(120, 0)]);
    const keep = s.ok(s.place(wall!, 30));
    const broken = structuredClone(s.history.doc);
    (broken.elements[keep] as Opening).t = 110;
    broken.elements['orphan'] = { ...(broken.elements[keep] as Opening), id: 'orphan', wallId: 'gone' };
    expect(checkInvariants(broken)).toEqual(expect.arrayContaining([expect.stringContaining('extends past'), expect.stringContaining('missing wall')]));
    const { doc, repairs } = repairInvariants(broken);
    expect(repairs).toHaveLength(2);
    expect(doc.elements['orphan']).toBeUndefined();
    expect((doc.elements[keep] as Opening).t).toBeCloseTo(102);
    expect(checkInvariants(doc)).toEqual([]);
    expect(openingsOnWall(doc, wall!)).toHaveLength(1);
  });
});
