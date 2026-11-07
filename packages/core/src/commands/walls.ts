import { add, distance, normalize, POINT_EPS, projectOnSegment, scale, sub } from '../geometry/vec2';
import type { Dimension, DimensionEnd, Id, PlanDocument, Vec2, Wall } from '../model/schema';
import { reconcileObjects, snapshotObjects, type ObjectAnchor } from '../catalog/host';
import { applyFoundationRecipes, foundationRecipes, type FoundationRecipe } from './foundations';
import { applyRoofRecipes } from './roofs';
import { roofRecipes, type RoofRecipe } from '../roofs/follow';
import { openingSpan, openingsOnWall, reconcileOpenings, snapshotOpenings, type OpeningAnchor } from '../openings/openings';
import { reconcileRooms, snapshotRoomPolygons } from '../rooms/rooms';
import { attachNode, getNode, getWall, insertWall, splitWall, tidyGraph, wallEnds } from '../walls/graph';
import { CommandError, defineCommand, type CommandContext } from './history';

interface LayoutBefore {
  openings: Map<Id, OpeningAnchor>;
  objects: Map<Id, ObjectAnchor>;
  rooms: Map<Id, Vec2[]>;
  roofs: RoofRecipe[];
  foundations: FoundationRecipe[];
}

/** Captured at the start of a wall command, so openings, objects and rooms can be matched afterwards. */
function snapshotLayout(doc: PlanDocument): LayoutBefore {
  return { openings: snapshotOpenings(doc), objects: snapshotObjects(doc), rooms: snapshotRoomPolygons(doc), roofs: roofRecipes(doc), foundations: foundationRecipes(doc) };
}

/** Every command that changes the wall graph ends here, so nodes, dimensions, openings, objects and rooms stay consistent. */
function finishWallEdit(doc: PlanDocument, before: LayoutBefore, ctx: CommandContext): void {
  tidyGraph(doc);
  reconcileOpenings(doc, before.openings);
  reconcileObjects(doc, before.objects);
  reconcileRooms(doc, before.rooms, ctx);
  applyRoofRecipes(doc, before.roofs, ctx);
  applyFoundationRecipes(doc, before.foundations, ctx);
}

const MAX_COORD = 1_000_000;
const MAX_LENGTH = 100_000;

function checkPoint(p: Vec2): Vec2 {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > MAX_COORD || Math.abs(p.y) > MAX_COORD) {
    throw new CommandError('That point is out of range.');
  }
  return { x: p.x, y: p.y };
}

function checkLevel(doc: PlanDocument, levelId: Id): void {
  if (!doc.levels[levelId]) throw new CommandError('That level no longer exists.');
}

function checkWallType(doc: PlanDocument, typeId: Id): void {
  if (!doc.wallTypes[typeId]) throw new CommandError('That wall type no longer exists.');
}

