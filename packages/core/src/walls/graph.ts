import { CommandError, type CommandContext } from '../commands/history';
import { distance, POINT_EPS, projectOnSegment, samePoint, segmentIntersection } from '../geometry/vec2';
import type { Id, PlanDocument, Vec2, Wall, WallNode, WallType } from '../model/schema';

export type WallTemplate = Pick<Wall, 'typeId' | 'height' | 'baseOffset'>;

export function wallThickness(type: WallType): number {
  return type.layers.reduce((sum, layer) => sum + layer.thickness, 0);
}

export function wallsOnLevel(doc: PlanDocument, levelId: Id): Wall[] {
  return Object.values(doc.elements).filter((el): el is Wall => el.kind === 'wall' && el.levelId === levelId);
}

export function nodesOnLevel(doc: PlanDocument, levelId: Id): WallNode[] {
  return Object.values(doc.elements).filter((el): el is WallNode => el.kind === 'wallNode' && el.levelId === levelId);
}

export function wallsAtNode(doc: PlanDocument, nodeId: Id): Wall[] {
  return Object.values(doc.elements).filter((el): el is Wall => el.kind === 'wall' && (el.a === nodeId || el.b === nodeId));
}

export function getNode(doc: PlanDocument, id: Id): WallNode {
  const node = doc.elements[id];
  if (node?.kind !== 'wallNode') throw new CommandError('That wall end no longer exists.');
  return node;
}

export function getWall(doc: PlanDocument, id: Id): Wall {
  const wall = doc.elements[id];
  if (wall?.kind !== 'wall') throw new CommandError('That wall no longer exists.');
  return wall;
}

export function wallEnds(doc: PlanDocument, wall: Wall): [Vec2, Vec2] {
  return [getNode(doc, wall.a).p, getNode(doc, wall.b).p];
}

export function addNode(doc: PlanDocument, levelId: Id, p: Vec2, ctx: CommandContext): WallNode {
  const node: WallNode = { id: ctx.newId(), kind: 'wallNode', levelId, p: { x: p.x, y: p.y } };
  doc.elements[node.id] = node;
  return node;
}

function findWallBetween(doc: PlanDocument, a: Id, b: Id): Wall | undefined {
  return wallsAtNode(doc, a).find((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a));
}

/** Splits a wall at the point on it nearest `p`. Returns the node there (an existing end if `p` is at one). */
export function splitWall(doc: PlanDocument, wallId: Id, p: Vec2, ctx: CommandContext): Id {
  const wall = getWall(doc, wallId);
  const [a, b] = wallEnds(doc, wall);
  const { point } = projectOnSegment(p, a, b);
  if (samePoint(point, a)) return wall.a;
  if (samePoint(point, b)) return wall.b;
  const node = addNode(doc, wall.levelId, point, ctx);
  const second: Wall = { ...wall, id: ctx.newId(), a: node.id, b: wall.b };
  wall.b = node.id;
  doc.elements[second.id] = second;
  return node.id;
}

/** The wall interior (not an end) that `p` lies on, if any. */
function wallContaining(doc: PlanDocument, levelId: Id, p: Vec2, ignoreNode?: Id): Wall | undefined {
  return wallsOnLevel(doc, levelId).find((wall) => {
    if (wall.a === ignoreNode || wall.b === ignoreNode) return false;
    const [a, b] = wallEnds(doc, wall);
    const hit = projectOnSegment(p, a, b);
    return hit.distance <= POINT_EPS && !samePoint(hit.point, a) && !samePoint(hit.point, b);
  });
}

function nodeAt(doc: PlanDocument, levelId: Id, p: Vec2, ignore?: Id): WallNode | undefined {
  return nodesOnLevel(doc, levelId).find((n) => n.id !== ignore && samePoint(n.p, p));
}

/** Returns the node at `p`: an existing node, a new node splitting the wall under `p`, or a new free node. */
export function locatePoint(doc: PlanDocument, levelId: Id, p: Vec2, ctx: CommandContext): Id {
  const existing = nodeAt(doc, levelId, p);
  if (existing) return existing.id;
  const host = wallContaining(doc, levelId, p);
  if (host) return splitWall(doc, host.id, p, ctx);
  return addNode(doc, levelId, p, ctx).id;
}

/**
 * Adds a straight wall from p to q, joining it into the wall graph: ends snap onto existing nodes or split the
 * walls they land on, crossings split both walls, and stretches that duplicate an existing wall are skipped.
 */
