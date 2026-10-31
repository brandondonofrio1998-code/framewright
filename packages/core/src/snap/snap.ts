import {
  add,
  distance,
  dot,
  fromAngle,
  lineIntersection,
  midpoint,
  projectOnSegment,
  scale,
  segmentIntersection,
  sub,
  vec,
} from '../geometry/vec2';
import type { Id, PlanDocument, Vec2 } from '../model/schema';
import type { Segment, WallGeometry } from '../walls/joins';

export type SnapKind = 'node' | 'corner' | 'midpoint' | 'intersection' | 'onWall' | 'angle' | 'alignment' | 'grid' | 'free';

export interface SnapTarget {
  p: Vec2;
  kind: 'node' | 'corner' | 'midpoint';
  id?: Id;
}

export interface SnapScene {
  points: SnapTarget[];
  segments: { a: Vec2; b: Vec2; id?: Id }[];
  /** Points that horizontal/vertical alignment guides come from. */
  alignTo: Vec2[];
}

export interface SnapSettings {
  objects: boolean;
  angles: boolean;
  grid: boolean;
}

export interface SnapOptions extends SnapSettings {
  /** Capture distance in model units (pixel tolerance / zoom). */
  tolerance: number;
  gridSpacing: number;
  /** Previous point: enables angle snapping relative to it. */
  anchor?: Vec2;
  /** Radians; default 15°. */
  angleStep?: number;
  /** Length rounding along a snapped angle, model units; default 1". */
  lengthStep?: number;
}

export interface SnapResult {
  p: Vec2;
  kind: SnapKind;
  /** Element the point snapped to (node or wall), when there is one. */
  id?: Id;
  /** Snapped direction from the anchor, radians. */
  angle?: number;
  /** Guide lines to draw (alignment, angle ray). */
  guides: Segment[];
}

const POINT_PRIORITY: Record<SnapTarget['kind'], number> = { node: 0, corner: 1, midpoint: 2 };
const DEFAULT_ANGLE_STEP = (15 * Math.PI) / 180;

function nearestPoint(cursor: Vec2, scene: SnapScene, tol: number): SnapTarget | null {
  let best: SnapTarget | null = null;
  let bestDist = Infinity;
  for (const target of scene.points) {
    const d = distance(cursor, target.p);
    if (d > tol) continue;
    if (!best || POINT_PRIORITY[target.kind] < POINT_PRIORITY[best.kind] || (target.kind === best.kind && d < bestDist)) {
      best = target;
      bestDist = d;
    }
  }
  return best;
}

function nearSegments(cursor: Vec2, scene: SnapScene, tol: number) {
  return scene.segments
    .map((s) => ({ s, hit: projectOnSegment(cursor, s.a, s.b) }))
    .filter(({ hit }) => hit.distance <= tol)
    .sort((x, y) => x.hit.distance - y.hit.distance);
}

function intersectionNear(cursor: Vec2, scene: SnapScene, tol: number): Vec2 | null {
  const near = nearSegments(cursor, scene, tol);
  let best: Vec2 | null = null;
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const hit = segmentIntersection(near[i]!.s.a, near[i]!.s.b, near[j]!.s.a, near[j]!.s.b);
      if (hit && distance(hit.point, cursor) <= tol && (!best || distance(hit.point, cursor) < distance(best, cursor))) best = hit.point;
    }
  }
  return best;
}

interface Alignment {
  p: Vec2;
  guides: Segment[];
}

/** Snap to the vertical and/or horizontal line through nearby alignment points. */
function alignmentNear(cursor: Vec2, scene: SnapScene, tol: number): Alignment | null {
  let vertical: Vec2 | null = null;
  let horizontal: Vec2 | null = null;
  for (const q of scene.alignTo) {
    if (Math.abs(cursor.x - q.x) <= tol && (!vertical || Math.abs(cursor.x - q.x) < Math.abs(cursor.x - vertical.x))) vertical = q;
    if (Math.abs(cursor.y - q.y) <= tol && (!horizontal || Math.abs(cursor.y - q.y) < Math.abs(cursor.y - horizontal.y))) horizontal = q;
  }
  if (vertical && horizontal) {
    const p = vec(vertical.x, horizontal.y);
    return { p, guides: [[vertical, p], [horizontal, p]] };
  }
  if (vertical) {
    const p = vec(vertical.x, cursor.y);
    return { p, guides: [[vertical, p]] };
  }
  if (horizontal) {
    const p = vec(cursor.x, horizontal.y);
    return { p, guides: [[horizontal, p]] };
  }
  return null;
}