function checkHeight(height: number | null): number | null {
  if (height === null) return null;
  if (!Number.isFinite(height) || height <= 0 || height > MAX_LENGTH) throw new CommandError('Wall height must be greater than zero.');
  return height;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const drawWalls = defineCommand<{ levelId: Id; typeId: Id; points: Vec2[]; closed?: boolean }, Id[]>({
  label: (p) => plural(p.points.length + (p.closed ? 1 : 0) - 1, 'Draw Wall', 'Draw Walls'),
  run: (doc, { levelId, typeId, points, closed = false }, ctx) => {
    checkLevel(doc, levelId);
    checkWallType(doc, typeId);
    if (points.length < 2) throw new CommandError('A wall needs a start and an end.');
    const before = snapshotLayout(doc);
    const pts = points.map(checkPoint);
    if (closed) pts.push(pts[0]!);
    const created: Id[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      if (distance(pts[i]!, pts[i + 1]!) <= POINT_EPS) throw new CommandError('A wall needs a length.');
      created.push(...insertWall(doc, levelId, pts[i]!, pts[i + 1]!, { typeId, height: null, baseOffset: 0 }, ctx));
    }
    finishWallEdit(doc, before, ctx);
    return created;
  },
});

export const moveWalls = defineCommand<{ wallIds: Id[]; delta: Vec2 }>({
  label: (p) => plural(p.wallIds.length, 'Move Wall', 'Move Walls'),
  run: (doc, { wallIds, delta }, ctx) => {
    const d = checkPoint(delta);
    if (Math.hypot(d.x, d.y) <= POINT_EPS) return;
    const before = snapshotLayout(doc);
    const nodeIds = new Set<Id>();
    for (const id of wallIds) {
      const wall = getWall(doc, id);
      nodeIds.add(wall.a).add(wall.b);
    }
    for (const id of nodeIds) {
      const node = getNode(doc, id);
      node.p = checkPoint(add(node.p, d));
    }
    for (const id of nodeIds) if (doc.elements[id]) attachNode(doc, id, ctx);
    finishWallEdit(doc, before, ctx);
  },
});

export const moveWallNode = defineCommand<{ nodeId: Id; to: Vec2 }>({
  label: () => 'Move Wall End',
  run: (doc, { nodeId, to }, ctx) => {
    const before = snapshotLayout(doc);
    const node = getNode(doc, nodeId);
    node.p = checkPoint(to);
    attachNode(doc, nodeId, ctx);
    finishWallEdit(doc, before, ctx);
  },
});

export const setWallLength = defineCommand<{ wallId: Id; length: number; keep?: 'a' | 'b' }>({
  label: () => 'Change Wall Length',
  run: (doc, { wallId, length, keep = 'a' }, ctx) => {
    if (!Number.isFinite(length) || length <= POINT_EPS || length > MAX_LENGTH) throw new CommandError('Wall length must be greater than zero.');
    const before = snapshotLayout(doc);
    const wall = getWall(doc, wallId);
    const [a, b] = wallEnds(doc, wall);
    const [fixed, movingId] = keep === 'a' ? [a, wall.b] : [b, wall.a];
    const direction = normalize(keep === 'a' ? sub(b, a) : sub(a, b));
    getNode(doc, movingId).p = checkPoint(add(fixed, scale(direction, length)));
    attachNode(doc, movingId, ctx);
    finishWallEdit(doc, before, ctx);
  },
});

export const splitWallAt = defineCommand<{ wallId: Id; at: Vec2 }, Id>({
  label: () => 'Split Wall',
  run: (doc, { wallId, at }, ctx) => {
    const wall = getWall(doc, wallId);
    const { a, b } = wall;
    const [pa, pb] = wallEnds(doc, wall);
    const s = distance(pa, projectOnSegment(checkPoint(at), pa, pb).point);
    if (openingsOnWall(doc, wallId).some((o) => s > openingSpan(o)[0] && s < openingSpan(o)[1])) {
      throw new CommandError('A wall cannot be broken through a door or window.');
    }
    const before = snapshotLayout(doc);
    const node = splitWall(doc, wallId, checkPoint(at), ctx);
    if (node === a || node === b) throw new CommandError('Split the wall somewhere between its ends.');
    finishWallEdit(doc, before, ctx);
    return node;
  },
});

export type WallChanges = Partial<Pick<Wall, 'typeId' | 'height' | 'baseOffset'>> & {
  roofPitch?: number | null;
  gableEnd?: boolean | null;
};

export const updateWalls = defineCommand<{ wallIds: Id[]; changes: WallChanges }>({
  label: (p) => plural(p.wallIds.length, 'Edit Wall', 'Edit Walls'),
  mergeKey: ({ wallIds, changes }) => `wall.update:${[...wallIds].sort().join(',')}:${Object.keys(changes).sort().join(',')}`,
  run: (doc, { wallIds, changes }, ctx) => {
    if (changes.typeId !== undefined) checkWallType(doc, changes.typeId);
    const height = changes.height === undefined ? undefined : checkHeight(changes.height);
    if (changes.baseOffset !== undefined && (!Number.isFinite(changes.baseOffset) || Math.abs(changes.baseOffset) > MAX_LENGTH)) {
      throw new CommandError('Base offset is out of range.');
    }
    if (changes.roofPitch !== undefined && changes.roofPitch !== null && (!(changes.roofPitch > 0) || changes.roofPitch > 24)) {
      throw new CommandError('Pitch must be greater than 0 and at most 24 in 12.');
    }
    const roofs = roofRecipes(doc);
    for (const id of wallIds) {
      const wall = getWall(doc, id);
      if (changes.typeId !== undefined) wall.typeId = changes.typeId;
      if (height !== undefined) wall.height = height;
      if (changes.baseOffset !== undefined) wall.baseOffset = changes.baseOffset;
      if (changes.roofPitch === null) delete wall.roofPitch;
      else if (changes.roofPitch !== undefined) wall.roofPitch = changes.roofPitch;
      if (changes.gableEnd === true) wall.gableEnd = true;
      else if (changes.gableEnd === false || changes.gableEnd === null) delete wall.gableEnd;
    }
    applyRoofRecipes(doc, roofs, ctx);
  },
});

function checkDimensionEnd(doc: PlanDocument, levelId: Id, end: DimensionEnd): DimensionEnd {
  if (end.nodeId === undefined) return { p: checkPoint(end.p) };
  const node = getNode(doc, end.nodeId);
  if (node.levelId !== levelId) throw new CommandError('A dimension can only measure walls on its own level.');
  return { p: { ...node.p }, nodeId: node.id };
}

export const createDimension = defineCommand<{ levelId: Id; a: DimensionEnd; b: DimensionEnd; offset: number }, Id>({
  label: () => 'Add Dimension',
  run: (doc, { levelId, a, b, offset }, ctx) => {
    checkLevel(doc, levelId);
    const dim: Dimension = {
      id: ctx.newId(),
      kind: 'dimension',
      levelId,
      a: checkDimensionEnd(doc, levelId, a),
      b: checkDimensionEnd(doc, levelId, b),
      offset: Number.isFinite(offset) ? offset : 0,
    };
    if (distance(dim.a.p, dim.b.p) <= POINT_EPS) throw new CommandError('A dimension needs two different points.');
    doc.elements[dim.id] = dim;
    return dim.id;
  },
});

export const updateDimension = defineCommand<{ id: Id; offset: number }>({
  label: () => 'Move Dimension',
  run: (doc, { id, offset }) => {
    const dim = doc.elements[id];
    if (dim?.kind !== 'dimension') throw new CommandError('That dimension no longer exists.');
    if (!Number.isFinite(offset) || Math.abs(offset) > MAX_LENGTH) throw new CommandError('Dimension offset is out of range.');
    dim.offset = offset;
  },
});

export const deleteElements = defineCommand<{ ids: Id[] }>({
  label: (p) => plural(p.ids.length, 'Delete', 'Delete Items'),
  run: (doc, { ids }, ctx) => {
    const before = snapshotLayout(doc);
    for (const id of ids) {
      const el = doc.elements[id];
      if (el && el.kind !== 'wallNode') delete doc.elements[id];
    }
    finishWallEdit(doc, before, ctx);
  },
});

export const wallCommands = {
  'wall.draw': drawWalls,
  'wall.move': moveWalls,
  'wallNode.move': moveWallNode,
  'wall.setLength': setWallLength,
  'wall.split': splitWallAt,
  'wall.update': updateWalls,
  'dimension.create': createDimension,
  'dimension.update': updateDimension,
  'elements.delete': deleteElements,
};
export type WallCommands = typeof wallCommands;
