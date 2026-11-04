import { deviceOnWall } from '../electrical/devices';
import type { Electrical, ElectricalDevice, Id, PlanDocument, Vec2 } from '../model/schema';
import { ELECTRICAL_DEVICES } from '../model/schema';
import { openingsOnWall, wallLength } from '../openings/openings';
import { getWall } from '../walls/graph';
import { CommandError, defineCommand } from './history';

export interface PlaceElectrical {
  levelId: Id;
  device: ElectricalDevice;
  p: Vec2;
  hostWallId?: Id;
  hostT?: number;
  side?: 'left' | 'right';
}

export const createElectrical = defineCommand<PlaceElectrical, Id>({
  label: (p) => (p.device === 'light' ? 'Light' : p.device === 'switch' ? 'Switch' : 'Receptacle'),
  run: (doc, input, ctx) => {
    if (!doc.levels[input.levelId]) throw new CommandError('That level no longer exists.');
    if (!ELECTRICAL_DEVICES.includes(input.device)) throw new CommandError('Unknown electrical device.');
    const placed = resolve(doc, input);
    const el: Electrical = { id: ctx.newId(), kind: 'electrical', levelId: input.levelId, ...placed };
    doc.elements[el.id] = el;
    return el.id;
  },
});

export const setElectricalDevice = defineCommand<{ id: Id; device: ElectricalDevice }>({
  label: () => 'Electrical Device',
  run: (doc, { id, device }) => {
    const el = doc.elements[id];
    if (el?.kind !== 'electrical') throw new CommandError('That device no longer exists.');
    if (!ELECTRICAL_DEVICES.includes(device)) throw new CommandError('Unknown electrical device.');
    if ((device === 'light') !== (el.device === 'light')) throw new CommandError('A light stays on the ceiling. A receptacle or switch stays on its wall.');
    el.device = device;
  },
});

function resolve(doc: PlanDocument, input: PlaceElectrical): Omit<Electrical, 'id' | 'kind' | 'levelId'> {
  if (input.device === 'light') {
    return { device: 'light', p: { x: input.p.x, y: input.p.y } };
  }
  if (!input.hostWallId || input.hostT === undefined || !input.side) throw new CommandError('Click a wall for a receptacle or a switch.');
  const wall = getWall(doc, input.hostWallId);
  if (wall.levelId !== input.levelId) throw new CommandError('That wall is on another level.');
  const length = wallLength(doc, wall);
  if (input.hostT < 0 || input.hostT > length) throw new CommandError('That spot is off the end of the wall.');
  for (const opening of openingsOnWall(doc, wall.id)) {
    if (Math.abs(opening.t - input.hostT) < opening.width / 2 + 3) throw new CommandError('That spot is in a door or a window.');
  }
  const posed = deviceOnWall(doc, wall, input.hostT, input.side);
  if (!posed) throw new CommandError('That wall has no type.');
  return { device: input.device, p: posed.p, hostWallId: wall.id, hostT: input.hostT, side: input.side };
}

export const electricalCommands = {
  'electrical.create': createElectrical,
  'electrical.setDevice': setElectricalDevice,
};