/** Resolves the cursor to a snapped point. Priority: points > angle (× wall/alignment/length) > on-wall > alignment > grid. */
export function snapPoint(cursor: Vec2, scene: SnapScene, opts: SnapOptions): SnapResult {
  const tol = opts.tolerance;

  if (opts.objects) {
    const target = nearestPoint(cursor, scene, tol);
    if (target) return { p: target.p, kind: target.kind, ...(target.id !== undefined && { id: target.id }), guides: [] };
    const crossing = intersectionNear(cursor, scene, tol);
    if (crossing) return { p: crossing, kind: 'intersection', guides: [] };
  }

  const anchor = opts.anchor;
  if (opts.angles && anchor && distance(cursor, anchor) > tol) {
    const step = opts.angleStep ?? DEFAULT_ANGLE_STEP;
    const raw = Math.atan2(cursor.y - anchor.y, cursor.x - anchor.x);
    const angle = Math.round(raw / step) * step;
    const dir = fromAngle(angle);
    const along = dot(sub(cursor, anchor), dir);
    const onRay = add(anchor, scale(dir, along));
    if (along > 0 && distance(cursor, onRay) <= tol) {
      if (opts.objects) {
        for (const { s } of nearSegments(cursor, scene, tol * 2)) {
          const p = lineIntersection(anchor, dir, s.a, sub(s.b, s.a));
          if (p && distance(p, cursor) <= tol * 2 && projectOnSegment(p, s.a, s.b).distance <= 1e-6) {
            return { p, kind: 'onWall', ...(s.id !== undefined && { id: s.id }), angle, guides: [[anchor, p]] };
          }
        }
        let best: Alignment | null = null;
        for (const q of scene.alignTo) {
          for (const lineDir of [vec(0, 1), vec(1, 0)]) {
            const p = lineIntersection(anchor, dir, q, lineDir);
            if (!p || distance(p, cursor) > tol || dot(sub(p, anchor), dir) <= 0) continue;
            if (!best || distance(p, cursor) < distance(best.p, cursor)) best = { p, guides: [[anchor, p], [q, p]] };
          }
        }
        if (best) return { p: best.p, kind: 'alignment', angle, guides: best.guides };
      }
      const lengthStep = opts.lengthStep ?? 1;
      const len = Math.max(lengthStep, Math.round(along / lengthStep) * lengthStep);
      const p = add(anchor, scale(dir, len));
      return { p, kind: 'angle', angle, guides: [[anchor, p]] };
    }
  }

  if (opts.objects) {
    const [nearest] = nearSegments(cursor, scene, tol);
    if (nearest) return { p: nearest.hit.point, kind: 'onWall', ...(nearest.s.id !== undefined && { id: nearest.s.id }), guides: [] };
    const aligned = alignmentNear(cursor, scene, tol);
    if (aligned) return { p: aligned.p, kind: 'alignment', guides: aligned.guides };
  }

  if (opts.grid && opts.gridSpacing > 0) {
    const g = opts.gridSpacing;
    return { p: vec(Math.round(cursor.x / g) * g, Math.round(cursor.y / g) * g), kind: 'grid', guides: [] };
  }
  return { p: cursor, kind: 'free', guides: [] };
}

export interface SnapSceneOptions {
  /** Include wall face corners and face lines (for dimensions), not just centerlines. */
  faces?: boolean;
  excludeNodes?: ReadonlySet<Id>;
  excludeWalls?: ReadonlySet<Id>;
}

export function buildSnapScene(doc: PlanDocument, geometry: Map<Id, WallGeometry>, options: SnapSceneOptions = {}): SnapScene {
  const scene: SnapScene = { points: [], segments: [], alignTo: [] };
  const seenNodes = new Set<Id>();
  for (const geom of geometry.values()) {
    if (options.excludeWalls?.has(geom.wallId)) continue;
    const wall = doc.elements[geom.wallId];
    if (wall?.kind !== 'wall') continue;
    for (const [nodeId, p] of [
      [wall.a, geom.a],
      [wall.b, geom.b],
    ] as const) {
      if (seenNodes.has(nodeId) || options.excludeNodes?.has(nodeId)) continue;
      seenNodes.add(nodeId);
      scene.points.push({ p, kind: 'node', id: nodeId });
      scene.alignTo.push(p);
    }
    scene.points.push({ p: midpoint(geom.a, geom.b), kind: 'midpoint', id: geom.wallId });
    scene.segments.push({ a: geom.a, b: geom.b, id: geom.wallId });
    if (options.faces) {
      for (const [a, b] of [geom.leftFace, geom.rightFace]) {
        scene.points.push({ p: a, kind: 'corner' }, { p: b, kind: 'corner' });
        scene.segments.push({ a, b, id: geom.wallId });
      }
    }
  }
  return scene;
}
