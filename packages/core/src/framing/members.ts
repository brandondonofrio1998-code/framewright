import { distance, normalize, perp, sub } from '../geometry/vec2';
import { defaultWallHeight } from '../model/levels';
import type { Id, Opening, PlanDocument, Vec2 } from '../model/schema';
import { openingSpan, openingsOnWall } from '../openings/openings';
import { wallsOnLevel } from '../walls/graph';
import type { WallGeometry } from '../walls/joins';

/** 16" on center, the ordinary stud spacing. */
export const STUD_SPACING = 16;
/** Actual thickness of a plate or stud along the wall, in inches. */
export const PLATE = 1.5;

export type MemberKind = 'bottom-plate' | 'top-plate' | 'stud' | 'king' | 'jack' | 'header' | 'sill' | 'cripple';

export interface FramingMember {
  kind: MemberKind;
  /** Distances along the wall from node a. */
  s0: number;
  s1: number;
  z0: number;
  z1: number;
}

export interface WallFraming {
  wallId: Id;
  materialId: Id;
  /** Perpendicular offsets of the structure layer, left of a → b. */
  off0: number;
  off1: number;
  members: FramingMember[];
}

/**
 * Depth of a doubled header from the clear opening width.
 * 3'-0" and under is a 2x4, then 2x6, 2x8, 2x10, and 2x12. This is Framewright's
 * schedule, not a snow-load span table.
 */
export function headerDepth(clearWidth: number): number {
  if (clearWidth <= 36) return 3.5;
  if (clearWidth <= 48) return 5.5;
  if (clearWidth <= 72) return 7.25;
  if (clearWidth <= 96) return 9.25;
  return 11.25;
}

/** Trimmers under each end of the header: one up to 6', two up to 8', three past that. */
export function jackCount(clearWidth: number): number {
  if (clearWidth <= 72) return 1;
  if (clearWidth <= 96) return 2;
  return 3;
}

/** Stud centers from one end to the other, 16" apart, with a stud flush at each end. */
export function studCenters(length: number): number[] {
  if (length < PLATE + 1e-3) return length > 1 ? [length / 2] : [];
  const inset = PLATE / 2;
  const last = length - inset;
  const centers: number[] = [];
  for (let s = inset; s < last - inset; s += STUD_SPACING) centers.push(s);
  centers.push(last);
  return centers;
}

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 - 1e-3 && b0 < a1 - 1e-3;
}

function put(members: FramingMember[], kind: MemberKind, s0: number, s1: number, z0: number, z1: number, length: number): void {
  const a = Math.max(0, Math.min(s0, s1));
  const b = Math.min(length, Math.max(s0, s1));
  if (b - a < 0.5 || z1 - z0 < 0.5) return;
  members.push({ kind, s0: a, s1: b, z0, z1 });
}

function subtractSpan(spans: [number, number][], cut0: number, cut1: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of spans) {
    if (cut1 <= a || cut0 >= b) out.push([a, b]);
    else {
      if (cut0 > a) out.push([a, cut0]);
      if (cut1 < b) out.push([cut1, b]);
    }
  }
  return out;
}

