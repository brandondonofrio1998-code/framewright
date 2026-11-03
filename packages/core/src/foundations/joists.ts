import { studCenters } from '../framing/members';
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

/** An axis-aligned rectangle, or null for an L or any other outline. */
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

/**
 * 2x10 joists at 16 inches on center under a floor that is raised off the slab.
 * They span the short side of a rectangular foundation and lap the stem at each end.
 * One joist sits flush at each side. An L-shaped outline, or a gap shorter than a 2x10, gets none.
 */
export function floorJoists(foundation: Foundation, floorBottom: number): FloorJoist[] {
  const gap = foundation.clearance ?? 0;
  if (gap + 1e-6 < JOIST_DEPTH) return [];
  const box = rectangle(foundation.polygon);
  if (!box) return [];
  const bearing = foundation.stemThickness ?? 0;
  const spanX = box.maxX - box.minX;
  const alongX = spanX <= box.maxY - box.minY;
  const run = alongX ? box.maxY - box.minY : spanX;
  const z1 = floorBottom;
  const z0 = floorBottom - JOIST_DEPTH;
  const joists: FloorJoist[] = [];
  for (const center of studCenters(run)) {
    const a = center - JOIST_WIDTH / 2;
    const b = center + JOIST_WIDTH / 2;
    const polygon = alongX
      ? [
          { x: box.minX - bearing, y: box.minY + a },
          { x: box.maxX + bearing, y: box.minY + a },
          { x: box.maxX + bearing, y: box.minY + b },
          { x: box.minX - bearing, y: box.minY + b },
        ]
      : [
          { x: box.minX + a, y: box.minY - bearing },
          { x: box.minX + b, y: box.minY - bearing },
          { x: box.minX + b, y: box.maxY + bearing },
          { x: box.minX + a, y: box.maxY + bearing },
        ];
    joists.push({ polygon, z0, z1, length: (alongX ? spanX : box.maxY - box.minY) + bearing * 2 });
  }
  return joists;
}
