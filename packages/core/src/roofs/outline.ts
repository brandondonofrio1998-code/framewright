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

interface SideFace {
  wall: Wall;
  wallId: Id;
  coord: number;
  a: { x: number; y: number };
  b: { x: number; y: number };
}

/** Faces on one straight side, even when a partition splits that side into several walls. */
function groupByCoord(faces: SideFace[]): SideFace[][] {
  const sorted = [...faces].sort((left, right) => left.coord - right.coord);
  const groups: SideFace[][] = [];
  for (const face of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(face.coord - last[0]!.coord) <= AXIS_EPS) last.push(face);
    else groups.push([face]);
  }
  return groups;
}

/** A gap wider than a foot between pieces of one side means the outline is open. */
function sideIsSolid(faces: SideFace[], along: 'x' | 'y'): boolean {
  const spans = faces
    .map((face) => {
      const s0 = along === 'x' ? face.a.x : face.a.y;
      const s1 = along === 'x' ? face.b.x : face.b.y;
      return [Math.min(s0, s1), Math.max(s0, s1)] as const;
    })
    .sort((left, right) => left[0] - right[0]);
  let end = spans[0]?.[0] ?? 0;
  for (const [start, stop] of spans) {
    if (start - end > 12) return false;
    end = Math.max(end, stop);
  }
  return spans.length > 0;
}

function sideOf(doc: PlanDocument, faces: SideFace[]): { coord: number; plate: number; wallIds: Id[] } {
  const coord = faces.reduce((sum, face) => sum + face.coord, 0) / faces.length;
  const plate = Math.min(...faces.map((face) => wallTop(doc, face.wall)));
  return { coord, plate, wallIds: faces.map((face) => face.wallId) };
}

/**
 * The exterior rectangle of a level, measured on the outside faces. An L, a diagonal wall,
 * or an unclosed run is refused. A partition that splits an outside wall does not: those
 * pieces are still one side. `x0` is the smaller X, `y0` the smaller Y.
 */
export function rectangularOutline(doc: PlanDocument, levelId: Id): { ok: true; rect: RectOutline } | { ok: false; reason: 'angled' | 'open' | 'small' } {
  const { exterior } = analyzeLevel(doc, levelId);
  const geometry = computeWallGeometry(doc, levelId);
  const vertical: SideFace[] = [];
  const horizontal: SideFace[] = [];
  for (const [wallId, side] of exterior) {
    const geom = geometry.get(wallId);
    const wall = doc.elements[wallId];
    if (!geom || wall?.kind !== 'wall') continue;
    const [a, b] = side === 'left' ? geom.leftFace : geom.rightFace;
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dy <= AXIS_EPS && dx > 1) horizontal.push({ wallId, wall, coord: (a.y + b.y) / 2, a, b });
    else if (dx <= AXIS_EPS && dy > 1) vertical.push({ wallId, wall, coord: (a.x + b.x) / 2, a, b });
    else return { ok: false, reason: 'angled' };
  }
  const xSides = groupByCoord(vertical);
  const ySides = groupByCoord(horizontal);
  if (xSides.length !== 2 || ySides.length !== 2) return { ok: false, reason: 'open' };
  if (xSides.some((side) => !sideIsSolid(side, 'y')) || ySides.some((side) => !sideIsSolid(side, 'x'))) return { ok: false, reason: 'open' };
  const [xLo, xHi] = xSides[0]![0]!.coord <= xSides[1]![0]!.coord ? [sideOf(doc, xSides[0]!), sideOf(doc, xSides[1]!)] : [sideOf(doc, xSides[1]!), sideOf(doc, xSides[0]!)];
  const [yLo, yHi] = ySides[0]![0]!.coord <= ySides[1]![0]!.coord ? [sideOf(doc, ySides[0]!), sideOf(doc, ySides[1]!)] : [sideOf(doc, ySides[1]!), sideOf(doc, ySides[0]!)];
  if (xHi.coord - xLo.coord < 12 || yHi.coord - yLo.coord < 12) return { ok: false, reason: 'small' };
  return {
    ok: true,
    rect: {
      x0: xLo.coord,
      x1: xHi.coord,
      y0: yLo.coord,
      y1: yHi.coord,
      plateX0: xLo.plate,
      plateX1: xHi.plate,
      plateY0: yLo.plate,
      plateY1: yHi.plate,
      generatedFrom: [...xLo.wallIds, ...xHi.wallIds, ...yLo.wallIds, ...yHi.wallIds],
    },
  };
}

export function outlineError(reason: 'angled' | 'open' | 'small', kind: 'gable' | 'hip'): string {
  if (reason === 'angled') return `A ${kind} roof needs a rectangular outline.`;
  if (reason === 'small') return 'The room is too small for a roof.';
  return `Draw a closed rectangular room before building a ${kind} roof.`;
}
