import { describe, expect, it } from 'vitest';
import { buildPlanDisplayList, parseDxf, planDxf } from '../../src';
import { testHistory } from '../helpers';

const p = (x: number, y: number) => ({ x, y });

const METERS = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', '0', '10', '1', '20', '0', '11', '2', '21', '0', '0', 'ENDSEC', '0', 'EOF', ''].join('\n');

describe('DXF import', () => {
  it('reads a meter line as inches', () => {
    const parsed = parseDxf(METERS);
    if (!parsed.ok) throw new Error(parsed.error);
    const line = parsed.prims.find((prim) => prim.t === 'line');
    if (!line || line.t !== 'line') throw new Error('no line');
    expect(line.b.x).toBeCloseTo(78.740157, 3);
    expect(line.a.y).toBeCloseTo(0, 5);
  });

  it('reads an exported room back as reference geometry', () => {
    const ctx = testHistory();
    const typeId = Object.values(ctx.history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
    const drawn = ctx.history.dispatch('wall.draw', {
      levelId: ctx.baseLevelId,
      typeId,
      points: [p(0, 0), p(240, 0), p(240, 144), p(0, 144)],
      closed: true,
    });
    if (!drawn.ok) throw new Error(drawn.error);
    const parsed = parseDxf(planDxf(ctx.history.doc, ctx.baseLevelId));
    if (!parsed.ok) throw new Error(parsed.error);
    const xs = parsed.prims.flatMap((prim) => (prim.t === 'line' ? [prim.a.x, prim.b.x] : prim.t === 'polyline' ? prim.pts.map((pt) => pt.x) : []));
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(240);
    expect(parsed.prims.some((prim) => prim.t === 'text' && prim.s === 'Room 1')).toBe(true);

    const imported = ctx.history.dispatch('cad.import', { levelId: ctx.baseLevelId, name: 'room', prims: parsed.prims });
    if (!imported.ok) throw new Error(imported.error);
    const reference = buildPlanDisplayList(ctx.history.doc, ctx.baseLevelId).filter((item) => item.layer === 'reference' && item.elementId === imported.value);
    expect(reference.length).toBe(1);
    expect(reference[0]!.prims.length).toBe(parsed.prims.length);
  });

  it('refuses a drawing with no geometry', () => {
    const parsed = parseDxf('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n');
    expect(parsed.ok).toBe(false);
  });
});
