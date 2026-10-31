import {
  clampOpeningT,
  exteriorSideOfWall,
  formatLength,
  nearestWall,
  openingFitError,
  openingsOnWall,
  openingSpan,
  type Id,
  type Opening,
  type Vec2,
  type WallGeometry,
} from '@framewright/core';
import type { TempDimension, ToolContext } from './types';

const WALL_TOLERANCE_PX = 12;
const CENTER_SNAP_PX = 10;

export interface OpeningSpot {
  wallId: Id;
  t: number;
  side: Opening['side'];
  /** Why the opening can't go here, or null if it fits. */
  error: string | null;
}

/**
 * Where an opening of `width` would go for the cursor: on the nearest wall, centred under the cursor (snapping to
 * the wall's midpoint, then whole inches), kept inside the wall. The side is the cursor's (door swing) or, with
 * `exterior`, the wall's outward side (window exterior).
 */
export function openingSpotAt(ctx: ToolContext, cursor: Vec2, width: number, ignoreId?: Id, exterior = false): OpeningSpot | null {
  const hit = nearestWall(ctx.geometry(), cursor, ctx.view.model(WALL_TOLERANCE_PX));
  if (!hit) return null;
  const doc = ctx.doc();
  const wall = doc.elements[hit.wallId];
  if (wall?.kind !== 'wall') return null;
  let t = Math.abs(hit.t - hit.length / 2) <= ctx.view.model(CENTER_SNAP_PX) ? hit.length / 2 : Math.round(hit.t);
  t = clampOpeningT(hit.length, width, t);
  const cursorSide = hit.left ? 'left' : 'right';
  const side = exterior ? (exteriorSideOfWall(doc, wall.id) ?? cursorSide) : cursorSide;
  return { wallId: hit.wallId, t, side, error: openingFitError(doc, wall, t, width, ignoreId) };
}

/** Temporary dimensions from the opening's edges to its neighbours (wall ends or other openings) along the wall. */
export function openingClearances(ctx: ToolContext, geom: WallGeometry, spot: { wallId: Id; t: number }, width: number, ignoreId?: Id): TempDimension[] {
  const doc = ctx.doc();
  const length = Math.hypot(geom.b.x - geom.a.x, geom.b.y - geom.a.y);
  const [s0, s1] = openingSpan({ t: spot.t, width });
  let before = 0;
  let after = length;
  for (const other of openingsOnWall(doc, spot.wallId)) {
    if (other.id === ignoreId) continue;
    const [o0, o1] = openingSpan(other);
    if (o1 <= s0 + 1e-6) before = Math.max(before, o1);
    if (o0 >= s1 - 1e-6) after = Math.min(after, o0);
  }
  const u = { x: (geom.b.x - geom.a.x) / length, y: (geom.b.y - geom.a.y) / length };
  const at = (s: number) => ({ x: geom.a.x + u.x * s, y: geom.a.y + u.y * s });
  const offset = geom.thickness / 2 + ctx.view.model(22);
  const format = doc.settings.lengthFormat;
  const dims: TempDimension[] = [];
  if (s0 - before > 1e-3) dims.push({ a: at(before), b: at(s0), offset, label: formatLength(s0 - before, format) });
  if (after - s1 > 1e-3) dims.push({ a: at(s1), b: at(after), offset, label: formatLength(after - s1, format) });
  return dims;
}
