import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { layoutSheet, openingSchedule, sheetPdf } from '../../src';
import { testHistory } from '../helpers';

const p = (x: number, y: number) => ({ x, y });

function room() {
  const ctx = testHistory();
  const typeId = Object.values(ctx.history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
  const drawn = ctx.history.dispatch('wall.draw', {
    levelId: ctx.baseLevelId,
    typeId,
    points: [p(0, 0), p(240, 0), p(240, 144), p(0, 144)],
    closed: true,
  });
  if (!drawn.ok) throw new Error(drawn.error);
  const wallId = Object.values(ctx.history.doc.elements).find((el) => el.kind === 'wall')!.id;
  return { ctx, wallId };
}

describe('opening schedule', () => {
  it('is empty until the level has a door or a window', () => {
    const ctx = testHistory();
    expect(openingSchedule(ctx.history.doc, ctx.baseLevelId)).toEqual([]);
    expect(layoutSheet(ctx.history.doc, ctx.baseLevelId).schedule).toBeNull();
  });

  it('groups matching openings and gives doors and windows their own marks', () => {
    const { ctx, wallId } = room();
    const door = { kind: 'door' as const, wallId, width: 36, height: 80, side: 'left' as const, hinge: 'start' as const, style: 'hinged' as const };
    const first = ctx.history.dispatch('opening.place', { ...door, t: 40 });
    const second = ctx.history.dispatch('opening.place', { ...door, t: 120 });
    const window = ctx.history.dispatch('opening.place', { kind: 'window', wallId, t: 200, width: 36, height: 48, sill: 32, side: 'right', hinge: 'start', style: 'double-hung' });
    if (!first.ok || !second.ok || !window.ok) throw new Error('opening');
    const rows = openingSchedule(ctx.history.doc, ctx.baseLevelId);
    expect(rows.map((row) => [row.mark, row.style, row.count])).toEqual([
      ['D1', 'Hinged', 2],
      ['W1', 'Double hung', 1],
    ]);
    expect(rows[0]!.size).toBe(`3'-0" x 6'-8"`);
    const sheet = layoutSheet(ctx.history.doc, ctx.baseLevelId);
    expect(sheet.schedule?.w).toBe(8);
    expect(sheet.viewport.x + sheet.viewport.w).toBeCloseTo(sheet.schedule!.x, 3);
  });

  it('writes both sheets when the schedule column is present', async () => {
    const { ctx, wallId } = room();
    const placed = ctx.history.dispatch('opening.place', { kind: 'door', wallId, t: 80, width: 36, height: 80, side: 'left', hinge: 'start', style: 'hinged' });
    if (!placed.ok) throw new Error(placed.error);
    const bytes = await sheetPdf(ctx.history.doc, ctx.baseLevelId);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPage(0).getWidth()).toBeCloseTo(36 * 72, 3);
  });
});
