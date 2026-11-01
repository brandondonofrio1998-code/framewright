import type { DisplayItem } from '../display/display-list';
import type { MeshPart } from '../mesh/meshes';
import type { Vec2 } from '../model/schema';

/** Which side of the plan the camera stands on. Plan Y is up the sheet. */
export const ELEVATION_FACINGS = ['front', 'back', 'left', 'right'] as const;
export type ElevationFacing = (typeof ELEVATION_FACINGS)[number];

export interface ElevationAxes {
  /** Unit vector from the camera into the model. */
  viewDir: readonly [number, number, number];
  /** Unit vector to the right on the sheet. Up on the sheet is +Z. */
  right: readonly [number, number, number];
}

/**
 * Front looks from the bottom of the plan toward +Y, so plan +X stays to the right.
 * Back, left, and right are the other three sides.
 */
export function elevationAxes(facing: ElevationFacing): ElevationAxes {
  switch (facing) {
    case 'front':
      return { viewDir: [0, 1, 0], right: [1, 0, 0] };
    case 'back':
      return { viewDir: [0, -1, 0], right: [-1, 0, 0] };
    case 'left':
      return { viewDir: [1, 0, 0], right: [0, -1, 0] };
    case 'right':
      return { viewDir: [-1, 0, 0], right: [0, 1, 0] };
  }
}

const QUANT = 1e-3;
const CREASE = Math.cos((15 * Math.PI) / 180);
const OFFSET = 0.05;
const BISECT = 5;
const MIN_EDGE = 0.05;