export function insertWall(doc: PlanDocument, levelId: Id, p: Vec2, q: Vec2, template: WallTemplate, ctx: CommandContext): Id[] {
  const start = locatePoint(doc, levelId, p, ctx);
  const end = locatePoint(doc, levelId, q, ctx);
  if (start === end) return [];
  const P = getNode(doc, start).p;
  const Q = getNode(doc, end).p;
  const len = distance(P, Q);

  const along = new Map<Id, number>([
    [start, 0],
    [end, 1],
  ]);
  const consider = (nodeId: Id, point: Vec2) => {
    const t = projectOnSegment(point, P, Q).t;
    if (!along.has(nodeId) && t * len > POINT_EPS && (1 - t) * len > POINT_EPS) along.set(nodeId, t);
  };

  for (const wall of wallsOnLevel(doc, levelId)) {
    if (!doc.elements[wall.id]) continue;
    const [a, b] = wallEnds(doc, wall);
    const hit = segmentIntersection(P, Q, a, b);
    if (hit) {
      if (samePoint(hit.point, P) || samePoint(hit.point, Q)) continue;
      if (samePoint(hit.point, a)) consider(wall.a, a);
      else if (samePoint(hit.point, b)) consider(wall.b, b);
      else consider(splitWall(doc, wall.id, hit.point, ctx), hit.point);
      continue;
    }
    // Parallel: collinear walls overlapping the new one contribute their ends.
    for (const [id, point] of [
      [wall.a, a],
      [wall.b, b],
    ] as const) {
      if (projectOnSegment(point, P, Q).distance <= POINT_EPS) consider(id, point);
    }
  }

  const chain = [...along.entries()].sort((x, y) => x[1] - y[1]).map(([id]) => id);
  const created: Id[] = [];
  for (let i = 0; i + 1 < chain.length; i++) {
    const u = chain[i]!;
    const v = chain[i + 1]!;
    if (findWallBetween(doc, u, v)) continue;
    const wall: Wall = { id: ctx.newId(), kind: 'wall', levelId, a: u, b: v, ...template };
    doc.elements[wall.id] = wall;
    created.push(wall.id);
  }
  return created;
}

/** Moves every wall from node `from` onto node `into`, dropping walls that collapse or duplicate another. */
export function mergeNode(doc: PlanDocument, from: Id, into: Id): void {
  if (from === into) return;
  for (const wall of wallsAtNode(doc, from)) {
    if (wall.a === from) wall.a = into;
    if (wall.b === from) wall.b = into;
    const other = wall.a === into ? wall.b : wall.a;
    const duplicate = wallsAtNode(doc, into).some(
      (w) => w.id !== wall.id && ((w.a === into && w.b === other) || (w.b === into && w.a === other)),
    );
    if (wall.a === wall.b || duplicate) delete doc.elements[wall.id];
  }
  for (const el of Object.values(doc.elements)) {
    if (el.kind !== 'dimension') continue;
    if (el.a.nodeId === from) el.a.nodeId = into;
    if (el.b.nodeId === from) el.b.nodeId = into;
  }
  delete doc.elements[from];
}

/** After a node moves: joins it to a node or wall it now touches. Returns the id of the node that remains. */
export function attachNode(doc: PlanDocument, nodeId: Id, ctx: CommandContext): Id {
  const node = getNode(doc, nodeId);
  const other = nodeAt(doc, node.levelId, node.p, nodeId);
  if (other) {
    mergeNode(doc, nodeId, other.id);
    return other.id;
  }
  const host = wallContaining(doc, node.levelId, node.p, nodeId);
  if (host) {
    const at = splitWall(doc, host.id, node.p, ctx);
    mergeNode(doc, nodeId, at);
    return at;
  }
  return nodeId;
}

export function removeOrphanNodes(doc: PlanDocument): void {
  const used = new Set<Id>();
  for (const el of Object.values(doc.elements)) if (el.kind === 'wall') used.add(el.a).add(el.b);
  for (const el of Object.values(doc.elements)) if (el.kind === 'wallNode' && !used.has(el.id)) delete doc.elements[el.id];
}

/** Keeps each dimension end's stored point on its node, and detaches ends whose node is gone. */
export function syncDimensions(doc: PlanDocument): void {
  for (const el of Object.values(doc.elements)) {
    if (el.kind !== 'dimension') continue;
    for (const end of [el.a, el.b]) {
      if (end.nodeId === undefined) continue;
      const node = doc.elements[end.nodeId];
      if (node?.kind === 'wallNode' && node.levelId === el.levelId) end.p = { x: node.p.x, y: node.p.y };
      else delete end.nodeId;
    }
  }
}

/** Removes orphans and resyncs dimensions; every wall command finishes with this. */
export function tidyGraph(doc: PlanDocument): void {
  removeOrphanNodes(doc);
  syncDimensions(doc);
}
