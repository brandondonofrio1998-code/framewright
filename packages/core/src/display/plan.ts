import { distance } from '../geometry/vec2';
import { objectPrims } from '../catalog/symbols';
import { frameLevel, memberQuad } from '../framing/members';
import { floorJoists } from '../foundations/joists';
import { FLOOR_FINISH, foundationsOnLevel } from '../foundations/slab';
import { balusterFoot, deckBalusters, deckGuardedEdges, deckJoists, deckPolygon, deckStair, deckStairDrop, decksOnLevel } from '../decks/deck';
import { handrails, landingPolygon, placedFlights, stairCorners, stairTreadLines, stairsOnLevel, winderTreads } from '../stairs/straight';
import { circuitWires, electricalItem, electricalOnLevel } from '../electrical/devices';
import { plumbingItem, plumbingOnLevel } from '../plumbing/fixtures';
import { siteItem, siteOnLevel } from '../site/marks';
import { plantItem, plantsOnLevel } from '../plants/tree';
import { pipeItem, pipesOnLevel } from '../pipes/pipe';
import { roadItem, roadsOnLevel } from '../roads/drive';
import { roofsOnLevel } from '../roofs/gable';
import type { Cad, Dimension, DimensionEnd, Id, Opening, PlanDocument, Room, Vec2, WallLayer } from '../model/schema';
import { openingsOnLevel } from '../openings/openings';
import { formatArea, roomFace, roomsOnLevel } from '../rooms/rooms';
import { formatLength } from '../units/length';
import { computeWallGeometry, type WallGeometry } from '../walls/joins';
import { dimensionPrims, type DisplayItem, type FillId, type Prim } from './display-list';
import { cutWallPrims, openingPrims } from './openings';

const FILL_BY_FUNCTION: Record<WallLayer['fn'], FillId> = {
  structure: 'wall.structure',
  sheathing: 'wall.sheathing',
  insulation: 'wall.insulation',
  finish: 'wall.finish',
  air: 'wall.air',
};

/** Where a dimension end is now: on its wall node if attached, otherwise at its stored point. */
export function resolveDimensionEnd(doc: PlanDocument, end: DimensionEnd): Vec2 {
  if (end.nodeId !== undefined) {
    const node = doc.elements[end.nodeId];
    if (node?.kind === 'wallNode') return node.p;
  }
  return end.p;
}

const ROOM_TEXT = 8;

function cadReference(el: Cad): Prim[] {
  return el.prims.map((prim) => {
    if (prim.t === 'line') return { t: 'line', a: prim.a, b: prim.b, pen: 'reference' };
    if (prim.t === 'polyline') return { t: 'polyline', pts: prim.pts, closed: prim.closed, pen: 'reference' };
    if (prim.t === 'arc') return { t: 'arc', c: prim.c, r: prim.r, start: prim.start, sweep: prim.sweep, pen: 'reference' };
    return { t: 'text', p: prim.p, s: prim.s, size: prim.size, rot: 0, align: 'left' };
  });
}

function roomLabel(room: Room, area: number): Prim[] {
  return [
    { t: 'text', p: { x: room.seed.x, y: room.seed.y + ROOM_TEXT * 0.3 }, s: room.name, size: ROOM_TEXT, rot: 0, align: 'center' },
    { t: 'text', p: room.seed, s: formatArea(area), size: ROOM_TEXT * 0.75, rot: 0, align: 'center' },
  ];
}

export function dimensionsOnLevel(doc: PlanDocument, levelId: Id): Dimension[] {
  return Object.values(doc.elements).filter((el): el is Dimension => el.kind === 'dimension' && el.levelId === levelId);
}

export function wallDisplayItem(geom: WallGeometry, openings: Opening[] = []): DisplayItem {
  if (openings.length > 0) return { elementId: geom.wallId, layer: 'walls', prims: cutWallPrims(geom, openings, (fn) => FILL_BY_FUNCTION[fn]) };
  const prims: Prim[] = geom.layers.map((layer) => ({ t: 'poly', rings: [layer.polygon], fill: FILL_BY_FUNCTION[layer.fn] }));
  for (const [a, b] of geom.layerLines) prims.push({ t: 'line', a, b, pen: 'wall.layer' });
  for (const [a, b] of [geom.leftFace, geom.rightFace, ...geom.caps]) prims.push({ t: 'line', a, b, pen: 'wall.face' });
  return { elementId: geom.wallId, layer: 'walls', prims };
}

