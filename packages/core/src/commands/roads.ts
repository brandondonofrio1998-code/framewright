import { distance } from '../geometry/vec2';
import { ROAD_WIDTH } from '../roads/drive';
import type { Id, Road, Vec2 } from '../model/schema';
import { CommandError, defineCommand } from './history';

const MIN_RUN = 96;
const MAX_RUN = 24_000;

export const createRoad = defineCommand<{ levelId: Id; a: Vec2; b: Vec2 }, Id>({
  label: () => 'Driveway',
  run: (doc, { levelId, a, b }, ctx) => {
    if (!doc.levels[levelId]) throw new CommandError('That level no longer exists.');
    const start = checkPoint(a);
    const end = checkPoint(b);
    const run = distance(start, end);
    if (run < MIN_RUN) throw new CommandError('A driveway has to be at least 8 feet long.');
    if (run > MAX_RUN) throw new CommandError('A driveway has to be at most 2000 feet long.');
    const road: Road = { id: ctx.newId(), kind: 'road', levelId, a: start, b: end, width: ROAD_WIDTH };
    doc.elements[road.id] = road;
    return road.id;
  },
});

export const setRoadWidth = defineCommand<{ id: Id; width: number }>({
  label: () => 'Driveway Width',
  run: (doc, { id, width }) => {
    const el = doc.elements[id];
    if (el?.kind !== 'road') throw new CommandError('That driveway no longer exists.');
    if (!Number.isFinite(width) || width < 96 || width > 480) throw new CommandError('Width has to be from 8 feet to 40 feet.');
    el.width = width;
  },
});

export const setRoadFall = defineCommand<{ id: Id; fall: number }>({
  label: () => 'Driveway Slope',
  run: (doc, { id, fall }) => {
    const el = doc.elements[id];
    if (el?.kind !== 'road') throw new CommandError('That driveway no longer exists.');
    if (!Number.isFinite(fall) || fall < -96 || fall > 96) throw new CommandError('The end can rise or drop at most 8 feet.');
    if (Math.abs(fall) < 1e-6) delete el.fall;
    else el.fall = fall;
  },
});

function checkPoint(p: Vec2): Vec2 {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 100_000 || Math.abs(p.y) > 100_000) {
    throw new CommandError('That point is out of range.');
  }
  return { x: p.x, y: p.y };
}

export const roadCommands = {
  'road.create': createRoad,
  'road.width': setRoadWidth,
  'road.fall': setRoadFall,
};
