import {
  add,
  angleOf,
  lineIntersection,
  normalize,
  normalizeAngle,
  perp,
  samePoint,
  scale,
  sub,
} from '../geometry/vec2';
import type { Id, PlanDocument, Vec2, Wall, WallLayer } from '../model/schema';
import { wallsOnLevel, wallThickness } from './graph';

/** Joins sharper than this are capped square instead of mitered, so miters can't spike. */
export const MIN_JOIN_ANGLE = (15 * Math.PI) / 180;
const COLLINEAR_EPS = 1e-5;

export type Segment = [Vec2, Vec2];

export interface WallLayerStrip {
  fn: WallLayer['fn'];
  materialId: Id;
  polygon: Vec2[];
}

export type WallEndKind = 'free' | 'through' | 'joined';

export interface WallGeometry {
  wallId: Id;
  a: Vec2;
  b: Vec2;
  thickness: number;
  /** Closed outline of the wall including its share of each join; used for fill and hit testing. */
  footprint: Vec2[];
  /** Face lines, left and right of a → b, trimmed at joins. */
  leftFace: Segment;
  rightFace: Segment;
  /** Square ends at free (unjoined) wall ends. */
  caps: Segment[];
  /** One strip per wall type layer, left to right. */
  layers: WallLayerStrip[];
  /** Lines between adjacent layers. */
  layerLines: Segment[];
  endKinds: [WallEndKind, WallEndKind];
}

interface Incident {
  wall: Wall;
  atA: boolean;
  /** Unit direction pointing from the node into the wall. */
  u: Vec2;
  angle: number;
  half: number;
}

interface EndInfo {
  node: Vec2;
  left: Vec2;
  right: Vec2;
  kind: WallEndKind;
  /** Degree ≥ 3 joins include the node in the outline so the hub has no gap. */
  includeNode: boolean;
}

const gapAllowsMiter = (gap: number) => gap >= MIN_JOIN_ANGLE && gap <= Math.PI * 2 - MIN_JOIN_ANGLE;

function isOpposite(x: Incident, y: Incident): boolean {
  return Math.abs(normalizeAngle(y.angle - x.angle) - Math.PI) < COLLINEAR_EPS;
}

/** At a node, the pair of collinear walls that runs straight through (others butt into it), if any. */
function throughPair(sorted: Incident[]): [Incident, Incident] | null {
  let best: [Incident, Incident] | null = null;
  const score = ([x, y]: [Incident, Incident]) => [Math.min(x.half, y.half), x.half + y.half];
  const key = ([x, y]: [Incident, Incident]) => [x.wall.id, y.wall.id].sort().join('|');
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const pair: [Incident, Incident] = [sorted[i]!, sorted[j]!];
      if (!isOpposite(pair[0], pair[1])) continue;
      if (!best) {
        best = pair;
        continue;
      }
      const [s0, s1] = score(pair);
      const [b0, b1] = score(best);
      if (s0! > b0! || (s0 === b0 && (s1! > b1! || (s1 === b1 && key(pair) < key(best))))) best = pair;
    }
  }
  return best;
}

function cornerBetween(node: Vec2, e: Incident, other: Incident, side: 'left' | 'right'): Vec2 {
  const sign = side === 'left' ? 1 : -1;
  const own = add(node, scale(perp(e.u), sign * e.half));
  const gap = side === 'left' ? normalizeAngle(other.angle - e.angle) : normalizeAngle(e.angle - other.angle);
  if (!gapAllowsMiter(gap)) return own;
  const theirs = add(node, scale(perp(other.u), -sign * other.half));
  return lineIntersection(own, e.u, theirs, other.u) ?? own;
}

