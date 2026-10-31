import type { Id, Level } from './schema';

export const ELEVATION_EPS = 1e-6;

/**
 * Levels form a stack: each level's elevation is the one below plus that level's
 * ceiling height plus this level's floor depth. The bottom level anchors the stack.
 */
export function stackedElevation(below: Level, level: Pick<Level, 'floorDepth'>): number {
  return below.elevation + below.ceilingHeight + level.floorDepth;
}

/** Recomputes elevations above the bottom level. Mutates `levels` (works on Immer drafts). */
export function restackLevels(levels: Record<Id, Level>, order: readonly Id[]): void {
  for (let i = 1; i < order.length; i++) {
    const below = levels[order[i - 1] ?? ''];
    const level = levels[order[i] ?? ''];
    if (below && level) level.elevation = stackedElevation(below, level);
  }
}

/** Default height of a wall on `level`: up to the underside of the floor above (or its own ceiling on top). */
export function defaultWallHeight(levels: Record<Id, Level>, order: readonly Id[], levelId: Id): number {
  const index = order.indexOf(levelId);
  const level = levels[levelId];
  if (!level) throw new Error(`Unknown level ${levelId}`);
  const above = index >= 0 ? levels[order[index + 1] ?? ''] : undefined;
  return level.ceilingHeight + (above?.floorDepth ?? 0);
}
