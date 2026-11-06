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

export function electricalSymbol(el: Electrical, pose: { p: Vec2; dir: Vec2; out?: Vec2 }): Prim[] {
  const { p, dir } = pose;
  const n = perpOf(dir);
  const prims: Prim[] = [{ t: 'arc', c: p, r: SYMBOL, start: 0, sweep: Math.PI * 2, pen: 'electrical' }];
  if (el.circuit !== undefined) {
    const out = pose.out ?? n;
    prims.push({ t: 'text', p: add(p, scale(out, SYMBOL + 6)), s: String(el.circuit), size: 6, rot: 0, align: 'center' });
  }
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

export interface CircuitWire {
  /** The first device on the circuit. The cable is derived, not stored. */
  id: Id;
  circuit: number;
  a: Vec2;
  b: Vec2;
  /** Height of each end above the level floor. */
  za: number;
  zb: number;
}

/** Center of the device above the floor. A light uses the ceiling. */
export function deviceHeight(device: Electrical['device'], ceilingHeight: number): number {
  if (device === 'light') return ceilingHeight - 0.5;
  if (device === 'switch') return SWITCH_CENTER;
  return RECEPTACLE_CENTER;
}

/**
 * Straight cables joining devices that share a circuit, in plan order.
 * One device on a circuit has no cable.
 */
export function circuitWires(doc: PlanDocument, levelId: Id): CircuitWire[] {
  const ceiling = doc.levels[levelId]?.ceilingHeight ?? 96;
  const groups = new Map<number, Electrical[]>();
  for (const device of electricalOnLevel(doc, levelId)) {
    if (device.circuit === undefined) continue;
    const list = groups.get(device.circuit) ?? [];
    list.push(device);
    groups.set(device.circuit, list);
  }
  const wires: CircuitWire[] = [];
  for (const [circuit, devices] of groups) {
    const placed = devices
      .map((device) => {
        const pose = electricalPose(doc, device);
        return { device, p: pose.p, z: deviceHeight(device.device, ceiling) };
      })
      .sort((p, q) => p.p.x - q.p.x || p.p.y - q.p.y || (p.device.id < q.device.id ? -1 : 1));
    for (let i = 1; i < placed.length; i++) {
      const prev = placed[i - 1]!;
      const next = placed[i]!;
      if (Math.hypot(next.p.x - prev.p.x, next.p.y - prev.p.y, next.z - prev.z) < 1) continue;
      wires.push({ id: placed[0]!.device.id, circuit, a: prev.p, b: next.p, za: prev.z, zb: next.z });
    }
  }
  return wires;
}

export function cableFeet(wires: readonly CircuitWire[]): number {
  return wires.reduce((sum, wire) => sum + Math.hypot(wire.b.x - wire.a.x, wire.b.y - wire.a.y, wire.zb - wire.za), 0) / 12;
}
