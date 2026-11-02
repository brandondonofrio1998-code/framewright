import type { CadPrim, Vec2 } from '../model/schema';

/** Inches per one DXF unit, for the $INSUNITS values architectural files use. */
const INCHES_PER_UNIT: Record<number, number> = {
  0: 1,
  1: 1,
  2: 12,
  4: 1 / 25.4,
  5: 1 / 2.54,
  6: 39.37007874015748,
};

const ENTITY = new Set(['LINE', 'LWPOLYLINE', 'ARC', 'CIRCLE', 'TEXT', 'MTEXT']);
const MAX_PRIMS = 20_000;
const MAX_COORD = 1_000_000;

export type DxfParse = { ok: true; prims: CadPrim[] } | { ok: false; error: string };

interface Raw {
  type: string;
  x: number[];
  y: number[];
  x2: number[];
  y2: number[];
  n40: number | null;
  start: number | null;
  end: number | null;
  flag: number;
  text: string;
}

/**
 * Reads an ASCII DXF into reference geometry, in model inches, Y up.
 * Unitless drawings are read as inches. Blocks, hatches, and old POLYLINE entities are skipped.
 */
export function parseDxf(text: string): DxfParse {
  if (text.includes('\0')) return { ok: false, error: 'This DXF is binary. Save it as an ASCII DXF and import that.' };
  const lines = text.split(/\r\n|\n|\r/);
  let section = '';
  let headerVar = '';
  let units: number | null = null;
  let raw: Raw | null = null;
  const prims: CadPrim[] = [];
  const flush = (scale: number) => {
    if (!raw) return;
    const prim = toPrim(raw, scale);
    raw = null;
    if (prim) prims.push(prim);
  };

  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]?.trim());
    const value = lines[i + 1]?.trim() ?? '';
    if (!Number.isFinite(code)) continue;
    if (code === 0 && value === 'SECTION') continue;
    if (code === 2 && (value === 'HEADER' || value === 'ENTITIES' || value === 'TABLES' || value === 'BLOCKS' || value === 'OBJECTS')) {
      section = value;
      continue;
    }
    if (code === 0 && value === 'ENDSEC') {
      section = '';
      continue;
    }
    if (section === 'HEADER' && code === 9) headerVar = value;
    if (section === 'HEADER' && headerVar === '$INSUNITS' && code === 70) {
      units = Number(value);
      headerVar = '';
    }
    if (section !== 'ENTITIES') continue;
    if (code === 0) {
      const scale = scaleOf(units);
      if (typeof scale !== 'number') return scale;
      flush(scale);
      if (prims.length > MAX_PRIMS) return { ok: false, error: 'The DXF is too large to import.' };
      raw = ENTITY.has(value) ? { type: value, x: [], y: [], x2: [], y2: [], n40: null, start: null, end: null, flag: 0, text: '' } : null;
      continue;
    }
    if (!raw) continue;
    if (code === 10) raw.x.push(Number(value));
    else if (code === 20) raw.y.push(Number(value));
    else if (code === 11) raw.x2.push(Number(value));
    else if (code === 21) raw.y2.push(Number(value));
    else if (code === 40 && (raw.type === 'ARC' || raw.type === 'CIRCLE' || raw.type === 'TEXT' || raw.type === 'MTEXT')) raw.n40 = Number(value);
    else if (code === 50) raw.start = Number(value);
    else if (code === 51) raw.end = Number(value);
    else if (code === 70) raw.flag = Number(value);
    else if (code === 1 || code === 3) raw.text = raw.text.length > 0 ? `${raw.text} ${value}` : value;
  }
  const scale = scaleOf(units);
  if (typeof scale !== 'number') return scale;
  flush(scale);
  if (prims.length === 0) return { ok: false, error: 'The DXF has no lines to import.' };
  if (prims.length > MAX_PRIMS) return { ok: false, error: 'The DXF is too large to import.' };
  return { ok: true, prims };
}

function scaleOf(units: number | null): number | DxfParse {
  const scale = INCHES_PER_UNIT[units ?? 0];
  if (scale === undefined) return { ok: false, error: 'This DXF uses a unit Framewright does not read. Use inches, feet, millimeters, centimeters, or meters.' };
  return scale;
}

function toPrim(raw: Raw, scale: number): CadPrim | null {
  const at = (x: number, y: number): Vec2 | null => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const p = { x: x * scale, y: y * scale };
    if (Math.abs(p.x) > MAX_COORD || Math.abs(p.y) > MAX_COORD) return null;
    return p;
  };
  if (raw.type === 'LINE') {
    const a = at(raw.x[0] ?? NaN, raw.y[0] ?? NaN);
    const b = at(raw.x2[0] ?? NaN, raw.y2[0] ?? NaN);
    if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) return null;
    return { t: 'line', a, b };
  }
  if (raw.type === 'LWPOLYLINE') {
    const pts: Vec2[] = [];
    for (let i = 0; i < Math.min(raw.x.length, raw.y.length); i++) {
      const p = at(raw.x[i]!, raw.y[i]!);
      if (p) pts.push(p);
    }
    if (pts.length < 2 || pts.length > 500) return null;
    return { t: 'polyline', pts, closed: (raw.flag & 1) === 1 };
  }
  if (raw.type === 'CIRCLE' || raw.type === 'ARC') {
    const c = at(raw.x[0] ?? NaN, raw.y[0] ?? NaN);
    const r = (raw.n40 ?? 0) * scale;
    if (!c || !(r > 0) || r > 100_000) return null;
    if (raw.type === 'CIRCLE') return { t: 'arc', c, r, start: 0, sweep: Math.PI * 2 };
    if (raw.start === null || raw.end === null) return null;
    let sweep = raw.end - raw.start;
    if (sweep <= 0) sweep += 360;
    return { t: 'arc', c, r, start: (raw.start * Math.PI) / 180, sweep: (sweep * Math.PI) / 180 };
  }
  const p = at(raw.x[0] ?? NaN, raw.y[0] ?? NaN);
  const text = raw.text.replace(/\\P/g, ' ').slice(0, 250).trim();
  const size = raw.n40 === null ? 6 : raw.n40 * scale;
  if (!p || text.length === 0 || !(size > 0) || size > 1000) return null;
  return { t: 'text', p, s: text, size };
}
