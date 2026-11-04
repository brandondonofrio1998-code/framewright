import { describe, expect, it } from 'vitest';
import { deckJoists, deckPosts, materialsList, placeDeck, pointInsideMesh, buildLevelMeshes } from '../../src';
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
    const parts = buildLevelMeshes(history.doc, baseLevelId);
    const deckParts = parts.filter((part) => part.elementId === (deck && 'id' in deck ? deck.id : ''));
    expect(deckParts.length).toBeGreaterThan(4);
    expect(pointInsideMesh(deckParts, [72, -64, -0.4])).toBe(true);
    expect(() => placeDeck({ x: 0, y: 0 }, { x: 1, y: 0 }, -1, { x: 80, y: 40 })).toThrow(/outside/);
  });
});
