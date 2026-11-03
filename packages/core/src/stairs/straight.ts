import { add, dot, normalize, perp, scale, sub } from '../geometry/vec2';
import type { PlanDocument, Stair, Vec2, Vec3 } from '../model/schema';

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
/** IRC 2021 R311.7.8: a rail is required at four or more risers, 34 to 38 inches above the nosing. */
export const HANDRAIL_MIN_RISERS = 4;
export const HANDRAIL_HEIGHT = 36;
/** Square rail, 1.5 inches. Its perimeter is 6 inches, inside the graspable range. */
export const HANDRAIL_SIZE = 1.5;

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

export interface Handrail {
  /** Bottom end, above the first nosing. */
  a: Vec3;
  /** Top end, above the upper floor. */
  b: Vec3;
}

/**
 * One handrail on the left of the flight. Its center is 36 inches vertically above the line of nosings,
 * and its outer face is flush with the side of the stair. A flight of fewer than four risers has none.
 */
export function handrail(stair: Pick<Stair, 'start' | 'dir' | 'run' | 'width' | 'risers' | 'riser'>, elevation: number): Handrail | null {
  if (stair.risers < HANDRAIL_MIN_RISERS) return null;
  const side = scale(perp(stair.dir), stair.width / 2 - HANDRAIL_SIZE / 2);
  const origin = add(stair.start, side);
  const end = add(origin, scale(stair.dir, stair.run));
  return {
    a: { x: origin.x, y: origin.y, z: elevation + stair.riser + HANDRAIL_HEIGHT },
    b: { x: end.x, y: end.y, z: elevation + stair.risers * stair.riser + HANDRAIL_HEIGHT },
  };
}

export interface PlacedFlight {
  start: Vec2;
  dir: Vec2;
  run: number;
  width: number;
  risers: number;
  riser: number;
  tread: number;
  /** Height of this flight's floor above the lower floor. */
  rise0: number;
}

function isReturn(stair: Stair): boolean {
  return stair.landing?.side != null && Math.abs(dot(stair.dir, stair.landing.dir)) > 0.5;
}

/** The straight flight, or the two flights of an L or U stair. */
export function placedFlights(stair: Stair): PlacedFlight[] {
  const first: PlacedFlight = {
    start: stair.start,
    dir: stair.dir,
    run: stair.run,
    width: stair.width,
    risers: stair.risers,
    riser: stair.riser,
    tread: stair.tread,
    rise0: 0,
  };
  if (!stair.landing) return [first];
  const start = isReturn(stair)
    ? add(add(stair.start, scale(stair.dir, stair.run + stair.width)), scale(perp(stair.dir), (stair.landing.side ?? 1) * stair.width))
    : add(add(stair.start, scale(stair.dir, stair.run + stair.width / 2)), scale(stair.landing.dir, stair.width / 2));
  return [
    first,
    {
      start,
      dir: stair.landing.dir,
      run: stair.landing.run,
      width: stair.width,
      risers: stair.landing.risers,
      riser: stair.riser,
      tread: stair.landing.tread,
      rise0: stair.risers * stair.riser,
    },
  ];
}

/** The landing between the flights, or null for a straight flight. An L landing is square. A U landing is twice as wide. */
export function landingPolygon(stair: Stair): Vec2[] | null {
  if (!stair.landing) return null;
  const half = stair.width / 2;
  if (!isReturn(stair)) {
    const center = add(stair.start, scale(stair.dir, stair.run + half));
    const d = scale(stair.dir, half);
    const t = scale(stair.landing.dir, half);
    return [add(center, add(scale(d, -1), scale(t, -1))), add(center, add(d, scale(t, -1))), add(center, add(d, t)), add(center, add(scale(d, -1), t))];
  }
  const sign = stair.landing.side ?? 1;
  const center = add(add(stair.start, scale(stair.dir, stair.run + half)), scale(perp(stair.dir), sign * half));
  const along = scale(stair.dir, half);
  const across = scale(perp(stair.dir), stair.width);
  return [add(center, add(scale(along, -1), scale(across, -1))), add(center, add(along, scale(across, -1))), add(center, add(along, across)), add(center, add(scale(along, -1), across))];
}

/** Footprints to cut out of the ceiling and the floor above: each flight, and the landing. */
export function stairOpenings(stair: Stair): Vec2[][] {
  const flights = placedFlights(stair).map((flight) => stairCorners(flight));
  const landing = landingPolygon(stair);
  return landing ? [...flights, landing] : flights;
}

export interface TurnLayout {
  riser: number;
  first: { risers: number; tread: number };
  second: { risers: number; tread: number; dir: Vec2 };
}

/** How many risers a run can hold: treads stay between 10 inches and 10 feet. */
function riserRange(run: number): { min: number; max: number } | null {
  const max = Math.floor(run / IRC_MIN_TREAD) + 1;
  const min = Math.max(2, Math.ceil(run / 120 - 1e-9) + 1);
  return max >= min ? { min, max } : null;
}

function splitRisers(total: number, a: { min: number; max: number }, b: { min: number; max: number }): { n1: number; n2: number } | null {
  if (a.min + b.min > total || a.max + b.max < total) return null;
  let n1 = Math.round((total * a.max) / (a.max + b.max));
  n1 = Math.min(a.max, Math.max(a.min, n1));
  let n2 = total - n1;
  if (n2 > b.max) {
    n1 -= n2 - b.max;
    n2 = b.max;
  }
  if (n2 < b.min) {
    n1 -= b.min - n2;
    n2 = b.min;
  }
  if (n1 < a.min || n1 > a.max || n2 < b.min || n2 > b.max) return null;
  return { n1, n2 };
}

/**
 * An L or U stair: two flights and one landing. `run1` and `run2` are the tread runs, not counting the landing.
 */
export function layoutTurn(totalRise: number, ceilingHeight: number, run1: number, run2: number, turn: Vec2): { ok: true; layout: TurnLayout } | { ok: false; error: string } {
  if (!(totalRise > 0)) return { ok: false, error: 'The upper floor is not above this one.' };
  if (totalRise > IRC_MAX_FLIGHT) return { ok: false, error: 'This flight rises more than 12 feet 7 inches. IRC 2021 wants a landing.' };
  if (ceilingHeight < IRC_MIN_HEADROOM) return { ok: false, error: 'The ceiling is lower than the 6 foot 8 inch headroom.' };
  const risers = Math.ceil((totalRise - 1e-6) / IRC_MAX_RISER);
  if (risers < 4) return { ok: false, error: 'A turned stair needs at least four risers.' };
  const riser = totalRise / risers;
  if (ceilingHeight - riser < IRC_MIN_HEADROOM - 1e-6) return { ok: false, error: 'The ceiling is too low for a 6 foot 8 inch headroom over the first step.' };
  const first = riserRange(run1);
  const second = riserRange(run2);
  if (!first || !second) return { ok: false, error: 'Each flight needs at least one 10 inch tread before the landing.' };
  const split = splitRisers(risers, first, second);
  if (!split) return { ok: false, error: 'These runs are too short for the rise. Lengthen a flight or the landing will not fit.' };
  return {
    ok: true,
    layout: {
      riser,
      first: { risers: split.n1, tread: run1 / (split.n1 - 1) },
      second: { risers: split.n2, tread: run2 / (split.n2 - 1), dir: turn },
    },
  };
}
