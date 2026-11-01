import type { Id, PlanDocument, RoofPlane, Vec2 } from '../model/schema';
import { outlineError, rectangularOutline } from './outline';

/** 6 in 12, a common house pitch. */
export const DEFAULT_PITCH = 6;
/** Eaves project this far past the outside face. Gable ends stay flush. */
export const DEFAULT_OVERHANG = 12;
/** Sheathing thickness, measured square to the slope. */
export const ROOF_THICKNESS = 0.5;

export interface GableSlope {
  polygon: Vec2[];
  pitch: number;
  up: Vec2;
  eave: Vec2;
  eaveZ: number;
  generatedFrom: Id[];
}

export interface GableRoof {
  plateZ: number;
  planes: GableSlope[];
}

/** Height of a roof plane at a plan point. */
export function roofZ(plane: Pick<GableSlope, 'eave' | 'eaveZ' | 'up' | 'pitch'>, p: Vec2): number {
  const run = (p.x - plane.eave.x) * plane.up.x + (p.y - plane.eave.y) * plane.up.y;
  return plane.eaveZ + (plane.pitch / 12) * run;
}

/**
 * A gable over a rectangular outline. The ridge runs the long way. The plane passes through
 * the top of the eave walls and continues past them by the overhang, so the fascia sits lower
 * than the plate. Anything that is not an axis-aligned rectangle is refused.
 */
export function gableOnLevel(doc: PlanDocument, levelId: Id, pitch = DEFAULT_PITCH, overhang = DEFAULT_OVERHANG): { ok: true; roof: GableRoof } | { ok: false; error: string } {
  if (!(pitch > 0) || pitch > 24) return { ok: false, error: 'Pitch must be greater than 0 and at most 24 in 12.' };
  if (!(overhang >= 0) || overhang > 48) return { ok: false, error: 'Overhang must be from 0 to 4 feet.' };
  const outline = rectangularOutline(doc, levelId);
  if (!outline.ok) return { ok: false, error: outlineError(outline.reason, 'gable') };
  const { x0, x1, y0, y1, plateX0, plateX1, plateY0, plateY1, generatedFrom } = outline.rect;
  const alongX = x1 - x0 >= y1 - y0;
  const plateZ = alongX ? Math.min(plateY0, plateY1) : Math.min(plateX0, plateX1);
  const drop = overhang * (pitch / 12);
  const planes = alongX
    ? [
        slopeY(x0, x1, y0 - overhang, (y0 + y1) / 2, { x: 0, y: 1 }, plateZ - drop, pitch, generatedFrom),
        slopeY(x0, x1, y1 + overhang, (y0 + y1) / 2, { x: 0, y: -1 }, plateZ - drop, pitch, generatedFrom),
      ]
    : [
        slopeX(y0, y1, x0 - overhang, (x0 + x1) / 2, { x: 1, y: 0 }, plateZ - drop, pitch, generatedFrom),
        slopeX(y0, y1, x1 + overhang, (x0 + x1) / 2, { x: -1, y: 0 }, plateZ - drop, pitch, generatedFrom),
      ];
  return { ok: true, roof: { plateZ, planes } };
}

/** A slope whose fascia and ridge are horizontal (constant y). Polygon is counter-clockwise in plan. */
function slopeY(x0: number, x1: number, fasciaY: number, ridgeY: number, up: Vec2, eaveZ: number, pitch: number, generatedFrom: Id[]): GableSlope {
  const polygon =
    up.y > 0
      ? [
          { x: x0, y: fasciaY },
          { x: x1, y: fasciaY },
          { x: x1, y: ridgeY },
          { x: x0, y: ridgeY },
        ]
      : [
          { x: x1, y: fasciaY },
          { x: x0, y: fasciaY },
          { x: x0, y: ridgeY },
          { x: x1, y: ridgeY },
        ];
  return { polygon, pitch, up, eave: polygon[0]!, eaveZ, generatedFrom };
}

/** A slope whose fascia and ridge are vertical (constant x). */
function slopeX(y0: number, y1: number, fasciaX: number, ridgeX: number, up: Vec2, eaveZ: number, pitch: number, generatedFrom: Id[]): GableSlope {
  const polygon = [
    { x: fasciaX, y: y0 },
    { x: fasciaX, y: y1 },
    { x: ridgeX, y: y1 },
    { x: ridgeX, y: y0 },
  ];
  return { polygon, pitch, up, eave: polygon[0]!, eaveZ, generatedFrom };
}

/** Triangles for a sheathing slab of `thickness` measured square to the slope. */
export function roofTriangles(plane: Pick<RoofPlane, 'polygon' | 'pitch' | 'up' | 'eave' | 'eaveZ'>, thickness = ROOF_THICKNESS): { positions: number[]; indices: number[] } {
  const slope = plane.pitch / 12;
  const len = Math.hypot(plane.up.x * slope, plane.up.y * slope, 1);
  const ox = (-plane.up.x * slope * thickness) / len;
  const oy = (-plane.up.y * slope * thickness) / len;
  const oz = thickness / len;
  const n = plane.polygon.length;
  const positions: number[] = [];
  for (const p of plane.polygon) {
    const z = roofZ(plane, p);
    positions.push(p.x, p.y, z);
  }
  for (const p of plane.polygon) {
    const z = roofZ(plane, p);
    positions.push(p.x + ox, p.y + oy, z + oz);
  }
  const indices: number[] = [];
  for (let k = 1; k < n - 1; k++) {
    indices.push(n, n + k, n + k + 1);
    indices.push(0, k + 1, k);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(i, j, n + j, i, n + j, n + i);
  }
  return { positions, indices };
}

export function roofsOnLevel(doc: PlanDocument, levelId: Id): RoofPlane[] {
  return Object.values(doc.elements).filter((el): el is RoofPlane => el.kind === 'roofPlane' && el.levelId === levelId);
}
