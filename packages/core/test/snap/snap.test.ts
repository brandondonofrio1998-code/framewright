import { describe, expect, it } from 'vitest';
import { buildSnapScene, computeWallGeometry, snapPoint, type SnapOptions, type SnapScene, type Vec2 } from '../../src';
import { testHistory } from '../helpers';

const p = (x: number, y: number): Vec2 => ({ x, y });
const ALL: SnapOptions = { objects: true, angles: true, grid: true, tolerance: 5, gridSpacing: 12 };
const NONE: SnapOptions = { objects: false, angles: false, grid: false, tolerance: 5, gridSpacing: 12 };
const empty: SnapScene = { points: [], segments: [], alignTo: [] };

function oneWallScene(faces = false) {
  const { history, baseLevelId } = testHistory();
  const typeId = Object.values(history.doc.wallTypes)[0]!.id;
  const r = history.dispatch('wall.draw', { levelId: baseLevelId, typeId, points: [p(0, 0), p(120, 0)] });
  if (!r.ok) throw new Error(r.error);
  return buildSnapScene(history.doc, computeWallGeometry(history.doc, baseLevelId), { faces });
}

describe('snap engine', () => {
  it('prefers wall ends, then midpoints, then the wall itself', () => {
    const scene = oneWallScene();
    expect(snapPoint(p(2, 1), scene, ALL)).toMatchObject({ kind: 'node', p: p(0, 0) });
    expect(snapPoint(p(61, 2), scene, ALL)).toMatchObject({ kind: 'midpoint', p: p(60, 0) });
    expect(snapPoint(p(90, 2), scene, ALL)).toMatchObject({ kind: 'onWall', p: p(90, 0) });
  });

  it('offers face corners only when asked (for dimensions)', () => {
    expect(snapPoint(p(119, 4), oneWallScene(false), ALL).kind).not.toBe('corner');
    const withFaces = snapPoint(p(-1, 4), oneWallScene(true), { ...ALL, tolerance: 2 });
    expect(withFaces.kind).toBe('corner');
    expect(withFaces.p.x).toBeCloseTo(0);
  });

  it('snaps to angle steps from the anchor and rounds the length', () => {
    const r = snapPoint(p(50.3, 49.6), empty, { ...NONE, angles: true, anchor: p(0, 0) });
    expect(r.kind).toBe('angle');
    expect(r.angle).toBeCloseTo(Math.PI / 4);
    expect(Math.hypot(r.p.x, r.p.y)).toBeCloseTo(71);
  });

  it('angle × alignment lands exactly on the guide', () => {
    const scene: SnapScene = { points: [], segments: [], alignTo: [p(37, 200)] };
    const r = snapPoint(p(37.3, 36.8), scene, { ...ALL, tolerance: 2, anchor: p(0, 0) });
    expect(r.kind).toBe('alignment');
    expect(r.p.x).toBeCloseTo(37);
    expect(r.p.y).toBeCloseTo(37);
    expect(r.guides).toHaveLength(2);
  });

  it('angle × wall lands exactly on the wall', () => {
    const scene: SnapScene = { points: [], segments: [{ a: p(0, 50), b: p(100, 50), id: 'w' }], alignTo: [] };
    const r = snapPoint(p(50.5, 49.2), scene, { ...ALL, anchor: p(0, 0) });
    expect(r).toMatchObject({ kind: 'onWall', id: 'w' });
    expect(r.p.x).toBeCloseTo(50);
    expect(r.p.y).toBeCloseTo(50);
  });

  it('aligns horizontally and vertically with other points', () => {
    const scene: SnapScene = { points: [], segments: [], alignTo: [p(10, 99), p(99, 20)] };
    expect(snapPoint(p(10.5, 20.4), scene, { ...NONE, objects: true })).toMatchObject({ kind: 'alignment', p: p(10, 20) });
    expect(snapPoint(p(10.5, 60), scene, { ...NONE, objects: true })).toMatchObject({ kind: 'alignment', p: p(10, 60) });
  });

  it('falls back to the grid, then to the raw cursor', () => {
    const scene = oneWallScene();
    expect(snapPoint(p(88, 30), scene, ALL)).toMatchObject({ kind: 'grid', p: p(84, 36) });
    expect(snapPoint(p(2, 1), scene, { ...NONE, grid: true })).toMatchObject({ kind: 'grid', p: p(0, 0) });
    expect(snapPoint(p(2.5, 1.5), scene, NONE)).toMatchObject({ kind: 'free', p: p(2.5, 1.5) });
  });

  it('can exclude the node being dragged', () => {
    const { history, baseLevelId } = testHistory();
    const typeId = Object.values(history.doc.wallTypes)[0]!.id;
    history.dispatch('wall.draw', { levelId: baseLevelId, typeId, points: [p(0, 0), p(120, 0)] });
    const start = Object.values(history.doc.elements).find((e) => e.kind === 'wallNode' && e.p.x === 0)!;
    const scene = buildSnapScene(history.doc, computeWallGeometry(history.doc, baseLevelId), { excludeNodes: new Set([start.id]) });
    expect(snapPoint(p(1, 1), scene, { ...NONE, objects: true }).kind).not.toBe('node');
  });
});
