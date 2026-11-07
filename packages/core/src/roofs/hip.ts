import { polygonArea } from '../geometry/vec2';
import type { Id, PlanDocument, Vec2 } from '../model/schema';
import { DEFAULT_OVERHANG, DEFAULT_PITCH, type GableRoof, type GableSlope } from './gable';
import { outlineError, rectangularOutline, type RectOutline } from './outline';
import { hipOverOutlines } from './shape';

/** Pitch of each side, rise per 12. `x0` is the wall at the smaller X, `y0` the wall at the smaller Y. */
export interface HipPitches {
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
}

const POINT_EPS = 0.05;

/**
 * A hip over a rectangular outline. Every side is an eave. The ridge is where the planes meet:
 * a line when the room is long, a point when it is square. Each side keeps its own pitch. A steeper
 * slope reaches the ridge in less distance, so the ridge moves toward that side. The fascia sits
 * below that wall's plate by overhang times pitch/12.
 */
export function hipOnLevel(
  doc: PlanDocument,
  levelId: Id,
  pitch = DEFAULT_PITCH,
  overhang = DEFAULT_OVERHANG,
  pitches: HipPitches = {},
): { ok: true; roof: GableRoof } | { ok: false; error: string } {
  const resolved = {
    x0: pitches.x0 ?? pitch,
    x1: pitches.x1 ?? pitch,
    y0: pitches.y0 ?? pitch,
    y1: pitches.y1 ?? pitch,
  };
  for (const side of Object.values(resolved)) {
    if (!(side > 0) || side > 24) return { ok: false, error: 'Pitch must be greater than 0 and at most 24 in 12.' };
  }
  if (!(overhang >= 0) || overhang > 48) return { ok: false, error: 'Overhang must be from 0 to 4 feet.' };
  const outline = rectangularOutline(doc, levelId);
  if (!outline.ok) {
    if (outline.reason === 'small') return { ok: false, error: outlineError(outline.reason, 'hip') };
    return hipOverOutlines(doc, levelId, pitch, overhang);
  }
  return hipOverRect(outline.rect, resolved, overhang);
}

