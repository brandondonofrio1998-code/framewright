import { distance } from '../geometry/vec2';
import type { Dimension, DimensionEnd, Id, Opening, PlanDocument, Vec2, WallLayer } from '../model/schema';
import { openingsOnLevel } from '../openings/openings';
import { formatLength } from '../units/length';
import { computeWallGeometry, type WallGeometry } from '../walls/joins';
import { dimensionPrims, type DisplayItem, type FillId, type Prim } from './display-list';
import { cutWallPrims, openingPrims } from './openings';

const FILL_BY_FUNCTION: Record<WallLayer['fn'], FillId> = {
  structure: 'wall.structure',
  sheathing: 'wall.sheathing',
  insulation: 'wall.insulation',
  finish: 'wall.finish',
  air: 'wall.air',
};

/** Where a dimension end is now: on its wall node if attached, otherwise at its stored point. */
export function resolveDimensionEnd(doc: PlanDocument, end: DimensionEnd): Vec2 {
  if (end.nodeId !== undefined) {
    const node = doc.elements[end.nodeId];
    if (node?.kind === 'wallNode') return node.p;
  }
  return end.p;
}

export function dimensionsOnLevel(doc: PlanDocument, levelId: Id): Dimension[] {
  return Object.values(doc.elements).filter((el): el is Dimension => el.kind === 'dimension' && el.levelId === levelId);
}

export function wallDisplayItem(geom: WallGeometry, openings: Opening[] = []): DisplayItem {
  if (openings.length > 0) return { elementId: geom.wallId, layer: 'walls', prims: cutWallPrims(geom, openings, (fn) => FILL_BY_FUNCTION[fn]) };
  const prims: Prim[] = geom.layers.map((layer) => ({ t: 'poly', rings: [layer.polygon], fill: FILL_BY_FUNCTION[layer.fn] }));
  for (const [a, b] of geom.layerLines) prims.push({ t: 'line', a, b, pen: 'wall.layer' });
  for (const [a, b] of [geom.leftFace, geom.rightFace, ...geom.caps]) prims.push({ t: 'line', a, b, pen: 'wall.face' });
  return { elementId: geom.wallId, layer: 'walls', prims };
}

export interface PlanDisplayOptions {
  /** Precomputed geometry for `levelId` (computed if omitted). */
  geometry?: Map<Id, WallGeometry>;
  /** Draw the level below as a faint reference. */
  showReference?: boolean;
}

/** Everything the plan view (and later PDF/DXF export) draws for one level, in model inches. */
export function buildPlanDisplayList(doc: PlanDocument, levelId: Id, options: PlanDisplayOptions = {}): DisplayItem[] {
  const items: DisplayItem[] = [];
  const index = doc.levelOrder.indexOf(levelId);
  const belowId = index > 0 ? doc.levelOrder[index - 1] : undefined;
  if (options.showReference !== false && belowId) {
    const prims: Prim[] = [];
    for (const geom of computeWallGeometry(doc, belowId).values()) {
      prims.push({ t: 'polyline', pts: geom.footprint, closed: true, pen: 'reference' });
    }
    if (prims.length > 0) items.push({ layer: 'reference', prims });
  }

  const geometry = options.geometry ?? computeWallGeometry(doc, levelId);
  const byWall = new Map<Id, Opening[]>();
  for (const o of openingsOnLevel(doc, levelId)) byWall.set(o.wallId, [...(byWall.get(o.wallId) ?? []), o]);
  for (const geom of geometry.values()) items.push(wallDisplayItem(geom, byWall.get(geom.wallId)));
  for (const [wallId, openings] of byWall) {
    const geom = geometry.get(wallId);
    if (!geom) continue;
    for (const o of openings) items.push({ elementId: o.id, layer: 'openings', prims: openingPrims(geom, o) });
  }

  const format = doc.settings.lengthFormat;
  for (const dim of dimensionsOnLevel(doc, levelId)) {
    const a = resolveDimensionEnd(doc, dim.a);
    const b = resolveDimensionEnd(doc, dim.b);
    items.push({ elementId: dim.id, layer: 'dimensions', prims: dimensionPrims(a, b, dim.offset, formatLength(distance(a, b), format)) });
  }
  return items;
}
