import { DOOR_STYLES, WINDOW_STYLES, type Door, type DoorStyle, type Id, type Opening, type PlanDocument, type WindowOpening, type WindowStyle } from '../model/schema';
import { isOpening, openingFitError } from '../openings/openings';
import { getWall } from '../walls/graph';
import { CommandError, defineCommand } from './history';

const MAX_SIZE = 10_000;

function checkSize(value: number, what: string, allowZero = false): number {
  if (!Number.isFinite(value) || value > MAX_SIZE || value < 0 || (!allowZero && value === 0)) {
    throw new CommandError(`${what} must be ${allowZero ? 'zero or more' : 'greater than zero'}.`);
  }
  return value;
}

function getOpening(doc: PlanDocument, id: Id): Opening {
  const el = doc.elements[id];
  if (!isOpening(el)) throw new CommandError('That door or window no longer exists.');
  return el;
}

function checkFit(doc: PlanDocument, wallId: Id, t: number, width: number, ignoreId?: Id): void {
  const wall = getWall(doc, wallId);
  if (!Number.isFinite(t)) throw new CommandError('That position is out of range.');
  const error = openingFitError(doc, wall, t, width, ignoreId);
  if (error) throw new CommandError(error);
}

interface PlaceBase {
  wallId: Id;
  t: number;
  width: number;
  height: number;
  side: Opening['side'];
  hinge: Opening['hinge'];
}

export type PlaceOpening =
  | (PlaceBase & { kind: 'door'; style: DoorStyle })
  | (PlaceBase & { kind: 'window'; style: WindowStyle; sill: number });

export const placeOpening = defineCommand<PlaceOpening, Id>({
  label: (p) => (p.kind === 'door' ? 'Place Door' : 'Place Window'),
  run: (doc, p, ctx) => {
    const wall = getWall(doc, p.wallId);
    const width = checkSize(p.width, 'Width');
    const height = checkSize(p.height, 'Height');
    checkFit(doc, wall.id, p.t, width);
    const base = { id: ctx.newId(), levelId: wall.levelId, wallId: wall.id, t: p.t, width, height, side: p.side, hinge: p.hinge };
    let opening: Opening;
    if (p.kind === 'door') {
      if (!DOOR_STYLES.includes(p.style)) throw new CommandError('Unknown door style.');
      opening = { ...base, kind: 'door', style: p.style } satisfies Door;
    } else {
      if (!WINDOW_STYLES.includes(p.style)) throw new CommandError('Unknown window style.');
      opening = { ...base, kind: 'window', style: p.style, sill: checkSize(p.sill, 'Sill height', true) } satisfies WindowOpening;
    }
    doc.elements[opening.id] = opening;
    return opening.id;
  },
});

export const moveOpening = defineCommand<{ id: Id; wallId: Id; t: number; side?: Opening['side'] }>({
  label: () => 'Move Opening',
  run: (doc, { id, wallId, t, side }) => {
    const opening = getOpening(doc, id);
    const wall = getWall(doc, wallId);
    if (wall.levelId !== opening.levelId) throw new CommandError('Doors and windows stay on their own level.');
    checkFit(doc, wall.id, t, opening.width, id);
    opening.wallId = wall.id;
    opening.t = t;
    if (side) opening.side = side;
  },
});

export interface OpeningChanges {
  width?: number;
  height?: number;
  sill?: number;
  side?: Opening['side'];
  hinge?: Opening['hinge'];
  doorStyle?: DoorStyle;
  windowStyle?: WindowStyle;
}

export const updateOpenings = defineCommand<{ ids: Id[]; changes: OpeningChanges }>({
  label: (p) => (p.ids.length === 1 ? 'Edit Opening' : 'Edit Openings'),
  mergeKey: ({ ids, changes }) => `opening.update:${[...ids].sort().join(',')}:${Object.keys(changes).sort().join(',')}`,
  run: (doc, { ids, changes }) => {
    if (changes.doorStyle !== undefined && !DOOR_STYLES.includes(changes.doorStyle)) throw new CommandError('Unknown door style.');
    if (changes.windowStyle !== undefined && !WINDOW_STYLES.includes(changes.windowStyle)) throw new CommandError('Unknown window style.');
    for (const id of ids) {
      const opening = getOpening(doc, id);
      if (changes.width !== undefined) {
        const width = checkSize(changes.width, 'Width');
        checkFit(doc, opening.wallId, opening.t, width, id);
        opening.width = width;
      }
      if (changes.height !== undefined) opening.height = checkSize(changes.height, 'Height');
      if (changes.side !== undefined) opening.side = changes.side;
      if (changes.hinge !== undefined) opening.hinge = changes.hinge;
      if (opening.kind === 'door' && changes.doorStyle !== undefined) opening.style = changes.doorStyle;
      if (opening.kind === 'window') {
        if (changes.windowStyle !== undefined) opening.style = changes.windowStyle;
        if (changes.sill !== undefined) opening.sill = checkSize(changes.sill, 'Sill height', true);
      }
    }
  },
});

export const openingCommands = {
  'opening.place': placeOpening,
  'opening.move': moveOpening,
  'opening.update': updateOpenings,
};
export type OpeningCommands = typeof openingCommands;