/** Hip planes for an outline already known to be a rectangle. Pitches are rise per 12. */
export function hipOverRect(
  rect: RectOutline,
  pitch: { x0: number; x1: number; y0: number; y1: number },
  overhang: number,
): { ok: true; roof: GableRoof } | { ok: false; error: string } {
  const sY0 = pitch.y0 / 12;
  const sY1 = pitch.y1 / 12;
  const sX0 = pitch.x0 / 12;
  const sX1 = pitch.x1 / 12;
  const { x0, x1, y0, y1, plateX0, plateX1, plateY0, plateY1, generatedFrom } = rect;

  // Ridge of the two Y walls: `at` is its Y, `lo`/`hi` are its X ends.
  const yRidge = meet(plateY0, sY0, y0, plateY1, sY1, y1, plateX0, sX0, x0, plateX1, sX1, x1);
  // Ridge of the two X walls: `at` is its X, `lo`/`hi` are its Y ends.
  const xRidge = meet(plateX0, sX0, x0, plateX1, sX1, x1, plateY0, sY0, y0, plateY1, sY1, y1);
  const yOk = yRidge.hi >= yRidge.lo - 1e-6;
  const xOk = xRidge.hi >= xRidge.lo - 1e-6;
  if (!yOk && !xOk) return { ok: false, error: 'These pitches do not meet over the room.' };
  const alongX = yOk && (!xOk || yRidge.hi - yRidge.lo >= xRidge.hi - xRidge.lo);

  const y0West = join(plateY0, sY0, overhang, plateX0, sX0, x0, true);
  const y0East = join(plateY0, sY0, overhang, plateX1, sX1, x1, false);
  const y1West = join(plateY1, sY1, overhang, plateX0, sX0, x0, true);
  const y1East = join(plateY1, sY1, overhang, plateX1, sX1, x1, false);
  const x0South = join(plateX0, sX0, overhang, plateY0, sY0, y0, true);
  const x0North = join(plateX0, sX0, overhang, plateY1, sY1, y1, false);
  const x1South = join(plateX1, sX1, overhang, plateY0, sY0, y0, true);
  const x1North = join(plateX1, sX1, overhang, plateY1, sY1, y1, false);
  const yFascia0 = y0 - overhang;
  const yFascia1 = y1 + overhang;
  const xFascia0 = x0 - overhang;
  const xFascia1 = x1 + overhang;

  const planes = alongX
    ? planesAlongX()
    : planesAlongY();

  if (planes.some((plane) => plane === null)) return { ok: false, error: 'These pitches do not meet over the room.' };
  return {
    ok: true,
    roof: { plateZ: Math.min(plateX0, plateX1, plateY0, plateY1), planes: planes.filter((plane): plane is GableSlope => plane !== null) },
  };

  function planesAlongX(): (GableSlope | null)[] {
    const [xLo, xHi] = ends(yRidge.lo, yRidge.hi);
    const yAt = yRidge.at;
    return [
      make(
        [
          { x: y0West, y: yFascia0 },
          { x: y0East, y: yFascia0 },
          { x: xHi, y: yAt },
          { x: xLo, y: yAt },
        ],
        { x: y0West, y: yFascia0 },
        pitch.y0,
        { x: 0, y: 1 },
        plateY0,
      ),
      make(
        [
          { x: y1East, y: yFascia1 },
          { x: y1West, y: yFascia1 },
          { x: xLo, y: yAt },
          { x: xHi, y: yAt },
        ],
        { x: y1West, y: yFascia1 },
        pitch.y1,
        { x: 0, y: -1 },
        plateY1,
      ),
      make(
        [
          { x: xFascia0, y: x0South },
          { x: xLo, y: yAt },
          { x: xFascia0, y: x0North },
        ],
        { x: xFascia0, y: x0South },
        pitch.x0,
        { x: 1, y: 0 },
        plateX0,
      ),
      make(
        [
          { x: xFascia1, y: x1South },
          { x: xFascia1, y: x1North },
          { x: xHi, y: yAt },
        ],
        { x: xFascia1, y: x1South },
        pitch.x1,
        { x: -1, y: 0 },
        plateX1,
      ),
    ];
  }

  function planesAlongY(): (GableSlope | null)[] {
    const [yLo, yHi] = ends(xRidge.lo, xRidge.hi);
    const xAt = xRidge.at;
    return [
      make(
        [
          { x: xFascia0, y: x0South },
          { x: xAt, y: yLo },
          { x: xAt, y: yHi },
          { x: xFascia0, y: x0North },
        ],
        { x: xFascia0, y: x0South },
        pitch.x0,
        { x: 1, y: 0 },
        plateX0,
      ),
      make(
        [
          { x: xFascia1, y: x1South },
          { x: xFascia1, y: x1North },
          { x: xAt, y: yHi },
          { x: xAt, y: yLo },
        ],
        { x: xFascia1, y: x1South },
        pitch.x1,
        { x: -1, y: 0 },
        plateX1,
      ),
      make(
        [
          { x: y0West, y: yFascia0 },
          { x: y0East, y: yFascia0 },
          { x: xAt, y: yLo },
        ],
        { x: y0West, y: yFascia0 },
        pitch.y0,
        { x: 0, y: 1 },
        plateY0,
      ),
      make(
        [
          { x: y1East, y: yFascia1 },
          { x: y1West, y: yFascia1 },
          { x: xAt, y: yHi },
        ],
        { x: y1West, y: yFascia1 },
        pitch.y1,
        { x: 0, y: -1 },
        plateY1,
      ),
    ];
  }

  function make(pts: Vec2[], eave: Vec2, sidePitch: number, up: Vec2, plate: number): GableSlope | null {
    const polygon = ccw(pts);
    if (polygon.length < 3 || polygonArea(polygon) < 1) return null;
    return { polygon, pitch: sidePitch, up, eave, eaveZ: plate - overhang * (sidePitch / 12), generatedFrom };
  }
}

/** Where two opposite planes meet, and where the side planes climb to that height. */
function meet(
  plateA: number,
  slopeA: number,
  originA: number,
  plateB: number,
  slopeB: number,
  originB: number,
  plateLo: number,
  slopeLo: number,
  originLo: number,
  plateHi: number,
  slopeHi: number,
  originHi: number,
): { at: number; z: number; lo: number; hi: number } {
  const at = (plateB - plateA + slopeB * originB + slopeA * originA) / (slopeA + slopeB);
  const z = plateA + slopeA * (at - originA);
  return { at, z, lo: originLo + (z - plateLo) / slopeLo, hi: originHi - (z - plateHi) / slopeHi };
}

/** Plan position where two eaves meet. `lowSide` is the neighbor at the smaller coordinate. */
function join(plate: number, slope: number, overhang: number, otherPlate: number, otherSlope: number, otherOrigin: number, lowSide: boolean): number {
  const delta = (plate - otherPlate - slope * overhang) / otherSlope;
  return lowSide ? otherOrigin + delta : otherOrigin - delta;
}

function ends(lo: number, hi: number): [number, number] {
  if (hi - lo < POINT_EPS) {
    const mid = (lo + hi) / 2;
    return [mid, mid];
  }
  return [lo, hi];
}

function ccw(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    const prev = out[out.length - 1];
    if (prev && Math.hypot(prev.x - p.x, prev.y - p.y) < POINT_EPS) continue;
    out.push(p);
  }
  if (out.length > 1) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (Math.hypot(first.x - last.x, first.y - last.y) < POINT_EPS) out.pop();
  }
  if (polygonArea(out) < 0) out.reverse();
  return out;
}
