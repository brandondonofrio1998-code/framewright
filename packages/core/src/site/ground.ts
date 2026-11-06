import { pointInPolygon, polygonArea, projectOnSegment } from '../geometry/vec2';
import type { Vec2 } from '../model/schema';

/** Vertical thickness of the blended ground, matching a flat pad. */
export const GROUND_THICKNESS = 2;

export interface GroundContour {
  points: Vec2[];
  grade: number;
}

/**
 * Height above the floor where the lot has a grade and at least one terrace.
 * Inside a terrace the ground is flat at that terrace. Between a terrace and
 * the next larger outline, the height moves from one grade to the other.
 */
export function groundElevation(p: Vec2, lot: readonly Vec2[], lotGrade: number, contours: readonly GroundContour[]): number | null {
  if (!pointInPolygon(p, lot)) return null;
  const terraces = contours.filter((contour) => contour.points.length >= 3);
  const containing = terraces.filter((contour) => pointInPolygon(p, contour.points)).sort((a, b) => Math.abs(polygonArea(a.points)) - Math.abs(polygonArea(b.points)));
  if (containing.length === 0) {
    if (terraces.length === 0) return lotGrade;
    let nearest = Infinity;
    let grade = lotGrade;
    for (const contour of terraces) {
      const distance = edgeDistance(p, contour.points);
      if (distance < nearest) {
        nearest = distance;
        grade = contour.grade;
      }
    }
    const outer = edgeDistance(p, lot);
    const t = nearest / (nearest + outer || 1);
    return grade * (1 - t) + lotGrade * t;
  }
  const host = containing[0]!;
  const inners = terraces.filter((contour) => contour !== host && contour.points.every((corner) => pointInPolygon(corner, host.points)) && !pointInPolygon(p, contour.points));
  if (inners.length === 0) return host.grade;
  let nearest = Infinity;
  let innerGrade = host.grade;
  for (const contour of inners) {
    const distance = edgeDistance(p, contour.points);
    if (distance < nearest) {
      nearest = distance;
      innerGrade = contour.grade;
    }
  }
  const outer = edgeDistance(p, host.points);
  const t = nearest / (nearest + outer || 1);
  return innerGrade * (1 - t) + host.grade * t;
}

export interface GroundMesh {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

/** A solid ground over the lot. Null when there is nothing to blend. */
export function blendedGround(lot: readonly Vec2[], lotGrade: number, contours: readonly GroundContour[], elevation: number): GroundMesh | null {
  if (contours.length === 0 || lot.length < 3) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of lot) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const span = Math.max(maxX - minX, maxY - minY, 24);
  const step = Math.max(24, span / 40);
  const nx = Math.max(1, Math.ceil((maxX - minX) / step));
  const ny = Math.max(1, Math.ceil((maxY - minY) / step));
  const mesh: GroundMesh = { positions: [], normals: [], uvs: [], indices: [] };
  const index = new Map<string, number>();
  const at = (x: number, y: number, z: number, nz: number) => {
    const key = `${x.toFixed(3)}:${y.toFixed(3)}:${z.toFixed(3)}:${nz}`;
    const found = index.get(key);
    if (found !== undefined) return found;
    const id = mesh.positions.length / 3;
    mesh.positions.push(x, y, z);
    mesh.normals.push(0, 0, nz);
    mesh.uvs.push(x, y);
    index.set(key, id);
    return id;
  };
  const tri = (a: number, b: number, c: number) => mesh.indices.push(a, b, c);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const corners = [
        { x: minX + i * step, y: minY + j * step },
        { x: minX + (i + 1) * step, y: minY + j * step },
        { x: minX + (i + 1) * step, y: minY + (j + 1) * step },
        { x: minX + i * step, y: minY + (j + 1) * step },
      ];
      if (!corners.every((corner) => pointInPolygon(corner, lot))) continue;
      const h = corners.map((corner) => elevation + (groundElevation(corner, lot, lotGrade, contours) ?? lotGrade));
      const top = corners.map((corner, k) => at(corner.x, corner.y, h[k]!, 1));
      const bot = corners.map((corner, k) => at(corner.x, corner.y, h[k]! - GROUND_THICKNESS, -1));
      tri(top[0]!, top[1]!, top[2]!);
      tri(top[0]!, top[2]!, top[3]!);
      tri(bot[0]!, bot[2]!, bot[1]!);
      tri(bot[0]!, bot[3]!, bot[2]!);
    }
  }
  for (let i = 0; i < lot.length; i++) {
    const a = lot[i]!;
    const b = lot[(i + 1) % lot.length]!;
    const ha = elevation + (groundElevation(a, lot, lotGrade, contours) ?? lotGrade);
    const hb = elevation + (groundElevation(b, lot, lotGrade, contours) ?? lotGrade);
    const a0 = at(a.x, a.y, ha - GROUND_THICKNESS, 0);
    const b0 = at(b.x, b.y, hb - GROUND_THICKNESS, 0);
    const b1 = at(b.x, b.y, hb, 0);
    const a1 = at(a.x, a.y, ha, 0);
    tri(a0, b0, b1);
    tri(a0, b1, a1);
  }
  return mesh.indices.length > 0 ? mesh : null;
}

function edgeDistance(p: Vec2, poly: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const distance = projectOnSegment(p, poly[i]!, poly[(i + 1) % poly.length]!).distance;
    if (distance < best) best = distance;
  }
  return best;
}
