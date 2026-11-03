import { layoutFlight, layoutTurn, unitDir, IRC_MIN_WIDTH } from '../stairs/straight';
import { dot, perp, scale, sub } from '../geometry/vec2';
import type { Id, Stair, Vec2 } from '../model/schema';
import { CommandError, defineCommand } from './history';

export interface CreateStair {
  levelId: Id;
  start: Vec2;
  end: Vec2;
  /** Point on the first walking line at the middle of the landing. Shift-click in the tool. */
  corner?: Vec2;
  width?: number;
}

export const createStair = defineCommand<CreateStair, Id>({
  label: () => 'Build Stairs',
  run: (doc, { levelId, start, end, corner, width }, ctx) => {
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
    const id = ctx.newId();
    if (!corner) {
      const built = layoutFlight(upper.elevation - lower.elevation, lower.ceilingHeight, run);
      if (!built.ok) throw new CommandError(built.error);
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
    }
    const toCorner = unitDir({ x: corner.x - start.x, y: corner.y - start.y });
    if (!toCorner) throw new CommandError('The turn is on the bottom of the stair.');
    const span1 = Math.hypot(corner.x - start.x, corner.y - start.y);
    const run1 = span1 - flightWidth / 2;
    const offset = sub(end, corner);
    const across = dot(offset, perp(toCorner));
    const along = dot(offset, toCorner);
    const lTurn = Math.abs(across) >= 1 && Math.abs(along) <= Math.abs(across) * 0.35;
    const uTurn = along < -flightWidth / 2 && Math.abs(across) <= Math.abs(along) * 0.5;
    if (!lTurn && !uTurn) throw new CommandError('The second flight has to turn 90 or 180 degrees.');
    const side: 1 | -1 = across < -1 ? -1 : 1;
    const turn = lTurn ? scale(perp(toCorner), across > 0 ? 1 : -1) : scale(toCorner, -1);
    const run2 = (lTurn ? Math.abs(across) : Math.abs(along)) - flightWidth / 2;
    const built = layoutTurn(upper.elevation - lower.elevation, lower.ceilingHeight, run1, run2, turn);
    if (!built.ok) throw new CommandError(built.error);
    const stair: Stair = {
      id,
      kind: 'stair',
      levelId,
      start,
      dir: toCorner,
      run: run1,
      width: flightWidth,
      toLevelId,
      risers: built.layout.first.risers,
      riser: Math.min(built.layout.riser, 7.75),
      tread: Math.max(built.layout.first.tread, 10),
      landing: {
        dir: built.layout.second.dir,
        run: run2,
        risers: built.layout.second.risers,
        tread: Math.max(built.layout.second.tread, 10),
        ...(uTurn ? { side } : {}),
      },
    };
    doc.elements[id] = stair;
    return id;
  },
});

export const stairCommands = {
  'stair.create': createStair,
};
export type StairCommands = typeof stairCommands;
