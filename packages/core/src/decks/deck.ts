import { studCenters } from '../framing/members';
import { add, distance, dot, length, normalize, perp, samePoint, scale, sub } from '../geometry/vec2';
import type { Deck, PlanDocument, Vec2 } from '../model/schema';
import { CommandError } from '../commands/history';
import { groundElevation } from '../site/ground';
import { siteOnLevel } from '../site/marks';

export const DECK_BOARD = 1;
export const DECK_JOIST_DEPTH = 7.25;
export const DECK_JOIST_WIDTH = 1.5;
export const RAIL_HEIGHT = 36;
export const RAIL_THICKNESS = 1.5;
export const RAIL_WIDTH = 3.5;
export const POST_SIZE = 3.5;
export const POST_SPACING = 72;
export const BALUSTER_SIZE = 1.5;
export const BALUSTER_GAP = 4;
const MIN_DECK = 36;
const MAX_WIDTH = 480;
const MAX_DEPTH = 240;

export type DeckShape = Pick<Deck, 'ledger' | 'dir' | 'width' | 'depth' | 'side'>;

/** The four corners, starting at the ledger. The first edge is against the house. */
export function deckPolygon(deck: DeckShape): Vec2[] {
  const out = scale(perp(deck.dir), deck.side);
  const a = deck.ledger;
  const b = add(a, scale(deck.dir, deck.width));
  const c = add(b, scale(out, deck.depth));
  const d = add(a, scale(out, deck.depth));
  return [a, b, c, d];
}

/** Joist rectangles. They span the short side, 16 inches on center, one flush at each end. */
export function deckJoists(deck: DeckShape): Vec2[][] {
  const spanDepth = deck.depth <= deck.width;
  const along = deck.dir;
  const across = scale(perp(deck.dir), deck.side);
  const half = DECK_JOIST_WIDTH / 2;
  if (spanDepth) {
    return studCenters(deck.width).map((s) => quad(deck.ledger, along, across, s - half, s + half, 0, deck.depth));
  }
  return studCenters(deck.depth).map((s) => quad(deck.ledger, along, across, 0, deck.width, s - half, s + half));
}

/** The three edges that are not against the house. */
export function deckOpenEdges(deck: DeckShape): [Vec2, Vec2][] {
  const [a, b, c, d] = deckPolygon(deck);
  return [
    [b!, c!],
    [c!, d!],
    [d!, a!],
  ];
}

/** Post centers on the guarded edges, at most 6 feet apart, including the corners. */
export function deckPosts(deck: DeckShape, gap = 0): Vec2[] {
  const points: Vec2[] = [];
  for (const [a, b] of deckGuardedEdges(deck, gap)) {
    for (const p of postsOnEdge(a, b)) {
      if (!points.some((q) => samePoint(q, p, 0.5))) points.push(p);
    }
  }
  return points;
}

/**
 * Baluster centers on the open edges. Each bay between posts is filled so the
 * clear opening is at most 4 inches, which keeps a 4 inch sphere from passing.
 */
export function deckBalusters(deck: DeckShape, gap = 0): Vec2[] {
  const points: Vec2[] = [];
  for (const [a, b] of deckGuardedEdges(deck, gap)) {
    const posts = postsOnEdge(a, b);
    for (let i = 0; i < posts.length - 1; i++) {
      const p = posts[i]!;
      const q = posts[i + 1]!;
      const span = distance(p, q);
      const clear = span - POST_SIZE;
      if (!(clear > BALUSTER_GAP)) continue;
      const count = Math.ceil((clear - BALUSTER_GAP) / (BALUSTER_SIZE + BALUSTER_GAP));
      const gap = (clear - count * BALUSTER_SIZE) / (count + 1);
      const u = normalize(sub(q, p));
      const first = POST_SIZE / 2 + gap + BALUSTER_SIZE / 2;
      const step = BALUSTER_SIZE + gap;
      for (let k = 0; k < count; k++) points.push(add(p, scale(u, first + k * step)));
    }
  }
  return points;
}

