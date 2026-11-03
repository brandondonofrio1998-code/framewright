import { add, normalize, perp, scale, sub } from '../geometry/vec2';
import type { PlanDocument, Stair, Vec2 } from '../model/schema';

/** IRC 2021 R311.7.5.1, maximum riser. */
export const IRC_MAX_RISER = 7.75;
/** IRC 2021 R311.7.5.2, minimum tread. */
export const IRC_MIN_TREAD = 10;
/** IRC 2021 R311.7.1, minimum width. */
export const IRC_MIN_WIDTH = 36;
/** IRC 2021 R311.7.2, minimum headroom. */
export const IRC_MIN_HEADROOM = 80;
/** IRC 2021 R311.7.6, maximum rise of one flight. */
export const IRC_MAX_FLIGHT = 151;

export const TREAD_THICKNESS = 1;
export const RISER_THICKNESS = 0.75;

export interface FlightLayout {
  risers: number;
  riser: number;
  tread: number;
  run: number;
}

/**
 * Equal risers and treads for a straight flight. Risers stay at or under 7 3/4 inches and treads at or
 * over 10 inches. The ceiling must clear 6'8" at the first nosing. The floor above and the ceiling
 * below are opened to this flight's footprint.
 */
export function layoutFlight(totalRise: number, ceilingHeight: number, run: number): { ok: true; layout: FlightLayout } | { ok: false; error: string } {
  if (!(totalRise > 0)) return { ok: false, error: 'The upper floor is not above this one.' };
  if (totalRise > IRC_MAX_FLIGHT) return { ok: false, error: 'This flight rises more than 12 feet 7 inches. IRC 2021 wants a landing.' };
  if (ceilingHeight < IRC_MIN_HEADROOM) return { ok: false, error: 'The ceiling is lower than the 6 foot 8 inch headroom.' };
  const risers = Math.ceil((totalRise - 1e-6) / IRC_MAX_RISER);
  if (risers < 2) return { ok: false, error: 'The floors are less than two risers apart.' };
  const riser = totalRise / risers;
  const treads = risers - 1;
  const minRun = treads * IRC_MIN_TREAD;
  if (run < minRun - 1e-6) return { ok: false, error: `This run is too short. IRC 2021 needs at least ${Math.ceil(minRun)} inches between these floors.` };
  if (run > 600) return { ok: false, error: 'That run is longer than 50 feet.' };
  const tread = run / treads;
  if (tread > 120) return { ok: false, error: 'That tread is deeper than 10 feet.' };
  if (ceilingHeight - riser < IRC_MIN_HEADROOM - 1e-6) return { ok: false, error: 'The ceiling is too low for a 6 foot 8 inch headroom over the first step.' };
  return { ok: true, layout: { risers, riser, tread, run } };
}

/** The stair's footprint, counter-clockwise, centered on the walking line. */
export function stairCorners(stair: Pick<Stair, 'start' | 'dir' | 'run' | 'width'>): Vec2[] {
  const side = scale(perp(stair.dir), stair.width / 2);
  const end = add(stair.start, scale(stair.dir, stair.run));
  return [sub(stair.start, side), add(stair.start, side), add(end, side), sub(end, side)];
}

/** A line across the stair at each interior nosing. */
export function stairTreadLines(stair: Pick<Stair, 'start' | 'dir' | 'run' | 'width' | 'tread'>): [Vec2, Vec2][] {
  const side = scale(perp(stair.dir), stair.width / 2);
  const lines: [Vec2, Vec2][] = [];
  const count = Math.round(stair.run / stair.tread);
  for (let i = 1; i < count; i++) {
    const at = add(stair.start, scale(stair.dir, i * stair.tread));
    lines.push([sub(at, side), add(at, side)]);
  }
  return lines;
}

/** A plan rectangle from `s0` to `s1` along `dir`, centered on `start`. */
export function runRect(start: Vec2, dir: Vec2, width: number, s0: number, s1: number): Vec2[] {
  const side = scale(perp(dir), width / 2);
  const a = add(start, scale(dir, s0));
  const b = add(start, scale(dir, s1));
  return [sub(a, side), add(a, side), add(b, side), sub(b, side)];
}

export function unitDir(dir: Vec2): Vec2 | null {
  const u = normalize(dir);
  return u.x === 0 && u.y === 0 ? null : u;
}

export function stairsOnLevel(doc: PlanDocument, levelId: string): Stair[] {
  return Object.values(doc.elements).filter((el): el is Stair => el.kind === 'stair' && el.levelId === levelId);
}
