import type { CatalogDef, CatalogObject, ParamValue, PlanDocument, Vec2 } from '../model/schema';
import type { PenId, Prim } from '../display/display-list';

type SymbolPen = Extract<PenId, 'object' | 'object.hidden' | 'object.detail'>;

const num = (params: Record<string, ParamValue>, key: string, fallback: number) => {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

export function resolvedParams(doc: PlanDocument, object: CatalogObject): Record<string, ParamValue> {
  return { ...(doc.catalogDefs[object.defId]?.params ?? {}), ...object.params };
}

export function objectSize(doc: PlanDocument, object: CatalogObject): { width: number; depth: number; height: number; elevation: number } {
  const params = resolvedParams(doc, object);
  return { width: num(params, 'width', 24), depth: num(params, 'depth', 24), height: num(params, 'height', 30), elevation: num(params, 'elevation', 0) };
}

/** Local plan point (origin at center, +y toward the back) into the plan. */
function place(p: Vec2, rotation: number, local: Vec2): Vec2 {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return { x: p.x + local.x * c - local.y * s, y: p.y + local.x * s + local.y * c };
}

function transform(prim: Prim, p: Vec2, rotation: number): Prim {
  const at = (v: Vec2) => place(p, rotation, v);
  switch (prim.t) {
    case 'line':
      return { ...prim, a: at(prim.a), b: at(prim.b) };
    case 'polyline':
      return { ...prim, pts: prim.pts.map(at) };
    case 'arc':
      return { ...prim, c: at(prim.c), start: prim.start + rotation };
    default:
      return prim;
  }
}

const corners = (w: number, d: number): Vec2[] => [
  { x: -w / 2, y: -d / 2 },
  { x: w / 2, y: -d / 2 },
  { x: w / 2, y: d / 2 },
  { x: -w / 2, y: d / 2 },
];

const outline = (w: number, d: number, pen: SymbolPen): Prim => ({
  t: 'polyline',
  pts: corners(w, d),
  closed: true,
  pen,
});

function oval(cx: number, cy: number, rx: number, ry: number, pen: SymbolPen): Prim {
  const pts: Vec2[] = [];
  const steps = 16;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return { t: 'polyline', pts, closed: true, pen };
}

/** Plan symbol in local inches: origin at the center, +y toward the back (the wall). */
export function localSymbol(def: CatalogDef, params: Record<string, ParamValue>): Prim[] {
  const w = num(params, 'width', 24);
  const d = num(params, 'depth', 24);
  const pen = def.generator === 'cabinet.wall' ? 'object.hidden' : 'object';
  const detail = 'object.detail' as const;
  const box = outline(w, d, pen);
  const front = -d / 2;
  switch (def.generator) {
    case 'cabinet.base':
    case 'cabinet.wall':
    case 'cabinet.tall': {
      const prims = [box];
      const leaves = w > 27 ? 2 : 1;
      for (let i = 1; i < leaves; i++) {
        const x = -w / 2 + (w * i) / leaves;
        prims.push({ t: 'line', a: { x, y: front }, b: { x, y: d / 2 }, pen: detail });
      }
      prims.push({ t: 'line', a: { x: -w / 2, y: front + 2 }, b: { x: w / 2, y: front + 2 }, pen: detail });
      return prims;
    }
    case 'appliance.range': {
      const prims = [box];
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        prims.push({ t: 'arc', c: { x: sx * w * 0.22, y: sy * d * 0.22 }, r: Math.min(w, d) * 0.14, start: 0, sweep: Math.PI * 2, pen: detail });
      }
      return prims;
    }
    case 'appliance.fridge': {
      // Door swings open from the left of the front edge.
      const hinge = { x: -w / 2, y: front };
      return [
        box,
        { t: 'line', a: hinge, b: { x: -w / 2, y: front - w }, pen },
        { t: 'arc', c: hinge, r: w, start: 0, sweep: -Math.PI / 2, pen: detail },
      ];
    }
    case 'appliance.dishwasher':
      return [box, { t: 'line', a: { x: -w / 2, y: d / 2 }, b: { x: w / 2, y: front }, pen: detail }];
    case 'fixture.toilet': {
      const tankDepth = Math.min(8, d * 0.3);
      return [
        {
          t: 'polyline',
          pts: [
            { x: -w * 0.4, y: d / 2 },
            { x: w * 0.4, y: d / 2 },
            { x: w * 0.4, y: d / 2 - tankDepth },
            { x: -w * 0.4, y: d / 2 - tankDepth },
          ],
          closed: true,
          pen,
        },
        oval(0, front + (d - tankDepth) * 0.38, w * 0.38, (d - tankDepth) * 0.32, pen),
      ];
    }
    case 'fixture.sink':
      return [box, oval(0, 0, w * 0.32, d * 0.28, detail)];
    case 'fixture.tub': {
      const inset = 2;
      return [
        box,
        outline(w - inset * 2, d - inset * 2, detail),
        { t: 'arc', c: { x: w / 2 - inset - 3, y: 0 }, r: 1.5, start: 0, sweep: Math.PI * 2, pen: detail },
      ];
    }
    case 'furniture.bed':
      return [box, outline(w * 0.92, d * 0.55, detail), { t: 'line', a: { x: -w * 0.46, y: d * 0.15 }, b: { x: w * 0.46, y: d * 0.15 }, pen: detail }];
    case 'furniture.sofa':
      return [box, { t: 'line', a: { x: -w / 2, y: d * 0.15 }, b: { x: w / 2, y: d * 0.15 }, pen: detail }, { t: 'line', a: { x: -w * 0.15, y: front }, b: { x: -w * 0.15, y: d / 2 }, pen: detail }, { t: 'line', a: { x: w * 0.15, y: front }, b: { x: w * 0.15, y: d / 2 }, pen: detail }];
    case 'furniture.desk':
      return [box, { t: 'line', a: { x: -w * 0.2, y: front }, b: { x: -w * 0.2, y: d / 2 }, pen: detail }, { t: 'line', a: { x: w * 0.2, y: front }, b: { x: w * 0.2, y: d / 2 }, pen: detail }];
    case 'appliance.laundry':
      return [box, { t: 'arc', c: { x: 0, y: 0 }, r: Math.min(w, d) * 0.28, start: 0, sweep: Math.PI * 2, pen: detail }];
    case 'fixture.shower':
      return [box, { t: 'line', a: { x: -w / 2, y: front }, b: { x: w / 2, y: front + d * 0.7 }, pen: detail }, { t: 'arc', c: { x: 0, y: d * 0.15 }, r: 1.5, start: 0, sweep: Math.PI * 2, pen: detail }];
  }
}

export function objectPrims(doc: PlanDocument, object: CatalogObject): Prim[] {
  const def = doc.catalogDefs[object.defId];
  if (!def) return [];
  return localSymbol(def, resolvedParams(doc, object)).map((prim) => transform(prim, object.p, object.rotation));
}

/** The object's plan rectangle, for hit testing. */
export function objectFootprint(doc: PlanDocument, object: CatalogObject): Vec2[] {
  const { width, depth } = objectSize(doc, object);
  return corners(width, depth).map((local) => place(object.p, object.rotation, local));
}
