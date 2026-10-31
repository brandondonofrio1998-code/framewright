import { placeOnWall } from '../catalog/placement';
import { objectSize } from '../catalog/symbols';
import {
  CatalogDefSchema,
  ROOM_TYPES,
  type CatalogDef,
  type CatalogObject,
  type Id,
  type ParamValue,
  type PlanDocument,
  type RoomType,
  type Vec2,
} from '../model/schema';
import { CommandError, defineCommand } from './history';

const MAX = 100_000;

function checkLevel(doc: PlanDocument, levelId: Id): void {
  if (!doc.levels[levelId]) throw new CommandError('That level no longer exists.');
}

function getObject(doc: PlanDocument, id: Id): CatalogObject {
  const el = doc.elements[id];
  if (el?.kind !== 'object') throw new CommandError('That object no longer exists.');
  return el;
}

function embed(doc: PlanDocument, def: CatalogDef): CatalogDef {
  const parsed = CatalogDefSchema.parse(def);
  const existing = doc.catalogDefs[parsed.id];
  if (existing) return existing;
  doc.catalogDefs[parsed.id] = parsed;
  return parsed;
}

export interface PlaceObject {
  levelId: Id;
  def: CatalogDef;
  /** Used when the object is not hosted on a wall. */
  p?: Vec2;
  rotation?: number;
  hostWallId?: Id;
  hostT?: number;
  side?: 'left' | 'right';
}

export const placeObject = defineCommand<PlaceObject, Id>({
  label: (p) => `Place ${p.def.name}`,
  run: (doc, input, ctx) => {
    checkLevel(doc, input.levelId);
    const def = embed(doc, input.def);
    const elevation = typeof def.params.elevation === 'number' ? def.params.elevation : 0;
    const width = typeof def.params.width === 'number' ? def.params.width : 24;
    const depth = typeof def.params.depth === 'number' ? def.params.depth : 24;
    let p = input.p ?? { x: 0, y: 0 };
    let rotation = input.rotation ?? 0;
    let hostT = input.hostT;
    let side = input.side;
    let hostWallId = input.hostWallId;
    if (hostWallId) {
      const wall = doc.elements[hostWallId];
      if (wall?.kind !== 'wall' || wall.levelId !== input.levelId) throw new CommandError('That wall no longer exists.');
      const placed = placeOnWall(doc, wall, hostT ?? 0, side ?? 'left', width, depth);
      if (!placed) throw new CommandError('That object does not fit on the wall.');
      p = placed.p;
      rotation = placed.rotation;
      hostT = placed.t;
      side = placed.side;
    } else {
      hostWallId = undefined;
      hostT = undefined;
      side = undefined;
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > MAX || Math.abs(p.y) > MAX) {
        throw new CommandError('That point is out of range.');
      }
    }
    const object: CatalogObject = {
      id: ctx.newId(),
      kind: 'object',
      levelId: input.levelId,
      defId: def.id,
      p: { x: p.x, y: p.y },
      z: elevation,
      rotation,
      params: {},
      ...(hostWallId && hostT !== undefined && side ? { hostWallId, hostT, side } : {}),
    };
    doc.elements[object.id] = object;
    return object.id;
  },
});

export interface MoveObject {
  id: Id;
  p: Vec2;
  rotation: number;
  hostWallId?: Id | null;
  hostT?: number;
  side?: 'left' | 'right';
}

export const moveObject = defineCommand<MoveObject>({
  label: () => 'Move Object',
  run: (doc, { id, p, rotation, hostWallId, hostT, side }) => {
    const object = getObject(doc, id);
    if (!Number.isFinite(rotation)) throw new CommandError('That angle is out of range.');
    if (hostWallId) {
      const wall = doc.elements[hostWallId];
      if (wall?.kind !== 'wall' || wall.levelId !== object.levelId) throw new CommandError('That wall no longer exists.');
      const { width, depth } = objectSize(doc, object);
      const placed = placeOnWall(doc, wall, hostT ?? 0, side ?? object.side ?? 'left', width, depth);
      if (!placed) throw new CommandError('That object does not fit on the wall.');
      object.p = placed.p;
      object.rotation = placed.rotation;
      object.hostWallId = wall.id;
      object.hostT = placed.t;
      object.side = placed.side;
      return;
    }
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > MAX || Math.abs(p.y) > MAX) throw new CommandError('That point is out of range.');
    object.p = { x: p.x, y: p.y };
    object.rotation = rotation;
    delete object.hostWallId;
    delete object.hostT;
    delete object.side;
  },
});

export const updateObject = defineCommand<{ id: Id; params?: Record<string, ParamValue>; z?: number }>({
  label: () => 'Edit Object',
  mergeKey: (p) => `object.update:${p.id}:${Object.keys(p.params ?? {}).sort().join(',')}:${p.z !== undefined}`,
  run: (doc, { id, params, z }) => {
    const object = getObject(doc, id);
    const def = doc.catalogDefs[object.defId];
    if (!def) throw new CommandError('That catalog item is missing from the plan.');
    if (z !== undefined) {
      if (!Number.isFinite(z) || z < 0 || z > MAX) throw new CommandError('Elevation must be zero or more.');
      object.z = z;
    }
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        const spec = def.paramSchema.find((param) => param.key === key);
        if (!spec) throw new CommandError(`Unknown property "${key}".`);
        if (typeof value !== 'number' || value < spec.min || value > spec.max) {
          throw new CommandError(`${spec.label} must be between ${spec.min} and ${spec.max} inches.`);
        }
        object.params[key] = value;
      }
      if (object.hostWallId) {
        const wall = doc.elements[object.hostWallId];
        if (wall?.kind === 'wall' && object.hostT !== undefined && object.side) {
          const { width, depth } = objectSize(doc, object);
          const placed = placeOnWall(doc, wall, object.hostT, object.side, width, depth);
          if (!placed) throw new CommandError('That size does not fit on the wall.');
          object.p = placed.p;
          object.rotation = placed.rotation;
          object.hostT = placed.t;
        }
      }
    }
  },
});

export const updateRoom = defineCommand<{ id: Id; name?: string; roomType?: RoomType; ceilingHeight?: number | null }>({
  label: () => 'Edit Room',
  mergeKey: (p) => `room.update:${p.id}:${Object.keys(p).sort().join(',')}`,
  run: (doc, { id, name, roomType, ceilingHeight }) => {
    const room = doc.elements[id];
    if (room?.kind !== 'room') throw new CommandError('That room no longer exists.');
    if (name !== undefined) {
      const trimmed = name.trim();
      if (trimmed.length === 0 || trimmed.length > 100) throw new CommandError('A room needs a name.');
      room.name = trimmed;
    }
    if (roomType !== undefined) {
      if (!ROOM_TYPES.includes(roomType)) throw new CommandError('Unknown room type.');
      room.roomType = roomType;
    }
    if (ceilingHeight !== undefined) {
      if (ceilingHeight !== null && (!Number.isFinite(ceilingHeight) || ceilingHeight <= 0 || ceilingHeight > MAX)) {
        throw new CommandError('Ceiling height must be greater than zero.');
      }
      room.ceilingHeight = ceilingHeight;
    }
  },
});

export const catalogCommands = {
  'object.place': placeObject,
  'object.move': moveObject,
  'object.update': updateObject,
  'room.update': updateRoom,
};
export type CatalogCommands = typeof catalogCommands;
