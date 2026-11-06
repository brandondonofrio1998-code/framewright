import { objectFootprint, objectSize } from '../catalog/symbols';
import { frameLevel, memberQuad } from '../framing/members';
import { floorJoists } from '../foundations/joists';
import { FLOOR_FINISH, foundationsOnLevel } from '../foundations/slab';
import { DECK_BOARD, DECK_JOIST_DEPTH, RAIL_HEIGHT, RAIL_WIDTH, balusterFoot, deckBalusters, deckJoists, deckOpenEdges, deckPolygon, deckPosts, decksOnLevel, postFoot, railStrip } from '../decks/deck';
import { RECEPTACLE_CENTER, SWITCH_CENTER, electricalOnLevel, electricalPose } from '../electrical/devices';
import { DRAIN_CENTER, SUPPLY_CENTER, plumbingOnLevel, plumbingPose } from '../plumbing/fixtures';
import { siteOnLevel } from '../site/marks';
import { plantRing, plantsOnLevel } from '../plants/tree';
import { ROAD_THICKNESS, roadPolygon, roadsOnLevel } from '../roads/drive';
import { pipeCenter, pipePolygon, pipeSize, pipesOnLevel } from '../pipes/pipe';
import { RISER_THICKNESS, TREAD_THICKNESS, HANDRAIL_SIZE, handrail, landingPolygon, placedFlights, runRect, stairOpenings, stairsOnLevel } from '../stairs/straight';
import { roofTriangles, roofsOnLevel } from '../roofs/gable';
import { clipToSlab, subtractConvex, triangulate } from '../geometry/polygon';
import { add, dot, normalize, perp, polygonArea, scale, sub } from '../geometry/vec2';
import type { Id, Opening, PlanDocument, Stair, Vec2, Vec3 } from '../model/schema';
import { defaultWallHeight } from '../model/levels';
import { openingFrame } from '../display/openings';
import { openingSpan, openingsOnWall } from '../openings/openings';
import { roomFace, roomsOnLevel } from '../rooms/rooms';
import { wallsOnLevel } from '../walls/graph';
import { computeWallGeometry, type WallGeometry } from '../walls/joins';

/** Finished floor thickness drawn under each room. Joists are separate, and only when the slab drops. */
const FLOOR_THICKNESS = 0.75;
const DOOR_THICKNESS = 1.375;
const GLASS_THICKNESS = 0.25;
const MIN_BAND = 0.05;

export type MeshRole = 'solid' | 'floor' | 'ceiling' | 'panel' | 'glass';

