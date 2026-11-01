import { describe, expect, it } from 'vitest';
import { buildLevelMeshes, layoutFlight, pointInPolygon, stairCorners, stairsOnLevel, IRC_MAX_RISER, IRC_MIN_TREAD } from '../../src';
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
    expect(Math.max(...zs)).toBeCloseTo(elevation + stair.risers * stair.riser, 3);
    expect(Math.min(...zs)).toBeCloseTo(elevation, 3);
    ctx.history.dispatch('level.delete', { id: upperId });
    expect(stairsOnLevel(ctx.history.doc, ctx.baseLevelId)).toHaveLength(0);
  });
});
