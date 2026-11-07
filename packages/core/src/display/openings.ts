import { add, angleOf, dot, normalize, normalizeAngle, perp, scale, sub } from '../geometry/vec2';
import type { Door, Opening, Vec2, WallLayer, WindowOpening } from '../model/schema';
import { openingSpan } from '../openings/openings';
import type { Segment, WallGeometry } from '../walls/joins';
import type { FillId, Prim } from './display-list';

/** An opening's local frame on its wall: `at(s, off)` is `s` along the centerline from node a, `off` to its left. */
export interface OpeningFrame {
  s0: number;
  s1: number;
  half: number;
  /** +1 when the opening's side is the wall's left, −1 for right. */
  sign: number;
  u: Vec2;
  n: Vec2;
  at(s: number, off: number): Vec2;
}

export function openingFrame(geom: Pick<WallGeometry, 'a' | 'b' | 'thickness'>, o: Opening): OpeningFrame {
  const u = normalize(sub(geom.b, geom.a));
  const n = perp(u);
  const [s0, s1] = openingSpan(o);
  return {
    s0,
    s1,
    half: geom.thickness / 2,
    sign: o.side === 'left' ? 1 : -1,
    u,
    n,
    at: (s, off) => add(add(geom.a, scale(u, s)), scale(n, off)),
  };
}

/** Outline of the opening's cut through the wall (for hit testing and box selection). */
export function openingOutline(geom: WallGeometry, o: Opening): Vec2[] {
  const f = openingFrame(geom, o);
  return [f.at(f.s0, -f.half), f.at(f.s1, -f.half), f.at(f.s1, f.half), f.at(f.s0, f.half)];
}

// --- Cutting openings out of the wall drawing -------------------------------------------------

type Interval = [number, number];

/** The parts of the wall axis not covered by any cut. */
function keptIntervals(cuts: Interval[]): Interval[] {
  const sorted = [...cuts].sort((x, y) => x[0] - y[0]);
  const kept: Interval[] = [];
  let from = -Infinity;
  for (const [c0, c1] of sorted) {
    if (c0 > from) kept.push([from, c0]);
    from = Math.max(from, c1);
  }
  kept.push([from, Infinity]);
  return kept;
}

/** Sutherland–Hodgman clip of `poly` to the half-plane `dot(p - origin, dir) >= limit`. */
function clipHalfPlane(poly: Vec2[], origin: Vec2, dir: Vec2, limit: number): Vec2[] {
  const out: Vec2[] = [];
  const value = (p: Vec2) => dot(sub(p, origin), dir) - limit;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const vp = value(p);
    const vq = value(q);
    if (vp >= 0) out.push(p);
    if ((vp >= 0) !== (vq >= 0)) out.push(add(p, scale(sub(q, p), vp / (vp - vq))));
  }
  return out;
}

function clipPolygonToSlab(poly: Vec2[], origin: Vec2, u: Vec2, [lo, hi]: Interval): Vec2[] {
  let out = poly;
  if (Number.isFinite(lo)) out = clipHalfPlane(out, origin, u, lo);
  if (Number.isFinite(hi) && out.length > 0) out = clipHalfPlane(out, origin, scale(u, -1), -hi);
  return out.length >= 3 ? out : [];
}

function clipSegmentToSlab([p, q]: Segment, origin: Vec2, u: Vec2, [lo, hi]: Interval): Segment | null {
  const sp = dot(sub(p, origin), u);
  const sq = dot(sub(q, origin), u);
  if (Math.abs(sq - sp) < 1e-9) return sp >= lo && sp <= hi ? [p, q] : null;
  const at = (s: number) => add(p, scale(sub(q, p), (s - sp) / (sq - sp)));
  const from = Math.max(Math.min(sp, sq), lo);
  const to = Math.min(Math.max(sp, sq), hi);
  if (to - from < 1e-6) return null;
  return sp <= sq ? [at(from), at(to)] : [at(to), at(from)];
}

/** Wall fills, layer lines and faces with each opening's span removed, plus jamb lines at each opening edge. */
export function cutWallPrims(geom: WallGeometry, openings: Opening[], fillOf: (fn: WallLayer['fn']) => FillId): Prim[] {
  const u = normalize(sub(geom.b, geom.a));
  const kept = keptIntervals(openings.map((o) => openingSpan(o)));
  const prims: Prim[] = [];
  for (const layer of geom.layers) {
    for (const slab of kept) {
      const polygon = clipPolygonToSlab(layer.polygon, geom.a, u, slab);
      if (polygon.length > 0) prims.push({ t: 'poly', rings: [polygon], fill: fillOf(layer.fn) });
    }
  }
  for (const [segments, pen] of [
    [geom.layerLines, 'wall.layer'],
    [[geom.leftFace, geom.rightFace], 'wall.face'],
  ] as const) {
    for (const segment of segments) {
      for (const slab of kept) {
        const piece = clipSegmentToSlab(segment, geom.a, u, slab);
        if (piece) prims.push({ t: 'line', a: piece[0], b: piece[1], pen });
      }
    }
  }
  for (const [a, b] of geom.caps) prims.push({ t: 'line', a, b, pen: 'wall.face' });
  for (const o of openings) {
    const f = openingFrame(geom, o);
    for (const s of [f.s0, f.s1]) prims.push({ t: 'line', a: f.at(s, -f.half), b: f.at(s, f.half), pen: 'wall.face' });
  }
  return prims;
}

