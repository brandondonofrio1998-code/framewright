import { dimensionLine } from '../display/display-list';
import { dimensionsOnLevel, resolveDimensionEnd } from '../display/plan';
import { pointInPolygon, projectOnSegment, type Bounds } from '../geometry/vec2';
import type { Id, PlanDocument, Vec2 } from '../model/schema';
import type { WallGeometry } from '../walls/joins';

export interface Picked {
  kind: 'wall' | 'dimension';
  id: Id;
}

/** The element under `p` (dimensions win over walls, since they draw on top), within `tolerance` model units. */
export function pickElement(doc: PlanDocument, levelId: Id, geometry: Map<Id, WallGeometry>, p: Vec2, tolerance: number): Picked | null {
  let best: { picked: Picked; d: number } | null = null;
  for (const dim of dimensionsOnLevel(doc, levelId)) {
    const [a, b] = dimensionLine(resolveDimensionEnd(doc, dim.a), resolveDimensionEnd(doc, dim.b), dim.offset);
    const d = projectOnSegment(p, a, b).distance;
    if (d <= tolerance && (!best || d < best.d)) best = { picked: { kind: 'dimension', id: dim.id }, d };
  }
  if (best) return best.picked;
  for (const geom of geometry.values()) {
    const d = pointInPolygon(p, geom.footprint) ? 0 : Math.max(0, projectOnSegment(p, geom.a, geom.b).distance - geom.thickness / 2);
    if (d <= tolerance && (!best || d < best.d)) best = { picked: { kind: 'wall', id: geom.wallId }, d };
  }
  return best?.picked ?? null;
}

const inside = (p: Vec2, box: Bounds) => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;

/** Elements lying entirely inside the box. */
export function elementsInBox(doc: PlanDocument, levelId: Id, geometry: Map<Id, WallGeometry>, box: Bounds): Id[] {
  const ids: Id[] = [];
  for (const geom of geometry.values()) if (geom.footprint.every((p) => inside(p, box))) ids.push(geom.wallId);
  for (const dim of dimensionsOnLevel(doc, levelId)) {
    const ends = [resolveDimensionEnd(doc, dim.a), resolveDimensionEnd(doc, dim.b)];
    if ([...ends, ...dimensionLine(ends[0]!, ends[1]!, dim.offset)].every((p) => inside(p, box))) ids.push(dim.id);
  }
  return ids;
}
