import { describe, expect, it } from 'vitest';
import {
  buildPlanDisplayList,
  checkInvariants,
  computeWallGeometry,
  distance,
  localSymbol,
  objectFootprint,
  pickElement,
  repairInvariants,
  starterById,
  STARTER_CATALOG,
  wallsOnLevel,
  type CatalogObject,
  type Vec2,
} from '../../src';
import { testHistory } from '../helpers';

const p = (x: number, y: number): Vec2 => ({ x, y });

function setup() {
  const ctx = testHistory();
  const typeId = Object.values(ctx.history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
  const draw = (points: Vec2[]) => {
    const result = ctx.history.dispatch('wall.draw', { levelId: ctx.baseLevelId, typeId, points });
    if (!result.ok) throw new Error(result.error);
  };
  const place = (sourceId: string, host: { wallId: string; t: number; side: 'left' | 'right' }) => {
    const def = starterById(sourceId)!;
    return ctx.history.dispatch('object.place', { levelId: ctx.baseLevelId, def, hostWallId: host.wallId, hostT: host.t, side: host.side });
  };
  return { ...ctx, draw, place };
}

describe('starter catalog', () => {
  it('every item has a plan symbol built from its own size', () => {
    for (const def of STARTER_CATALOG) {
      const prims = localSymbol(def, def.params);
      expect(prims.length, def.name).toBeGreaterThan(0);
      const width = def.params.width as number;
      const xs = prims.flatMap((prim) => (prim.t === 'polyline' ? prim.pts.map((pt) => pt.x) : []));
      const span = Math.max(...xs) - Math.min(...xs);
      expect(span, def.name).toBeGreaterThan(width * 0.5);
      expect(span, def.name).toBeLessThanOrEqual(width + 0.01);
    }
  });

  it('embeds the definition once and places the object against the wall', () => {
    const s = setup();
    s.draw([p(0, 0), p(240, 0)]);
    const wall = wallsOnLevel(s.history.doc, s.baseLevelId)[0]!;
    const placed = s.place('starter.base-24', { wallId: wall.id, t: 48, side: 'left' });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const object = s.history.doc.elements[placed.value] as CatalogObject;
    expect(s.history.doc.catalogDefs['starter.base-24']?.name).toBe('Base Cabinet 24');
    expect(object).toMatchObject({ hostWallId: wall.id, hostT: 48, side: 'left', z: 0, params: {} });
    // Back against the wall face, center one depth/2 further into the room.
    const half = 7.1875 / 2;
    expect(object.p.x).toBeCloseTo(48);
    expect(object.p.y).toBeCloseTo(half + 12);
    s.place('starter.base-24', { wallId: wall.id, t: 96, side: 'left' });
    expect(Object.keys(s.history.doc.catalogDefs)).toEqual(['starter.base-24']);
    expect(checkInvariants(s.history.doc)).toEqual([]);
  });

  it('follows the wall it is hosted on, and stays put when the wall is deleted', () => {
    const s = setup();
    s.draw([p(0, 0), p(240, 0)]);
    const wall = wallsOnLevel(s.history.doc, s.baseLevelId)[0]!;
    const placed = s.place('starter.fridge-36', { wallId: wall.id, t: 100, side: 'left' });
    if (!placed.ok) throw new Error(placed.error);
    const id = placed.value;
    s.history.dispatch('wall.move', { wallIds: [wall.id], delta: p(10, 20) });
    const moved = s.history.doc.elements[id] as CatalogObject;
    expect(moved.hostT).toBeCloseTo(100);
    expect(moved.p.y).toBeCloseTo(20 + 7.1875 / 2 + 15);
    const where = { ...moved.p };
    s.history.dispatch('elements.delete', { ids: [wall.id] });
    const detached = s.history.doc.elements[id] as CatalogObject;
    expect(detached.hostWallId).toBeUndefined();
    expect(distance(detached.p, where)).toBeLessThan(1e-6);
  });

  it('resizes against the wall and draws into the plan', () => {
    const s = setup();
    s.draw([p(0, 0), p(240, 0)]);
    const wall = wallsOnLevel(s.history.doc, s.baseLevelId)[0]!;
    const placed = s.place('starter.range-30', { wallId: wall.id, t: 60, side: 'left' });
    if (!placed.ok) throw new Error(placed.error);
    expect(s.history.dispatch('object.update', { id: placed.value, params: { width: 36 } }).ok).toBe(true);
    const object = s.history.doc.elements[placed.value] as CatalogObject;
    const footprint = objectFootprint(s.history.doc, object);
    const xs = footprint.map((pt) => pt.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(36);
    const items = buildPlanDisplayList(s.history.doc, s.baseLevelId);
    const symbol = items.find((item) => item.elementId === placed.value)!;
    expect(symbol.layer).toBe('objects');
    expect(symbol.prims.some((prim) => prim.t === 'arc')).toBe(true);
  });

  it('is picked inside its footprint and repaired when its definition is missing', () => {
    const s = setup();
    s.draw([p(0, 0), p(120, 0)]);
    const wall = wallsOnLevel(s.history.doc, s.baseLevelId)[0]!;
    const placed = s.place('starter.toilet', { wallId: wall.id, t: 40, side: 'left' });
    if (!placed.ok) throw new Error(placed.error);
    const object = s.history.doc.elements[placed.value] as CatalogObject;
    const geometry = computeWallGeometry(s.history.doc, s.baseLevelId);
    expect(pickElement(s.history.doc, s.baseLevelId, geometry, object.p, 1)).toEqual({ kind: 'object', id: placed.value });
    const broken = structuredClone(s.history.doc);
    delete broken.catalogDefs['starter.toilet'];
    const { doc, repairs } = repairInvariants(broken);
    expect(repairs).toEqual([`Removed object ${placed.value} with a missing catalog item`]);
    expect(doc.elements[placed.value]).toBeUndefined();
  });
});
