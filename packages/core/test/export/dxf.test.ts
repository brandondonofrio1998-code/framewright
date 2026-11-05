import { describe, expect, it } from 'vitest';
import { planDxf } from '../../src';
import { testHistory } from '../helpers';

const p = (x: number, y: number) => ({ x, y });

/** Entities in an ASCII DXF, with the layer (group 8) and every X coordinate (group 10 or 11). */
function entities(dxf: string): { type: string; layer: string; xs: number[] }[] {
  const lines = dxf.trim().split('\n');
  const start = lines.findIndex((line, i) => line.trim() === 'ENTITIES' && lines[i - 1]?.trim() === '2');
  const found: { type: string; layer: string; xs: number[] }[] = [];
  let current: { type: string; layer: string; xs: number[] } | null = null;
  for (let i = start + 1; i < lines.length - 1; i += 2) {
    const code = Number(lines[i]?.trim());
    const value = lines[i + 1]?.trim() ?? '';
    if (code === 0) {
      if (value === 'ENDSEC') break;
      current = { type: value, layer: '', xs: [] };
      found.push(current);
    } else if (current && code === 8) current.layer = value;
    else if (current && (code === 10 || code === 11)) current.xs.push(Number(value));
  }
  return found;
}

describe('plan DXF', () => {
  it('writes an empty plan as an inch drawing with the standard layers', () => {
    const ctx = testHistory();
    const dxf = planDxf(ctx.history.doc, ctx.baseLevelId);
    expect(dxf).toContain('AC1015');
    expect(dxf).toContain('$INSUNITS');
    for (const layer of ['reference', 'walls', 'openings', 'objects', 'rooms', 'dimensions', 'text', 'roof', 'foundation', 'stairs', 'deck', 'electrical', 'plumbing', 'site']) expect(dxf).toContain(layer);
    expect(entities(dxf)).toEqual([]);
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
  });

  it('puts the room outline on the walls layer, in model inches', () => {
    const ctx = testHistory();
    const typeId = Object.values(ctx.history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
    const drawn = ctx.history.dispatch('wall.draw', {
      levelId: ctx.baseLevelId,
      typeId,
      points: [p(0, 0), p(240, 0), p(240, 144), p(0, 144)],
      closed: true,
    });
    if (!drawn.ok) throw new Error(drawn.error);
    const drawnEntities = entities(planDxf(ctx.history.doc, ctx.baseLevelId));
    const walls = drawnEntities.filter((entity) => entity.layer === 'walls' && (entity.type === 'LWPOLYLINE' || entity.type === 'LINE'));
    const xs = walls.flatMap((entity) => entity.xs);
    expect(walls.length).toBeGreaterThan(0);
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(240);
    const labels = drawnEntities.filter((entity) => entity.layer === 'rooms' && entity.type === 'TEXT');
    expect(labels.length).toBeGreaterThan(0);
    expect(planDxf(ctx.history.doc, ctx.baseLevelId)).toContain('Room 1');
    expect(planDxf(ctx.history.doc, ctx.baseLevelId)).toContain('sq ft');
  });
});
