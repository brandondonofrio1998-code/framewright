import { placeDeck, type DeckShape } from '../decks/deck';
import { length } from '../geometry/vec2';
import type { Deck, Id } from '../model/schema';
import { CommandError, defineCommand } from './history';

export const createDeck = defineCommand<DeckShape & { levelId: Id }, Id>({
  label: () => 'Deck',
  run: (doc, { levelId, ledger, dir, width, depth, side }, ctx) => {
    if (!doc.levels[levelId]) throw new CommandError('That level no longer exists.');
    if (length(dir) < 0.5) throw new CommandError('That wall has no direction.');
    const shape = placeDeck(ledger, dir, side, cornerOf({ ledger, dir, width, depth, side }));
    const deck: Deck = { id: ctx.newId(), kind: 'deck', levelId, ...shape };
    doc.elements[deck.id] = deck;
    return deck.id;
  },
});

function cornerOf(deck: DeckShape): { x: number; y: number } {
  const outX = -deck.dir.y * deck.side;
  const outY = deck.dir.x * deck.side;
  return {
    x: deck.ledger.x + deck.dir.x * deck.width + outX * deck.depth,
    y: deck.ledger.y + deck.dir.y * deck.width + outY * deck.depth,
  };
}

export const deckCommands = {
  'deck.create': createDeck,
};
