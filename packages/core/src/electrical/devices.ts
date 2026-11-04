import { add, normalize, scale, sub } from '../geometry/vec2';
import type { DisplayItem, Prim } from '../display/display-list';
import type { Electrical, Id, PlanDocument, Vec2, Wall } from '../model/schema';
import { wallEnds, wallThickness } from '../walls/graph';

/** Center of a receptacle above the floor. */
export const RECEPTACLE_CENTER = 18;
/** Center of a switch above the floor. */
export const SWITCH_CENTER = 48;
const SYMBOL = 3;

export function electricalOnLevel(doc: PlanDocument, levelId: Id): Electrical[] {
  return Object.values(doc.elements).filter((el): el is Electrical => el.kind === 'electrical' && el.levelId === levelId);
}

/** Where a wall device sits, on the face, and the wall's direction. */
export function deviceOnWall(doc: PlanDocument, wall: Wall, t: number, side: 'left' | 'right'): { p: Vec2; dir: Vec2; out: Vec2 } | null {
  const type = doc.wallTypes[wall.typeId];
  if (!type) return null;
  const [a, b] = wallEnds(doc, wall);
  const dir = normalize(sub(b, a));
  const out = scale(perpOf(dir), side === 'left' ? 1 : -1);
  const along = add(a, scale(dir, t));
  return { p: add(along, scale(out, wallThickness(type) / 2)), dir, out };
}

export function electricalPose(doc: PlanDocument, el: Electrical): { p: Vec2; dir: Vec2; out: Vec2 } {
  if (el.hostWallId && el.hostT !== undefined && el.side) {
    const wall = doc.elements[el.hostWallId];
    if (wall?.kind === 'wall') {
      const posed = deviceOnWall(doc, wall, el.hostT, el.side);
      if (posed) return posed;
    }
  }
  return { p: el.p, dir: { x: 1, y: 0 }, out: { x: 0, y: 1 } };
}

export function electricalSymbol(el: Electrical, pose: { p: Vec2; dir: Vec2 }): Prim[] {
  const { p, dir } = pose;
  const n = perpOf(dir);
  const prims: Prim[] = [{ t: 'arc', c: p, r: SYMBOL, start: 0, sweep: Math.PI * 2, pen: 'electrical' }];
  if (el.device === 'light') {
    prims.push(line(add(p, scale(dir, -SYMBOL)), add(p, scale(dir, SYMBOL))));
    prims.push(line(add(p, scale(n, -SYMBOL)), add(p, scale(n, SYMBOL))));
  } else if (el.device === 'switch') {
    prims.push(line(add(p, scale(dir, -SYMBOL * 0.7)), add(p, scale(dir, SYMBOL * 0.7))));
  } else {
    prims.push(line(add(add(p, scale(dir, -1)), scale(n, -SYMBOL * 0.55)), add(add(p, scale(dir, -1)), scale(n, SYMBOL * 0.55))));
    prims.push(line(add(add(p, scale(dir, 1)), scale(n, -SYMBOL * 0.55)), add(add(p, scale(dir, 1)), scale(n, SYMBOL * 0.55))));
  }
  return prims;
}

export function electricalItem(doc: PlanDocument, el: Electrical): DisplayItem {
  return { elementId: el.id, layer: 'electrical', prims: electricalSymbol(el, electricalPose(doc, el)) };
}

function perpOf(dir: Vec2): Vec2 {
  return { x: -dir.y, y: dir.x };
}

function line(a: Vec2, b: Vec2): Prim {
  return { t: 'line', a, b, pen: 'electrical' };
}
