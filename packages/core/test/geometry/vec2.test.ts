import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  distance,
  lineIntersection,
  normalizeAngle,
  pointInPolygon,
  polygonArea,
  projectOnSegment,
  segmentIntersection,
  vec,
} from '../../src';

const coord = fc.double({ min: -1e4, max: 1e4, noNaN: true });
const point = fc.record({ x: coord, y: coord });

describe('vec2', () => {
  it('intersects lines and reports parallels', () => {
    expect(lineIntersection(vec(0, 0), vec(1, 0), vec(5, -3), vec(0, 1))).toEqual(vec(5, 0));
    expect(lineIntersection(vec(0, 0), vec(1, 1), vec(0, 1), vec(2, 2))).toBeNull();
  });

  it('intersects segments only within their extents, endpoints included', () => {
    expect(segmentIntersection(vec(0, 0), vec(10, 0), vec(5, -5), vec(5, 5))).toMatchObject({ point: vec(5, 0), t: 0.5, u: 0.5 });
    expect(segmentIntersection(vec(0, 0), vec(10, 0), vec(10, 0), vec(10, 5))?.point).toEqual(vec(10, 0));
    expect(segmentIntersection(vec(0, 0), vec(10, 0), vec(11, -5), vec(11, 5))).toBeNull();
  });

  it('projects onto segments with clamping', () => {
    expect(projectOnSegment(vec(5, 3), vec(0, 0), vec(10, 0))).toEqual({ point: vec(5, 0), t: 0.5, distance: 3 });
    expect(projectOnSegment(vec(-4, 3), vec(0, 0), vec(10, 0))).toEqual({ point: vec(0, 0), t: 0, distance: 5 });
  });

  it('computes signed polygon area and containment', () => {
    const square = [vec(0, 0), vec(10, 0), vec(10, 10), vec(0, 10)];
    expect(polygonArea(square)).toBe(100);
    expect(polygonArea([...square].reverse())).toBe(-100);
    expect(pointInPolygon(vec(5, 5), square)).toBe(true);
    expect(pointInPolygon(vec(15, 5), square)).toBe(false);
  });

  it('normalizes angles into [0, 2π)', () => {
    expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2);
    expect(normalizeAngle(5 * Math.PI)).toBeCloseTo(Math.PI);
  });

  it('property: a segment crossing point lies on both segments', () => {
    fc.assert(
      fc.property(point, point, point, point, (a, b, c, d) => {
        const hit = segmentIntersection(a, b, c, d);
        if (!hit) return;
        expect(projectOnSegment(hit.point, a, b).distance).toBeLessThan(1e-3 + distance(a, b) * 1e-9);
        expect(projectOnSegment(hit.point, c, d).distance).toBeLessThan(1e-3 + distance(c, d) * 1e-9);
      }),
    );
  });
});
