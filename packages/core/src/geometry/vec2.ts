import type { Vec2 } from '../model/schema';

/** Points closer than this (inches) are the same point in the wall graph. */
export const POINT_EPS = 1e-3;
/** Directions within this many radians are parallel. */
export const ANGLE_EPS = 1e-6;

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const midpoint = (a: Vec2, b: Vec2): Vec2 => lerp(a, b, 0.5);
/** Rotates 90° counter-clockwise: the left normal of a direction. */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
export const samePoint = (a: Vec2, b: Vec2, eps = POINT_EPS): boolean => distance(a, b) <= eps;
export const angleOf = (a: Vec2): number => Math.atan2(a.y, a.x);
export const fromAngle = (radians: number, len = 1): Vec2 => ({ x: Math.cos(radians) * len, y: Math.sin(radians) * len });

export function normalize(a: Vec2): Vec2 {
  const len = length(a);
  return len === 0 ? { x: 0, y: 0 } : { x: a.x / len, y: a.y / len };
}

/** Normalizes an angle to [0, 2π). */
export function normalizeAngle(radians: number): number {
  const full = Math.PI * 2;
  const r = radians % full;
  return r < 0 ? r + full : r;
}

/** Intersection of the infinite lines p + s·d and q + t·e, or null when parallel. */
export function lineIntersection(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const denom = cross(d, e);
  if (Math.abs(denom) <= ANGLE_EPS * length(d) * length(e)) return null;
  const s = cross(sub(q, p), e) / denom;
  return add(p, scale(d, s));
}

export interface SegmentHit {
  point: Vec2;
  /** Parameter along the first segment, 0..1. */
  t: number;
  /** Parameter along the second segment, 0..1. */
  u: number;
}

/** Where segment ab crosses segment cd (endpoints included), or null if they don't meet or are parallel. */
export function segmentIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): SegmentHit | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const denom = cross(r, s);
  if (Math.abs(denom) <= ANGLE_EPS * length(r) * length(s)) return null;
  const ac = sub(c, a);
  const t = cross(ac, s) / denom;
  const u = cross(ac, r) / denom;
  const tolT = POINT_EPS / length(r);
  const tolU = POINT_EPS / length(s);
  if (t < -tolT || t > 1 + tolT || u < -tolU || u > 1 + tolU) return null;
  return { point: add(a, scale(r, t)), t: Math.min(1, Math.max(0, t)), u: Math.min(1, Math.max(0, u)) };
}

export interface Projection {
  point: Vec2;
  /** Parameter along the segment, clamped to 0..1. */
  t: number;
  distance: number;
}

export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): Projection {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), ab) / len2));
  const point = add(a, scale(ab, t));
  return { point, t, distance: distance(p, point) };
}

/** Closest point to p on the infinite line through `origin` with direction `dir`. */
export function projectOnLine(p: Vec2, origin: Vec2, dir: Vec2): Vec2 {
  const len2 = dot(dir, dir);
  if (len2 === 0) return origin;
  return add(origin, scale(dir, dot(sub(p, origin), dir) / len2));
}

/** Signed area; positive when counter-clockwise. */
export function polygonArea(points: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += cross(a, b);
  }
  return sum / 2;
}

export function pointInPolygon(p: Vec2, points: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(points: Iterable<Vec2>): Bounds | null {
  let b: Bounds | null = null;
  for (const p of points) {
    if (!b) b = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
    else {
      b.minX = Math.min(b.minX, p.x);
      b.minY = Math.min(b.minY, p.y);
      b.maxX = Math.max(b.maxX, p.x);
      b.maxY = Math.max(b.maxY, p.y);
    }
  }
  return b;
}
