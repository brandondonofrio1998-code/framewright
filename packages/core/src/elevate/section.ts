import type { DisplayItem, FillId } from '../display/display-list';
import { elevationAxes, buildElevation, type ElevationFacing } from './elevation';
import type { MeshPart, MeshRole } from '../mesh/meshes';
import type { MaterialDef, Vec2 } from '../model/schema';

const EPS = 1e-4;
const QUANT = 1e-3;
const MIN_EDGE = 0.05;
const MIN_AREA = 0.25;

interface Pt {
  x: number;
  y: number;
  z: number;
}

/** Which poché hatch a cut solid uses. Glass is left as an outline. */
export function pocheFill(role: MeshRole, category: MaterialDef['category'] | null): FillId | null {
  if (role === 'glass') return null;
  if (role === 'floor') return 'wall.structure';
  switch (category) {
    case 'framing':
      return 'wall.structure';
    case 'sheathing':
      return 'wall.sheathing';
    case 'insulation':
      return 'wall.insulation';
    case 'drywall':
    case 'siding':
    case 'generic':
      return 'wall.finish';
    default:
      return role === 'panel' ? 'wall.structure' : 'wall.finish';
  }
}

function depthOf(x: number, y: number, z: number, vx: number, vy: number, vz: number): number {
  return x * vx + y * vy + z * vz;
}

function rangeOf(parts: readonly MeshPart[], vx: number, vy: number, vz: number): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const part of parts) {
    const p = part.positions;
    for (let i = 0; i < p.length; i += 3) {
      const d = depthOf(p[i]!, p[i + 1]!, p[i + 2]!, vx, vy, vz);
      if (d < min) min = d;
      if (d > max) max = d;
    }
  }
  return Number.isFinite(min) ? { min, max } : null;
}

function qk(p: Pt): string {
  return `${Math.round(p.x / QUANT)},${Math.round(p.y / QUANT)},${Math.round(p.z / QUANT)}`;
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/** Intersection of one triangle with the plane. A face lying in the plane contributes its three edges. */
function triangleCut(a: Pt, b: Pt, c: Pt, da: number, db: number, dc: number): [Pt, Pt][] {
  const pts = [a, b, c];
  const ds = [da, db, dc];
  const on = ds.map((d) => Math.abs(d) <= EPS);
  if (on.every(Boolean)) return [[a, b], [b, c], [c, a]];
  const hits: Pt[] = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const di = ds[i]!;
    const dj = ds[j]!;
    if (on[i] && on[j]) hits.push(pts[i]!, pts[j]!);
    else if (on[i]) hits.push(pts[i]!);
    else if (!on[j] && di * dj < 0) hits.push(lerp(pts[i]!, pts[j]!, di / (di - dj)));
  }
  const uniq: Pt[] = [];
  for (const hit of hits) {
    if (!uniq.some((q) => Math.hypot(hit.x - q.x, hit.y - q.y, hit.z - q.z) < QUANT)) uniq.push(hit);
  }
  return uniq.length === 2 ? [[uniq[0]!, uniq[1]!]] : [];
}

function cutSegments(part: MeshPart, vx: number, vy: number, vz: number, plane: number): [Pt, Pt][] {
  const pos = part.positions;
  const idx = part.indices;
  const segs: [Pt, Pt][] = [];
  for (let i = 0; i < idx.length; i += 3) {
    const at = (n: number): Pt => {
      const v = idx[i + n]! * 3;
      return { x: pos[v]!, y: pos[v + 1]!, z: pos[v + 2]! };
    };
    const a = at(0);
    const b = at(1);
    const c = at(2);
    segs.push(
      ...triangleCut(a, b, c, depthOf(a.x, a.y, a.z, vx, vy, vz) - plane, depthOf(b.x, b.y, b.z, vx, vy, vz) - plane, depthOf(c.x, c.y, c.z, vx, vy, vz) - plane),
    );
  }
  return segs;
}

/** Drop edges that two same-material cuts share, which is the union of polygons that only touch along an edge. */
function boundary(segs: readonly (readonly [Pt, Pt])[]): [Pt, Pt][] {
  const map = new Map<string, { a: Pt; b: Pt; n: number }>();
  for (const [a, b] of segs) {
    if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) < MIN_EDGE) continue;
    const ka = qk(a);
    const kb = qk(b);
    if (ka === kb) continue;
    const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    const found = map.get(key);
    if (found) found.n += 1;
    else map.set(key, { a, b, n: 1 });
  }
  return [...map.values()].filter((edge) => edge.n % 2 === 1).map((edge) => [edge.a, edge.b]);
}

function sheet(p: Pt, right: readonly [number, number, number]): Vec2 {
  return { x: p.x * right[0] + p.y * right[1] + p.z * right[2], y: p.z };
}

function signedArea(ring: readonly Vec2[]): number {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    area += p.x * q.y - q.x * p.y;
  }
  return area / 2;
}