interface Tri {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  cx: number;
  cy: number;
  cz: number;
  nx: number;
  ny: number;
  nz: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

interface Edge {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  tris: number[];
}

interface Pt {
  x: number;
  y: number;
  z: number;
}

function q(n: number): number {
  return Math.round(n / QUANT) * QUANT;
}

function keyOf(ax: number, ay: number, az: number, bx: number, by: number, bz: number): string {
  const a = `${q(ax)},${q(ay)},${q(az)}`;
  const b = `${q(bx)},${q(by)},${q(bz)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function collect(parts: readonly MeshPart[]): Tri[] {
  const tris: Tri[] = [];
  for (const part of parts) {
    const pos = part.positions;
    const idx = part.indices;
    for (let i = 0; i < idx.length; i += 3) {
      const ia = idx[i]! * 3;
      const ib = idx[i + 1]! * 3;
      const ic = idx[i + 2]! * 3;
      const ax = pos[ia]!;
      const ay = pos[ia + 1]!;
      const az = pos[ia + 2]!;
      const bx = pos[ib]!;
      const by = pos[ib + 1]!;
      const bz = pos[ib + 2]!;
      const cx = pos[ic]!;
      const cy = pos[ic + 1]!;
      const cz = pos[ic + 2]!;
      const e1x = bx - ax;
      const e1y = by - ay;
      const e1z = bz - az;
      const e2x = cx - ax;
      const e2y = cy - ay;
      const e2z = cz - az;
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-8) continue;
      tris.push({
        ax, ay, az, bx, by, bz, cx, cy, cz,
        nx: nx / len, ny: ny / len, nz: nz / len,
        minX: Math.min(ax, bx, cx), minY: Math.min(ay, by, cy), minZ: Math.min(az, bz, cz),
        maxX: Math.max(ax, bx, cx), maxY: Math.max(ay, by, cy), maxZ: Math.max(az, bz, cz),
      });
    }
  }
  return tris;
}

function edgesOf(tris: readonly Tri[]): Edge[] {
  const map = new Map<string, Edge>();
  const add = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, tri: number) => {
    const key = keyOf(ax, ay, az, bx, by, bz);
    const found = map.get(key);
    if (found) found.tris.push(tri);
    else map.set(key, { ax, ay, az, bx, by, bz, tris: [tri] });
  };
  tris.forEach((tri, i) => {
    add(tri.ax, tri.ay, tri.az, tri.bx, tri.by, tri.bz, i);
    add(tri.bx, tri.by, tri.bz, tri.cx, tri.cy, tri.cz, i);
    add(tri.cx, tri.cy, tri.cz, tri.ax, tri.ay, tri.az, i);
  });
  return [...map.values()];
}

function isFeature(tris: readonly Tri[], edge: Edge, vx: number, vy: number, vz: number): boolean {
  if (edge.tris.length === 1) return true;
  let front = false;
  let back = false;
  for (let i = 0; i < edge.tris.length; i++) {
    const n = tris[edge.tris[i]!]!;
    const facing = n.nx * vx + n.ny * vy + n.nz * vz;
    if (facing < -1e-4) front = true;
    else if (facing > 1e-4) back = true;
    for (let j = i + 1; j < edge.tris.length; j++) {
      const m = tris[edge.tris[j]!]!;
      if (n.nx * m.nx + n.ny * m.ny + n.nz * m.nz < CREASE) return true;
    }
  }
  return front && back;
}

/** t along the ray, or null. Ignores hits behind the origin and grazes. */
function rayHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tri: Tri): number | null {
  const e1x = tri.bx - tri.ax;
  const e1y = tri.by - tri.ay;
  const e1z = tri.bz - tri.az;
  const e2x = tri.cx - tri.ax;
  const e2y = tri.cy - tri.ay;
  const e2z = tri.cz - tri.az;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-8) return null;
  const inv = 1 / det;
  const tx = ox - tri.ax;
  const ty = oy - tri.ay;
  const tz = oz - tri.az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return null;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 1e-4 ? t : null;
}

function inFront(tri: Tri, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): boolean {
  if (Math.abs(dx) < 0.5 && (ox < tri.minX - 1e-3 || ox > tri.maxX + 1e-3)) return false;
  if (Math.abs(dy) < 0.5 && (oy < tri.minY - 1e-3 || oy > tri.maxY + 1e-3)) return false;
  if (Math.abs(dz) < 0.5 && (oz < tri.minZ - 1e-3 || oz > tri.maxZ + 1e-3)) return false;
  if (dx > 0.5 && tri.maxX < ox - 1e-3) return false;
  if (dx < -0.5 && tri.minX > ox + 1e-3) return false;
  if (dy > 0.5 && tri.maxY < oy - 1e-3) return false;
  if (dy < -0.5 && tri.minY > oy + 1e-3) return false;
  if (dz > 0.5 && tri.maxZ < oz - 1e-3) return false;
  if (dz < -0.5 && tri.minZ > oz + 1e-3) return false;
  return true;
}

function occluded(tris: readonly Tri[], skip: readonly number[], p: Pt, vx: number, vy: number, vz: number): boolean {
  const ox = p.x - vx * OFFSET;
  const oy = p.y - vy * OFFSET;
  const oz = p.z - vz * OFFSET;
  const dx = -vx;
  const dy = -vy;
  const dz = -vz;
  const own = new Set(skip);
  for (let i = 0; i < tris.length; i++) {
    if (own.has(i)) continue;
    const tri = tris[i]!;
    if (!inFront(tri, ox, oy, oz, dx, dy, dz)) continue;
    if (rayHit(ox, oy, oz, dx, dy, dz, tri) !== null) return true;
  }
  return false;
}

function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

function visibleSpans(a: Pt, b: Pt, see: (p: Pt) => boolean, depth: number): [Pt, Pt][] {
  const va = see(a);
  const vb = see(b);
  const m = mid(a, b);
  if (va && vb) {
    if (depth >= BISECT || see(m)) return [[a, b]];
    return [...visibleSpans(a, m, see, depth + 1), ...visibleSpans(m, b, see, depth + 1)];
  }
  if (!va && !vb) {
    if (depth >= BISECT || !see(m)) return [];
    return [...visibleSpans(a, m, see, depth + 1), ...visibleSpans(m, b, see, depth + 1)];
  }
  if (depth >= BISECT) return va ? [[a, m]] : [[m, b]];
  return [...visibleSpans(a, m, see, depth + 1), ...visibleSpans(m, b, see, depth + 1)];
}

function sheet(p: Pt, right: readonly [number, number, number]): Vec2 {
  return { x: p.x * right[0]! + p.y * right[1]! + p.z * right[2]!, y: p.z };
}

/**
 * Visible crease, boundary, and silhouette edges of the solids, projected onto the elevation.
 * Sheet X runs to the right, sheet Y is Z. Hidden portions are omitted.
 * Raycasts run on the main thread; a spatial index waits until elevations of whole houses are slow.
 */
export function buildElevation(parts: readonly MeshPart[], facing: ElevationFacing): DisplayItem[] {
  const { viewDir, right } = elevationAxes(facing);
  const [vx, vy, vz] = viewDir;
  const tris = collect(parts);
  if (tris.length === 0) return [];
  const lines: { a: Vec2; b: Vec2 }[] = [];
  for (const edge of edgesOf(tris)) {
    if (Math.hypot(edge.bx - edge.ax, edge.by - edge.ay, edge.bz - edge.az) < MIN_EDGE) continue;
    if (!isFeature(tris, edge, vx!, vy!, vz!)) continue;
    const see = (p: Pt) => !occluded(tris, edge.tris, p, vx!, vy!, vz!);
    const spans = visibleSpans({ x: edge.ax, y: edge.ay, z: edge.az }, { x: edge.bx, y: edge.by, z: edge.bz }, see, 0);
    for (const [a, b] of spans) {
      const pa = sheet(a, right);
      const pb = sheet(b, right);
      if (Math.hypot(pb.x - pa.x, pb.y - pa.y) < MIN_EDGE) continue;
      lines.push({ a: pa, b: pb });
    }
  }
  if (lines.length === 0) return [];
  return [{ layer: 'walls', prims: lines.map((line) => ({ t: 'line' as const, a: line.a, b: line.b, pen: 'wall.face' as const })) }];
}
