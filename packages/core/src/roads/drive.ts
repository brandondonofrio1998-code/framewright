import type { DisplayItem } from '../display/display-list';
import { add, normalize, scale, sub } from '../geometry/vec2';
import type { Id, PlanDocument, Road, Vec2 } from '../model/schema';

/** A new driveway is 12 feet wide. */
export const ROAD_WIDTH = 144;
export const ROAD_THICKNESS = 4;

export function roadsOnLevel(doc: PlanDocument, levelId: Id): Road[] {
  return Object.values(doc.elements).filter((el): el is Road => el.kind === 'road' && el.levelId === levelId);
}

export function roadPolygon(road: Pick<Road, 'a' | 'b' | 'width'>): Vec2[] {
  const dir = normalize(sub(road.b, road.a));
  const n = scale(perp(dir), road.width / 2);
  return [sub(road.a, n), add(road.a, n), add(road.b, n), sub(road.b, n)];
}

export function roadItem(road: Road): DisplayItem {
  return { elementId: road.id, layer: 'roads', prims: [{ t: 'polyline', pts: roadPolygon(road), closed: true, pen: 'road' }] };
}

function perp(dir: Vec2): Vec2 {
  return { x: -dir.y, y: dir.x };
}
