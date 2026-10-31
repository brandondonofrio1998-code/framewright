import { describe, expect, it } from 'vitest';
import {
  buildPlanDisplayList,
  computeWallGeometry,
  dimensionPrims,
  elementsInBox,
  pickElement,
  readableRotation,
  wallsOnLevel,
  type Prim,
  type Vec2,
} from '../../src';
import { testHistory } from '../helpers';

const p = (x: number, y: number): Vec2 => ({ x, y });

function planWithWallAndDimension() {
  const { history, baseLevelId } = testHistory();
  const typeId = Object.values(history.doc.wallTypes)[0]!.id;
  history.dispatch('wall.draw', { levelId: baseLevelId, typeId, points: [p(0, 0), p(120, 0)] });
  const wall = wallsOnLevel(history.doc, baseLevelId)[0]!;
  const dim = history.dispatch('dimension.create', {
    levelId: baseLevelId,
    a: { p: p(0, 0), nodeId: wall.a },
    b: { p: p(120, 0), nodeId: wall.b },
    offset: 24,
  });
  if (!dim.ok) throw new Error(dim.error);
  return { history, baseLevelId, wallId: wall.id, dimId: dim.value };
}

describe('display list', () => {
  it('keeps dimension text readable at any direction', () => {
    expect(readableRotation(p(-1, 0))).toBeCloseTo(0);
    expect(readableRotation(p(0, -1))).toBeCloseTo(Math.PI / 2);
    expect(readableRotation(p(-1, -1))).toBeCloseTo(Math.PI / 4);
  });

  it('builds an architectural dimension: extension lines, line, ticks, label above', () => {
    const prims = dimensionPrims(p(0, 0), p(120, 0), 24, "10'");
    const lines = prims.filter((x): x is Extract<Prim, { t: 'line' }> => x.t === 'line');
    expect(lines).toHaveLength(5);
    expect(lines).toContainEqual({ t: 'line', a: p(0, 24), b: p(120, 24), pen: 'dimension' });
    const text = prims.find((x) => x.t === 'text');
    expect(text).toMatchObject({ s: "10'", rot: 0, align: 'center', p: { x: 60, y: 28.5 } });
  });

  it('draws each wall as layer fills plus face lines, and dimensions with formatted lengths', () => {
    const { history, baseLevelId, wallId, dimId } = planWithWallAndDimension();
    const items = buildPlanDisplayList(history.doc, baseLevelId);
    const wall = items.find((i) => i.elementId === wallId)!;
    expect(wall.prims.filter((x) => x.t === 'poly')).toHaveLength(4);
    expect(wall.prims.filter((x) => x.t === 'line' && x.pen === 'wall.face')).toHaveLength(4);
    const dim = items.find((i) => i.elementId === dimId)!;
    expect(dim.prims.find((x) => x.t === 'text')).toMatchObject({ s: `10'-0"` });
  });

  it('shows the level below as a reference on upper levels', () => {
    const { history, baseLevelId } = planWithWallAndDimension();
    const upper = history.dispatch('level.create', { position: 'above', referenceId: baseLevelId });
    if (!upper.ok) throw new Error(upper.error);
    const items = buildPlanDisplayList(history.doc, upper.value);
    expect(items.map((i) => i.layer)).toEqual(['reference']);
    expect(buildPlanDisplayList(history.doc, upper.value, { showReference: false })).toEqual([]);
  });
});

describe('picking', () => {
  it('picks dimensions over walls, walls by their outline, and nothing in empty space', () => {
    const { history, baseLevelId, wallId, dimId } = planWithWallAndDimension();
    const geometry = computeWallGeometry(history.doc, baseLevelId);
    expect(pickElement(history.doc, baseLevelId, geometry, p(60, 2), 1)).toEqual({ kind: 'wall', id: wallId });
    expect(pickElement(history.doc, baseLevelId, geometry, p(60, 24.5), 1)).toEqual({ kind: 'dimension', id: dimId });
    expect(pickElement(history.doc, baseLevelId, geometry, p(60, 60), 1)).toBeNull();
  });

  it('box-selects only what is fully inside', () => {
    const { history, baseLevelId, wallId, dimId } = planWithWallAndDimension();
    const geometry = computeWallGeometry(history.doc, baseLevelId);
    expect(elementsInBox(history.doc, baseLevelId, geometry, { minX: -10, minY: -10, maxX: 130, maxY: 10 })).toEqual([wallId]);
    expect(elementsInBox(history.doc, baseLevelId, geometry, { minX: -10, minY: -10, maxX: 130, maxY: 30 }).sort()).toEqual(
      [wallId, dimId].sort(),
    );
  });
});
