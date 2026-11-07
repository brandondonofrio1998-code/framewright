import { studCenters } from '../framing/members';
import { pointInPolygon } from '../geometry/vec2';
import type { Foundation, Vec2 } from '../model/schema';

/** Actual size of a 2x10, the joist used under a dropped floor. */
export const JOIST_DEPTH = 9.25;
export const JOIST_WIDTH = 1.5;

export interface FloorJoist {
  /** Plan rectangle. The ends lap the stem by its thickness. */
  polygon: Vec2[];
  z0: number;
  z1: number;
  /** Span including the bearing at each end, inches. */
  length: number;
}

interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface Bearing {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface Bay {
  box: Box;
  bearing: Bearing;
}

/** An axis-aligned rectangle, or null when the outline is not four corners of a box. */
function rectangle(points: readonly Vec2[]): Box | null {
  if (points.length !== 4) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  if (maxX - minX < 1 || maxY - minY < 1) return null;
  for (const p of points) {
    const onX = Math.abs(p.x - minX) <= 1e-3 || Math.abs(p.x - maxX) <= 1e-3;
    const onY = Math.abs(p.y - minY) <= 1e-3 || Math.abs(p.y - maxY) <= 1e-3;
    if (!onX || !onY) return null;
  }
  return { minX, maxX, minY, maxY };
}

function sortedUnique(values: number[]): number[] {
  const out: number[] = [];
  for (const value of [...values].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last === undefined || value - last > 1e-3) out.push(value);
  }
  return out;
}

function orthogonal(points: readonly Vec2[]): boolean {
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    if ((dx > 1e-3 && dy > 1e-3) || (dx <= 1e-3 && dy <= 1e-3)) return false;
  }
  return true;
}

/** Rectangular bays of an orthogonal outline. A shared edge does not lap a stem. */
function baysOf(points: readonly Vec2[], lap: number): Bay[] | null {
  const rect = rectangle(points);
  if (rect) return [{ box: rect, bearing: { minX: lap, maxX: lap, minY: lap, maxY: lap } }];
  if (!orthogonal(points)) return null;
  const xs = sortedUnique(points.map((p) => p.x));
  const ys = sortedUnique(points.map((p) => p.y));
  if (xs.length < 2 || ys.length < 2) return null;
  const inside: { ix: number; iy: number }[] = [];
  for (let ix = 0; ix < xs.length - 1; ix++) {
    for (let iy = 0; iy < ys.length - 1; iy++) {
      if (pointInPolygon({ x: (xs[ix]! + xs[ix + 1]!) / 2, y: (ys[iy]! + ys[iy + 1]!) / 2 }, points)) inside.push({ ix, iy });
    }
  }
  if (inside.length === 0) return null;
  const filled = new Set(inside.map((cell) => `${cell.ix},${cell.iy}`));
  const has = (ix: number, iy: number) => filled.has(`${ix},${iy}`);
  return inside.map(({ ix, iy }) => ({
    box: { minX: xs[ix]!, maxX: xs[ix + 1]!, minY: ys[iy]!, maxY: ys[iy + 1]! },
    bearing: {
      minX: has(ix - 1, iy) ? 0 : lap,
      maxX: has(ix + 1, iy) ? 0 : lap,
      minY: has(ix, iy - 1) ? 0 : lap,
      maxY: has(ix, iy + 1) ? 0 : lap,
    },
  }));
}

function joistsIn(bay: Bay, z0: number, z1: number): FloorJoist[] {
  const { box, bearing } = bay;
  const spanX = box.maxX - box.minX;
  const spanY = box.maxY - box.minY;
  const alongX = spanX <= spanY;
  const run = alongX ? spanY : spanX;
  const span = (alongX ? spanX : spanY) + (alongX ? bearing.minX + bearing.maxX : bearing.minY + bearing.maxY);
  const joists: FloorJoist[] = [];
  for (const center of studCenters(run)) {
    const a = center - JOIST_WIDTH / 2;
    const b = center + JOIST_WIDTH / 2;
    const polygon = alongX
      ? [
          { x: box.minX - bearing.minX, y: box.minY + a },
          { x: box.maxX + bearing.maxX, y: box.minY + a },
          { x: box.maxX + bearing.maxX, y: box.minY + b },
          { x: box.minX - bearing.minX, y: box.minY + b },
        ]
      : [
          { x: box.minX + a, y: box.minY - bearing.minY },
          { x: box.minX + b, y: box.minY - bearing.minY },
          { x: box.minX + b, y: box.maxY + bearing.maxY },
          { x: box.minX + a, y: box.maxY + bearing.maxY },
        ];
    joists.push({ polygon, z0, z1, length: span });
  }
  return joists;
}

/**
 * 2x10 joists at 16 inches on center under a floor that is raised off the slab.
 * They span the short side of each rectangular bay and lap the stem at each end.
 * An orthogonal outline is split into those bays. The edge where two bays meet does not lap.
 * One joist sits flush at each side. A gap shorter than a 2x10, or a wall that is not square to the others, gets none.
 */
export function floorJoists(foundation: Foundation, floorBottom: number): FloorJoist[] {
  const gap = foundation.clearance ?? 0;
  if (gap + 1e-6 < JOIST_DEPTH) return [];
  const bays = baysOf(foundation.polygon, foundation.stemThickness ?? 0);
  if (!bays) return [];
  const z1 = floorBottom;
  const z0 = floorBottom - JOIST_DEPTH;
  return bays.flatMap((bay) => joistsIn(bay, z0, z1));
}