function postsOnEdge(a: Vec2, b: Vec2): Vec2[] {
  const len = distance(a, b);
  const segments = Math.max(1, Math.ceil(len / POST_SPACING));
  const points: Vec2[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return points;
}

export function deckRailLength(deck: DeckShape, gap = 0): number {
  return deckGuardedEdges(deck, gap).reduce((sum, [a, b]) => sum + distance(a, b), 0);
}

/** A strip centered on an edge, for the top rail. */
export function railStrip(a: Vec2, b: Vec2): Vec2[] {
  const u = normalize(sub(b, a));
  const n = scale(perp(u), RAIL_THICKNESS / 2);
  return [sub(a, n), add(a, n), add(b, n), sub(b, n)];
}

export function postFoot(p: Vec2): Vec2[] {
  return squareFoot(p, POST_SIZE);
}

export function balusterFoot(p: Vec2): Vec2[] {
  return squareFoot(p, BALUSTER_SIZE);
}

function squareFoot(p: Vec2, size: number): Vec2[] {
  const h = size / 2;
  return [
    { x: p.x - h, y: p.y - h },
    { x: p.x + h, y: p.y - h },
    { x: p.x + h, y: p.y + h },
    { x: p.x - h, y: p.y + h },
  ];
}

/**
 * A deck whose ledger starts at `origin`, runs along `axis`, and reaches `corner`.
 * `side` is the side of `axis` the first click was on.
 */
export function placeDeck(origin: Vec2, axis: Vec2, side: 1 | -1, corner: Vec2): DeckShape {
  if (length(axis) < 1e-6) throw new CommandError('That wall has no direction.');
  const dir0 = normalize(axis);
  const out0 = scale(perp(dir0), side);
  let along = dot(sub(corner, origin), dir0);
  let across = dot(sub(corner, origin), out0);
  let ledger = origin;
  let dir = dir0;
  let signed = side;
  if (along < 0) {
    ledger = add(origin, scale(dir0, along));
    dir = scale(dir0, -1);
    signed = side === 1 ? -1 : 1;
    const out = scale(perp(dir), signed);
    along = dot(sub(corner, ledger), dir);
    across = dot(sub(corner, ledger), out);
  }
  if (across <= 0) throw new CommandError('Click the outside of the wall.');
  if (along < MIN_DECK || across < MIN_DECK) throw new CommandError('A deck has to be at least 3 feet wide and 3 feet deep.');
  if (along > MAX_WIDTH || across > MAX_DEPTH) throw new CommandError('A deck can be at most 40 feet along the wall and 20 feet out.');
  return { ledger, dir, width: along, depth: across, side: signed };
}

export const DECK_STAIR_WIDTH = 36;
const MAX_STAIR_DROP = 151;

export interface DeckStair {
  start: Vec2;
  dir: Vec2;
  run: number;
  width: number;
  risers: number;
  riser: number;
  tread: number;
  /** Height of the bottom of the stair above the floor. Negative when the lot is below. */
  rise0: number;
}

/** How far the ground under the outer edge sits below the floor. */
export function deckStairDrop(doc: PlanDocument, deck: Deck): number {
  const mid = outerMid(deck);
  for (const mark of siteOnLevel(doc, deck.levelId)) {
    if (mark.role !== 'lot' || !mark.points || mark.grade === undefined) continue;
    const contours = siteOnLevel(doc, deck.levelId)
      .filter((other) => other.role === 'contour' && other.points && other.grade !== undefined)
      .map((other) => ({ points: other.points!, grade: other.grade! }));
    const height = groundElevation(mid, mark.points, mark.grade, contours);
    if (height !== null && height < -7.75) return -height;
  }
  return 0;
}

/** A stair from the lot up to the middle of the outer edge. Null when the drop is too small or too tall. */
export function deckStair(deck: DeckShape, drop: number): DeckStair | null {
  if (!(drop >= 7.75) || drop > MAX_STAIR_DROP) return null;
  const risers = Math.ceil((drop - 1e-6) / 7.75);
  const riser = drop / risers;
  const tread = 10;
  const run = (risers - 1) * tread;
  const width = Math.min(DECK_STAIR_WIDTH, deck.width);
  const mid = outerMid(deck);
  const out = normalize(scale(perp(deck.dir), deck.side));
  return { start: add(mid, scale(out, run)), dir: scale(out, -1), run, width, risers, riser, tread, rise0: -drop };
}

/** Open edges that still get a rail. The stair takes a gap out of the outer edge. */
export function deckGuardedEdges(deck: DeckShape, gap: number): [Vec2, Vec2][] {
  const edges = deckOpenEdges(deck);
  if (!(gap > 1)) return edges;
  const outer = edges[1];
  if (!outer) return edges;
  return [edges[0]!, ...splitEdge(outer[0], outer[1], gap), edges[2]!].filter((edge): edge is [Vec2, Vec2] => edge !== undefined);
}

function outerMid(deck: DeckShape): Vec2 {
  const poly = deckPolygon(deck);
  const c = poly[2]!;
  const d = poly[3]!;
  return { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
}

function splitEdge(a: Vec2, b: Vec2, gap: number): [Vec2, Vec2][] {
  const len = distance(a, b);
  if (gap >= len - 1) return [];
  const u = normalize(sub(b, a));
  const mid = add(a, scale(u, len / 2));
  const half = gap / 2;
  const left = add(mid, scale(u, -half));
  const right = add(mid, scale(u, half));
  const parts: [Vec2, Vec2][] = [];
  if (distance(a, left) > 1) parts.push([a, left]);
  if (distance(right, b) > 1) parts.push([right, b]);
  return parts;
}

export function decksOnLevel(doc: PlanDocument, levelId: string): Deck[] {
  return Object.values(doc.elements).filter((el): el is Deck => el.kind === 'deck' && el.levelId === levelId);
}

function quad(origin: Vec2, along: Vec2, across: Vec2, a0: number, a1: number, c0: number, c1: number): Vec2[] {
  const at = (a: number, c: number) => add(origin, add(scale(along, a), scale(across, c)));
  return [at(a0, c0), at(a1, c0), at(a1, c1), at(a0, c1)];
}