function frameOne(geom: WallGeometry, openings: readonly Opening[], z0: number, z1: number): WallFraming | null {
  const structure = geom.layers.find((layer) => layer.fn === 'structure');
  if (!structure) return null;
  const length = distance(geom.a, geom.b);
  if (length < 1) return null;
  const u = normalize(sub(geom.b, geom.a));
  const n = perp(u);
  let off0 = Infinity;
  let off1 = -Infinity;
  for (const p of structure.polygon) {
    const off = (p.x - geom.a.x) * n.x + (p.y - geom.a.y) * n.y;
    off0 = Math.min(off0, off);
    off1 = Math.max(off1, off);
  }
  if (!(off1 - off0 > 0.5)) return null;

  const studBottom = z0 + PLATE;
  const studTop = z1 - PLATE * 2;
  const members: FramingMember[] = [];

  let plates: [number, number][] = [[0, length]];
  const blocked: [number, number][] = [];
  for (const opening of openings) {
    const [clear0, clear1] = openingSpan(opening);
    const jacks = jackCount(opening.width);
    const side = jacks * PLATE + PLATE;
    blocked.push([clear0 - side, clear1 + side]);
    const head = opening.kind === 'window' ? z0 + opening.sill + opening.height : z0 + opening.height;
    const depth = Math.min(headerDepth(opening.width), Math.max(0, studTop - head));
    const headerS0 = clear0 - jacks * PLATE;
    const headerS1 = clear1 + jacks * PLATE;
    if (opening.kind === 'door') plates = subtractSpan(plates, clear0, clear1);
    for (let i = 0; i < jacks; i++) {
      put(members, 'jack', clear0 - (i + 1) * PLATE, clear0 - i * PLATE, studBottom, head, length);
      put(members, 'jack', clear1 + i * PLATE, clear1 + (i + 1) * PLATE, studBottom, head, length);
    }
    put(members, 'king', clear0 - side, clear0 - jacks * PLATE, studBottom, studTop, length);
    put(members, 'king', clear1 + jacks * PLATE, clear1 + side, studBottom, studTop, length);
    put(members, 'header', headerS0, headerS1, head, head + depth, length);
    if (studTop - (head + depth) >= 0.5) {
      for (const center of studCenters(headerS1 - headerS0)) {
        const s = headerS0 + center;
        put(members, 'cripple', s - PLATE / 2, s + PLATE / 2, head + depth, studTop, length);
      }
    }
    if (opening.kind === 'window') {
      const sillTop = z0 + opening.sill;
      put(members, 'sill', clear0, clear1, sillTop - PLATE, sillTop, length);
      for (const center of studCenters(clear1 - clear0)) {
        const s = clear0 + center;
        put(members, 'cripple', s - PLATE / 2, s + PLATE / 2, studBottom, sillTop - PLATE, length);
      }
    }
  }

  for (const center of studCenters(length)) {
    const s0 = center - PLATE / 2;
    const s1 = center + PLATE / 2;
    if (blocked.some(([a, b]) => overlaps(s0, s1, a, b))) continue;
    put(members, 'stud', s0, s1, studBottom, studTop, length);
  }
  for (const [s0, s1] of plates) put(members, 'bottom-plate', s0, s1, z0, studBottom, length);
  put(members, 'top-plate', 0, length, studTop, studTop + PLATE, length);
  put(members, 'top-plate', 0, length, studTop + PLATE, z1, length);

  return { wallId: geom.wallId, materialId: structure.materialId, off0, off1, members };
}

/** The rectangle of a member in plan, in the structure layer. */
export function memberQuad(a: Vec2, b: Vec2, off0: number, off1: number, s0: number, s1: number): Vec2[] {
  const u = normalize(sub(b, a));
  const n = perp(u);
  const at = (s: number, off: number): Vec2 => ({ x: a.x + u.x * s + n.x * off, y: a.y + u.y * s + n.y * off });
  return [at(s0, off0), at(s1, off0), at(s1, off1), at(s0, off1)];
}

/** Plates, studs, trimmers, and headers for every wall on a level. Derived, never saved. */
export function frameLevel(doc: PlanDocument, levelId: Id, geometry: ReadonlyMap<Id, WallGeometry>): WallFraming[] {
  const level = doc.levels[levelId];
  if (!level) return [];
  const height = defaultWallHeight(doc.levels, doc.levelOrder, levelId);
  const framed: WallFraming[] = [];
  for (const wall of wallsOnLevel(doc, levelId)) {
    const geom = geometry.get(wall.id);
    if (!geom) continue;
    const z0 = level.elevation + wall.baseOffset;
    const z1 = z0 + (wall.height ?? height);
    const one = frameOne(geom, openingsOnWall(doc, wall.id), z0, z1);
    if (one && one.members.length > 0) framed.push(one);
  }
  return framed;
}
