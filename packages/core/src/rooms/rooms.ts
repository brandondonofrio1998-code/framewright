import { add, angleOf, boundsOf, distance, lineIntersection, normalize, perp, pointInPolygon, polygonArea, samePoint, scale, sub } from '../geometry/vec2';
import type { Id, PlanDocument, Room, Vec2, Wall } from '../model/schema';
import { guessExteriorSide } from '../openings/openings';
import { wallThickness, wallsOnLevel } from '../walls/graph';
import type { CommandContext } from '../commands/history';

/** Inner area below this (2 sq ft) is a gap between walls, not a room. */
const MIN_ROOM_AREA = 2 * 144;

export interface RoomFace {
  /** Wall centerline, counter-clockwise. */
  centerline: Vec2[];
  /** Inner wall faces, counter-clockwise. */
  polygon: Vec2[];
  /** Square inches inside the walls. */
  area: number;
  edges: { wallId: Id; forward: boolean }[];
}

interface HalfEdge {
  wallId: Id;
  from: Id;
  to: Id;
  angle: number;
  forward: boolean;
}

const edgeKey = (e: HalfEdge) => `${e.wallId}:${e.from}`;

function nodePoint(doc: PlanDocument, id: Id): Vec2 | undefined {
  const node = doc.elements[id];
  return node?.kind === 'wallNode' ? node.p : undefined;
}

/** A point guaranteed to lie inside `polygon` (its centroid when that falls inside, otherwise the deepest grid point). */
export function interiorPoint(polygon: readonly Vec2[]): Vec2 {
  const centroid = polygonCentroid(polygon);
  if (pointInPolygon(centroid, polygon)) return centroid;
  const bounds = boundsOf(polygon);
  if (!bounds) return centroid;
  const step = Math.max((bounds.maxX - bounds.minX) / 16, (bounds.maxY - bounds.minY) / 16, 1);
  let best: Vec2 | null = null;
  let bestClearance = -1;
  for (let x = bounds.minX + step / 2; x < bounds.maxX; x += step) {
    for (let y = bounds.minY + step / 2; y < bounds.maxY; y += step) {
      const p = { x, y };
      if (!pointInPolygon(p, polygon)) continue;
      const clearance = distanceToEdges(p, polygon);
      if (clearance > bestClearance) {
        best = p;
        bestClearance = clearance;
      }
    }
  }
  return best ?? centroid;
}

function polygonCentroid(polygon: readonly Vec2[]): Vec2 {
  let twice = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const cross = a.x * b.y - b.x * a.y;
    twice += cross;
    x += (a.x + b.x) * cross;
    y += (a.y + b.y) * cross;
  }
  if (Math.abs(twice) < 1e-6) {
    const n = polygon.length || 1;
    return { x: polygon.reduce((s, p) => s + p.x, 0) / n, y: polygon.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: x / (3 * twice), y: y / (3 * twice) };
}

function distanceToEdges(p: Vec2, polygon: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const ab = sub(b, a);
    const len2 = ab.x * ab.x + ab.y * ab.y;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / len2));
    best = Math.min(best, distance(p, { x: a.x + ab.x * t, y: a.y + ab.y * t }));
  }
  return best;
}

/** Offsets a counter-clockwise polygon to its left by a per-edge distance (the inside of a room). */
function offsetInward(points: Vec2[], distances: number[]): Vec2[] {
  const lines = points.map((a, i) => {
    const b = points[(i + 1) % points.length]!;
    if (distance(a, b) < 1e-6) return null;
    const u = normalize(sub(b, a));
    return { origin: add(a, scale(perp(u), distances[i] ?? 0)), u };
  });
  const corners: Vec2[] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = lines[(i - 1 + lines.length) % lines.length];
    const cur = lines[i];
    if (!cur) continue;
    const corner = prev ? lineIntersection(prev.origin, prev.u, cur.origin, cur.u) : null;
    const point = corner ?? cur.origin;
    if (corners.length === 0 || !samePoint(corners[corners.length - 1]!, point)) corners.push(point);
  }
  if (corners.length > 1 && samePoint(corners[0]!, corners[corners.length - 1]!)) corners.pop();
  return corners;
}

interface FaceWalk {
  points: Vec2[];
  edges: { wallId: Id; forward: boolean }[];
  area: number;
}

