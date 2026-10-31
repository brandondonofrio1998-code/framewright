import { distance, projectOnSegment } from '../geometry/vec2';
import type { CatalogObject, Id, PlanDocument, Vec2, Wall } from '../model/schema';
import { objectSize } from './symbols';
import { placeOnWall } from './placement';

const EPS = 1e-3;
const ON_WALL = 1e-2;

export interface ObjectAnchor {
  hostWallId: Id;
  a: Id;
  b: Id;
  pa: Vec2;
  pb: Vec2;
  hostT: number;
  side: 'left' | 'right';
  /** Where the back center sat, so a split wall can be found again. */
  anchor: Vec2;
}

function pointOf(doc: PlanDocument, id: Id): Vec2 | undefined {
  const node = doc.elements[id];
  return node?.kind === 'wallNode' ? node.p : undefined;
}

export function snapshotObjects(doc: PlanDocument): Map<Id, ObjectAnchor> {
  const anchors = new Map<Id, ObjectAnchor>();
  for (const el of Object.values(doc.elements)) {
    if (el.kind !== 'object' || !el.hostWallId || el.hostT === undefined || !el.side) continue;
    const wall = doc.elements[el.hostWallId];
    if (wall?.kind !== 'wall') continue;
    const pa = pointOf(doc, wall.a);
    const pb = pointOf(doc, wall.b);
    if (!pa || !pb) continue;
    const len = distance(pa, pb);
    const k = len > 0 ? el.hostT / len : 0;
    anchors.set(el.id, {
      hostWallId: wall.id,
      a: wall.a,
      b: wall.b,
      pa: { ...pa },
      pb: { ...pb },
      hostT: el.hostT,
      side: el.side,
      anchor: { x: pa.x + (pb.x - pa.x) * k, y: pa.y + (pb.y - pa.y) * k },
    });
  }
  return anchors;
}

function wallThrough(doc: PlanDocument, levelId: Id, p: Vec2, prefer: Id): { wall: Wall; t: number } | null {
  const walls = Object.values(doc.elements).filter((el): el is Wall => el.kind === 'wall' && el.levelId === levelId);
  walls.sort((x, y) => Number(y.id === prefer) - Number(x.id === prefer));
  for (const wall of walls) {
    const a = pointOf(doc, wall.a);
    const b = pointOf(doc, wall.b);
    if (!a || !b) continue;
    const hit = projectOnSegment(p, a, b);
    if (hit.distance <= ON_WALL) return { wall, t: distance(a, hit.point) };
  }
  return null;
}

function detach(object: CatalogObject): void {
  delete object.hostWallId;
  delete object.hostT;
  delete object.side;
}

/** Hosted objects follow their wall the way doors do; an object whose wall is gone stays where it is, unhosted. */
export function reconcileObjects(doc: PlanDocument, before: Map<Id, ObjectAnchor>): void {
  for (const el of Object.values(doc.elements)) {
    if (el.kind !== 'object' || !el.hostWallId) continue;
    const anchor = before.get(el.id);
    if (!anchor) continue;
    const { width, depth } = objectSize(doc, el);
    let wall = doc.elements[el.hostWallId]?.kind === 'wall' ? (doc.elements[el.hostWallId] as Wall) : undefined;
    let t = el.hostT ?? anchor.hostT;

    if (wall && wall.a === anchor.a && wall.b === anchor.b) {
      const pa = pointOf(doc, wall.a)!;
      const pb = pointOf(doc, wall.b)!;
      const len = distance(pa, pb);
      const movedA = distance(pa, anchor.pa) > EPS;
      const movedB = distance(pb, anchor.pb) > EPS;
      const oldLen = distance(anchor.pa, anchor.pb);
      if (movedA && !movedB) t = len - (oldLen - anchor.hostT);
      else if (movedA && movedB && Math.abs(len - oldLen) > EPS) t = oldLen > 0 ? (anchor.hostT / oldLen) * len : len / 2;
    } else {
      const found = wallThrough(doc, el.levelId, anchor.anchor, el.hostWallId);
      if (found) {
        wall = found.wall;
        t = found.t;
      } else {
        detach(el);
        continue;
      }
    }

    if (!wall || wall.levelId !== el.levelId) {
      detach(el);
      continue;
    }
    const placed = placeOnWall(doc, wall, t, el.side ?? anchor.side, width, depth);
    if (!placed || width > distance(pointOf(doc, wall.a)!, pointOf(doc, wall.b)!) + EPS) {
      detach(el);
      continue;
    }
    el.hostWallId = wall.id;
    el.hostT = placed.t;
    el.side = placed.side;
    el.p = placed.p;
    el.rotation = placed.rotation;
  }
}
