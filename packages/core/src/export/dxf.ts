import { buildPlanDisplayList } from '../display/plan';
import type { DrawLayer, Prim } from '../display/display-list';
import type { Id, PlanDocument, Vec2 } from '../model/schema';

/** One AutoCAD color index per drawing layer. */
const LAYERS: { name: DrawLayer; color: number }[] = [
  { name: 'reference', color: 8 },
  { name: 'walls', color: 7 },
  { name: 'openings', color: 4 },
  { name: 'objects', color: 3 },
  { name: 'rooms', color: 2 },
  { name: 'dimensions', color: 1 },
];

/**
 * ASCII DXF (AC1015) of one level's plan, in model inches, Y up.
 * Filled wall polygons are written as closed outlines. Hatch patterns are not written.
 */
export function planDxf(doc: PlanDocument, levelId: Id): string {
  const out: string[] = [];
  const pair = (code: number, value: string | number) => {
    out.push(String(code).padStart(3, ' '));
    out.push(String(value));
  };
  pair(0, 'SECTION');
  pair(2, 'HEADER');
  pair(9, '$ACADVER');
  pair(1, 'AC1015');
  pair(9, '$INSUNITS');
  pair(70, 1);
  pair(0, 'ENDSEC');

  pair(0, 'SECTION');
  pair(2, 'TABLES');
  pair(0, 'TABLE');
  pair(2, 'LAYER');
  pair(70, LAYERS.length);
  for (const layer of LAYERS) {
    pair(0, 'LAYER');
    pair(2, layer.name);
    pair(70, 0);
    pair(62, layer.color);
  }
  pair(0, 'ENDTAB');
  pair(0, 'ENDSEC');

  pair(0, 'SECTION');
  pair(2, 'ENTITIES');
  for (const item of buildPlanDisplayList(doc, levelId)) {
    for (const prim of item.prims) writePrim(pair, item.layer, prim);
  }
  pair(0, 'ENDSEC');
  pair(0, 'EOF');
  return `${out.join('\n')}\n`;
}

function writePrim(pair: (code: number, value: string | number) => void, layer: DrawLayer, prim: Prim): void {
  if (prim.t === 'line') {
    pair(0, 'LINE');
    pair(8, layer);
    point(pair, 10, prim.a);
    point(pair, 11, prim.b);
  } else if (prim.t === 'polyline') {
    polyline(pair, layer, prim.pts, prim.closed);
  } else if (prim.t === 'poly') {
    for (const ring of prim.rings) polyline(pair, layer, ring, true);
  } else if (prim.t === 'arc') {
    if (!(prim.r > 0) || prim.sweep === 0) return;
    if (Math.abs(prim.sweep) >= Math.PI * 2 - 1e-6) {
      pair(0, 'CIRCLE');
      pair(8, layer);
      point(pair, 10, prim.c);
      pair(40, num(prim.r));
      return;
    }
    const start = prim.sweep > 0 ? prim.start : prim.start + prim.sweep;
    const end = prim.sweep > 0 ? prim.start + prim.sweep : prim.start;
    pair(0, 'ARC');
    pair(8, layer);
    point(pair, 10, prim.c);
    pair(40, num(prim.r));
    pair(50, num(degrees(start)));
    pair(51, num(degrees(end)));
  } else if (prim.t === 'text') {
    const text = prim.s.replace(/[\r\n]+/g, ' ').slice(0, 250);
    if (text.length === 0) return;
    const align = prim.align === 'center' ? 1 : prim.align === 'right' ? 2 : 0;
    pair(0, 'TEXT');
    pair(8, layer);
    point(pair, 10, prim.p);
    pair(40, num(prim.size));
    pair(1, text);
    pair(50, num(degrees(prim.rot)));
    pair(72, align);
    pair(73, 1);
    point(pair, 11, prim.p);
  }
}

function polyline(pair: (code: number, value: string | number) => void, layer: DrawLayer, pts: Vec2[], closed: boolean): void {
  if (pts.length < 2) return;
  pair(0, 'LWPOLYLINE');
  pair(8, layer);
  pair(90, pts.length);
  pair(70, closed ? 1 : 0);
  for (const p of pts) point(pair, 10, p);
}

function point(pair: (code: number, value: string | number) => void, code: number, p: Vec2): void {
  pair(code, num(p.x));
  pair(code + 10, num(p.y));
}

function degrees(radians: number): number {
  let value = ((radians * 180) / Math.PI) % 360;
  if (value < 0) value += 360;
  return value;
}

function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}