export interface ExteriorShell {
  /** Centerline of the exterior, walked clockwise. */
  points: Vec2[];
  edges: { wallId: Id; forward: boolean }[];
}

/**
 * Faces of one level's wall graph. Bounded counter-clockwise faces are rooms; the clockwise face around each
 * connected outline is the exterior, and it says which side of each wall faces outside. `shells` are those
 * clockwise outlines.
 */
export function analyzeLevel(doc: PlanDocument, levelId: Id): { rooms: RoomFace[]; exterior: Map<Id, 'left' | 'right'>; shells: ExteriorShell[] } {
  const walls = wallsOnLevel(doc, levelId);
  const outgoing = new Map<Id, HalfEdge[]>();
  const add = (wall: Wall, from: Id, to: Id, forward: boolean) => {
    const a = nodePoint(doc, from);
    const b = nodePoint(doc, to);
    if (!a || !b || distance(a, b) < 1e-6) return;
    const edge: HalfEdge = { wallId: wall.id, from, to, angle: angleOf(sub(b, a)), forward };
    outgoing.set(from, [...(outgoing.get(from) ?? []), edge]);
  };
  for (const wall of walls) {
    add(wall, wall.a, wall.b, true);
    add(wall, wall.b, wall.a, false);
  }
  for (const edges of outgoing.values()) edges.sort((x, y) => x.angle - y.angle);

  const next = (edge: HalfEdge): HalfEdge | undefined => {
    const outs = outgoing.get(edge.to);
    if (!outs || outs.length === 0) return undefined;
    const back = outs.findIndex((e) => e.wallId === edge.wallId && e.to === edge.from);
    if (back < 0) return undefined;
    return outs[(back - 1 + outs.length) % outs.length];
  };

  const used = new Set<string>();
  const walks: FaceWalk[] = [];
  for (const edges of outgoing.values()) {
    for (const start of edges) {
      if (used.has(edgeKey(start))) continue;
      const points: Vec2[] = [];
      const faceEdges: FaceWalk['edges'] = [];
      let edge: HalfEdge | undefined = start;
      let guard = 0;
      while (edge && !used.has(edgeKey(edge)) && guard++ <= walls.length * 2) {
        const p = nodePoint(doc, edge.from);
        if (p) points.push(p);
        faceEdges.push({ wallId: edge.wallId, forward: edge.forward });
        used.add(edgeKey(edge));
        edge = next(edge);
        if (edge && edgeKey(edge) === edgeKey(start)) break;
      }
      if (points.length >= 3) walks.push({ points, edges: faceEdges, area: polygonArea(points) });
    }
  }

  const exterior = new Map<Id, 'left' | 'right'>();
  const shells: ExteriorShell[] = [];
  const rooms: RoomFace[] = [];
  for (const walk of walks) {
    if (walk.area < -1) {
      shells.push({ points: walk.points, edges: walk.edges });
      for (const edge of walk.edges) exterior.set(edge.wallId, edge.forward ? 'left' : 'right');
      continue;
    }
    if (walk.area <= 1) continue;
    const distances = walk.edges.map((edge) => {
      const wall = doc.elements[edge.wallId];
      const type = wall?.kind === 'wall' ? doc.wallTypes[wall.typeId] : undefined;
      return type ? wallThickness(type) / 2 : 0;
    });
    const polygon = offsetInward(walk.points, distances);
    const area = polygonArea(polygon);
    if (polygon.length < 3 || area < MIN_ROOM_AREA) continue;
    rooms.push({ centerline: walk.points, polygon, area, edges: walk.edges });
  }
  return { rooms, exterior, shells };
}

/**
 * The side of a wall that faces the exterior. A wall between two rooms has none. A wall that is not part of any
 * closed room falls back to the side facing away from the middle of the plan.
 */
export function exteriorSideOfWall(doc: PlanDocument, wallId: Id): 'left' | 'right' | null {
  const wall = doc.elements[wallId];
  if (wall?.kind !== 'wall') return null;
  const { rooms, exterior } = analyzeLevel(doc, wall.levelId);
  const found = exterior.get(wallId);
  if (found) return found;
  const enclosed = rooms.some((face) => face.edges.some((edge) => edge.wallId === wallId));
  return enclosed ? null : guessExteriorSide(doc, wall);
}

export function roomsOnLevel(doc: PlanDocument, levelId: Id): Room[] {
  return Object.values(doc.elements).filter((el): el is Room => el.kind === 'room' && el.levelId === levelId);
}

