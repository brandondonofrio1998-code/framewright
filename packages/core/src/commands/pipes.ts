import { distance } from '../geometry/vec2';
import type { Id, Pipe, PlanDocument, Vec2 } from '../model/schema';
import { PIPE_SERVICES, type PipeService } from '../model/schema';
import { plumbingOnLevel } from '../plumbing/fixtures';
import { CommandError, defineCommand } from './history';

const MIN_RUN = 12;
const MAX_RUN = 24_000;

export const createPipe = defineCommand<{ levelId: Id; a: Vec2; b: Vec2; service: PipeService }, Id>({
  label: (input) => (input.service === 'drain' ? 'Drain Pipe' : 'Supply Pipe'),
  run: (doc, { levelId, a, b, service }, ctx) => {
    if (!doc.levels[levelId]) throw new CommandError('That level no longer exists.');
    if (!PIPE_SERVICES.includes(service)) throw new CommandError('A pipe is a supply or a drain.');
    const start = snapToFixture(doc, levelId, checkPoint(a), service);
    const end = snapToFixture(doc, levelId, checkPoint(b), service);
    const run = distance(start, end);
    if (run < MIN_RUN) throw new CommandError('A pipe has to be at least 1 foot long.');
    if (run > MAX_RUN) throw new CommandError('A pipe has to be at most 2000 feet long.');
    const pipe: Pipe = { id: ctx.newId(), kind: 'pipe', levelId, service, a: start, b: end };
    doc.elements[pipe.id] = pipe;
    return pipe.id;
  },
});

export const setPipeService = defineCommand<{ id: Id; service: PipeService }>({
  label: () => 'Pipe',
  run: (doc, { id, service }) => {
    const el = doc.elements[id];
    if (el?.kind !== 'pipe') throw new CommandError('That pipe no longer exists.');
    if (!PIPE_SERVICES.includes(service)) throw new CommandError('A pipe is a supply or a drain.');
    el.service = service;
  },
});

function snapToFixture(doc: PlanDocument, levelId: string, p: Vec2, service: PipeService): Vec2 {
  let best = p;
  let bestD = 18;
  for (const fixture of plumbingOnLevel(doc, levelId)) {
    if (fixture.fixture !== service) continue;
    const gap = distance(p, fixture.p);
    if (gap <= bestD) {
      bestD = gap;
      best = { x: fixture.p.x, y: fixture.p.y };
    }
  }
  return best;
}

function checkPoint(p: Vec2): Vec2 {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 100_000 || Math.abs(p.y) > 100_000) {
    throw new CommandError('That point is out of range.');
  }
  return { x: p.x, y: p.y };
}

export const pipeCommands = {
  'pipe.create': createPipe,
  'pipe.service': setPipeService,
};
