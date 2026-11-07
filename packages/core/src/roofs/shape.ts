import { clipHalfPlane, subtractConvex, triangulate } from '../geometry/polygon';
import { add, dot, length, lineIntersection, normalize, perp, polygonArea, scale, sub } from '../geometry/vec2';
import type { Id, PlanDocument, Vec2 } from '../model/schema';
import { wallTop } from './outline';
import { analyzeLevel } from '../rooms/rooms';
import { computeWallGeometry } from '../walls/joins';
import type { GableRoof, GableSlope } from './gable';

const SAME_LINE = 0.2;

export interface RoofEdge {
  /** A point on the outside face. */
  origin: Vec2;
  /** Unit normal pointing into the building. */
  inward: Vec2;
  plate: number;
  /** Rise per 12. */
  pitch: number;
  /** The roof stops at this wall instead of sloping up from it. */
  gable: boolean;
  wallIds: Id[];
}

export function levelHasRoofChoices(doc: PlanDocument, levelId: Id): boolean {
  return Object.values(doc.elements).some((el) => el.kind === 'wall' && el.levelId === levelId && (el.gableEnd === true || el.roofPitch !== undefined));
}

/**
 * Outside face of each closed shell. Consecutive pieces of one straight wall are one edge.
 * The walk is clockwise, so the inside of the building is to the right.
 */
export function roofEdges(doc: PlanDocument, levelId: Id, fallbackPitch = 6): RoofEdge[][] {
  const { shells } = analyzeLevel(doc, levelId);
  const geometry = computeWallGeometry(doc, levelId);
  const loops: RoofEdge[][] = [];
  for (const shell of shells) {
    const edges: RoofEdge[] = [];
    for (const step of shell.edges) {
      const geom = geometry.get(step.wallId);
      const wall = doc.elements[step.wallId];
      const start = wall?.kind === 'wall' ? doc.elements[step.forward ? wall.a : wall.b] : undefined;
      const end = wall?.kind === 'wall' ? doc.elements[step.forward ? wall.b : wall.a] : undefined;
      if (!geom || wall?.kind !== 'wall' || start?.kind !== 'wallNode' || end?.kind !== 'wallNode') continue;
      const travel = sub(end.p, start.p);
      const along = normalize(travel);
      if (length(along) < 1e-6) continue;
      const outward = perp(along);
      const mid = add(start.p, scale(travel, 0.5));
      edges.push({
        origin: add(mid, scale(outward, geom.thickness / 2)),
        inward: scale(outward, -1),
        plate: wallTop(doc, wall),
        pitch: wall.roofPitch ?? fallbackPitch,
        gable: wall.gableEnd === true,
        wallIds: [step.wallId],
      });
    }
    const merged = mergeCollinear(edges);
    if (merged.length >= 3) loops.push(merged);
  }
  return loops;
}

function mergeCollinear(edges: RoofEdge[]): RoofEdge[] {
  const out: RoofEdge[] = [];
  for (const edge of edges) {
    const prev = out[out.length - 1];
    if (prev && sameLine(prev, edge)) absorb(prev, edge);
    else out.push({ ...edge, wallIds: [...edge.wallIds] });
  }
  if (out.length > 1 && sameLine(out[0]!, out[out.length - 1]!)) absorb(out[0]!, out.pop()!);
  return out;
}

function sameLine(a: RoofEdge, b: RoofEdge): boolean {
  return dot(a.inward, b.inward) > 0.98 && Math.abs(dot(sub(b.origin, a.origin), a.inward)) < SAME_LINE;
}

function absorb(into: RoofEdge, edge: RoofEdge): void {
  into.plate = Math.min(into.plate, edge.plate);
  into.pitch = Math.max(into.pitch, edge.pitch);
  into.gable = into.gable || edge.gable;
  into.wallIds.push(...edge.wallIds);
  into.origin = { x: (into.origin.x + edge.origin.x) / 2, y: (into.origin.y + edge.origin.y) / 2 };
}

/**
 * A hip over every closed outline on the level. Each outside wall is an eave unless that wall
 * is a gable end, in which case the roof runs into it. A steeper eave reaches the ridge sooner.
 */
