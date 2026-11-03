import { polygonArea } from '../geometry/vec2';
import { subtractConvex } from '../geometry/polygon';
import { frameLevel } from '../framing/members';
import { defaultWallHeight } from '../model/levels';
import type { PlanDocument, Stair, Vec2 } from '../model/schema';
import { openingsOnWall, wallLength } from '../openings/openings';
import { foundationsOnLevel } from '../foundations/slab';
import { roofsOnLevel } from '../roofs/gable';
import { roomFace, roomsOnLevel } from '../rooms/rooms';
import { handrail, placedFlights, stairOpenings, stairsOnLevel } from '../stairs/straight';
import { formatLength } from '../units/length';
import { wallsOnLevel } from '../walls/graph';
import { computeWallGeometry } from '../walls/joins';

export type TakeoffUnit = 'sq ft' | 'lin ft' | 'cu yd' | 'each';

export interface TakeoffLine {
  category: string;
  name: string;
  quantity: number;
  unit: TakeoffUnit;
}

const CATEGORY_ORDER = ['Walls', 'Framing', 'Floors', 'Ceilings', 'Roof', 'Foundation', 'Openings', 'Stairs'];
const SHEET = new Set(['finish', 'sheathing', 'insulation']);

/**
 * Quantities derived from the plan. Sheet areas are the wall face minus door and window holes.
 * Ceiling area is the room's inside face.
 * Roof area is the sloped area. Concrete is the slab plus the footings, in cubic yards.
 */
export function materialsList(doc: PlanDocument): TakeoffLine[] {
  const lines = new Map<string, TakeoffLine>();
  const add = (category: string, name: string, quantity: number, unit: TakeoffUnit) => {
    if (!(quantity > 1e-6)) return;
    const key = `${category}\0${name}\0${unit}`;
    const existing = lines.get(key);
    if (existing) existing.quantity += quantity;
    else lines.set(key, { category, name, quantity, unit });
  };

  for (const levelId of doc.levelOrder) {
    const level = doc.levels[levelId];
    if (!level) continue;
    const heightOf = defaultWallHeight(doc.levels, doc.levelOrder, levelId);
    for (const wall of wallsOnLevel(doc, levelId)) {
      const length = wallLength(doc, wall);
      const height = wall.height ?? heightOf;
      const holes = openingsOnWall(doc, wall.id).reduce((sum, opening) => sum + opening.width * opening.height, 0);
      const net = Math.max(0, length * height - holes) / 144;
      const type = doc.wallTypes[wall.typeId];
      if (!type) continue;
      for (const layer of type.layers) {
        if (!SHEET.has(layer.fn)) continue;
        const material = doc.materials[layer.materialId];
        if (material) add('Walls', material.name, net, 'sq ft');
      }
    }

    const framed = frameLevel(doc, levelId, computeWallGeometry(doc, levelId));
    let studs = 0;
    let plates = 0;
    let headers = 0;
    let extras = 0;
    for (const wall of framed) {
      for (const member of wall.members) {
        const length = Math.abs(member.s1 - member.s0);
        if (member.kind === 'stud' || member.kind === 'king') studs += 1;
        else if (member.kind === 'bottom-plate' || member.kind === 'top-plate') plates += length;
        else if (member.kind === 'header') headers += length;
        else extras += 1;
      }
    }
    add('Framing', 'Studs', studs, 'each');
    add('Framing', 'Plates', plates / 12, 'lin ft');
    add('Framing', 'Headers', headers / 12, 'lin ft');
    add('Framing', 'Trimmers and cripples', extras, 'each');

    const arriving = Object.values(doc.elements).filter((el): el is Stair => el.kind === 'stair' && el.toLevelId === levelId);
    const leaving = stairsOnLevel(doc, levelId);
    let floor = 0;
    let ceiling = 0;
    for (const room of roomsOnLevel(doc, levelId)) {
      const face = roomFace(doc, room);
      if (!face) continue;
      floor += openArea(face.polygon, arriving);
      if (level.ceilingFinish > 0) ceiling += openArea(face.polygon, leaving);
    }
    add('Floors', 'Finished floor', floor / 144, 'sq ft');
    const gypsum = Object.values(doc.materials).find((material) => material.category === 'drywall')?.name ?? 'Gypsum board 1/2"';
    add('Ceilings', gypsum, ceiling / 144, 'sq ft');

    for (const roof of roofsOnLevel(doc, levelId)) {
      const sheathing = Object.values(doc.materials).find((material) => material.category === 'sheathing')?.name ?? 'Roof sheathing';
      const sloped = Math.abs(polygonArea(roof.polygon)) * Math.hypot(1, roof.pitch / 12);
      add('Roof', sheathing, sloped / 144, 'sq ft');
    }

    let concrete = 0;
    for (const foundation of foundationsOnLevel(doc, levelId)) {
      concrete += Math.abs(polygonArea(foundation.polygon)) * foundation.thickness;
      for (const stem of foundation.stems ?? []) concrete += Math.abs(polygonArea(stem)) * (foundation.thickness + (foundation.stemRise ?? 0));
      for (const footing of foundation.footings) concrete += Math.abs(polygonArea(footing)) * foundation.footingDepth;
    }
    add('Foundation', 'Concrete', concrete / 46656, 'cu yd');

    let treads = 0;
    let rail = 0;
    for (const stair of stairsOnLevel(doc, levelId)) {
      for (const flight of placedFlights(stair)) {
        treads += Math.max(0, flight.risers - 1);
        const bar = handrail(flight, (level?.elevation ?? 0) + flight.rise0);
        if (bar) rail += Math.hypot(bar.b.x - bar.a.x, bar.b.y - bar.a.y, bar.b.z - bar.a.z);
      }
    }
    add('Stairs', 'Stair treads', treads, 'each');
    add('Stairs', 'Handrail', rail / 12, 'lin ft');
  }

  for (const el of Object.values(doc.elements)) {
    if (el.kind !== 'door' && el.kind !== 'window') continue;
    const name = `${el.kind === 'door' ? 'Door' : 'Window'} ${formatLength(el.width, doc.settings.lengthFormat)} × ${formatLength(el.height, doc.settings.lengthFormat)}`;
    add('Openings', name, 1, 'each');
  }

  return [...lines.values()].sort((a, b) => {
    const category = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    return category !== 0 ? category : a.name.localeCompare(b.name);
  });
}

/** CSV with a header row. Names that contain a comma or quote are quoted. */
export function materialsCsv(list: readonly TakeoffLine[]): string {
  const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
  const rows = [['Category', 'Item', 'Quantity', 'Unit'], ...list.map((line) => [line.category, line.name, String(line.quantity), line.unit])];
  return rows.map((row) => row.map(cell).join(',')).join('\n');
}

/** Area of a room face after each stair footprint is removed. */
function openArea(polygon: Vec2[], stairs: readonly Stair[]): number {
  let pieces = [polygon];
  for (const stair of stairs) {
    for (const hole of stairOpenings(stair)) pieces = pieces.flatMap((piece) => subtractConvex(piece, hole));
  }
  return pieces.reduce((sum, piece) => sum + Math.abs(polygonArea(piece)), 0);
}
