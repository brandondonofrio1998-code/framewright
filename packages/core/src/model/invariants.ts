import { produce } from 'immer';
import { lookLength, MIN_LOOK } from '../view/walk';
import { ELEVATION_EPS, restackLevels, stackedElevation } from './levels';
import type { Id, PlanDocument, Wall, WallNode } from './schema';

export const LENGTH_EPS = 1e-4;

function wallLength(a: WallNode, b: WallNode): number {
  return Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y);
}

function hostLength(doc: PlanDocument, wall: Wall): number {
  const a = doc.elements[wall.a];
  const b = doc.elements[wall.b];
  return a?.kind === 'wallNode' && b?.kind === 'wallNode' ? wallLength(a, b) : 0;
}

/** Returns human-readable descriptions of every broken invariant (empty = valid). */
export function checkInvariants(doc: PlanDocument): string[] {
  const problems: string[] = [];
  const levelIds = Object.keys(doc.levels);

  for (const [key, level] of Object.entries(doc.levels)) if (key !== level.id) problems.push(`level key ${key} != id ${level.id}`);
  for (const [key, type] of Object.entries(doc.wallTypes)) if (key !== type.id) problems.push(`wall type key ${key} != id ${type.id}`);
  for (const [key, mat] of Object.entries(doc.materials)) if (key !== mat.id) problems.push(`material key ${key} != id ${mat.id}`);
  for (const [key, def] of Object.entries(doc.catalogDefs)) if (key !== def.id) problems.push(`catalog def key ${key} != id ${def.id}`);
  for (const [key, el] of Object.entries(doc.elements)) if (key !== el.id) problems.push(`element key ${key} != id ${el.id}`);
  if (doc.layerSets) {
    const ids = doc.layerSets.map((set) => set.id);
    if (new Set(ids).size !== ids.length) problems.push('layer sets repeat an id');
    if (doc.activeLayerSet && !ids.includes(doc.activeLayerSet)) problems.push('the active layer set is missing');
  } else if (doc.activeLayerSet) problems.push('the active layer set is missing');

  if (doc.levelOrder.length === 0) problems.push('document has no levels');
  if (new Set(doc.levelOrder).size !== doc.levelOrder.length) problems.push('levelOrder has duplicates');
  if (doc.levelOrder.length !== levelIds.length || doc.levelOrder.some((id) => !doc.levels[id])) {
    problems.push('levelOrder does not match levels');
  }
  for (let i = 1; i < doc.levelOrder.length; i++) {
    const below = doc.levels[doc.levelOrder[i - 1] ?? ''];
    const level = doc.levels[doc.levelOrder[i] ?? ''];
    if (below && level && Math.abs(level.elevation - stackedElevation(below, level)) > ELEVATION_EPS) {
      problems.push(`level ${level.name} is not stacked on ${below.name}`);
    }
  }

  for (const type of Object.values(doc.wallTypes)) {
    for (const layer of type.layers) if (!doc.materials[layer.materialId]) problems.push(`wall type ${type.name} uses missing material`);
    const [first, last] = type.coreIndex;
    if (first > last || last >= type.layers.length) problems.push(`wall type ${type.name} has an invalid core range`);
  }

  const usedNodes = new Set<Id>();
  for (const el of Object.values(doc.elements)) {
    if (!doc.levels[el.levelId]) problems.push(`${el.kind} ${el.id} is on missing level`);
    if (el.kind !== 'wall') continue;
    const a = doc.elements[el.a];
    const b = doc.elements[el.b];
    usedNodes.add(el.a).add(el.b);
    if (a?.kind !== 'wallNode' || b?.kind !== 'wallNode') {
      problems.push(`wall ${el.id} references a missing node`);
      continue;
    }
    if (el.a === el.b) problems.push(`wall ${el.id} starts and ends at the same node`);
    else if (wallLength(a, b) <= LENGTH_EPS) problems.push(`wall ${el.id} has zero length`);
    if (a.levelId !== el.levelId || b.levelId !== el.levelId) problems.push(`wall ${el.id} uses nodes from another level`);
    if (!doc.wallTypes[el.typeId]) problems.push(`wall ${el.id} has missing wall type`);
  }
  for (const el of Object.values(doc.elements)) {
    if (el.kind === 'wallNode' && !usedNodes.has(el.id)) problems.push(`wall node ${el.id} is not used by any wall`);
    if (el.kind === 'dimension') {
      for (const end of [el.a, el.b]) {
        if (end.nodeId === undefined) continue;
        const node = doc.elements[end.nodeId];
        if (node?.kind !== 'wallNode' || node.levelId !== el.levelId) problems.push(`dimension ${el.id} references a missing node`);
      }
    }
    if (el.kind === 'door' || el.kind === 'window') {
      const wall = doc.elements[el.wallId];
      if (wall?.kind !== 'wall' || wall.levelId !== el.levelId) {
        problems.push(`${el.kind} ${el.id} references a missing wall`);
        continue;
      }
      const length = hostLength(doc, wall);
      if (el.t - el.width / 2 < -LENGTH_EPS * 10 || el.t + el.width / 2 > length + LENGTH_EPS * 10) {
        problems.push(`${el.kind} ${el.id} extends past its wall`);
      }
    }
    if (el.kind === 'object') {
      if (!doc.catalogDefs[el.defId]) problems.push(`object ${el.id} references a missing catalog item`);
      if (el.hostWallId !== undefined) {
        const wall = doc.elements[el.hostWallId];
        if (wall?.kind !== 'wall' || wall.levelId !== el.levelId) problems.push(`object ${el.id} references a missing wall`);
      }
    }
    if (el.kind === 'camera' && lookLength(el.eye, el.target) < MIN_LOOK) problems.push(`camera ${el.id} has no look direction`);
    if (el.kind === 'roofPlane' && Math.hypot(el.up.x, el.up.y) < 0.5) problems.push(`roof ${el.id} has no slope direction`);
    if (el.kind === 'foundation' && !doc.materials[el.materialId]) problems.push(`foundation ${el.id} references a missing material`);
    if (el.kind === 'stair') {
      if (Math.hypot(el.dir.x, el.dir.y) < 0.5) problems.push(`stair ${el.id} has no direction`);
      const target = doc.levels[el.toLevelId];
      if (!target || target.id === el.levelId) problems.push(`stair ${el.id} does not arrive at a level above`);
    }
  }
  return problems;
}

