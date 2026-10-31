import { dimensionLine } from '../display/display-list';
import { openingOutline } from '../display/openings';
import { dimensionsOnLevel, resolveDimensionEnd } from '../display/plan';
import { cross, distance, pointInPolygon, projectOnSegment, sub, type Bounds } from '../geometry/vec2';
import type { Id, PlanDocument, Vec2 } from '../model/schema';
import { openingsOnLevel } from '../openings/openings';
import type { WallGeometry } from '../walls/joins';

export interface Picked {
  kind: 'wall' | 'dimension' | 'door' | 'window';
  id: Id;
}

function distanceToPolygon(p: Vec2, polygon: Vec2[]): number {
  if (pointInPolygon(p, polygon)) return 0;
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) best = Math.min(best, projectOnSegment(p, polygon[i]!, polygon[(i + 1) % polygon.length]!).distance);
  return best;
}

/**
 * The element under `p` within `tolerance` model units. Dimensions win (they draw on top), then doors and
 * windows (they sit inside walls), then walls.
 */
export function pickElement(doc: PlanDocument, levelId: Id, geometry: Map<Id, WallGeometry>, p: Vec2, tolerance: number): Picked | null {
  const best: { picked: Picked | null; d: number } = { picked: null, d: Infinity };
  const consider = (picked: Picked, d: number) => {
    if (d <= tolerance && d < best.d) Object.assign(best, { picked, d });
  };
  for (const dim of dimensionsOnLevel(doc, levelId)) {
    const [a, b] = dimensionLine(resolveDimensionEnd(doc, dim.a), resolveDimensionEnd(doc, dim.b), dim.offset);
    consider({ kind: 'dimension', id: dim.id }, projectOnSegment(p, a, b).distance);
  }
  if (best.picked) return best.picked;
  for (const o of openingsOnLevel(doc, levelId)) {
    const geom = geometry.get(o.wallId);
    if (geom) consider({ kind: o.kind, id: o.id }, distanceToPolygon(p, openingOutline(geom, o)));
  }
  if (best.picked) return best.picked;
  for (const geom of geometry.values()) {
    const d = pointInPolygon(p, geom.footprint) ? 0 : Math.max(0, projectOnSegment(p, geom.a, geom.b).distance - geom.thickness / 2);
    consider({ kind: 'wall', id: geom.wallId }, d);
  }
  return best.picked;
}

export interface WallHit {
  wallId: Id;
  /** Distance along the wall from node a to the point nearest `p`. */
  t: number;
  length: number;
  /** Whether `p` is on the wall's left (relative to a → b). */
  left: boolean;
}

/** The wall nearest `p` whose faces are within `tolerance`, for placing and sliding doors and windows. */
export function nearestWall(geometry: Map<Id, WallGeometry>, p: Vec2, tolerance: number): WallHit | null {
  let best: (WallHit & { d: number }) | null = null;
  for (const geom of geometry.values()) {
    const hit = projectOnSegment(p, geom.a, geom.b);
    const d = Math.max(0, hit.distance - geom.thickness / 2);
    if (d > tolerance || (best && d >= best.d)) continue;
    const length = distance(geom.a, geom.b);
    best = { wallId: geom.wallId, t: hit.t * length, length, left: cross(sub(geom.b, geom.a), sub(p, geom.a)) > 0, d };
  }
  return best && { wallId: best.wallId, t: best.t, length: best.length, left: best.left };
}

const inside = (p: Vec2, box: Bounds) => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;

/** Elements lying entirely inside the box. */
export function elementsInBox(doc: PlanDocument, levelId: Id, geometry: Map<Id, WallGeometry>, box: Bounds): Id[] {
  const ids: Id[] = [];
  for (const geom of geometry.values()) if (geom.footprint.every((p) => inside(p, box))) ids.push(geom.wallId);
  for (const o of openingsOnLevel(doc, levelId)) {
    const geom = geometry.get(o.wallId);
    if (geom && openingOutline(geom, o).every((p) => inside(p, box))) ids.push(o.id);
  }
  for (const dim of dimensionsOnLevel(doc, levelId)) {
    const ends = [resolveDimensionEnd(doc, dim.a), resolveDimensionEnd(doc, dim.b)];
    if ([...ends, ...dimensionLine(ends[0]!, ends[1]!, dim.offset)].every((p) => inside(p, box))) ids.push(dim.id);
  }
  return ids;
}
