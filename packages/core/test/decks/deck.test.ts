import { describe, expect, it } from 'vitest';
import { BALUSTER_GAP, BALUSTER_SIZE, POST_SIZE, buildLevelMeshes, deckBalusters, deckJoists, deckOpenEdges, deckPosts, deckStair, distance, dot, materialsList, normalize, placeDeck, pointInsideMesh, sub } from '../../src';
import { testHistory } from '../helpers';

describe('decks', () => {
  it('builds joists, a rail, and a walking surface outside the wall', () => {
    const { history, baseLevelId } = testHistory();
    const shape = placeDeck({ x: 0, y: -4 }, { x: 1, y: 0 }, -1, { x: 144, y: -124 });
    expect(shape).toMatchObject({ width: 144, depth: 120, side: -1 });
    const created = history.dispatch('deck.create', { levelId: baseLevelId, ...shape });
    if (!created.ok) throw new Error(created.error);
    const deck = Object.values(history.doc.elements).find((el) => el.kind === 'deck');
    expect(deck?.kind).toBe('deck');
    expect(deckJoists(shape).length).toBeGreaterThan(4);
    expect(deckPosts(shape).length).toBeGreaterThan(3);
    const lines = materialsList(history.doc);
    expect(lines.find((line) => line.name === 'Decking')?.quantity).toBeCloseTo((144 * 120) / 144, 3);
    expect(lines.find((line) => line.name === 'Deck railing')?.quantity).toBeCloseTo((144 + 240) / 12, 3);
    const balusters = deckBalusters(shape);
    expect(balusters.length).toBeGreaterThan(20);
    expect(lines.find((line) => line.name === 'Deck balusters')?.quantity).toBe(balusters.length);
    expect(widestOpening(shape)).toBeLessThanOrEqual(BALUSTER_GAP + 1e-6);
    const parts = buildLevelMeshes(history.doc, baseLevelId);
    const deckParts = parts.filter((part) => part.elementId === (deck && 'id' in deck ? deck.id : ''));
    expect(deckParts.length).toBeGreaterThan(4);
    const spindle = balusters.reduce((best, p) => (p.x > best.x ? p : best));
    expect(pointInsideMesh(deckParts, [spindle.x, spindle.y, 16])).toBe(true);
    expect(pointInsideMesh(deckParts, [72, -64, -0.4])).toBe(true);
    expect(() => placeDeck({ x: 0, y: 0 }, { x: 1, y: 0 }, -1, { x: 80, y: 40 })).toThrow(/outside/);
  });

  it('steps down to a lot that sits below the floor', () => {
    const { history, baseLevelId } = testHistory();
    const lot = history.dispatch('site.lot', {
      levelId: baseLevelId,
      points: [
        { x: -20, y: 20 },
        { x: 200, y: 20 },
        { x: 200, y: -200 },
        { x: -20, y: -200 },
      ],
    });
    if (!lot.ok) throw new Error(lot.error);
    const graded = history.dispatch('site.grade', { id: lot.value, grade: -48 });
    if (!graded.ok) throw new Error(graded.error);
    const shape = placeDeck({ x: 0, y: -4 }, { x: 1, y: 0 }, -1, { x: 144, y: -124 });
    const created = history.dispatch('deck.create', { levelId: baseLevelId, ...shape });
    if (!created.ok) throw new Error(created.error);
    const flight = deckStair(shape, 48);
    if (!flight) throw new Error('missing stair');
    expect(flight.risers).toBeGreaterThan(5);
    expect(flight.riser).toBeLessThanOrEqual(7.75);
    const parts = buildLevelMeshes(history.doc, baseLevelId).filter((part) => part.elementId === created.value);
    const tread = { x: flight.start.x + flight.dir.x * flight.tread * 0.5, y: flight.start.y + flight.dir.y * flight.tread * 0.5 };
    expect(pointInsideMesh(parts, [tread.x, tread.y + 4, flight.rise0 + flight.riser - 0.4])).toBe(true);
  });
});

/** Largest clear gap between posts and balusters along the open edges. */
function widestOpening(shape: Parameters<typeof deckBalusters>[0]): number {
  let widest = 0;
  const spindles = deckBalusters(shape);
  for (const [a, b] of deckOpenEdges(shape)) {
    const u = normalize(sub(b, a));
    const length = distance(a, b);
    const along = (p: { x: number; y: number }) => dot(sub(p, a), u);
    const marks: { t: number; half: number }[] = [];
    const keep = (p: { x: number; y: number }, half: number) => {
      const t = along(p);
      const foot = { x: a.x + u.x * t, y: a.y + u.y * t };
      if (distance(p, foot) < 0.6 && t >= -0.6 && t <= length + 0.6) marks.push({ t, half });
    };
    for (const p of deckPosts(shape)) keep(p, POST_SIZE / 2);
    for (const p of spindles) keep(p, BALUSTER_SIZE / 2);
    marks.sort((p, q) => p.t - q.t);
    for (let i = 0; i < marks.length - 1; i++) {
      const gap = marks[i + 1]!.t - marks[i + 1]!.half - (marks[i]!.t + marks[i]!.half);
      if (gap > widest) widest = gap;
    }
  }
  return widest;
}
