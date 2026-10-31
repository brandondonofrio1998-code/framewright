import { distance, projectOnSegment } from '../geometry/vec2';
import type { Door, Id, Opening, PlanDocument, Vec2, Wall, WindowOpening } from '../model/schema';
import { formatLength } from '../units/length';

/** Openings closer than this to each other or a wall end still count as fitting (float noise). */
export const OPENING_EPS = 1e-3;
const ON_WALL_EPS = 1e-2;

export type DoorDefaults = Pick<Door, 'style' | 'width' | 'height'>;
export type WindowDefaults = Pick<WindowOpening, 'style' | 'width' | 'height' | 'sill'>;

/** 3'-0" x 6'-8" hinged door; 3'-0" x 4'-0" double-hung window with its head at 6'-8". */
export const DEFAULT_DOOR: DoorDefaults = { style: 'hinged', width: 36, height: 80 };
export const DEFAULT_WINDOW: WindowDefaults = { style: 'double-hung', width: 36, height: 48, sill: 32 };

export const isOpening = (el: { kind: string } | undefined): el is Opening => el?.kind === 'door' || el?.kind === 'window';

export function openingsOnWall(doc: PlanDocument, wallId: Id): Opening[] {
  return Object.values(doc.elements).filter((el): el is Opening => isOpening(el) && el.wallId === wallId);
}

export function openingsOnLevel(doc: PlanDocument, levelId: Id): Opening[] {
  return Object.values(doc.elements).filter((el): el is Opening => isOpening(el) && el.levelId === levelId);
}

function nodePoint(doc: PlanDocument, id: Id): Vec2 | undefined {
  const node = doc.elements[id];
  return node?.kind === 'wallNode' ? node.p : undefined;
}

export function wallLength(doc: PlanDocument, wall: Wall): number {
  const a = nodePoint(doc, wall.a);
  const b = nodePoint(doc, wall.b);
  return a && b ? distance(a, b) : 0;
}

/** The opening's extent along its wall, as distances from node a. */
export function openingSpan(o: Pick<Opening, 't' | 'width'>): [number, number] {
  return [o.t - o.width / 2, o.t + o.width / 2];
}

/** Why an opening of `width` centred at `t` can't go on `wall`, or null if it fits. */
export function openingFitError(doc: PlanDocument, wall: Wall, t: number, width: number, ignoreId?: Id): string | null {
  const length = wallLength(doc, wall);
  const format = doc.settings.lengthFormat;
  if (width > length + OPENING_EPS) return `The wall is only ${formatLength(length, format)} long.`;
  const [s0, s1] = openingSpan({ t, width });
  if (s0 < -OPENING_EPS || s1 > length + OPENING_EPS) return 'The opening must fit within the wall.';
  for (const other of openingsOnWall(doc, wall.id)) {
    if (other.id === ignoreId) continue;
    const [o0, o1] = openingSpan(other);
    if (s0 < o1 - OPENING_EPS && o0 < s1 - OPENING_EPS) return 'Openings on the same wall cannot overlap.';
  }
  return null;
}

/** Keeps an opening of `width` centred as near `t` as the wall allows. */
export function clampOpeningT(length: number, width: number, t: number): number {
  return Math.min(Math.max(t, width / 2), Math.max(width / 2, length - width / 2));
}

/** Where each opening sat before a wall edit, so it can be re-hosted afterwards. */
export interface OpeningAnchor {
  wallId: Id;
  a: Id;
  b: Id;
  pa: Vec2;
  pb: Vec2;
  t: number;
  center: Vec2;
}

export function snapshotOpenings(doc: PlanDocument): Map<Id, OpeningAnchor> {
  const anchors = new Map<Id, OpeningAnchor>();
  for (const el of Object.values(doc.elements)) {
    if (!isOpening(el)) continue;
    const wall = doc.elements[el.wallId];
    if (wall?.kind !== 'wall') continue;
    const pa = nodePoint(doc, wall.a);
    const pb = nodePoint(doc, wall.b);
    if (!pa || !pb) continue;
    const len = distance(pa, pb);
    const k = len > 0 ? el.t / len : 0;
    anchors.set(el.id, {
      wallId: wall.id,
      a: wall.a,
      b: wall.b,
      pa: { ...pa },
      pb: { ...pb },
      t: el.t,
      center: { x: pa.x + (pb.x - pa.x) * k, y: pa.y + (pb.y - pa.y) * k },
    });
  }
  return anchors;
}

/** The wall on `levelId` whose centerline passes through `p`, preferring `prefer`. Returns it with the distance from its node a. */
function wallThrough(doc: PlanDocument, levelId: Id, p: Vec2, prefer: Id): { wall: Wall; t: number } | null {
  const walls = Object.values(doc.elements).filter((el): el is Wall => el.kind === 'wall' && el.levelId === levelId);
  walls.sort((x, y) => Number(y.id === prefer) - Number(x.id === prefer));
  for (const wall of walls) {
    const a = nodePoint(doc, wall.a);
    const b = nodePoint(doc, wall.b);
    if (!a || !b) continue;
    const hit = projectOnSegment(p, a, b);
    if (hit.distance <= ON_WALL_EPS) return { wall, t: distance(a, hit.point) };
  }
  return null;
}

/**
 * Re-hosts openings after walls moved, split, merged or disappeared:
 * - a wall that moved rigidly carries its openings;
 * - when one end moved, openings keep their distance from the end that stayed;
 * - when a wall was split or merged, each opening goes to the wall now under its center;
 * - openings whose wall is gone (or too short for them) are removed.
 */
export function reconcileOpenings(doc: PlanDocument, before: Map<Id, OpeningAnchor>): void {
  for (const el of Object.values(doc.elements)) {
    if (!isOpening(el)) continue;
    const anchor = before.get(el.id);
    let wall = doc.elements[el.wallId]?.kind === 'wall' ? (doc.elements[el.wallId] as Wall) : undefined;
    let t = el.t;

    if (anchor && wall && wall.a === anchor.a && wall.b === anchor.b) {
      const pa = nodePoint(doc, wall.a)!;
      const pb = nodePoint(doc, wall.b)!;
      const len = distance(pa, pb);
      const movedA = distance(pa, anchor.pa) > OPENING_EPS;
      const movedB = distance(pb, anchor.pb) > OPENING_EPS;
      const oldLen = distance(anchor.pa, anchor.pb);
      if (movedA && !movedB) t = len - (oldLen - anchor.t);
      else if (movedA && movedB && Math.abs(len - oldLen) > OPENING_EPS) t = oldLen > 0 ? (anchor.t / oldLen) * len : len / 2;
    } else if (anchor) {
      const found = wallThrough(doc, el.levelId, anchor.center, el.wallId);
      if (found) {
        wall = found.wall;
        t = found.t;
      } else if (wall) {
        const pa = nodePoint(doc, wall.a)!;
        const pb = nodePoint(doc, wall.b)!;
        t = distance(pa, projectOnSegment(anchor.center, pa, pb).point);
      }
    }

    if (!wall || wall.levelId !== el.levelId) {
      delete doc.elements[el.id];
      continue;
    }
    const len = wallLength(doc, wall);
    if (el.width > len + OPENING_EPS) {
      delete doc.elements[el.id];
      continue;
    }
    el.wallId = wall.id;
    el.t = clampOpeningT(len, el.width, t);
  }
}
