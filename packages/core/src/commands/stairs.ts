import { layoutFlight, unitDir, IRC_MIN_WIDTH } from '../stairs/straight';
import type { Id, Stair, Vec2 } from '../model/schema';
import { CommandError, defineCommand } from './history';

export interface CreateStair {
  levelId: Id;
  start: Vec2;
  end: Vec2;
  width?: number;
}

export const createStair = defineCommand<CreateStair, Id>({
  label: () => 'Build Stairs',
  run: (doc, { levelId, start, end, width }, ctx) => {
    const lower = doc.levels[levelId];
    if (!lower) throw new CommandError('That level no longer exists.');
    const toLevelId = doc.levelOrder[doc.levelOrder.indexOf(levelId) + 1];
    const upper = toLevelId ? doc.levels[toLevelId] : undefined;
    if (!toLevelId || !upper) throw new CommandError('Add a level above before building stairs.');
    const dir = unitDir({ x: end.x - start.x, y: end.y - start.y });
    if (!dir) throw new CommandError('The two points are the same.');
    const run = Math.hypot(end.x - start.x, end.y - start.y);
    const flightWidth = width ?? IRC_MIN_WIDTH;
    if (flightWidth < IRC_MIN_WIDTH || flightWidth > 120) throw new CommandError('Stair width must be from 36 inches to 10 feet.');
    const built = layoutFlight(upper.elevation - lower.elevation, lower.ceilingHeight, run);
    if (!built.ok) throw new CommandError(built.error);
    const id = ctx.newId();
    const stair: Stair = {
      id,
      kind: 'stair',
      levelId,
      start,
      dir,
      run,
      width: flightWidth,
      toLevelId,
      risers: built.layout.risers,
      riser: Math.min(built.layout.riser, 7.75),
      tread: Math.max(built.layout.tread, 10),
    };
    doc.elements[id] = stair;
    return id;
  },
});

export const stairCommands = {
  'stair.create': createStair,
};
export type StairCommands = typeof stairCommands;
