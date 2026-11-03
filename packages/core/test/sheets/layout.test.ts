import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildPlanDisplayList, layoutSheet, sheetPdf, SHEET_HEIGHT, SHEET_WIDTH } from '../../src';
import { testHistory } from '../helpers';

const p = (x: number, y: number) => ({ x, y });

describe('sheet layout', () => {
  it('puts a title block under the plan on an ARCH D sheet', () => {
    const ctx = testHistory();
    const sheet = layoutSheet(ctx.history.doc, ctx.baseLevelId);
    expect(sheet.width).toBe(SHEET_WIDTH);
    expect(sheet.height).toBe(SHEET_HEIGHT);
    expect(sheet.title.y).toBe(sheet.border.y);
    expect(sheet.viewport.y).toBeGreaterThanOrEqual(sheet.title.y + sheet.title.h - 0.01);
    expect(sheet.viewport.y + sheet.viewport.h).toBeLessThanOrEqual(sheet.border.y + sheet.border.h + 0.01);
    expect(sheet.titleText).toBe('Untitled');
    expect(sheet.levelName).toBe('Level 1');
    expect(sheet.scaleLabel).toBe('1/4" = 1\'-0"');
    expect(sheet.schedule).toBeNull();
  });

  it('picks a standard scale that fits a room', () => {
    const ctx = testHistory();
    const typeId = Object.values(ctx.history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
    const drawn = ctx.history.dispatch('wall.draw', {
      levelId: ctx.baseLevelId,
      typeId,
      points: [p(0, 0), p(240, 0), p(240, 144), p(0, 144)],
      closed: true,
    });
    if (!drawn.ok) throw new Error(drawn.error);
    const sheet = layoutSheet(ctx.history.doc, ctx.baseLevelId);
    const items = buildPlanDisplayList(ctx.history.doc, ctx.baseLevelId);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const item of items) {
      for (const prim of item.prims) {
        const pts = prim.t === 'line' ? [prim.a, prim.b] : prim.t === 'polyline' ? prim.pts : prim.t === 'poly' ? prim.rings.flat() : [];
        for (const point of pts) {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        }
      }
    }
    expect((maxX - minX) / sheet.modelPerPaper).toBeLessThanOrEqual(sheet.viewport.w);
    expect((maxY - minY) / sheet.modelPerPaper).toBeLessThanOrEqual(sheet.viewport.h);
    expect(sheet.center.x).toBeGreaterThan(100);
    expect(sheet.center.x).toBeLessThan(140);
    expect(sheet.scaleLabel).toMatch(/=\s*1'-0"/);
  });

  it('writes a one-page PDF the size of the sheet', async () => {
    const ctx = testHistory();
    const typeId = Object.values(ctx.history.doc.wallTypes).find((t) => t.name === 'Exterior 2x6')!.id;
    const drawn = ctx.history.dispatch('wall.draw', {
      levelId: ctx.baseLevelId,
      typeId,
      points: [p(0, 0), p(240, 0), p(240, 144), p(0, 144)],
      closed: true,
    });
    if (!drawn.ok) throw new Error(drawn.error);
    const bytes = await sheetPdf(ctx.history.doc, ctx.baseLevelId);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(1500);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    const page = pdf.getPage(0);
    expect(page.getWidth()).toBeCloseTo(SHEET_WIDTH * 72, 3);
    expect(page.getHeight()).toBeCloseTo(SHEET_HEIGHT * 72, 3);
    expect(layoutSheet(ctx.history.doc, ctx.baseLevelId).scaleLabel.length).toBeGreaterThan(0);
  });
});
