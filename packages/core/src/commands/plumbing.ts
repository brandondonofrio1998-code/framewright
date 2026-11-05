import { deviceOnWall } from '../electrical/devices';
import type { Id, PlanDocument, Plumbing, PlumbingFixture, Vec2 } from '../model/schema';
import { PLUMBING_FIXTURES } from '../model/schema';
import { openingsOnWall, wallLength } from '../openings/openings';
import { getWall } from '../walls/graph';
import { CommandError, defineCommand } from './history';

export interface PlacePlumbing {
  levelId: Id;
  fixture: PlumbingFixture;
  p: Vec2;
  hostWallId?: Id;
  hostT?: number;
  side?: 'left' | 'right';
}

export const createPlumbing = defineCommand<PlacePlumbing, Id>({
  label: (p) => (p.fixture === 'supply' ? 'Supply' : 'Drain'),
  run: (doc, input, ctx) => {
    if (!doc.levels[input.levelId]) throw new CommandError('That level no longer exists.');
    if (!PLUMBING_FIXTURES.includes(input.fixture)) throw new CommandError('Unknown plumbing fixture.');
    const placed = resolve(doc, input);
    const el: Plumbing = { id: ctx.newId(), kind: 'plumbing', levelId: input.levelId, ...placed };
    doc.elements[el.id] = el;
    return el.id;
  },
});

export const setPlumbingFixture = defineCommand<{ id: Id; fixture: PlumbingFixture }>({
  label: () => 'Plumbing Fixture',
  run: (doc, { id, fixture }) => {
    const el = doc.elements[id];
    if (el?.kind !== 'plumbing') throw new CommandError('That fixture no longer exists.');
    if (!PLUMBING_FIXTURES.includes(fixture)) throw new CommandError('Unknown plumbing fixture.');
    if (!el.hostWallId) throw new CommandError('A floor drain stays on the floor.');
    el.fixture = fixture;
  },
});

function resolve(doc: PlanDocument, input: PlacePlumbing): Omit<Plumbing, 'id' | 'kind' | 'levelId'> {
  if (!input.hostWallId || input.hostT === undefined || !input.side) {
    if (input.fixture !== 'drain') throw new CommandError('Click a wall for a supply.');
    return { fixture: 'drain', p: { x: input.p.x, y: input.p.y } };
  }
  const wall = getWall(doc, input.hostWallId);
  if (wall.levelId !== input.levelId) throw new CommandError('That wall is on another level.');
  const length = wallLength(doc, wall);
  if (input.hostT < 0 || input.hostT > length) throw new CommandError('That spot is off the end of the wall.');
  for (const opening of openingsOnWall(doc, wall.id)) {
    if (Math.abs(opening.t - input.hostT) < opening.width / 2 + 3) throw new CommandError('That spot is in a door or a window.');
  }
  const posed = deviceOnWall(doc, wall, input.hostT, input.side);
  if (!posed) throw new CommandError('That wall has no type.');
  return { fixture: input.fixture, p: posed.p, hostWallId: wall.id, hostT: input.hostT, side: input.side };
}

export const plumbingCommands = {
  'plumbing.create': createPlumbing,
  'plumbing.setFixture': setPlumbingFixture,
};
