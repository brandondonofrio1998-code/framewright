import { objectFootprint } from '../catalog/symbols';
import { landingPolygon, placedFlights, stairCorners, stairsOnLevel } from '../stairs/straight';
import { dimensionLine } from '../display/display-list';
import { openingOutline } from '../display/openings';
import { dimensionsOnLevel, resolveDimensionEnd } from '../display/plan';
import { cross, distance, pointInPolygon, projectOnSegment, sub, type Bounds } from '../geometry/vec2';
import type { Cad, Id, PlanDocument, Vec2 } from '../model/schema';
import { foundationsOnLevel } from '../foundations/slab';
import { openingsOnLevel } from '../openings/openings';
import { roomFace, roomsOnLevel } from '../rooms/rooms';
import type { WallGeometry } from '../walls/joins';

export interface Picked {
  kind: 'wall' | 'dimension' | 'door' | 'window' | 'object' | 'room' | 'stair' | 'cad' | 'foundation';
  id: Id;
}

function distanceToCad(p: Vec2, el: Cad): number {
  let best = Infinity;
  for (const prim of el.prims) {
    if (prim.t === 'line') best = Math.min(best, projectOnSegment(p, prim.a, prim.b).distance);
    else if (prim.t === 'polyline') {
      for (let i = 0; i < prim.pts.length - 1; i++) best = Math.min(best, projectOnSegment(p, prim.pts[i]!, prim.pts[i + 1]!).distance);
      if (prim.closed && prim.pts.length > 2) best = Math.min(best, projectOnSegment(p, prim.pts[prim.pts.length - 1]!, prim.pts[0]!).distance);
    } else if (prim.t === 'text') best = Math.min(best, distance(p, prim.p));
    else best = Math.min(best, arcDistance(p, prim.c, prim.r, prim.start, prim.sweep));
  }
  return best;
}

function arcDistance(p: Vec2, c: Vec2, r: number, start: number, sweep: number): number {
  const end = (angle: number): Vec2 => ({ x: c.x + r * Math.cos(angle), y: c.y + r * Math.sin(angle) });
  const ang = Math.atan2(p.y - c.y, p.x - c.x);
  const sign = sweep < 0 ? -1 : 1;
  let rel = ang - start;
  const turn = sign * Math.PI * 2;
  while (rel * sign < 0) rel += turn;
  while (rel * sign >= Math.PI * 2) rel -= turn;
  if (rel * sign <= Math.abs(sweep)) return Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - r);
  return Math.min(distance(p, end(start)), distance(p, end(start + sweep)));
}

function cadPoints(el: Cad): Vec2[] {
  const points: Vec2[] = [];
  for (const prim of el.prims) {
    if (prim.t === 'line') points.push(prim.a, prim.b);
    else if (prim.t === 'polyline') points.push(...prim.pts);
    else if (prim.t === 'text') points.push(prim.p);
    else points.push(prim.c, { x: prim.c.x + prim.r, y: prim.c.y }, { x: prim.c.x - prim.r, y: prim.c.y }, { x: prim.c.x, y: prim.c.y + prim.r }, { x: prim.c.x, y: prim.c.y - prim.r });
  }
  return points;
}

function distanceToPolygon(p: Vec2, polygon: Vec2[]): number {
  if (pointInPolygon(p, polygon)) return 0;
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) best = Math.min(best, projectOnSegment(p, polygon[i]!, polygon[(i + 1) % polygon.length]!).distance);
  return best;
}

/**
 * The element under `p` within `tolerance` model units. Dimensions win (they draw on top), then doors and
 * windows (they sit inside walls), then objects, then walls, then rooms.
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
  for (const el of Object.values(doc.elements)) {
    if (el.kind !== 'object' || el.levelId !== levelId) continue;
    consider({ kind: 'object', id: el.id }, distanceToPolygon(p, objectFootprint(doc, el)));
  }
  if (best.picked) return best.picked;
  for (const stair of stairsOnLevel(doc, levelId)) {
    for (const flight of placedFlights(stair)) consider({ kind: 'stair', id: stair.id }, distanceToPolygon(p, stairCorners(flight)));
    const landing = landingPolygon(stair);
    if (landing) consider({ kind: 'stair', id: stair.id }, distanceToPolygon(p, landing));
  }
  if (best.picked) return best.picked;
  for (const geom of geometry.values()) {
    const d = pointInPolygon(p, geom.footprint) ? 0 : Math.max(0, projectOnSegment(p, geom.a, geom.b).distance - geom.thickness / 2);
    consider({ kind: 'wall', id: geom.wallId }, d);
  }
  const onWall = [...geometry.values()].some((geom) => pointInPolygon(p, geom.footprint));
  if (!onWall) {
    for (const foundation of foundationsOnLevel(doc, levelId)) {
      for (const poly of [...foundation.footings, ...(foundation.stems ?? [])]) {
        if (pointInPolygon(p, poly)) consider({ kind: 'foundation', id: foundation.id }, 0);
      }
    }
  }
  if (best.picked) return best.picked;
  for (const el of Object.values(doc.elements)) {
    if (el.kind !== 'cad' || el.levelId !== levelId) continue;
    consider({ kind: 'cad', id: el.id }, distanceToCad(p, el));
  }
  if (best.picked) return best.picked;
  for (const room of roomsOnLevel(doc, levelId)) {
    const face = roomFace(doc, room);
    if (face && pointInPolygon(p, face.polygon)) consider({ kind: 'room', id: room.id }, 0);
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
  for (const el of Object.values(doc.elements)) {
    if (el.kind === 'object' && el.levelId === levelId && objectFootprint(doc, el).every((p) => inside(p, box))) ids.push(el.id);
  }
  for (const room of roomsOnLevel(doc, levelId)) {
    const face = roomFace(doc, room);
    if (face && face.polygon.every((p) => inside(p, box))) ids.push(room.id);
  }
  for (const o of openingsOnLevel(doc, levelId)) {
    const geom = geometry.get(o.wallId);
    if (geom && openingOutline(geom, o).every((p) => inside(p, box))) ids.push(o.id);
  }
  for (const stair of stairsOnLevel(doc, levelId)) {
    const points = [...placedFlights(stair).flatMap((flight) => stairCorners(flight)), ...(landingPolygon(stair) ?? [])];
    if (points.every((p) => inside(p, box))) ids.push(stair.id);
  }
  for (const el of Object.values(doc.elements)) {
    if (el.kind === 'cad' && el.levelId === levelId && cadPoints(el).every((p) => inside(p, box))) ids.push(el.id);
  }
  for (const dim of dimensionsOnLevel(doc, levelId)) {
    const ends = [resolveDimensionEnd(doc, dim.a), resolveDimensionEnd(doc, dim.b)];
    if ([...ends, ...dimensionLine(ends[0]!, ends[1]!, dim.offset)].every((p) => inside(p, box))) ids.push(dim.id);
  }
  return ids;
}