// --- Symbols ---------------------------------------------------------------------------------

/** A hinged leaf drawn open 90° with its swing arc. */
function swingLeaf(f: OpeningFrame, hingeS: number, latchS: number, sideOff: number, normal: Vec2): Prim[] {
  const hinge = f.at(hingeS, sideOff);
  const width = Math.abs(latchS - hingeS);
  const tip = add(hinge, scale(normal, width));
  const start = angleOf(normal);
  const turn = normalizeAngle(angleOf(sub(f.at(latchS, sideOff), hinge)) - start);
  const sweep = turn > Math.PI ? turn - 2 * Math.PI : turn;
  return [
    { t: 'line', a: hinge, b: tip, pen: 'opening' },
    { t: 'arc', c: hinge, r: width, start, sweep, pen: 'opening.swing' },
  ];
}

function doorPrims(f: OpeningFrame, door: Door): Prim[] {
  const face = f.sign * f.half;
  const out = scale(f.n, f.sign);
  const [hingeS, latchS] = door.hinge === 'start' ? [f.s0, f.s1] : [f.s1, f.s0];
  const inward = Math.sign(latchS - hingeS);
  const width = f.s1 - f.s0;
  const mid = (f.s0 + f.s1) / 2;
  switch (door.style) {
    case 'hinged':
      return swingLeaf(f, hingeS, latchS, face, out);
    case 'double':
      return [...swingLeaf(f, f.s0, mid, face, out), ...swingLeaf(f, f.s1, mid, face, out)];
    case 'pocket': {
      const panel = Math.min(1.5, f.half);
      const shown = width * 0.15;
      return [
        { t: 'line', a: f.at(hingeS - inward * (width - shown), 0), b: f.at(hingeS + inward * shown, 0), pen: 'opening' },
        { t: 'line', a: f.at(hingeS - inward * width, panel / 2), b: f.at(hingeS, panel / 2), pen: 'opening.hidden' },
        { t: 'line', a: f.at(hingeS - inward * width, -panel / 2), b: f.at(hingeS, -panel / 2), pen: 'opening.hidden' },
      ];
    }
    case 'sliding': {
      const gap = Math.min(1, f.half / 2);
      const overlap = Math.min(2, width / 8);
      return [
        { t: 'line', a: f.at(f.s0, gap), b: f.at(mid + overlap, gap), pen: 'opening' },
        { t: 'line', a: f.at(mid - overlap, -gap), b: f.at(f.s1, -gap), pen: 'opening' },
      ];
    }
    case 'bifold': {
      const leaf = width / 4;
      const angle = Math.PI / 6;
      const fold = (s: number, dir: number): Prim[] => {
        const p0 = f.at(s, face);
        const p1 = add(f.at(s + dir * leaf * Math.cos(angle), face), scale(out, leaf * Math.sin(angle)));
        const p2 = f.at(s + dir * 2 * leaf * Math.cos(angle), face);
        return [{ t: 'polyline', pts: [p0, p1, p2], closed: false, pen: 'opening' }];
      };
      return [...fold(f.s0, 1), ...fold(f.s1, -1)];
    }
    case 'garage':
      return [
        { t: 'polyline', pts: [f.at(f.s0, -1), f.at(f.s1, -1), f.at(f.s1, 1), f.at(f.s0, 1)], closed: true, pen: 'opening' },
        { t: 'polyline', pts: [f.at(f.s0, -width / 2), f.at(f.s0, 0), f.at(f.s1, 0), f.at(f.s1, -width / 2)], closed: false, pen: 'opening.hidden' },
      ];
    case 'opening':
      return [];
  }
}

function windowPrims(f: OpeningFrame, win: WindowOpening): Prim[] {
  const glass = Math.min(0.75, f.half / 3);
  const prims: Prim[] = [];
  if (win.style === 'slider') {
    const mid = (f.s0 + f.s1) / 2;
    const overlap = Math.min(2, (f.s1 - f.s0) / 8);
    prims.push(
      { t: 'line', a: f.at(f.s0, glass), b: f.at(mid + overlap, glass), pen: 'opening' },
      { t: 'line', a: f.at(mid - overlap, -glass), b: f.at(f.s1, -glass), pen: 'opening' },
    );
  } else {
    prims.push(
      { t: 'line', a: f.at(f.s0, glass), b: f.at(f.s1, glass), pen: 'opening' },
      { t: 'line', a: f.at(f.s0, -glass), b: f.at(f.s1, -glass), pen: 'opening' },
    );
  }
  // Sill projecting past the exterior face.
  const sill = 1.5;
  const face = f.sign * f.half;
  const outer = f.sign * (f.half + sill);
  prims.push({ t: 'polyline', pts: [f.at(f.s0 - sill, face), f.at(f.s0 - sill, outer), f.at(f.s1 + sill, outer), f.at(f.s1 + sill, face)], closed: false, pen: 'opening' });
  return prims;
}

export function openingPrims(geom: WallGeometry, o: Opening): Prim[] {
  const f = openingFrame(geom, o);
  return o.kind === 'door' ? doorPrims(f, o) : windowPrims(f, o);
}