export interface PlanDisplayOptions {
  /** Precomputed geometry for `levelId` (computed if omitted). */
  geometry?: Map<Id, WallGeometry>;
  /** Draw the level below as a faint reference. */
  showReference?: boolean;
}

/** Everything the plan view (and later PDF/DXF export) draws for one level, in model inches. */
export function buildPlanDisplayList(doc: PlanDocument, levelId: Id, options: PlanDisplayOptions = {}): DisplayItem[] {
  const items: DisplayItem[] = [];
  const index = doc.levelOrder.indexOf(levelId);
  const belowId = index > 0 ? doc.levelOrder[index - 1] : undefined;
  if (options.showReference !== false && belowId) {
    const prims: Prim[] = [];
    for (const geom of computeWallGeometry(doc, belowId).values()) {
      prims.push({ t: 'polyline', pts: geom.footprint, closed: true, pen: 'reference' });
    }
    if (prims.length > 0) items.push({ layer: 'reference', prims });
  }

  const geometry = options.geometry ?? computeWallGeometry(doc, levelId);
  const byWall = new Map<Id, Opening[]>();
  for (const o of openingsOnLevel(doc, levelId)) byWall.set(o.wallId, [...(byWall.get(o.wallId) ?? []), o]);
  for (const geom of geometry.values()) items.push(wallDisplayItem(geom, byWall.get(geom.wallId)));
  for (const framed of frameLevel(doc, levelId, geometry)) {
    const geom = geometry.get(framed.wallId);
    if (!geom) continue;
    const prims: Prim[] = [];
    for (const member of framed.members) {
      if (member.kind !== 'stud' && member.kind !== 'king' && member.kind !== 'jack') continue;
      prims.push({ t: 'polyline', pts: memberQuad(geom.a, geom.b, framed.off0, framed.off1, member.s0, member.s1), closed: true, pen: 'wall.layer' });
    }
    if (prims.length > 0) items.push({ elementId: framed.wallId, layer: 'walls', prims });
  }
  for (const [wallId, openings] of byWall) {
    const geom = geometry.get(wallId);
    if (!geom) continue;
    for (const o of openings) items.push({ elementId: o.id, layer: 'openings', prims: openingPrims(geom, o) });
  }

  for (const el of Object.values(doc.elements)) {
    if (el.kind !== 'object' || el.levelId !== levelId) continue;
    const prims = objectPrims(doc, el);
    if (prims.length > 0) items.push({ elementId: el.id, layer: 'objects', prims });
  }
  for (const room of roomsOnLevel(doc, levelId)) {
    const face = roomFace(doc, room);
    if (!face) continue;
    items.push({ elementId: room.id, layer: 'rooms', prims: roomLabel(room, face.area) });
  }
  for (const roof of roofsOnLevel(doc, levelId)) {
    items.push({
      layer: 'roof',
      prims: [{ t: 'polyline', pts: roof.polygon, closed: true, pen: 'roof' }],
    });
  }
  for (const foundation of foundationsOnLevel(doc, levelId)) {
    items.push({
      elementId: foundation.id,
      layer: 'foundation',
      prims: [
        { t: 'polyline', pts: foundation.polygon, closed: true, pen: 'foundation' },
        ...foundation.footings.map((footing): Prim => ({ t: 'polyline', pts: footing, closed: true, pen: 'foundation' })),
        ...(foundation.stems ?? []).map((stem): Prim => ({ t: 'polyline', pts: stem, closed: true, pen: 'foundation' })),
        ...floorJoists(foundation, (doc.levels[levelId]?.elevation ?? 0) - FLOOR_FINISH).map((joist): Prim => ({ t: 'polyline', pts: joist.polygon, closed: true, pen: 'wall.layer' })),
      ],
    });
  }
  for (const stair of stairsOnLevel(doc, levelId)) {
    const prims: Prim[] = [];
    for (const flight of placedFlights(stair)) {
      prims.push({ t: 'polyline', pts: stairCorners(flight), closed: true, pen: 'stair' });
      prims.push(...stairTreadLines(flight).map(([a, b]): Prim => ({ t: 'line', a, b, pen: 'stair' })));
      for (const rail of handrails(flight, flight.rise0)) prims.push({ t: 'line', a: { x: rail.a.x, y: rail.a.y }, b: { x: rail.b.x, y: rail.b.y }, pen: 'stair' });
    }
    const landing = landingPolygon(stair);
    if (landing) prims.push({ t: 'polyline', pts: landing, closed: true, pen: 'stair' });
    for (const wedge of winderTreads(stair)) prims.push({ t: 'polyline', pts: wedge, closed: true, pen: 'stair' });
    items.push({ elementId: stair.id, layer: 'stairs', prims });
  }
  for (const el of Object.values(doc.elements)) {
    if (el.kind !== 'stair' || el.toLevelId !== levelId || el.levelId === levelId) continue;
    const prims: Prim[] = placedFlights(el).map((flight) => ({ t: 'polyline' as const, pts: stairCorners(flight), closed: true, pen: 'stair' as const }));
    const landing = landingPolygon(el);
    if (landing) prims.push({ t: 'polyline', pts: landing, closed: true, pen: 'stair' });
    for (const wedge of winderTreads(el)) prims.push({ t: 'polyline', pts: wedge, closed: true, pen: 'stair' });
    items.push({ elementId: el.id, layer: 'stairs', prims });
  }
  for (const deck of decksOnLevel(doc, levelId)) {
    const outline = deckPolygon(deck);
    const flight = deckStair(deck, deckStairDrop(doc, deck));
    const gap = flight ? flight.width : 0;
    const prims: Prim[] = [
      { t: 'polyline', pts: outline, closed: true, pen: 'deck' },
      ...deckJoists(deck).map((joist): Prim => ({ t: 'polyline', pts: joist, closed: true, pen: 'deck' })),
      ...deckGuardedEdges(deck, gap).map(([a, b]): Prim => ({ t: 'line', a, b, pen: 'deck' })),
      ...deckBalusters(deck, gap).map((spindle): Prim => ({ t: 'polyline', pts: balusterFoot(spindle), closed: true, pen: 'deck' })),
    ];
    if (flight) {
      prims.push({ t: 'polyline', pts: stairCorners(flight), closed: true, pen: 'stair' });
      prims.push(...stairTreadLines(flight).map(([a, b]): Prim => ({ t: 'line', a, b, pen: 'stair' })));
      for (const rail of handrails(flight, flight.rise0)) prims.push({ t: 'line', a: { x: rail.a.x, y: rail.a.y }, b: { x: rail.b.x, y: rail.b.y }, pen: 'stair' });
    }
    items.push({ elementId: deck.id, layer: 'deck', prims });
  }
  for (const device of electricalOnLevel(doc, levelId)) items.push(electricalItem(doc, device));
  for (const wire of circuitWires(doc, levelId)) {
    if (Math.hypot(wire.b.x - wire.a.x, wire.b.y - wire.a.y) < 1) continue;
    items.push({ elementId: wire.id, layer: 'electrical', prims: [{ t: 'line', a: wire.a, b: wire.b, pen: 'electrical' }] });
  }
  for (const fixture of plumbingOnLevel(doc, levelId)) items.push(plumbingItem(doc, fixture));
  for (const pipe of pipesOnLevel(doc, levelId)) items.push(pipeItem(pipe));
  for (const mark of siteOnLevel(doc, levelId)) {
    const item = siteItem(mark);
    if (item) items.push(item);
  }
  for (const plant of plantsOnLevel(doc, levelId)) items.push(plantItem(plant));
  for (const road of roadsOnLevel(doc, levelId)) items.push(roadItem(road));

  for (const el of Object.values(doc.elements)) {
    if (el.kind !== 'cad' || el.levelId !== levelId) continue;
    items.push({ elementId: el.id, layer: 'reference', prims: cadReference(el) });
  }
  for (const el of Object.values(doc.elements)) {
    if (el.kind !== 'text' || el.levelId !== levelId) continue;
    items.push({ elementId: el.id, layer: 'text', prims: [{ t: 'text', p: el.p, s: el.text, size: el.size, rot: el.rot ?? 0, align: 'left' }] });
  }

  const format = doc.settings.lengthFormat;
  for (const dim of dimensionsOnLevel(doc, levelId)) {
    const a = resolveDimensionEnd(doc, dim.a);
    const b = resolveDimensionEnd(doc, dim.b);
    items.push({ elementId: dim.id, layer: 'dimensions', prims: dimensionPrims(a, b, dim.offset, formatLength(distance(a, b), format)) });
  }
  return items;
}
