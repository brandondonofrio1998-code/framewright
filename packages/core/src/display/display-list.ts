import { add, angleOf, distance, midpoint, normalize, perp, scale, sub } from '../geometry/vec2';
import type { Id, Vec2 } from '../model/schema';

export type PenId = 'wall.face' | 'wall.layer' | 'dimension' | 'reference' | 'opening' | 'opening.swing' | 'opening.hidden' | 'object' | 'object.detail' | 'object.hidden';
export type FillId = 'wall.structure' | 'wall.sheathing' | 'wall.insulation' | 'wall.finish' | 'wall.air';
export type DrawLayer = 'reference' | 'walls' | 'openings' | 'objects' | 'rooms' | 'dimensions';
export type TextAlign = 'left' | 'center' | 'right';

export type Prim =
  | { t: 'line'; a: Vec2; b: Vec2; pen: PenId }
  | { t: 'polyline'; pts: Vec2[]; closed: boolean; pen: PenId }
  | { t: 'poly'; rings: Vec2[][]; fill: FillId; pen?: PenId }
  /** Circular arc from angle `start` sweeping `sweep` radians (positive = counter-clockwise, Y up). */
  | { t: 'arc'; c: Vec2; r: number; start: number; sweep: number; pen: PenId }
  /** `p` is on the text's bottom edge, so text drawn larger than `size` still clears what it labels. */
  | { t: 'text'; p: Vec2; s: string; size: number; rot: number; align: TextAlign };

export interface DisplayItem {
  elementId?: Id;
  layer: DrawLayer;
  prims: Prim[];
}

export interface DimensionStyle {
  /** Text height, model inches. */
  textSize: number;
  /** Gap between the measured point and its extension line. */
  extensionGap: number;
  /** How far extension lines run past the dimension line. */
  extensionBeyond: number;
  /** Length of the 45° tick marks. */
  tick: number;
}

export const DEFAULT_DIMENSION_STYLE: DimensionStyle = { textSize: 6, extensionGap: 2, extensionBeyond: 3, tick: 4 };

/** Rotation that keeps text along `dir` readable (never upside down). */
export function readableRotation(dir: Vec2): number {
  let rot = angleOf(dir);
  if (rot > Math.PI / 2 + 1e-9) rot -= Math.PI;
  if (rot <= -Math.PI / 2 + 1e-9) rot += Math.PI;
  return rot;
}

/** Points on the dimension line for a dimension from a to b at `offset` (positive = left of a → b). */
export function dimensionLine(a: Vec2, b: Vec2, offset: number): [Vec2, Vec2] {
  const n = perp(normalize(sub(b, a)));
  return [add(a, scale(n, offset)), add(b, scale(n, offset))];
}

/** Architectural linear dimension: extension lines, dimension line, tick marks and a centred label. */
export function dimensionPrims(a: Vec2, b: Vec2, offset: number, label: string, style: DimensionStyle = DEFAULT_DIMENSION_STYLE): Prim[] {
  if (distance(a, b) === 0) return [];
  const d = normalize(sub(b, a));
  const n = perp(d);
  const side = offset < 0 ? -1 : 1;
  const [a2, b2] = dimensionLine(a, b, offset);
  const prims: Prim[] = [];
  if (Math.abs(offset) > style.extensionGap) {
    for (const [p, q] of [
      [a, a2],
      [b, b2],
    ] as const) {
      prims.push({ t: 'line', a: add(p, scale(n, side * style.extensionGap)), b: add(q, scale(n, side * style.extensionBeyond)), pen: 'dimension' });
    }
  }
  prims.push({ t: 'line', a: a2, b: b2, pen: 'dimension' });
  const slash = scale(normalize(add(d, n)), style.tick / 2);
  for (const p of [a2, b2]) prims.push({ t: 'line', a: sub(p, slash), b: add(p, slash), pen: 'dimension' });

  const rot = readableRotation(d);
  const up = perp({ x: Math.cos(rot), y: Math.sin(rot) });
  prims.push({ t: 'text', p: add(midpoint(a2, b2), scale(up, style.textSize * 0.25)), s: label, size: style.textSize, rot, align: 'center' });
  return prims;
}
