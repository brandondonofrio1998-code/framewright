import type { Id, PlanDocument, RoofPlane, Vec2 } from '../model/schema';
import { dot, sub } from '../geometry/vec2';
import { rectangularOutline, type RectOutline } from './outline';
import { roofEdges } from './shape';

export interface RoofRecipe {
  levelId: Id;
  kind: 'gable' | 'hip';
  pitch: number;
  overhang: number;
  pitches: { x0: number; x1: number; y0: number; y1: number };
}

type Side = 'x0' | 'x1' | 'y0' | 'y1';

/** The pitch and overhang of each roof, measured before the walls change. */
export function roofRecipes(doc: PlanDocument): RoofRecipe[] {
  const byLevel = new Map<Id, RoofPlane[]>();
  for (const el of Object.values(doc.elements)) {
    if (el.kind !== 'roofPlane') continue;
    const list = byLevel.get(el.levelId) ?? [];
    list.push(el);
    byLevel.set(el.levelId, list);
  }
  const recipes: RoofRecipe[] = [];
  for (const [levelId, planes] of byLevel) {
    const outline = rectangularOutline(doc, levelId);
    const recipe = outline.ok ? recipeFor(levelId, planes, outline.rect) : shapeRecipe(doc, levelId, planes);
    if (recipe) recipes.push(recipe);
  }
  return recipes;
}

/** A hip that follows a wing, a notch, or an angled wall. */
function shapeRecipe(doc: PlanDocument, levelId: Id, planes: RoofPlane[]): RoofRecipe | null {
  const pitch = planes[0]?.pitch ?? 6;
  const edges = roofEdges(doc, levelId).flat();
  const hangs: number[] = [];
  for (const plane of planes) {
    let best = 48;
    let hang = -1;
    for (const edge of edges) {
      if (dot(edge.inward, plane.up) < 0.9) continue;
      const along = dot(sub(edge.origin, plane.eave), plane.up);
      if (along < -0.5 || along > 48) continue;
      const miss = Math.abs(dot(sub(edge.origin, plane.eave), { x: -plane.up.y, y: plane.up.x }));
      if (miss < best) {
        best = miss;
        hang = along;
      }
    }
    if (hang >= 0) hangs.push(hang);
  }
  const overhang = hangs.length > 0 ? hangs.reduce((sum, value) => sum + value, 0) / hangs.length : 12;
  return { levelId, kind: 'hip', pitch, overhang, pitches: { x0: pitch, x1: pitch, y0: pitch, y1: pitch } };
}

function recipeFor(levelId: Id, planes: RoofPlane[], rect: RectOutline): RoofRecipe | null {
  const sides = new Map<Side, RoofPlane>();
  for (const plane of planes) {
    const side = sideOf(plane.up);
    if (!side || sides.has(side)) return null;
    sides.set(side, plane);
  }
  const overhangs = [...sides].map(([side, plane]) => overhangOf(plane, rect, side));
  if (overhangs.some((value) => !(value >= -0.05) || value > 48.05)) return null;
  if (!close(overhangs)) return null;
  const overhang = overhangs.reduce((sum, value) => sum + value, 0) / overhangs.length;
  const y0 = sides.get('y0');
  const y1 = sides.get('y1');
  const x0 = sides.get('x0');
  const x1 = sides.get('x1');
  if (planes.length === 2 && y0 && y1 && close([y0.pitch, y1.pitch])) {
    return { levelId, kind: 'gable', pitch: y0.pitch, overhang, pitches: { x0: y0.pitch, x1: y0.pitch, y0: y0.pitch, y1: y1.pitch } };
  }
  if (planes.length === 2 && x0 && x1 && close([x0.pitch, x1.pitch])) {
    return { levelId, kind: 'gable', pitch: x0.pitch, overhang, pitches: { x0: x0.pitch, x1: x1.pitch, y0: x0.pitch, y1: x0.pitch } };
  }
  if (planes.length === 4 && x0 && x1 && y0 && y1) {
    return { levelId, kind: 'hip', pitch: y0.pitch, overhang, pitches: { x0: x0.pitch, x1: x1.pitch, y0: y0.pitch, y1: y1.pitch } };
  }
  return null;
}

function sideOf(up: Vec2): Side | null {
  if (up.y > 0.5 && Math.abs(up.x) < 0.2) return 'y0';
  if (up.y < -0.5 && Math.abs(up.x) < 0.2) return 'y1';
  if (up.x > 0.5 && Math.abs(up.y) < 0.2) return 'x0';
  if (up.x < -0.5 && Math.abs(up.y) < 0.2) return 'x1';
  return null;
}

function overhangOf(plane: RoofPlane, rect: RectOutline, side: Side): number {
  if (side === 'y0') return rect.y0 - plane.eave.y;
  if (side === 'y1') return plane.eave.y - rect.y1;
  if (side === 'x0') return rect.x0 - plane.eave.x;
  return plane.eave.x - rect.x1;
}

function close(values: number[]): boolean {
  const first = values[0] ?? 0;
  return values.every((value) => Math.abs(value - first) <= 0.05);
}
