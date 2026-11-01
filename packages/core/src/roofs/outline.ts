import { defaultWallHeight } from '../model/levels';
import type { Id, PlanDocument, Wall } from '../model/schema';
import { analyzeLevel } from '../rooms/rooms';
import { computeWallGeometry } from '../walls/joins';

const AXIS_EPS = 0.05;

/** The outside faces of one closed, axis-aligned rectangular room. */
export interface RectOutline {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Height of the top of the wall on that side. */
  plateX0: number;
  plateX1: number;
  plateY0: number;
  plateY1: number;
  generatedFrom: Id[];
}

export function wallTop(doc: PlanDocument, wall: Wall): number {
  const level = doc.levels[wall.levelId];
  if (!level) return 0;
  return level.elevation + wall.baseOffset + (wall.height ?? defaultWallHeight(doc.levels, doc.levelOrder, wall.levelId));
}

/**
 * The exterior rectangle of a level, measured on the outside faces. An L, a diagonal wall,
 * or an unclosed run is refused. `x0` is the smaller X, `y0` the smaller Y.
 */
export function rectangularOutline(doc: PlanDocument, levelId: Id): { ok: true; rect: RectOutline } | { ok: false; reason: 'angled' | 'open' | 'small' } {
  const { exterior } = analyzeLevel(doc, levelId);
  const geometry = computeWallGeometry(doc, levelId);
  const faces: { wall: Wall; axis: 'x' | 'y'; coord: number; wallId: Id }[] = [];
  for (const [wallId, side] of exterior) {
    const geom = geometry.get(wallId);
    const wall = doc.elements[wallId];
    if (!geom || wall?.kind !== 'wall') continue;
    const [a, b] = side === 'left' ? geom.leftFace : geom.rightFace;
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dy <= AXIS_EPS && dx > 1) faces.push({ wallId, wall, axis: 'y', coord: (a.y + b.y) / 2 });
    else if (dx <= AXIS_EPS && dy > 1) faces.push({ wallId, wall, axis: 'x', coord: (a.x + b.x) / 2 });
    else return { ok: false, reason: 'angled' };
  }
  const vertical = faces.filter((face) => face.axis === 'x');
  const horizontal = faces.filter((face) => face.axis === 'y');
  if (vertical.length !== 2 || horizontal.length !== 2) return { ok: false, reason: 'open' };
  const [xLo, xHi] = vertical[0]!.coord <= vertical[1]!.coord ? [vertical[0]!, vertical[1]!] : [vertical[1]!, vertical[0]!];
  const [yLo, yHi] = horizontal[0]!.coord <= horizontal[1]!.coord ? [horizontal[0]!, horizontal[1]!] : [horizontal[1]!, horizontal[0]!];
  if (xHi.coord - xLo.coord < 12 || yHi.coord - yLo.coord < 12) return { ok: false, reason: 'small' };
  return {
    ok: true,
    rect: {
      x0: xLo.coord,
      x1: xHi.coord,
      y0: yLo.coord,
      y1: yHi.coord,
      plateX0: wallTop(doc, xLo.wall),
      plateX1: wallTop(doc, xHi.wall),
      plateY0: wallTop(doc, yLo.wall),
      plateY1: wallTop(doc, yHi.wall),
      generatedFrom: faces.map((face) => face.wallId),
    },
  };
}

export function outlineError(reason: 'angled' | 'open' | 'small', kind: 'gable' | 'hip'): string {
  if (reason === 'angled') return `A ${kind} roof needs a rectangular outline.`;
  if (reason === 'small') return 'The room is too small for a roof.';
  return `Draw a closed rectangular room before building a ${kind} roof.`;
}
