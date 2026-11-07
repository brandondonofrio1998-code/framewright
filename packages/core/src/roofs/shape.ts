import { clipHalfPlane, triangulate } from '../geometry/polygon';
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
  wallIds: Id[];
}

/**
 * Outside face of each closed shell. Consecutive pieces of one straight wall are one edge.
 * The walk is clockwise, so the inside of the building is to the right.
 */
export function roofEdges(doc: PlanDocument, levelId: Id): RoofEdge[][] {
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
  into.wallIds.push(...edge.wallIds);
  into.origin = { x: (into.origin.x + edge.origin.x) / 2, y: (into.origin.y + edge.origin.y) / 2 };
}

/**
 * A hip over every closed outline on the level. Each outside wall is an eave. The slope
 * rises toward the inside, and the lower plane wins, so an L grows a valley at the notch.
 * A rectangle keeps the dedicated hip in `hip.ts`.
 */
export function hipOverOutlines(doc: PlanDocument, levelId: Id, pitch: number, overhang: number): { ok: true; roof: GableRoof } | { ok: false; error: string } {
  const loops = roofEdges(doc, levelId);
  if (loops.length === 0) return { ok: false, error: 'Draw a closed room before building a roof.' };
  const planes = loops.flatMap((loop) => hipLoop(loop, pitch, overhang));
  if (planes.length < 3) return { ok: false, error: 'Draw a closed room before building a roof.' };
  const plateZ = Math.min(...loops.flatMap((loop) => loop.map((edge) => edge.plate)));
  return { ok: true, roof: { plateZ, planes } };
}

function hipLoop(edges: RoofEdge[], pitch: number, overhang: number): GableSlope[] {
  const fascia = offsetLoop(edges, overhang);
  if (fascia.length < 3 || Math.abs(polygonArea(fascia)) < 1) return [];
  const triangles = triangulate(fascia);
  if (triangles.length < 3) return [];
  const slope = pitch / 12;
  const planes: GableSlope[] = [];
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]!;
    let cell = boundsPolygon(fascia, overhang + 24);
    const fasciaOrigin = add(edge.origin, scale(edge.inward, -overhang));
    cell = clipHalfPlane(cell, fasciaOrigin, edge.inward, 0);
    for (let j = 0; j < edges.length; j++) {
      if (j === i) continue;
      cell = clipBelow(cell, edge, edges[j]!, slope);
      if (cell.length < 3) break;
    }
    if (cell.length < 3) continue;
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
        pitch,
        up: edge.inward,
        eave: fasciaOrigin,
        eaveZ: edge.plate - overhang * slope,
        generatedFrom: edge.wallIds,
      });
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

/** Keeps the region where `edge` is no higher than `other`. */
function clipBelow(poly: Vec2[], edge: RoofEdge, other: RoofEdge, slope: number): Vec2[] {
  const dir = sub(edge.inward, other.inward);
  const limit = (other.plate - edge.plate) / slope + dot(edge.origin, edge.inward) - dot(other.origin, other.inward);
  if (length(dir) < 0.02) {
    const edgeAt = edge.plate + slope * dot(edge.origin, edge.inward);
    const otherAt = other.plate + slope * dot(other.origin, other.inward);
    return edgeAt <= otherAt + 1e-6 ? poly : [];
  }
  return clipHalfPlane(poly, { x: 0, y: 0 }, scale(dir, -1), -limit);
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