function loopsOf(segs: readonly [Pt, Pt][], right: readonly [number, number, number]): Vec2[][] {
  const pointAt = new Map<string, Pt>();
  const adj = new Map<string, string[]>();
  const remember = (p: Pt) => {
    const key = qk(p);
    if (!pointAt.has(key)) pointAt.set(key, p);
    return key;
  };
  const join = (a: string, b: string) => {
    const list = adj.get(a);
    if (list) {
      if (!list.includes(b)) list.push(b);
    } else adj.set(a, [b]);
  };
  for (const [a, b] of segs) {
    const ka = remember(a);
    const kb = remember(b);
    if (ka === kb) continue;
    join(ka, kb);
    join(kb, ka);
  }
  const used = new Set<string>();
  const mark = (a: string, b: string) => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    used.add(key);
    return key;
  };
  const seen = (a: string, b: string) => used.has(a < b ? `${a}|${b}` : `${b}|${a}`);
  const rings: Vec2[][] = [];
  for (const [start, nbs] of adj) {
    for (const first of nbs) {
      if (seen(start, first)) continue;
      mark(start, first);
      const ring: Vec2[] = [sheet(pointAt.get(start)!, right)];
      let prev = start;
      let cur = first;
      while (cur !== start && ring.length < 10000) {
        ring.push(sheet(pointAt.get(cur)!, right));
        const nexts = (adj.get(cur) ?? []).filter((cand) => cand !== prev);
        const nxt = nexts.find((cand) => !seen(cur, cand)) ?? nexts[0];
        if (!nxt) break;
        mark(cur, nxt);
        prev = cur;
        cur = nxt;
      }
      if (cur !== start || ring.length < 3) continue;
      const area = signedArea(ring);
      if (Math.abs(area) < MIN_AREA) continue;
      rings.push(area < 0 ? ring.reverse() : ring);
    }
  }
  return rings;
}

interface ClipVert extends Pt {
  d: number;
}

/** Keep the portion with depth >= plane. A crossing triangle becomes one or two triangles. */
function clipPart(part: MeshPart, vx: number, vy: number, vz: number, plane: number): MeshPart | null {
  const pos = part.positions;
  const idx = part.indices;
  const out: number[] = [];
  const indices: number[] = [];
  const add = (p: Pt) => {
    const i = out.length / 3;
    out.push(p.x, p.y, p.z);
    return i;
  };
  const clip = (poly: ClipVert[]): Pt[] => {
    const kept: Pt[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const aIn = a.d >= -EPS;
      const bIn = b.d >= -EPS;
      if (aIn && bIn) kept.push(b);
      else if (aIn && !bIn) kept.push(lerp(a, b, a.d / (a.d - b.d)));
      else if (!aIn && bIn) {
        kept.push(lerp(a, b, a.d / (a.d - b.d)));
        kept.push(b);
      }
    }
    return kept;
  };
  for (let i = 0; i < idx.length; i += 3) {
    const poly: ClipVert[] = [0, 1, 2].map((n) => {
      const v = idx[i + n]! * 3;
      const p = { x: pos[v]!, y: pos[v + 1]!, z: pos[v + 2]! };
      return { ...p, d: depthOf(p.x, p.y, p.z, vx, vy, vz) - plane };
    });
    const kept = poly.every((p) => p.d >= -EPS) ? poly : clip(poly);
    if (kept.length < 3) continue;
    const ids = kept.map((p) => add(p));
    for (let k = 1; k < ids.length - 1; k++) indices.push(ids[0]!, ids[k]!, ids[k + 1]!);
  }
  if (indices.length === 0) return null;
  return {
    elementId: part.elementId,
    materialId: part.materialId,
    role: part.role,
    positions: Float32Array.from(out),
    normals: new Float32Array(out.length),
    uvs: new Float32Array((out.length / 3) * 2),
    indices: Uint32Array.from(indices),
  };
}

/**
 * A vertical section. `fraction` 0 is the near side of the model and 1 is the far side.
 * The cut is filled by material. Edges shared by two cuts of the same material are dropped.
 * Past the plane, the drawing is the elevation of whatever is left.
 * Solids here do not overlap, so cancelling a shared edge is the union. clipper2 waits for a cut that can overlap.
 */
export function buildSection(parts: readonly MeshPart[], facing: ElevationFacing, fraction: number, fillOf: (part: MeshPart) => FillId | null): DisplayItem[] {
  const { viewDir, right } = elevationAxes(facing);
  const [vx, vy, vz] = viewDir;
  const range = rangeOf(parts, vx!, vy!, vz!);
  if (!range) return [];
  const t = Math.min(1, Math.max(0, fraction));
  const plane = range.min + (range.max - range.min) * t;
  const grouped = new Map<FillId, [Pt, Pt][]>();
  for (const part of parts) {
    const fill = fillOf(part);
    if (!fill) continue;
    const segs = cutSegments(part, vx!, vy!, vz!, plane);
    if (segs.length === 0) continue;
    const list = grouped.get(fill);
    if (list) list.push(...segs);
    else grouped.set(fill, segs);
  }
  const prims: DisplayItem['prims'] = [];
  for (const [fill, segs] of grouped) {
    const rings = loopsOf(boundary(segs), right);
    if (rings.length > 0) prims.push({ t: 'poly', rings, fill });
  }
  const kept: MeshPart[] = [];
  for (const part of parts) {
    const clipped = clipPart(part, vx!, vy!, vz!, plane);
    if (clipped) kept.push(clipped);
  }
  const items: DisplayItem[] = [];
  if (prims.length > 0) items.push({ layer: 'walls', prims });
  items.push(...buildElevation(kept, facing));
  return items;
}