/** Derives every wall's outline, faces, and layer strips on a level, with L, T, X and n-way joins. */
export function computeWallGeometry(doc: PlanDocument, levelId: Id): Map<Id, WallGeometry> {
  const walls = wallsOnLevel(doc, levelId);
  const nodePos = (id: Id): Vec2 => {
    const node = doc.elements[id];
    if (node?.kind !== 'wallNode') throw new Error(`Missing wall node ${id}`);
    return node.p;
  };
  const halfOf = (wall: Wall) => {
    const type = doc.wallTypes[wall.typeId];
    return type ? wallThickness(type) / 2 : 0;
  };

  const incidents = new Map<Id, Incident[]>();
  for (const wall of walls) {
    const a = nodePos(wall.a);
    const b = nodePos(wall.b);
    const d = normalize(sub(b, a));
    const half = halfOf(wall);
    for (const [nodeId, atA, u] of [
      [wall.a, true, d],
      [wall.b, false, scale(d, -1)],
    ] as const) {
      const list = incidents.get(nodeId) ?? [];
      list.push({ wall, atA, u, angle: normalizeAngle(angleOf(u)), half });
      incidents.set(nodeId, list);
    }
  }

  const ends = new Map<string, EndInfo>();
  for (const [nodeId, list] of incidents) {
    const node = nodePos(nodeId);
    const sorted = [...list].sort((x, y) => x.angle - y.angle || (x.wall.id < y.wall.id ? -1 : 1));
    const through = sorted.length >= 2 ? throughPair(sorted) : null;
    sorted.forEach((e, k) => {
      let leftOfU: Vec2;
      let rightOfU: Vec2;
      if (sorted.length === 1) {
        leftOfU = add(node, scale(perp(e.u), e.half));
        rightOfU = add(node, scale(perp(e.u), -e.half));
      } else {
        leftOfU = cornerBetween(node, e, sorted[(k + 1) % sorted.length]!, 'left');
        rightOfU = cornerBetween(node, e, sorted[(k - 1 + sorted.length) % sorted.length]!, 'right');
      }
      const kind: WallEndKind = sorted.length === 1 ? 'free' : through?.includes(e) ? 'through' : 'joined';
      ends.set(`${e.wall.id}:${e.atA ? 'a' : 'b'}`, {
        node,
        left: e.atA ? leftOfU : rightOfU,
        right: e.atA ? rightOfU : leftOfU,
        kind,
        includeNode: sorted.length >= 3,
      });
    });
  }

  const result = new Map<Id, WallGeometry>();
  for (const wall of walls) {
    const type = doc.wallTypes[wall.typeId];
    const A = ends.get(`${wall.id}:a`);
    const B = ends.get(`${wall.id}:b`);
    if (!type || !A || !B) continue;
    const d = normalize(sub(B.node, A.node));
    const n = perp(d);
    const thickness = wallThickness(type);

    const endpoint = (end: EndInfo, offset: number): Vec2 => {
      const square = add(end.node, scale(n, offset));
      if (end.kind !== 'joined' || samePoint(end.left, end.right)) return square;
      return lineIntersection(square, d, end.left, sub(end.right, end.left)) ?? square;
    };

    const offsets = [thickness / 2];
    for (const layer of type.layers) offsets.push(offsets.at(-1)! - layer.thickness);
    const starts = offsets.map((o) => endpoint(A, o));
    const finishes = offsets.map((o) => endpoint(B, o));

    const footprint = [A.right, B.right];
    if (B.includeNode) footprint.push(B.node);
    footprint.push(B.left, A.left);
    if (A.includeNode) footprint.push(A.node);

    const caps: Segment[] = [];
    if (A.kind === 'free') caps.push([A.left, A.right]);
    if (B.kind === 'free') caps.push([B.left, B.right]);

    result.set(wall.id, {
      wallId: wall.id,
      a: A.node,
      b: B.node,
      thickness,
      footprint,
      leftFace: [A.left, B.left],
      rightFace: [A.right, B.right],
      caps,
      layers: type.layers.map((layer, i) => ({
        fn: layer.fn,
        materialId: layer.materialId,
        polygon: [starts[i]!, finishes[i]!, finishes[i + 1]!, starts[i + 1]!],
      })),
      layerLines: offsets.slice(1, -1).map((_, i) => [starts[i + 1]!, finishes[i + 1]!] as Segment),
      endKinds: [A.kind, B.kind],
    });
  }
  return result;
}
