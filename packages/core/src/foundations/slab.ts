import { add, lineIntersection, normalize, perp, polygonArea, scale, sub } from '../geometry/vec2';
import type { Foundation, Id, PlanDocument, Vec2 } from '../model/schema';
import { analyzeLevel } from '../rooms/rooms';
import { wallThickness } from '../walls/graph';

/** A common slab-on-grade thickness. */
export const SLAB_THICKNESS = 4;
/** Footing centered on the exterior wall. */
export const FOOTING_WIDTH = 16;
/** How far the footing continues below the slab. */
export const FOOTING_DEPTH = 12;
/** The drawn floor is this thick, and the slab stops at its underside. */
export const FLOOR_FINISH = 0.75;

export interface SlabFoundation {
  polygon: Vec2[];
  thickness: number;
  footingWidth: number;
  footingDepth: number;
  footings: Vec2[][];
  generatedFrom: Id[];
}

/**
 * A slab under each closed outline on a level, with a footing strip under the exterior walls.
 * The slab's edge is the outside face of those walls. An outline that is not closed is refused.
 * The result stays put until the foundation is built again.
 */
export function slabOnLevel(
  doc: PlanDocument,
  levelId: Id,
  thickness = SLAB_THICKNESS,
  footingWidth = FOOTING_WIDTH,
  footingDepth = FOOTING_DEPTH,
): { ok: true; slabs: SlabFoundation[] } | { ok: false; error: string } {
  if (!(thickness >= 2) || thickness > 24) return { ok: false, error: 'Slab thickness must be from 2 to 24 inches.' };
  if (!(footingWidth >= 6) || footingWidth > 48) return { ok: false, error: 'Footing width must be from 6 to 48 inches.' };
  if (!(footingDepth >= 0) || footingDepth > 48) return { ok: false, error: 'Footing depth must be from 0 to 48 inches.' };
  const { shells } = analyzeLevel(doc, levelId);
  if (shells.length === 0) return { ok: false, error: 'Draw a closed room before building a foundation.' };
  const slabs: SlabFoundation[] = [];
  for (const shell of shells) {
    const halfWall = shell.edges.map((edge) => {
      const wall = doc.elements[edge.wallId];
      const type = wall?.kind === 'wall' ? doc.wallTypes[wall.typeId] : undefined;
      return type ? wallThickness(type) / 2 : 0;
    });
    const outside = offsetLoop(shell.points, halfWall, 1);
    const outerFoot = offsetLoop(shell.points, shell.edges.map(() => footingWidth / 2), 1);
    const innerFoot = offsetLoop(shell.points, shell.edges.map(() => footingWidth / 2), -1);
    if (!outside || !outerFoot || !innerFoot) return { ok: false, error: 'The foundation outline did not close.' };
    if (polygonArea(innerFoot) >= -10) return { ok: false, error: 'The footing is wider than the room.' };
    const polygon = polygonArea(outside) < 0 ? [...outside].reverse() : outside;
    if (polygon.length < 3 || polygonArea(polygon) < 10) return { ok: false, error: 'The room is too small for a foundation.' };
    const footings: Vec2[][] = [];
    for (let i = 0; i < shell.points.length; i++) {
      const j = (i + 1) % shell.points.length;
      const quad = [outerFoot[i]!, outerFoot[j]!, innerFoot[j]!, innerFoot[i]!];
      if (polygonArea(quad) > 1 || polygonArea(quad) < -1) footings.push(quad);
    }
    if (footings.length === 0) return { ok: false, error: 'The foundation outline did not close.' };
    slabs.push({
      polygon,
      thickness,
      footingWidth,
      footingDepth,
      footings,
      generatedFrom: shell.edges.map((edge) => edge.wallId),
    });
  }
  return { ok: true, slabs };
}

/** Offsets a loop to the left (`sign` 1) or right (`sign` -1) of its walk. Collinear edges keep their corner. */
function offsetLoop(points: Vec2[], distances: number[], sign: 1 | -1): Vec2[] | null {
  if (points.length < 3 || distances.length !== points.length) return null;
  const lines = points.map((a, i) => {
    const b = points[(i + 1) % points.length]!;
    const u = normalize(sub(b, a));
    if (u.x === 0 && u.y === 0) return null;
    return { origin: add(a, scale(perp(u), sign * (distances[i] ?? 0))), u };
  });
  if (lines.some((line) => line === null)) return null;
  const corners: Vec2[] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = lines[(i - 1 + lines.length) % lines.length];
    const cur = lines[i];
    if (!prev || !cur) return null;
    const corner = lineIntersection(prev.origin, prev.u, cur.origin, cur.u) ?? cur.origin;
    const last = corners[corners.length - 1];
    if (!last || Math.hypot(last.x - corner.x, last.y - corner.y) > 0.05) corners.push(corner);
  }
  if (corners.length > 1) {
    const first = corners[0]!;
    const last = corners[corners.length - 1]!;
    if (Math.hypot(first.x - last.x, first.y - last.y) <= 0.05) corners.pop();
  }
  return corners.length >= 3 ? corners : null;
}

export function foundationsOnLevel(doc: PlanDocument, levelId: Id): Foundation[] {
  return Object.values(doc.elements).filter((el): el is Foundation => el.kind === 'foundation' && el.levelId === levelId);
}
