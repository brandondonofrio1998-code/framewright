import { deviceOnWall } from '../electrical/devices';
import type { DisplayItem, Prim } from '../display/display-list';
import { add, scale } from '../geometry/vec2';
import type { Id, PlanDocument, Plumbing, Vec2 } from '../model/schema';

/** Center of a supply pair above the floor. */
export const SUPPLY_CENTER = 20;
/** Center of a wall drain above the floor. */
export const DRAIN_CENTER = 12;

export function plumbingOnLevel(doc: PlanDocument, levelId: Id): Plumbing[] {
  return Object.values(doc.elements).filter((el): el is Plumbing => el.kind === 'plumbing' && el.levelId === levelId);
}

export function plumbingPose(doc: PlanDocument, el: Plumbing): { p: Vec2; dir: Vec2; out: Vec2 } {
  if (el.hostWallId && el.hostT !== undefined && el.side) {
    const wall = doc.elements[el.hostWallId];
    if (wall?.kind === 'wall') {
      const posed = deviceOnWall(doc, wall, el.hostT, el.side);
      if (posed) return posed;
    }
  }
  return { p: el.p, dir: { x: 1, y: 0 }, out: { x: 0, y: 1 } };
}

export function plumbingSymbol(el: Plumbing, pose: { p: Vec2; dir: Vec2 }): Prim[] {
  const { p, dir } = pose;
  const n = { x: -dir.y, y: dir.x };
  if (!el.hostWallId) return [{ t: 'arc', c: p, r: 4, start: 0, sweep: Math.PI * 2, pen: 'plumbing' }];
  if (el.fixture === 'drain') {
    return [
      { t: 'arc', c: p, r: 2, start: 0, sweep: Math.PI * 2, pen: 'plumbing' },
      line(add(p, scale(n, -2)), add(p, scale(n, 2))),
    ];
  }
  return [line(add(add(p, scale(dir, -4)), scale(n, -2)), add(add(p, scale(dir, -4)), scale(n, 2))), line(add(add(p, scale(dir, 4)), scale(n, -2)), add(add(p, scale(dir, 4)), scale(n, 2)))];
}

export function plumbingItem(doc: PlanDocument, el: Plumbing): DisplayItem {
  return { elementId: el.id, layer: 'plumbing', prims: plumbingSymbol(el, plumbingPose(doc, el)) };
}

function line(a: Vec2, b: Vec2): Prim {
  return { t: 'line', a, b, pen: 'plumbing' };
}
