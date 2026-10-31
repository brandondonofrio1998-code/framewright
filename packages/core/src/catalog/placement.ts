import { add, angleOf, distance, normalize, perp, scale } from '../geometry/vec2';
import type { Id, PlanDocument, Vec2, Wall } from '../model/schema';
import { wallThickness } from '../walls/graph';

export interface WallPlacement {
  p: Vec2;
  rotation: number;
  t: number;
  side: 'left' | 'right';
}

/**
 * Puts an object's back against a wall face. `t` is the distance from node a to the object's center, clamped so the
 * whole object sits on the wall. Local +y (the back) points at the wall.
 */
export function placeOnWall(doc: PlanDocument, wall: Wall, t: number, side: 'left' | 'right', width: number, depth: number): WallPlacement | null {
  const a = doc.elements[wall.a];
  const b = doc.elements[wall.b];
  const type = doc.wallTypes[wall.typeId];
  if (a?.kind !== 'wallNode' || b?.kind !== 'wallNode' || !type) return null;
  const length = distance(a.p, b.p);
  if (length < 1e-6) return null;
  const clamped = Math.min(Math.max(t, width / 2), Math.max(width / 2, length - width / 2));
  const u = normalize({ x: b.p.x - a.p.x, y: b.p.y - a.p.y });
  const n = perp(u);
  const sign = side === 'left' ? 1 : -1;
  const along = add(a.p, scale(u, clamped));
  const back = add(along, scale(n, sign * (wallThickness(type) / 2)));
  const p = add(back, scale(n, sign * (depth / 2)));
  // Local +y should point back at the wall, which is opposite the side normal.
  const rotation = angleOf(scale(n, -sign)) - Math.PI / 2;
  return { p, rotation, t: clamped, side };
}

export function wallById(doc: PlanDocument, id: Id | undefined): Wall | undefined {
  if (!id) return undefined;
  const wall = doc.elements[id];
  return wall?.kind === 'wall' ? wall : undefined;
}
