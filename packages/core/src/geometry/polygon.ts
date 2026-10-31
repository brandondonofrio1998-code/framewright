import type { Vec2 } from '../model/schema';
import { add, cross, dot, polygonArea, scale, sub } from './vec2';

const EPS = 1e-8;

/**
 * Triangle indices into `poly`, wound counter-clockwise. Handles concave simple polygons
 * (an L-shaped room). Returns an empty list when the polygon is degenerate.
 */
export function triangulate(poly: readonly Vec2[]): number[] {
  const n = poly.length;
  if (n < 3 || Math.abs(polygonArea(poly)) < EPS) return [];
  const flipped = polygonArea(poly) < 0;
  const order = Array.from({ length: n }, (_, i) => (flipped ? n - 1 - i : i));
  const at = (slot: number) => poly[order[slot]!]!;
  const tris: number[] = [];
  let guard = order.length * order.length;
  while (order.length > 3 && guard-- > 0) {
    let ear = -1;
    for (let i = 0; i < order.length; i++) {
      const i0 = (i + order.length - 1) % order.length;
      const i2 = (i + 1) % order.length;
      const a = at(i0);
      const b = at(i);
      const c = at(i2);
      if (cross(sub(b, a), sub(c, b)) <= EPS) continue;
      let contains = false;
      for (let j = 0; j < order.length; j++) {
        if (j === i0 || j === i || j === i2) continue;
        if (pointInTriangle(at(j), a, b, c)) {
          contains = true;
          break;
        }
      }
      if (!contains) {
        ear = i;
        break;
      }
    }
    if (ear < 0) return [];
    const i0 = (ear + order.length - 1) % order.length;
    const i2 = (ear + 1) % order.length;
    tris.push(order[i0]!, order[ear]!, order[i2]!);
    order.splice(ear, 1);
  }
  if (order.length === 3) tris.push(order[0]!, order[1]!, order[2]!);
  return tris.length === (n - 2) * 3 ? tris : [];
}

function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const c0 = cross(sub(b, a), sub(p, a));
  const c1 = cross(sub(c, b), sub(p, b));
  const c2 = cross(sub(a, c), sub(p, c));
  const neg = c0 < -EPS || c1 < -EPS || c2 < -EPS;
  const pos = c0 > EPS || c1 > EPS || c2 > EPS;
  return !(neg && pos);
}

/** Sutherland–Hodgman clip to the slab `lo <= dot(p - origin, axis) <= hi`. `axis` is a unit vector. */
export function clipToSlab(poly: readonly Vec2[], origin: Vec2, axis: Vec2, lo: number, hi: number): Vec2[] {
  let out = poly.slice();
  if (Number.isFinite(lo)) out = clipHalfPlane(out, origin, axis, lo);
  if (Number.isFinite(hi) && out.length > 0) out = clipHalfPlane(out, origin, scale(axis, -1), -hi);
  return out.length >= 3 ? out : [];
}

function clipHalfPlane(poly: readonly Vec2[], origin: Vec2, dir: Vec2, limit: number): Vec2[] {
  const out: Vec2[] = [];
  const value = (p: Vec2) => dot(sub(p, origin), dir) - limit;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const vp = value(p);
    const vq = value(q);
    const pin = vp >= -1e-9;
    const qin = vq >= -1e-9;
    if (pin) out.push(p);
    if (pin !== qin && vp !== vq) out.push(add(p, scale(sub(q, p), vp / (vp - vq))));
  }
  return out;
}
