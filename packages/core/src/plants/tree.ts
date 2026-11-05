import type { DisplayItem, Prim } from '../display/display-list';
import type { Id, PlanDocument, Plant, Vec2 } from '../model/schema';

export function plantsOnLevel(doc: PlanDocument, levelId: Id): Plant[] {
  return Object.values(doc.elements).filter((el): el is Plant => el.kind === 'plant' && el.levelId === levelId);
}

export function plantItem(el: Plant): DisplayItem {
  return { elementId: el.id, layer: 'plants', prims: plantSymbol(el) };
}

function plantSymbol(el: Plant): Prim[] {
  return [
    { t: 'arc', c: el.p, r: el.radius, start: 0, sweep: Math.PI * 2, pen: 'plant' },
    { t: 'arc', c: el.p, r: 4, start: 0, sweep: Math.PI * 2, pen: 'plant' },
  ];
}

export function plantRing(center: Vec2, radius: number, sides = 8): Vec2[] {
  return Array.from({ length: sides }, (_, i) => {
    const angle = (i / sides) * Math.PI * 2;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
}
