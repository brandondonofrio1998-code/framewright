import type { DisplayItem, Prim } from '../display/display-list';
import { add, distance, polygonArea } from '../geometry/vec2';
import type { Id, PlanDocument, SiteMark, Vec2 } from '../model/schema';

export function siteOnLevel(doc: PlanDocument, levelId: Id): SiteMark[] {
  return Object.values(doc.elements).filter((el): el is SiteMark => el.kind === 'site' && el.levelId === levelId);
}

export function lotPerimeter(points: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) sum += distance(points[i]!, points[(i + 1) % points.length]!);
  return sum;
}

export function lotArea(points: readonly Vec2[]): number {
  return Math.abs(polygonArea(points));
}

export function siteItem(el: SiteMark): DisplayItem | null {
  if (el.role === 'lot' && el.points) {
    return { elementId: el.id, layer: 'site', prims: [{ t: 'polyline', pts: el.points, closed: true, pen: 'site' }] };
  }
  if (el.role === 'north' && el.p) return { elementId: el.id, layer: 'site', prims: northArrow(el.p) };
  return null;
}

function northArrow(p: Vec2): Prim[] {
  const tip = add(p, { x: 0, y: 48 });
  return [
    { t: 'line', a: p, b: tip, pen: 'site' },
    { t: 'line', a: add(p, { x: -10, y: 28 }), b: tip, pen: 'site' },
    { t: 'line', a: add(p, { x: 10, y: 28 }), b: tip, pen: 'site' },
    { t: 'text', p: add(p, { x: 0, y: 54 }), s: 'N', size: 12, rot: 0, align: 'center' },
  ];
}