/** One drawable solid. Coordinates are inches, Z up. UVs are inches in the face plane. */
export interface MeshPart {
  elementId: Id;
  materialId: Id | null;
  role: MeshRole;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

interface Builder {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

function builder(): Builder {
  return { positions: [], normals: [], uvs: [], indices: [] };
}

function vertex(b: Builder, x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number {
  const i = b.positions.length / 3;
  b.positions.push(x, y, z);
  b.normals.push(nx, ny, nz);
  b.uvs.push(u, v);
  return i;
}

function ccwRing(poly: readonly Vec2[]): Vec2[] {
  return polygonArea(poly) >= 0 ? poly.slice() : [...poly].reverse();
}

/** Extrude a plan polygon from z0 up to z1. Cut edges (across a wall opening) can be omitted when a neighbor already covers them. */
function extrude(b: Builder, poly: readonly Vec2[], z0: number, z1: number, skipCut?: (a: Vec2, c: Vec2) => boolean): void {
  if (z1 - z0 < MIN_BAND) return;
  const ring = ccwRing(poly);
  if (ring.length < 3) return;
  const tris = triangulate(ring);
  if (tris.length === 0) return;
  const top = ring.map((p) => vertex(b, p.x, p.y, z1, 0, 0, 1, p.x, p.y));
  const bot = ring.map((p) => vertex(b, p.x, p.y, z0, 0, 0, -1, p.x, p.y));
  for (let i = 0; i < tris.length; i += 3) {
    b.indices.push(top[tris[i]!]!, top[tris[i + 1]!]!, top[tris[i + 2]!]!);
    b.indices.push(bot[tris[i + 2]!]!, bot[tris[i + 1]!]!, bot[tris[i]!]!);
  }
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const c = ring[(i + 1) % ring.length]!;
    if (skipCut?.(a, c)) continue;
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const nx = dy / len;
    const ny = -dx / len;
    const ia = vertex(b, a.x, a.y, z0, nx, ny, 0, 0, z0);
    const ib = vertex(b, c.x, c.y, z0, nx, ny, 0, len, z0);
    const ic = vertex(b, c.x, c.y, z1, nx, ny, 0, len, z1);
    const id = vertex(b, a.x, a.y, z1, nx, ny, 0, 0, z1);
    b.indices.push(ia, ib, ic, ia, ic, id);
  }
}

function finish(b: Builder, elementId: Id, materialId: Id | null, role: MeshRole): MeshPart | null {
  if (b.indices.length === 0) return null;
  return {
    elementId,
    materialId,
    role,
    positions: Float32Array.from(b.positions),
    normals: Float32Array.from(b.normals),
    uvs: Float32Array.from(b.uvs),
    indices: Uint32Array.from(b.indices),
  };
}

function push(parts: MeshPart[], part: MeshPart | null): void {
  if (part) parts.push(part);
}

interface Band {
  z0: number;
  z1: number;
  /** A sill or header: its cut ends sit against the neighboring full-height piece, which already draws the jamb. */
  partial: boolean;
}

function bandsFor(opening: Opening | undefined, z0: number, z1: number): Band[] {
  if (!opening) return [{ z0, z1, partial: false }];
  const sill = opening.kind === 'window' ? z0 + opening.sill : z0;
  const head = (opening.kind === 'window' ? z0 + opening.sill : z0) + opening.height;
  const sillZ = Math.min(Math.max(sill, z0), z1);
  const headZ = Math.min(Math.max(head, z0), z1);
  const bands: Band[] = [];
  if (sillZ - z0 > MIN_BAND) bands.push({ z0, z1: sillZ, partial: true });
  if (z1 - headZ > MIN_BAND) bands.push({ z0: headZ, z1, partial: true });
  return bands;
}

function sameStation(p: Vec2, q: Vec2, project: (v: Vec2) => number, stations: readonly number[]): boolean {
  const sp = project(p);
  const sq = project(q);
  if (Math.abs(sp - sq) > 1e-3) return false;
  return stations.some((s) => Math.abs(sp - s) < 1e-3);
}

/** The two points where a layer's plan polygon crosses the plane `project(p) = s`. */
function crossSection(poly: readonly Vec2[], project: (v: Vec2) => number, s: number): [Vec2, Vec2] | null {
  const hits: Vec2[] = [];
  const push = (p: Vec2) => {
    if (!hits.some((h) => Math.hypot(h.x - p.x, h.y - p.y) < 1e-3)) hits.push(p);
  };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const c = poly[(i + 1) % poly.length]!;
    const pa = project(a);
    const pc = project(c);
    if (Math.abs(pa - s) <= 1e-4 && Math.abs(pc - s) <= 1e-4) {
      push(a);
      push(c);
    } else if ((pa - s) * (pc - s) <= 1e-8 && Math.abs(pc - pa) > 1e-12) {
      const t = Math.min(1, Math.max(0, (s - pa) / (pc - pa)));
      push(add(a, scale(sub(c, a), t)));
    }
  }
  if (hits.length < 2) return null;
  return [hits[0]!, hits[hits.length - 1]!];
}

function addQuad(b: Builder, a: Vec2, c: Vec2, z0: number, z1: number, nx: number, ny: number): void {
  const len = Math.hypot(c.x - a.x, c.y - a.y);
  if (len < 1e-6 || z1 - z0 < MIN_BAND) return;
  const ia = vertex(b, a.x, a.y, z0, nx, ny, 0, 0, z0);
  const ib = vertex(b, c.x, c.y, z0, nx, ny, 0, len, z0);
  const ic = vertex(b, c.x, c.y, z1, nx, ny, 0, len, z1);
  const id = vertex(b, a.x, a.y, z1, nx, ny, 0, 0, z1);
  b.indices.push(ia, ib, ic, ia, ic, id);
}

function wallSolids(doc: PlanDocument, geom: WallGeometry, z0: number, z1: number, parts: MeshPart[]): void {
  const openings = openingsOnWall(doc, geom.wallId);
  const u = normalize(sub(geom.b, geom.a));
  const across = perp(u);
  const project = (p: Vec2) => dot(sub(p, geom.a), u);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of geom.footprint) {
    const s = project(p);
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  const cuts: number[] = [];
  for (const opening of openings) {
    const [s0, s1] = openingSpan(opening);
    cuts.push(Math.max(lo, Math.min(hi, s0)), Math.max(lo, Math.min(hi, s1)));
  }
  const stations = [lo, hi, ...cuts];
  stations.sort((a, b) => a - b);
  const unique: number[] = [];
  for (const s of stations) {
    if (unique.length === 0 || s - unique[unique.length - 1]! > 1e-4) unique.push(s);
  }
  const skipCut = (p: Vec2, q: Vec2) => sameStation(p, q, project, cuts);

  for (const layer of geom.layers) {
    if (layer.fn === 'structure') continue;
    const b = builder();
    for (let i = 0; i < unique.length - 1; i++) {
      const s0 = unique[i]!;
      const s1 = unique[i + 1]!;
      const mid = (s0 + s1) / 2;
      const opening = openings.find((o) => {
        const [a, c] = openingSpan(o);
        return mid > a + 1e-4 && mid < c - 1e-4;
      });
      const slice = clipToSlab(layer.polygon, geom.a, u, s0, s1);
      if (slice.length < 3) continue;
      for (const band of bandsFor(opening, z0, z1)) extrude(b, slice, band.z0, band.z1, skipCut);
    }
    for (const opening of openings) {
      const [s0, s1] = openingSpan(opening);
      const sill = opening.kind === 'window' ? z0 + opening.sill : z0;
      const head = sill + opening.height;
      const hole0 = Math.min(Math.max(sill, z0), z1);
      const hole1 = Math.min(Math.max(head, z0), z1);
      const start = crossSection(layer.polygon, project, s0);
      const end = crossSection(layer.polygon, project, s1);
      const along = (pts: [Vec2, Vec2]) => [...pts].sort((p, q) => dot(p, across) - dot(q, across)) as [Vec2, Vec2];
      if (start) {
        const [low, high] = along(start);
        addQuad(b, low, high, hole0, hole1, u.x, u.y);
      }
      if (end) {
        const [low, high] = along(end);
        addQuad(b, high, low, hole0, hole1, -u.x, -u.y);
      }
    }
    push(parts, finish(b, geom.wallId, layer.materialId, 'solid'));
  }
}

function openingSolids(doc: PlanDocument, geom: WallGeometry, zBase: number, parts: MeshPart[]): void {
  for (const opening of openingsOnWall(doc, geom.wallId)) {
    const frame = openingFrame(geom, opening);
    if (opening.kind === 'door' && opening.style !== 'opening') {
      const b = builder();
      const leaves = opening.style === 'double' ? 2 : 1;
      const gap = 0.25;
      const sA = frame.s0 + gap;
      const sB = frame.s1 - gap;
      const span = (sB - sA) / leaves;
      for (let i = 0; i < leaves; i++) {
        const a = sA + span * i + (i > 0 ? 0.06 : 0);
        const c = sA + span * (i + 1) - (i < leaves - 1 ? 0.06 : 0);
        extrude(
          b,
          [frame.at(a, -DOOR_THICKNESS / 2), frame.at(c, -DOOR_THICKNESS / 2), frame.at(c, DOOR_THICKNESS / 2), frame.at(a, DOOR_THICKNESS / 2)],
          zBase + gap,
          zBase + opening.height - gap,
        );
      }
      push(parts, finish(b, opening.id, null, 'panel'));
    }
    if (opening.kind === 'window') {
      const b = builder();
      const inset = 1;
      const half = GLASS_THICKNESS / 2;
      const sill = zBase + opening.sill + inset;
      const head = zBase + opening.sill + opening.height - inset;
      if (head - sill > MIN_BAND && frame.s1 - frame.s0 > inset * 2) {
        extrude(
          b,
          [
            frame.at(frame.s0 + inset, -half),
            frame.at(frame.s1 - inset, -half),
            frame.at(frame.s1 - inset, half),
            frame.at(frame.s0 + inset, half),
          ],
          sill,
          head,
        );
      }
      push(parts, finish(b, opening.id, null, 'glass'));
    }
  }
}

function objectSolids(doc: PlanDocument, levelId: Id, elevation: number, parts: MeshPart[]): void {
  for (const el of Object.values(doc.elements)) {
    if (el.kind !== 'object' || el.levelId !== levelId) continue;
    const size = objectSize(doc, el);
    const b = builder();
    extrude(b, objectFootprint(doc, el), elevation + el.z, elevation + el.z + size.height);
    push(parts, finish(b, el.id, null, 'panel'));
  }
}

function stairSolids(doc: PlanDocument, levelId: Id, elevation: number, parts: MeshPart[]): void {
  const lumber = Object.values(doc.materials).find((material) => material.category === 'framing')?.id ?? null;
  for (const stair of stairsOnLevel(doc, levelId)) {
    for (const flight of placedFlights(stair)) {
      const base = elevation + flight.rise0;
      const treads = flight.risers - 1;
      for (let k = 1; k <= treads; k++) {
        const b = builder();
        extrude(b, runRect(flight.start, flight.dir, flight.width, (k - 1) * flight.tread, k * flight.tread), base + k * flight.riser - TREAD_THICKNESS, base + k * flight.riser);
        push(parts, finish(b, stair.id, lumber, 'solid'));
      }
      for (let k = 1; k <= flight.risers; k++) {
        const s = (k - 1) * flight.tread;
        const b = builder();
        extrude(b, runRect(flight.start, flight.dir, flight.width, s, s + RISER_THICKNESS), base + (k - 1) * flight.riser, base + k * flight.riser);
        push(parts, finish(b, stair.id, lumber, 'solid'));
      }
      const rail = handrail(flight, base);
      if (rail) {
        const b = builder();
        addRail(b, rail.a, rail.b, perp(flight.dir), HANDRAIL_SIZE);
        push(parts, finish(b, stair.id, lumber, 'solid'));
      }
    }
    const landing = landingPolygon(stair);
    if (landing) {
      const top = elevation + stair.risers * stair.riser;
      const b = builder();
      extrude(b, landing, top - TREAD_THICKNESS, top);
      push(parts, finish(b, stair.id, lumber, 'solid'));
    }
  }
}

function addRail(b: Builder, a: Vec3, c: Vec3, side: Vec2, size: number): void {
  const dx = c.x - a.x;
  const dy = c.y - a.y;
  const dz = c.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return;
  const d = { x: dx / len, y: dy / len, z: dz / len };
  const ux = -d.z * side.y;
  const uy = d.z * side.x;
  const uz = d.x * side.y - d.y * side.x;
  const ulen = Math.hypot(ux, uy, uz);
  if (ulen < 1e-8) return;
  const u = { x: ux / ulen, y: uy / ulen, z: uz / ulen };
  const s = size / 2;
  const at = (p: Vec3, hs: number, us: number): Vec3 => ({
    x: p.x + side.x * hs + u.x * us,
    y: p.y + side.y * hs + u.y * us,
    z: p.z + u.z * us,
  });
  const ends = [a, c].map((p) => [at(p, s, s), at(p, -s, s), at(p, -s, -s), at(p, s, -s)]);
  const [start, finishEnd] = ends as [Vec3[], Vec3[]];
  const face = (p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, n: Vec3) => {
    const i = b.positions.length / 3;
    for (const p of [p0, p1, p2, p3]) {
      b.positions.push(p.x, p.y, p.z);
      b.normals.push(n.x, n.y, n.z);
      b.uvs.push(0, 0);
    }
    b.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  face(start[0]!, start[1]!, finishEnd[1]!, finishEnd[0]!, { x: u.x, y: u.y, z: u.z });
  face(start[2]!, start[3]!, finishEnd[3]!, finishEnd[2]!, { x: -u.x, y: -u.y, z: -u.z });
  face(start[3]!, start[0]!, finishEnd[0]!, finishEnd[3]!, { x: side.x, y: side.y, z: 0 });
  face(start[1]!, start[2]!, finishEnd[2]!, finishEnd[1]!, { x: -side.x, y: -side.y, z: 0 });
  face(start[3]!, start[2]!, start[1]!, start[0]!, { x: -d.x, y: -d.y, z: -d.z });
  face(finishEnd[0]!, finishEnd[1]!, finishEnd[2]!, finishEnd[3]!, d);
}

function deckSolids(doc: PlanDocument, levelId: Id, elevation: number, parts: MeshPart[]): void {
  const lumber = Object.values(doc.materials).find((material) => material.category === 'framing')?.id ?? null;
  for (const deck of decksOnLevel(doc, levelId)) {
    const top = elevation;
    const board = builder();
    extrude(board, deckPolygon(deck), top - DECK_BOARD, top);
    push(parts, finish(board, deck.id, lumber, 'solid'));
    for (const joist of deckJoists(deck)) {
      const piece = builder();
      extrude(piece, joist, top - DECK_BOARD - DECK_JOIST_DEPTH, top - DECK_BOARD);
      push(parts, finish(piece, deck.id, lumber, 'solid'));
    }
    for (const [a, b] of deckOpenEdges(deck)) {
      const rail = builder();
      extrude(rail, railStrip(a, b), top + RAIL_HEIGHT - RAIL_WIDTH, top + RAIL_HEIGHT);
      push(parts, finish(rail, deck.id, lumber, 'solid'));
    }
    for (const post of deckPosts(deck)) {
      const piece = builder();
      extrude(piece, postFoot(post), top, top + RAIL_HEIGHT);
      push(parts, finish(piece, deck.id, lumber, 'solid'));
    }
    const spindles = builder();
    for (const spindle of deckBalusters(deck)) {
      extrude(spindles, balusterFoot(spindle), top, top + RAIL_HEIGHT - RAIL_WIDTH);
    }
    push(parts, finish(spindles, deck.id, lumber, 'solid'));
  }
}

function electricalSolids(doc: PlanDocument, levelId: Id, elevation: number, ceilingHeight: number, parts: MeshPart[]): void {
  for (const device of electricalOnLevel(doc, levelId)) {
    const pose = electricalPose(doc, device);
    const b = builder();
    if (device.device === 'light') {
      const half = 3;
      const p = pose.p;
      extrude(
        b,
        [
          { x: p.x - half, y: p.y - half },
          { x: p.x + half, y: p.y - half },
          { x: p.x + half, y: p.y + half },
          { x: p.x - half, y: p.y + half },
        ],
        elevation + ceilingHeight - 1,
        elevation + ceilingHeight,
      );
    } else {
      const center = elevation + (device.device === 'switch' ? SWITCH_CENTER : RECEPTACLE_CENTER);
      extrude(b, deviceBox(pose.p, pose.dir, pose.out), center - 2.25, center + 2.25);
    }
    push(parts, finish(b, device.id, null, 'solid'));
  }
}

function deviceBox(p: Vec2, dir: Vec2, out: Vec2): Vec2[] {
  const along = { x: dir.x * 1.4, y: dir.y * 1.4 };
  const proud = { x: out.x * 0.6, y: out.y * 0.6 };
  const a = { x: p.x - along.x, y: p.y - along.y };
  const c = { x: p.x + along.x, y: p.y + along.y };
  return [a, c, { x: c.x + proud.x, y: c.y + proud.y }, { x: a.x + proud.x, y: a.y + proud.y }];
}

function plumbingSolids(doc: PlanDocument, levelId: Id, elevation: number, parts: MeshPart[]): void {
  for (const fixture of plumbingOnLevel(doc, levelId)) {
    const pose = plumbingPose(doc, fixture);
    if (!fixture.hostWallId) {
      const b = builder();
      const half = 4;
      const p = pose.p;
      extrude(
        b,
        [
          { x: p.x - half, y: p.y - half },
          { x: p.x + half, y: p.y - half },
          { x: p.x + half, y: p.y + half },
          { x: p.x - half, y: p.y + half },
        ],
        elevation,
        elevation + 0.5,
      );
      push(parts, finish(b, fixture.id, null, 'solid'));
      continue;
    }
    const center = elevation + (fixture.fixture === 'supply' ? SUPPLY_CENTER : DRAIN_CENTER);
    const offsets = fixture.fixture === 'supply' ? [-4, 4] : [0];
    for (const offset of offsets) {
      const b = builder();
      const p = { x: pose.p.x + pose.dir.x * offset, y: pose.p.y + pose.dir.y * offset };
      extrude(b, deviceBox(p, pose.dir, pose.out), center - 1.5, center + 1.5);
      push(parts, finish(b, fixture.id, null, 'solid'));
    }
  }
}

function lotPads(doc: PlanDocument, levelId: Id, elevation: number, parts: MeshPart[]): void {
  for (const mark of siteOnLevel(doc, levelId)) {
    if (mark.role !== 'lot' && mark.role !== 'contour') continue;
    if (!mark.points || mark.grade === undefined) continue;
    const top = elevation + mark.grade;
    const pad = builder();
    extrude(pad, mark.points, top - 2, top);
    push(parts, finish(pad, mark.id, null, 'solid'));
  }
}

function plantSolids(doc: PlanDocument, levelId: Id, elevation: number, parts: MeshPart[]): void {
  const lumber = Object.values(doc.materials).find((material) => material.category === 'framing')?.id ?? null;
  for (const plant of plantsOnLevel(doc, levelId)) {
    const trunk = builder();
    extrude(trunk, plantRing(plant.p, 4), elevation, elevation + plant.height * 0.45);
    push(parts, finish(trunk, plant.id, lumber, 'solid'));
    const canopy = builder();
    extrude(canopy, plantRing(plant.p, plant.radius), elevation + plant.height * 0.4, elevation + plant.height);
    push(parts, finish(canopy, plant.id, null, 'solid'));
  }
}

function pipeSolids(doc: PlanDocument, levelId: Id, elevation: number, parts: MeshPart[]): void {
  for (const pipe of pipesOnLevel(doc, levelId)) {
    const size = pipeSize(pipe);
    const center = elevation + pipeCenter(pipe);
    const piece = builder();
    extrude(piece, pipePolygon(pipe), center - size / 2, center + size / 2);
    push(parts, finish(piece, pipe.id, null, 'solid'));
  }
}

function roadSolids(doc: PlanDocument, levelId: Id, elevation: number, parts: MeshPart[]): void {
  for (const road of roadsOnLevel(doc, levelId)) {
    const pad = builder();
    extrude(pad, roadPolygon(road), elevation - ROAD_THICKNESS, elevation);
    push(parts, finish(pad, road.id, null, 'solid'));
  }
}

function foundationSolids(doc: PlanDocument, levelId: Id, elevation: number, parts: MeshPart[]): void {
  const floorBottom = elevation - FLOOR_FINISH;
  for (const foundation of foundationsOnLevel(doc, levelId)) {
    const gap = foundation.clearance ?? 0;
    const slabTop = floorBottom - gap;
    const bottom = slabTop - foundation.thickness;
    const slab = builder();
    extrude(slab, foundation.polygon, bottom, slabTop);
    push(parts, finish(slab, foundation.id, foundation.materialId, 'solid'));
    for (const stem of foundation.stems ?? []) {
      const wall = builder();
      extrude(wall, stem, bottom, floorBottom + (foundation.stemRise ?? 0));
      push(parts, finish(wall, foundation.id, foundation.materialId, 'solid'));
    }
    if (foundation.footingDepth >= MIN_BAND) {
      for (const footing of foundation.footings) {
        const b = builder();
        extrude(b, footing, bottom - foundation.footingDepth, bottom);
        push(parts, finish(b, foundation.id, foundation.materialId, 'solid'));
      }
    }
    const joists = floorJoists(foundation, floorBottom);
    if (joists.length > 0) {
      const lumber = Object.values(doc.materials).find((material) => material.category === 'framing')?.id ?? null;
      const b = builder();
      for (const joist of joists) extrude(b, joist.polygon, joist.z0, joist.z1);
      push(parts, finish(b, foundation.id, lumber, 'solid'));
    }
  }
}

function floorSolids(doc: PlanDocument, levelId: Id, elevation: number, parts: MeshPart[]): void {
  const holes = Object.values(doc.elements).filter((el): el is Stair => el.kind === 'stair' && el.toLevelId === levelId);
  for (const room of roomsOnLevel(doc, levelId)) {
    const face = roomFace(doc, room);
    if (!face) continue;
    for (const polygon of openingPieces(face.polygon, holes)) {
      const b = builder();
      extrude(b, polygon, elevation - FLOOR_THICKNESS, elevation);
      push(parts, finish(b, room.id, null, 'floor'));
    }
  }
}

/** A flat gypsum sheet on the inside of each room, up to that room's ceiling. */
function ceilingSolids(doc: PlanDocument, levelId: Id, elevation: number, ceilingHeight: number, finishThickness: number, parts: MeshPart[]): void {
  if (!(finishThickness > 0)) return;
  const drywall = Object.values(doc.materials).find((material) => material.category === 'drywall')?.id ?? null;
  const holes = Object.values(doc.elements).filter((el): el is Stair => el.kind === 'stair' && el.levelId === levelId);
  for (const room of roomsOnLevel(doc, levelId)) {
    const face = roomFace(doc, room);
    if (!face) continue;
    const top = elevation + (room.ceilingHeight ?? ceilingHeight);
    if (top - finishThickness < elevation) continue;
    for (const polygon of openingPieces(face.polygon, holes)) {
      const b = builder();
      extrude(b, polygon, top - finishThickness, top);
      push(parts, finish(b, room.id, drywall, 'ceiling'));
    }
  }
}

/** The polygon with each stair footprint removed. */
function openingPieces(polygon: Vec2[], stairs: readonly Stair[]): Vec2[][] {
  let pieces = [polygon];
  for (const stair of stairs) {
    for (const hole of stairOpenings(stair)) pieces = pieces.flatMap((piece) => subtractConvex(piece, hole));
  }
  return pieces;
}

/** Solids for one level: wall layers with opening holes, floors, doors, glass, and catalog boxes. */
export function buildLevelMeshes(doc: PlanDocument, levelId: Id): MeshPart[] {
  const level = doc.levels[levelId];
  if (!level) return [];
  const geometry = computeWallGeometry(doc, levelId);
  const height = defaultWallHeight(doc.levels, doc.levelOrder, levelId);
  const framing = new Map(frameLevel(doc, levelId, geometry).map((wall) => [wall.wallId, wall]));
  const parts: MeshPart[] = [];
  for (const wall of wallsOnLevel(doc, levelId)) {
    const geom = geometry.get(wall.id);
    if (!geom || geom.footprint.length < 3) continue;
    const z0 = level.elevation + wall.baseOffset;
    const z1 = z0 + (wall.height ?? height);
    if (z1 - z0 < MIN_BAND) continue;
    wallSolids(doc, geom, z0, z1, parts);
    const framed = framing.get(geom.wallId);
    if (framed) {
      const b = builder();
      for (const member of framed.members) {
        extrude(b, memberQuad(geom.a, geom.b, framed.off0, framed.off1, member.s0, member.s1), member.z0, member.z1);
      }
      push(parts, finish(b, geom.wallId, framed.materialId, 'solid'));
    }
    openingSolids(doc, geom, z0, parts);
  }
  floorSolids(doc, levelId, level.elevation, parts);
  ceilingSolids(doc, levelId, level.elevation, level.ceilingHeight, level.ceilingFinish, parts);
  objectSolids(doc, levelId, level.elevation, parts);
  foundationSolids(doc, levelId, level.elevation, parts);
  stairSolids(doc, levelId, level.elevation, parts);
  deckSolids(doc, levelId, level.elevation, parts);
  electricalSolids(doc, levelId, level.elevation, level.ceilingHeight, parts);
  plumbingSolids(doc, levelId, level.elevation, parts);
  pipeSolids(doc, levelId, level.elevation, parts);
  lotPads(doc, levelId, level.elevation, parts);
  plantSolids(doc, levelId, level.elevation, parts);
  roadSolids(doc, levelId, level.elevation, parts);
  const sheathing = Object.values(doc.materials).find((material) => material.category === 'sheathing')?.id ?? null;
  for (const roof of roofsOnLevel(doc, levelId)) {
    const b = builder();
    const { positions, indices } = roofTriangles(roof);
    const slope = roof.pitch / 12;
    const len = Math.hypot(roof.up.x * slope, roof.up.y * slope, 1);
    const nx = (-roof.up.x * slope) / len;
    const ny = (-roof.up.y * slope) / len;
    const nz = 1 / len;
    const count = roof.polygon.length;
    b.positions.push(...positions);
    b.indices.push(...indices);
    for (let i = 0; i < count; i++) b.normals.push(-nx, -ny, -nz);
    for (let i = 0; i < count; i++) b.normals.push(nx, ny, nz);
    for (let i = 0; i < count * 2; i++) b.uvs.push(positions[i * 3] ?? 0, positions[i * 3 + 1] ?? 0);
    push(parts, finish(b, roof.id, sheathing, 'solid'));
  }
  return parts;
}

/** Every level, stacked at its real elevation. */
export function buildPlanMeshes(doc: PlanDocument): MeshPart[] {
  return doc.levelOrder.flatMap((levelId) => buildLevelMeshes(doc, levelId));
}

export interface MeshBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export function meshBounds(parts: readonly MeshPart[]): MeshBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const part of parts) {
    for (let i = 0; i < part.positions.length; i += 3) {
      const x = part.positions[i]!;
      const y = part.positions[i + 1]!;
      const z = part.positions[i + 2]!;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/** Odd crossings of a +X ray. Points exactly on a face are not reliable. */
export function pointInsideMesh(parts: readonly MeshPart[], p: readonly [number, number, number]): boolean {
  let hits = 0;
  for (const part of parts) hits += rayHits(part, p[0], p[1], p[2]);
  return hits % 2 === 1;
}

function rayHits(part: MeshPart, ox: number, oy: number, oz: number): number {
  const pos = part.positions;
  const idx = part.indices;
  let hits = 0;
  for (let i = 0; i < idx.length; i += 3) {
    if (rayHitsTriangle(ox, oy, oz, pos, idx[i]! * 3, idx[i + 1]! * 3, idx[i + 2]! * 3)) hits++;
  }
  return hits;
}

/** Möller–Trumbore, ray direction +X. */
function rayHitsTriangle(ox: number, oy: number, oz: number, pos: Float32Array, ia: number, ib: number, ic: number): boolean {
  const ax = pos[ia]!;
  const ay = pos[ia + 1]!;
  const az = pos[ia + 2]!;
  const e1x = pos[ib]! - ax;
  const e1y = pos[ib + 1]! - ay;
  const e1z = pos[ib + 2]! - az;
  const e2x = pos[ic]! - ax;
  const e2y = pos[ic + 1]! - ay;
  const e2z = pos[ic + 2]! - az;
  const py = -e2z;
  const pz = e2y;
  const det = e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-8) return false;
  const inv = 1 / det;
  const tx = ox - ax;
  const ty = oy - ay;
  const tz = oz - az;
  const u = (ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return false;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = qx * inv;
  if (v < 0 || u + v > 1) return false;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 1e-3;
}