export function hipOverOutlines(doc: PlanDocument, levelId: Id, pitch: number, overhang: number): { ok: true; roof: GableRoof } | { ok: false; error: string } {
  const loops = roofEdges(doc, levelId, pitch);
  if (loops.length === 0) return { ok: false, error: 'Draw a closed room before building a roof.' };
  const planes = loops.flatMap((loop) => hipLoop(loop, overhang));
  if (planes.length < 1) return { ok: false, error: 'A roof needs an eave. Leave at least one wall sloping.' };
  const plateZ = Math.min(...loops.flatMap((loop) => loop.map((edge) => edge.plate)));
  return { ok: true, roof: { plateZ, planes } };
}

function hipLoop(edges: RoofEdge[], overhang: number): GableSlope[] {
  const fascia = offsetLoop(edges, overhang);
  if (fascia.length < 3 || Math.abs(polygonArea(fascia)) < 1) return [];
  const triangles = triangulate(fascia);
  if (triangles.length < 3) return [];
  const planes: GableSlope[] = [];
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]!;
    if (edge.gable) continue;
    const bounds = boundsPolygon(fascia, overhang + 24);
    const fasciaOrigin = add(edge.origin, scale(edge.inward, -overhang));
    let pieces: Vec2[][] = [clipHalfPlane(bounds, fasciaOrigin, edge.inward, 0)].filter((piece) => piece.length >= 3);
    for (let j = 0; j < edges.length; j++) {
      if (j === i) continue;
      const other = edges[j]!;
      if (other.gable) {
        pieces = pieces.map((piece) => clipHalfPlane(piece, other.origin, other.inward, 0)).filter((piece) => piece.length >= 3);
        continue;
      }
      const lose = whereOtherWins(bounds, edge, other);
      if (lose.length < 3 || Math.abs(polygonArea(lose)) < 1) continue;
      pieces = pieces.flatMap((piece) => subtractConvex(piece, lose));
    }
    const slope = edge.pitch / 12;
    for (const cell of pieces) {
      for (let t = 0; t < triangles.length; t += 3) {
        const tri = [fascia[triangles[t]!]!, fascia[triangles[t + 1]!]!, fascia[triangles[t + 2]!]!];
        let piece = cell;
        for (let k = 0; k < 3; k++) {
          const a = tri[k]!;
          const b = tri[(k + 1) % 3]!;
          const inside = perp(sub(b, a));
          if (length(inside) < 1e-8) continue;
          piece = clipHalfPlane(piece, a, normalize(inside), 0);
        }
        if (piece.length < 3 || Math.abs(polygonArea(piece)) < 1) continue;
        const polygon = polygonArea(piece) < 0 ? [...piece].reverse() : piece;
        planes.push({
          polygon,
          pitch: edge.pitch,
          up: edge.inward,
          eave: fasciaOrigin,
          eaveZ: edge.plate - overhang * slope,
          generatedFrom: edge.wallIds,
        });
      }
    }
  }
  return planes;
}

/** The outside faces moved further out by `dist`. */
function offsetLoop(edges: RoofEdge[], dist: number): Vec2[] {
  const lines = edges.map((edge) => ({
    origin: add(edge.origin, scale(edge.inward, -dist)),
    dir: perp(edge.inward),
  }));
  const points: Vec2[] = [];
  for (let i = 0; i < lines.length; i++) {
    const prev = lines[(i - 1 + lines.length) % lines.length]!;
    const cur = lines[i]!;
    const hit = lineIntersection(prev.origin, prev.dir, cur.origin, cur.dir);
    if (!hit) return [];
    points.push(hit);
  }
  return points;
}

/** The part of the footprint where `other` is inward and lower than `edge`. */
function whereOtherWins(bounds: Vec2[], edge: RoofEdge, other: RoofEdge): Vec2[] {
  const region = clipHalfPlane(bounds, other.origin, other.inward, 0);
  const slopeEdge = edge.pitch / 12;
  const slopeOther = other.pitch / 12;
  const dir = sub(scale(edge.inward, slopeEdge), scale(other.inward, slopeOther));
  const limit = other.plate - edge.plate + slopeEdge * dot(edge.origin, edge.inward) - slopeOther * dot(other.origin, other.inward);
  if (length(dir) < 1e-4) return edge.plate > other.plate ? region : [];
  return clipHalfPlane(region, { x: 0, y: 0 }, dir, limit);
}

function boundsPolygon(points: readonly Vec2[], pad: number): Vec2[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return [
    { x: minX - pad, y: minY - pad },
    { x: maxX + pad, y: minY - pad },
    { x: maxX + pad, y: maxY + pad },
    { x: minX - pad, y: maxY + pad },
  ];
}
