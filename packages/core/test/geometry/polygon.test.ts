import { describe, expect, it } from 'vitest';
import { polygonArea, triangulate, type Vec2 } from '../../src';

const p = (x: number, y: number): Vec2 => ({ x, y });

function triangleArea(poly: Vec2[], tris: number[]): number {
  let area = 0;
  for (let i = 0; i < tris.length; i += 3) {
    area += polygonArea([poly[tris[i]!]!, poly[tris[i + 1]!]!, poly[tris[i + 2]!]!]);
  }
  return area;
}

describe('triangulate', () => {
  it('covers a rectangle and a concave L, and keeps a clockwise ring counter-clockwise', () => {
    const rect = [p(0, 0), p(4, 0), p(4, 2), p(0, 2)];
    const rectTris = triangulate(rect);
    expect(rectTris).toHaveLength(6);
    expect(triangleArea(rect, rectTris)).toBeCloseTo(8, 6);

    const l = [p(0, 0), p(2, 0), p(2, 1), p(1, 1), p(1, 2), p(0, 2)];
    const lTris = triangulate(l);
    expect(lTris).toHaveLength(12);
    expect(triangleArea(l, lTris)).toBeCloseTo(3, 6);

    const cw = [p(0, 0), p(0, 2), p(4, 2), p(4, 0)];
    expect(triangleArea(cw, triangulate(cw))).toBeCloseTo(8, 6);
  });
});
