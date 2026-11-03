import { describe, expect, it } from 'vitest';
import { buildLevelMeshes, handrail, landingPolygon, layoutFlight, placedFlights, pointInPolygon, pointInsideMesh, stairCorners, stairsOnLevel, HANDRAIL_HEIGHT, IRC_MAX_RISER, IRC_MIN_TREAD } from '../../src';
import { testHistory } from '../helpers';

const p = (x: number, y: number) => ({ x, y });

function withUpper() {
  const ctx = testHistory();
  const added = ctx.history.dispatch('level.create', { position: 'above', referenceId: ctx.baseLevelId });
  if (!added.ok) throw new Error(added.error);
  return ctx;
}

describe('straight stairs', () => {
  it('refuses a flight with no level above, or a run that is too short', () => {
    const alone = testHistory();
    const missing = alone.history.dispatch('stair.create', { levelId: alone.baseLevelId, start: p(0, 0), end: p(160, 0) });
    expect(missing.ok).toBe(false);

    const ctx = withUpper();
    const lower = ctx.history.doc.levels[ctx.baseLevelId]!;
    const upper = ctx.history.doc.levels[ctx.history.doc.levelOrder[1]!]!;
    const rise = upper.elevation - lower.elevation;
    const planned = layoutFlight(rise, lower.ceilingHeight, 100);
    expect(planned.ok).toBe(false);
    const built = ctx.history.dispatch('stair.create', { levelId: ctx.baseLevelId, start: p(0, 0), end: p(100, 0) });
    expect(built.ok).toBe(false);
  });

  it('uses equal risers at or under 7 3/4 and treads at or over 10', () => {
    const ctx = withUpper();
    const lower = ctx.history.doc.levels[ctx.baseLevelId]!;
    const upper = ctx.history.doc.levels[ctx.history.doc.levelOrder[1]!]!;
    const rise = upper.elevation - lower.elevation;
    const built = ctx.history.dispatch('stair.create', { levelId: ctx.baseLevelId, start: p(0, 0), end: p(144, 0) });
    if (!built.ok) throw new Error(built.error);
    const stair = stairsOnLevel(ctx.history.doc, ctx.baseLevelId)[0]!;
    expect(stair.risers).toBe(Math.ceil((rise - 1e-6) / IRC_MAX_RISER));
    expect(stair.riser).toBeLessThanOrEqual(IRC_MAX_RISER);
    expect(stair.riser * stair.risers).toBeCloseTo(rise, 6);
    expect(stair.tread).toBeGreaterThanOrEqual(IRC_MIN_TREAD);
    expect(stair.tread * (stair.risers - 1)).toBeCloseTo(144, 6);
    expect(stair.width).toBe(36);
    expect(pointInPolygon(p(72, 0), stairCorners(stair))).toBe(true);
    expect(pointInPolygon(p(72, 30), stairCorners(stair))).toBe(false);
  });

  it('refuses a ceiling too low for headroom and a flight taller than 12 feet 7 inches', () => {
    const low = withUpper();
    const edited = low.history.dispatch('level.update', { id: low.baseLevelId, changes: { ceilingHeight: 84 } });
    if (!edited.ok) throw new Error(edited.error);
    expect(low.history.dispatch('stair.create', { levelId: low.baseLevelId, start: p(0, 0), end: p(200, 0) }).ok).toBe(false);

    const tall = withUpper();
    const raised = tall.history.dispatch('level.update', { id: tall.baseLevelId, changes: { ceilingHeight: 160 } });
    if (!raised.ok) throw new Error(raised.error);
    expect(tall.history.dispatch('stair.create', { levelId: tall.baseLevelId, start: p(0, 0), end: p(400, 0) }).ok).toBe(false);
  });

  it('builds the steps up to the upper floor, and deleting that level removes the stair', () => {
    const ctx = withUpper();
    const upperId = ctx.history.doc.levelOrder[1]!;
    const built = ctx.history.dispatch('stair.create', { levelId: ctx.baseLevelId, start: p(0, 0), end: p(144, 0) });
    if (!built.ok) throw new Error(built.error);
    const stair = stairsOnLevel(ctx.history.doc, ctx.baseLevelId)[0]!;
    const elevation = ctx.history.doc.levels[ctx.baseLevelId]!.elevation;
    const zs = buildLevelMeshes(ctx.history.doc, ctx.baseLevelId)
      .filter((part) => part.elementId === stair.id)
      .flatMap((part) => [...part.positions].filter((_, i) => i % 3 === 2));
    const top = elevation + stair.risers * stair.riser;
    const stepZs = zs.filter((z) => z <= top + 1);
    expect(Math.max(...stepZs)).toBeCloseTo(top, 3);
    expect(Math.min(...zs)).toBeCloseTo(elevation, 3);
    expect(Math.max(...zs)).toBeGreaterThan(top + 30);
    ctx.history.dispatch('level.delete', { id: upperId });
    expect(stairsOnLevel(ctx.history.doc, ctx.baseLevelId)).toHaveLength(0);
  });

  it('opens the ceiling below and the floor above to the stair footprint', () => {
    const ctx = withUpper();
    const upperId = ctx.history.doc.levelOrder[1]!;
    const typeId = Object.values(ctx.history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
    for (const levelId of [ctx.baseLevelId, upperId]) {
      const drawn = ctx.history.dispatch('wall.draw', {
        levelId,
        typeId,
        points: [p(0, 0), p(240, 0), p(240, 144), p(0, 144)],
        closed: true,
      });
      if (!drawn.ok) throw new Error(drawn.error);
    }
    const built = ctx.history.dispatch('stair.create', { levelId: ctx.baseLevelId, start: p(60, 72), end: p(220, 72) });
    if (!built.ok) throw new Error(built.error);
    const lower = ctx.history.doc.levels[ctx.baseLevelId]!;
    const upper = ctx.history.doc.levels[upperId]!;
    const ceiling = buildLevelMeshes(ctx.history.doc, ctx.baseLevelId).filter((part) => part.role === 'ceiling');
    const floor = buildLevelMeshes(ctx.history.doc, upperId).filter((part) => part.role === 'floor');
    const inWell = [140, 72] as const;
    const beside = [30, 30] as const;
    expect(pointInsideMesh(ceiling, [inWell[0], inWell[1], lower.elevation + lower.ceilingHeight - 0.1])).toBe(false);
    expect(pointInsideMesh(ceiling, [beside[0], beside[1], lower.elevation + lower.ceilingHeight - 0.1])).toBe(true);
    expect(pointInsideMesh(floor, [inWell[0], inWell[1], upper.elevation - 0.3])).toBe(false);
    expect(pointInsideMesh(floor, [beside[0], beside[1], upper.elevation - 0.3])).toBe(true);
  });

  it('puts one handrail 36 inches above the nosings, on the left', () => {
    const flight = { start: p(0, 0), dir: { x: 1, y: 0 }, run: 140, width: 36, risers: 15, riser: 7 };
    const rail = handrail(flight, 10);
    if (!rail) throw new Error('missing rail');
    expect(rail.a.z).toBeCloseTo(10 + 7 + HANDRAIL_HEIGHT, 5);
    expect(rail.b.z).toBeCloseTo(10 + 15 * 7 + HANDRAIL_HEIGHT, 5);
    expect(rail.a.y).toBeCloseTo(18 - 0.75, 5);
    expect(rail.b.x).toBeCloseTo(140, 5);
    expect(handrail({ ...flight, risers: 3 }, 0)).toBeNull();
  });

  it('builds an L stair with a square landing and two flights', () => {
    const ctx = withUpper();
    const lower = ctx.history.doc.levels[ctx.baseLevelId]!;
    const upper = ctx.history.doc.levels[ctx.history.doc.levelOrder[1]!]!;
    const built = ctx.history.dispatch('stair.create', {
      levelId: ctx.baseLevelId,
      start: p(0, 0),
      corner: p(120, 0),
      end: p(120, 100),
    });
    if (!built.ok) throw new Error(built.error);
    const stair = stairsOnLevel(ctx.history.doc, ctx.baseLevelId)[0]!;
    expect(stair.landing).toBeDefined();
    expect(stair.dir.x).toBeCloseTo(1, 5);
    expect(stair.landing!.dir.y).toBeCloseTo(1, 5);
    expect(stair.riser * (stair.risers + stair.landing!.risers)).toBeCloseTo(upper.elevation - lower.elevation, 5);
    expect(stair.tread).toBeGreaterThanOrEqual(IRC_MIN_TREAD);
    expect(stair.landing!.tread).toBeGreaterThanOrEqual(IRC_MIN_TREAD);
    const landing = landingPolygon(stair);
    if (!landing) throw new Error('missing landing');
    expect(Math.hypot(landing[1]!.x - landing[0]!.x, landing[1]!.y - landing[0]!.y)).toBeCloseTo(36, 3);
    const flights = placedFlights(stair);
    expect(flights).toHaveLength(2);
    expect(flights[1]!.rise0).toBeCloseTo(stair.risers * stair.riser, 5);
    expect(pointInPolygon(p(120, 0), landing)).toBe(true);
  });

  it('builds a U stair that returns beside the first flight', () => {
    const ctx = withUpper();
    const upperId = ctx.history.doc.levelOrder[1]!;
    const typeId = Object.values(ctx.history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
    for (const levelId of [ctx.baseLevelId, upperId]) {
      const drawn = ctx.history.dispatch('wall.draw', {
        levelId,
        typeId,
        points: [p(0, 0), p(240, 0), p(240, 144), p(0, 144)],
        closed: true,
      });
      if (!drawn.ok) throw new Error(drawn.error);
    }
    const lower = ctx.history.doc.levels[ctx.baseLevelId]!;
    const upper = ctx.history.doc.levels[upperId]!;
    const built = ctx.history.dispatch('stair.create', {
      levelId: ctx.baseLevelId,
      start: p(20, 40),
      corner: p(160, 40),
      end: p(40, 44),
    });
    if (!built.ok) throw new Error(built.error);
    const stair = stairsOnLevel(ctx.history.doc, ctx.baseLevelId)[0]!;
    expect(stair.landing?.side).toBe(1);
    expect(stair.landing!.dir.x).toBeCloseTo(-1, 5);
    expect(stair.riser * (stair.risers + stair.landing!.risers)).toBeCloseTo(upper.elevation - lower.elevation, 5);
    const landing = landingPolygon(stair);
    if (!landing) throw new Error('missing landing');
    const along = Math.hypot(landing[1]!.x - landing[0]!.x, landing[1]!.y - landing[0]!.y);
    const across = Math.hypot(landing[2]!.x - landing[1]!.x, landing[2]!.y - landing[1]!.y);
    expect(along).toBeCloseTo(36, 3);
    expect(across).toBeCloseTo(72, 3);
    const flights = placedFlights(stair);
    expect(flights[1]!.dir.x).toBeCloseTo(-1, 5);
    expect(flights[1]!.start.y).toBeCloseTo(76, 3);
    const floor = buildLevelMeshes(ctx.history.doc, upperId).filter((part) => part.role === 'floor');
    expect(pointInsideMesh(floor, [120, 76, upper.elevation - 0.3])).toBe(false);
    expect(pointInsideMesh(floor, [200, 100, upper.elevation - 0.3])).toBe(true);
    const diagonal = ctx.history.dispatch('stair.create', {
      levelId: ctx.baseLevelId,
      start: p(20, 100),
      corner: p(160, 100),
      end: p(90, 160),
    });
    expect(diagonal.ok).toBe(false);
  });
});
