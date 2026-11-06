import type { DisplayItem } from '../display/display-list';
import { add, normalize, scale, sub } from '../geometry/vec2';
import type { Id, Pipe, PlanDocument, Vec2 } from '../model/schema';
import { DRAIN_CENTER, SUPPLY_CENTER } from '../plumbing/fixtures';

/** Outside size of a supply pipe, in inches. */
export const PIPE_SUPPLY = 0.75;
/** Outside size of a drain pipe, in inches. */
export const PIPE_DRAIN = 2;

export function pipesOnLevel(doc: PlanDocument, levelId: Id): Pipe[] {
  return Object.values(doc.elements).filter((el): el is Pipe => el.kind === 'pipe' && el.levelId === levelId);
}

export function pipeSize(pipe: Pick<Pipe, 'service'>): number {
  return pipe.service === 'drain' ? PIPE_DRAIN : PIPE_SUPPLY;
}

/** Height of the pipe center above the level floor. */
export function pipeCenter(pipe: Pick<Pipe, 'service'>): number {
  return pipe.service === 'drain' ? DRAIN_CENTER : SUPPLY_CENTER;
}

/** A square section centered on the run. */
export function pipePolygon(pipe: Pick<Pipe, 'a' | 'b' | 'service'>): Vec2[] {
  const dir = normalize(sub(pipe.b, pipe.a));
  const n = scale(perp(dir), pipeSize(pipe) / 2);
  return [sub(pipe.a, n), add(pipe.a, n), add(pipe.b, n), sub(pipe.b, n)];
}

export function pipeItem(pipe: Pipe): DisplayItem {
  return {
    elementId: pipe.id,
    layer: 'plumbing',
    prims: [
      { t: 'line', a: pipe.a, b: pipe.b, pen: 'plumbing' },
      { t: 'polyline', pts: pipePolygon(pipe), closed: true, pen: 'plumbing' },
    ],
  };
}

function perp(dir: Vec2): Vec2 {
  return { x: -dir.y, y: dir.x };
}