export interface RepairResult {
  doc: PlanDocument;
  repairs: string[];
}

/**
 * Fixes what can be fixed without guessing user intent, and reports each fix.
 * Used when loading files. Commands must never rely on this.
 */
export function repairInvariants(input: PlanDocument): RepairResult {
  const repairs: string[] = [];
  const doc = produce(input, (d) => {
    for (const table of [d.levels, d.wallTypes, d.materials, d.catalogDefs, d.elements] as Record<string, { id: string }>[]) {
      for (const [key, value] of Object.entries(table)) {
        if (key !== value.id) {
          delete table[key];
          table[value.id] = value;
          repairs.push(`Re-keyed ${value.id}`);
        }
      }
    }

    const known = d.levelOrder.filter((id, i) => d.levels[id] && d.levelOrder.indexOf(id) === i);
    const missing = Object.values(d.levels)
      .filter((l) => !known.includes(l.id))
      .sort((x, y) => x.elevation - y.elevation)
      .map((l) => l.id);
    if (known.length !== d.levelOrder.length || missing.length > 0) {
      d.levelOrder = [...known, ...missing];
      repairs.push('Rebuilt level order');
    }
    const before = d.levelOrder.map((id) => d.levels[id]?.elevation);
    restackLevels(d.levels, d.levelOrder);
    if (d.levelOrder.some((id, i) => Math.abs((d.levels[id]?.elevation ?? 0) - (before[i] ?? 0)) > ELEVATION_EPS)) {
      repairs.push('Restacked level elevations');
    }

    for (const el of Object.values(d.elements)) {
      if (!d.levels[el.levelId]) {
        delete d.elements[el.id];
        repairs.push(`Removed ${el.kind} ${el.id} on a missing level`);
      }
    }
    const fallbackType = Object.keys(d.wallTypes)[0];
    for (const el of Object.values(d.elements)) {
      if (el.kind !== 'wall') continue;
      const wall = el as Wall;
      const a = d.elements[wall.a];
      const b = d.elements[wall.b];
      const broken =
        a?.kind !== 'wallNode' ||
        b?.kind !== 'wallNode' ||
        wall.a === wall.b ||
        a.levelId !== wall.levelId ||
        b.levelId !== wall.levelId ||
        wallLength(a, b) <= LENGTH_EPS;
      if (broken) {
        delete d.elements[wall.id];
        repairs.push(`Removed invalid wall ${wall.id}`);
      } else if (!d.wallTypes[wall.typeId]) {
        if (fallbackType === undefined) {
          delete d.elements[wall.id];
          repairs.push(`Removed wall ${wall.id} with no wall type available`);
        } else {
          wall.typeId = fallbackType;
          repairs.push(`Assigned a default wall type to wall ${wall.id}`);
        }
      }
    }
    const used = new Set<string>();
    for (const el of Object.values(d.elements)) if (el.kind === 'wall') used.add(el.a).add(el.b);
    for (const el of Object.values(d.elements)) {
      if (el.kind === 'wallNode' && !used.has(el.id)) {
        delete d.elements[el.id];
        repairs.push(`Removed unused wall node ${el.id}`);
      }
    }
    for (const el of Object.values(d.elements)) {
      if (el.kind !== 'dimension') continue;
      for (const end of [el.a, el.b]) {
        if (end.nodeId === undefined) continue;
        const node = d.elements[end.nodeId];
        if (node?.kind !== 'wallNode' || node.levelId !== el.levelId) {
          delete end.nodeId;
          repairs.push(`Detached dimension ${el.id} from a missing wall node`);
        }
      }
    }
    for (const el of Object.values(d.elements)) {
      if (el.kind !== 'door' && el.kind !== 'window') continue;
      const wall = d.elements[el.wallId];
      const length = wall?.kind === 'wall' && wall.levelId === el.levelId ? hostLength(d, wall) : 0;
      if (el.width > length + LENGTH_EPS) {
        delete d.elements[el.id];
        repairs.push(`Removed ${el.kind} ${el.id} that no longer fits a wall`);
        continue;
      }
      const t = Math.min(Math.max(el.t, el.width / 2), length - el.width / 2);
      if (Math.abs(t - el.t) > LENGTH_EPS) {
        el.t = t;
        repairs.push(`Moved ${el.kind} ${el.id} back within its wall`);
      }
    }
    for (const el of Object.values(d.elements)) {
      if (el.kind !== 'object') continue;
      if (!d.catalogDefs[el.defId]) {
        delete d.elements[el.id];
        repairs.push(`Removed object ${el.id} with a missing catalog item`);
        continue;
      }
      if (el.hostWallId !== undefined) {
        const wall = d.elements[el.hostWallId];
        if (wall?.kind !== 'wall' || wall.levelId !== el.levelId) {
          delete el.hostWallId;
          delete el.hostT;
          delete el.side;
          repairs.push(`Detached object ${el.id} from a missing wall`);
        }
      }
    }
    for (const el of Object.values(d.elements)) {
      if (el.kind !== 'camera') continue;
      if (lookLength(el.eye, el.target) < MIN_LOOK) {
        delete d.elements[el.id];
        repairs.push(`Removed camera ${el.id} with no look direction`);
      }
    }
    for (const el of Object.values(d.elements)) {
      if (el.kind !== 'roofPlane') continue;
      const len = Math.hypot(el.up.x, el.up.y);
      if (len < 0.5) {
        delete d.elements[el.id];
        repairs.push(`Removed roof ${el.id} with no slope direction`);
      } else if (Math.abs(len - 1) > 1e-6) {
        el.up = { x: el.up.x / len, y: el.up.y / len };
        repairs.push(`Normalized the slope of roof ${el.id}`);
      }
    }
    for (const el of Object.values(d.elements)) {
      if (el.kind !== 'foundation') continue;
      if (el.polygon.length < 3 || !d.materials[el.materialId]) {
        delete d.elements[el.id];
        repairs.push(`Removed foundation ${el.id}`);
      }
    }
    for (const el of Object.values(d.elements)) {
      if (el.kind !== 'stair') continue;
      const len = Math.hypot(el.dir.x, el.dir.y);
      const target = d.levels[el.toLevelId];
      if (len < 0.5 || !target || target.id === el.levelId) {
        delete d.elements[el.id];
        repairs.push(`Removed stair ${el.id}`);
      } else if (Math.abs(len - 1) > 1e-6) {
        el.dir = { x: el.dir.x / len, y: el.dir.y / len };
        repairs.push(`Normalized the direction of stair ${el.id}`);
      }
    }
  });
  return { doc, repairs };
}