/** The detected face a room currently occupies, if it still has one. */
export function roomFace(doc: PlanDocument, room: Room): RoomFace | undefined {
  return analyzeLevel(doc, room.levelId).rooms.find((face) => pointInPolygon(room.seed, face.polygon));
}

/** Square feet, for labels. */
export function formatArea(squareInches: number): string {
  return `${(squareInches / 144).toFixed(1)} sq ft`;
}

function nextRoomName(doc: PlanDocument): string {
  const used = new Set(Object.values(doc.elements).flatMap((el) => (el.kind === 'room' ? [el.name] : [])));
  let n = 1;
  while (used.has(`Room ${n}`)) n++;
  return `Room ${n}`;
}

/** How many sample points of `a` lie inside `b`. Enough to tell which face a room became. */
function overlapScore(a: readonly Vec2[], b: readonly Vec2[]): number {
  const bounds = boundsOf(a);
  if (!bounds) return 0;
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1);
  const step = Math.max(6, span / 12);
  let score = 0;
  for (let x = bounds.minX; x <= bounds.maxX; x += step) {
    for (let y = bounds.minY; y <= bounds.maxY; y += step) {
      const p = { x, y };
      if (pointInPolygon(p, a) && pointInPolygon(p, b)) score++;
    }
  }
  return score;
}

/**
 * Keeps room elements matched to the spaces they name. A room follows the face containing its seed, or, when a wall
 * edit moved that point outside, the face overlapping its previous outline. New spaces get "Room N"; spaces that
 * closed up lose their room (undo restores it, since this runs inside the wall command).
 */
export function reconcileRooms(doc: PlanDocument, previous: Map<Id, Vec2[]>, ctx: CommandContext): void {
  const levelIds = new Set(Object.values(doc.elements).flatMap((el) => (el.kind === 'wall' || el.kind === 'room' ? [el.levelId] : [])));
  for (const levelId of levelIds) {
    if (!doc.levels[levelId]) continue;
    const faces = analyzeLevel(doc, levelId).rooms;
    const rooms = roomsOnLevel(doc, levelId);
    const takenFaces = new Set<number>();
    const claimed = new Set<Id>();

    const claim = (room: Room, index: number) => {
      takenFaces.add(index);
      claimed.add(room.id);
      const face = faces[index]!;
      if (!pointInPolygon(room.seed, face.polygon)) room.seed = interiorPoint(face.polygon);
    };

    for (const room of rooms) {
      const index = faces.findIndex((face, i) => !takenFaces.has(i) && pointInPolygon(room.seed, face.polygon));
      if (index >= 0) claim(room, index);
    }
    for (const room of rooms) {
      if (claimed.has(room.id)) continue;
      const prev = previous.get(room.id);
      if (!prev) continue;
      let best = -1;
      let bestScore = 0;
      faces.forEach((face, i) => {
        if (takenFaces.has(i)) return;
        const score = overlapScore(prev, face.polygon);
        if (score > bestScore) {
          best = i;
          bestScore = score;
        }
      });
      if (best >= 0) claim(room, best);
    }
    faces.forEach((face, i) => {
      if (takenFaces.has(i)) return;
      const room: Room = {
        id: ctx.newId(),
        kind: 'room',
        levelId,
        name: nextRoomName(doc),
        roomType: 'unspecified',
        seed: interiorPoint(face.polygon),
        ceilingHeight: null,
      };
      doc.elements[room.id] = room;
    });
    for (const room of rooms) {
      if (!claimed.has(room.id)) delete doc.elements[room.id];
    }
  }
}

/** Each room's current outline, captured before a wall edit so it can be matched afterwards. */
export function snapshotRoomPolygons(doc: PlanDocument): Map<Id, Vec2[]> {
  const byLevel = new Map<Id, RoomFace[]>();
  const polygons = new Map<Id, Vec2[]>();
  for (const el of Object.values(doc.elements)) {
    if (el.kind !== 'room') continue;
    let faces = byLevel.get(el.levelId);
    if (!faces) {
      faces = analyzeLevel(doc, el.levelId).rooms;
      byLevel.set(el.levelId, faces);
    }
    const face = faces.find((f) => pointInPolygon(el.seed, f.polygon));
    if (face) polygons.set(el.id, face.polygon);
  }
  return polygons;
}
