import { studCenters } from '../framing/members';
import { add, distance, dot, length, normalize, perp, samePoint, scale, sub } from '../geometry/vec2';
import type { Deck, PlanDocument, Vec2 } from '../model/schema';
import { CommandError } from '../commands/history';

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

/** Post centers on the open edges, at most 6 feet apart, including the corners. */
export function deckPosts(deck: DeckShape): Vec2[] {
  const points: Vec2[] = [];
  for (const [a, b] of deckOpenEdges(deck)) {
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
export function deckBalusters(deck: DeckShape): Vec2[] {
  const points: Vec2[] = [];
  for (const [a, b] of deckOpenEdges(deck)) {
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

export function deckRailLength(deck: DeckShape): number {
  return deckOpenEdges(deck).reduce((sum, [a, b]) => sum + distance(a, b), 0);
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

export function decksOnLevel(doc: PlanDocument, levelId: string): Deck[] {
  return Object.values(doc.elements).filter((el): el is Deck => el.kind === 'deck' && el.levelId === levelId);
}

function quad(origin: Vec2, along: Vec2, across: Vec2, a0: number, a1: number, c0: number, c1: number): Vec2[] {
  const at = (a: number, c: number) => add(origin, add(scale(along, a), scale(across, c)));
  return [at(a0, c0), at(a1, c0), at(a1, c1), at(a0, c1)];
}
