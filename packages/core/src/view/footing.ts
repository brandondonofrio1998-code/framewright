import { dot, pointInPolygon, sub } from '../geometry/vec2';
import { deckStair, deckStairDrop, decksOnLevel } from '../decks/deck';
import type { Id, PlanDocument, Vec2 } from '../model/schema';
import { landingPolygon, placedFlights, stairCorners, stairsOnLevel, type PlacedFlight } from '../stairs/straight';

/** Height of the tread or landing under a plan point, relative to the level floor. */
export function footRise(doc: PlanDocument, levelId: Id, p: Vec2): number {
  let rise: number | null = null;
  const take = (height: number) => {
    if (rise === null || height > rise) rise = height;
  };
  const onFlight = (flight: PlacedFlight) => {
    if (!pointInPolygon(p, stairCorners(flight))) return;
    const along = dot(sub(p, flight.start), flight.dir);
    if (along >= (flight.risers - 1) * flight.tread) take(flight.rise0 + flight.risers * flight.riser);
    else if (along <= 0) take(flight.rise0);
    else take(flight.rise0 + (Math.floor(along / flight.tread) + 1) * flight.riser);
  };
  for (const stair of stairsOnLevel(doc, levelId)) {
    for (const flight of placedFlights(stair)) onFlight(flight);
    const landing = landingPolygon(stair);
    if (landing && pointInPolygon(p, landing)) take(stair.risers * stair.riser);
  }
  for (const deck of decksOnLevel(doc, levelId)) {
    const flight = deckStair(deck, deckStairDrop(doc, deck));
    if (flight) onFlight(flight);
  }
  return rise ?? 0;
}
