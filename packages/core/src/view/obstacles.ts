import { objectFootprint } from '../catalog/symbols';
import { circuitWires } from '../electrical/devices';
import { deckPosts, deckStair, deckStairDrop, decksOnLevel, postFoot } from '../decks/deck';
import { openingsOnWall, wallLength } from '../openings/openings';
import type { Id, PlanDocument, Vec2 } from '../model/schema';
import { pipeSize, pipesOnLevel } from '../pipes/pipe';
import { landingPolygon, placedFlights, stairCorners, stairsOnLevel } from '../stairs/straight';
import { computeWallGeometry } from '../walls/joins';
import type { WalkBarrier } from './walk';

/** Walls, with a gap at each door and window, plus furniture and stairs. */
export function walkObstacles(doc: PlanDocument, levelId: Id): WalkBarrier[] {
  const barriers: WalkBarrier[] = [];
  for (const geom of computeWallGeometry(doc, levelId).values()) {
    const wall = doc.elements[geom.wallId];
    if (wall?.kind !== 'wall') continue;
    const length = wallLength(doc, wall);
    const cuts = openingsOnWall(doc, wall.id).map((opening) => [opening.t - opening.width / 2, opening.t + opening.width / 2] as [number, number]);
    for (const [start, end] of remainingSpans(length, cuts)) {
      barriers.push({ a: along(geom.a, geom.b, start / length), b: along(geom.a, geom.b, end / length), half: geom.thickness / 2 });
    }
  }
  for (const el of Object.values(doc.elements)) {
    if (el.kind !== 'object' || el.levelId !== levelId) continue;
    pushLoop(barriers, objectFootprint(doc, el));
  }
  for (const stair of stairsOnLevel(doc, levelId)) {
    for (const flight of placedFlights(stair)) pushLoop(barriers, stairCorners(flight));
    const landing = landingPolygon(stair);
    if (landing) pushLoop(barriers, landing);
  }
  for (const deck of decksOnLevel(doc, levelId)) {
    const gap = deckStair(deck, deckStairDrop(doc, deck))?.width ?? 0;
    for (const post of deckPosts(deck, gap)) pushLoop(barriers, postFoot(post));
  }
  for (const pipe of pipesOnLevel(doc, levelId)) barriers.push({ a: pipe.a, b: pipe.b, half: pipeSize(pipe) / 2 });
  for (const wire of circuitWires(doc, levelId)) {
    if (Math.hypot(wire.b.x - wire.a.x, wire.b.y - wire.a.y) > 1) barriers.push({ a: wire.a, b: wire.b, half: 0.25 });
  }
  return barriers;
}

function remainingSpans(length: number, cuts: [number, number][]): [number, number][] {
  let spans: [number, number][] = [[0, length]];
  for (const [cutStart, cutEnd] of cuts) {
    const next: [number, number][] = [];
    for (const [start, end] of spans) {
      if (cutEnd <= start || cutStart >= end) {
        next.push([start, end]);
        continue;
      }
      if (cutStart > start + 1) next.push([start, cutStart]);
      if (cutEnd < end - 1) next.push([cutEnd, end]);
    }
    spans = next;
  }
  return spans.filter(([start, end]) => end - start > 1);
}

function along(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function pushLoop(barriers: WalkBarrier[], points: readonly Vec2[]): void {
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    if (Math.hypot(b.x - a.x, b.y - a.y) > 1) barriers.push({ a, b, half: 0 });
  }
}
