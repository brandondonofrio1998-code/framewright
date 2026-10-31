import { nearestWall, type Id } from '@framewright/core';
import type { ToolContext } from './types';

const WALL_TOLERANCE_PX = 14;
const CENTER_SNAP_PX = 10;

export interface ObjectSpot {
  wallId: Id;
  t: number;
  side: 'left' | 'right';
}

/** Where an object's center would sit along the nearest wall. `width` keeps it fully on the wall. */
export function objectSpotAt(ctx: ToolContext, cursor: { x: number; y: number }, width: number): ObjectSpot | null {
  const hit = nearestWall(ctx.geometry(), cursor, ctx.view.model(WALL_TOLERANCE_PX));
  if (!hit) return null;
  let t = Math.abs(hit.t - hit.length / 2) <= ctx.view.model(CENTER_SNAP_PX) ? hit.length / 2 : Math.round(hit.t);
  const inset = Math.min(width / 2, hit.length / 2);
  t = Math.min(Math.max(t, inset), hit.length - inset);
  return { wallId: hit.wallId, t, side: hit.left ? 'left' : 'right' };
}
