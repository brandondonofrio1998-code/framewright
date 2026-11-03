import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildElevation, buildPlanDisplayList, buildPlanMeshes, buildSection, boundsOf, fitDrawing, layoutElevationSheet, layoutSheet, pocheFill, sheetPdf, SHEET_HEIGHT, SHEET_WIDTH } from '../../src';
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
    const chosen = ctx.history.dispatch('settings.update', { sheetScale: 24 });
    if (!chosen.ok) throw new Error(chosen.error);
    expect(layoutSheet(ctx.history.doc, ctx.baseLevelId).scaleLabel).toBe('1/2" = 1\'-0"');
    const cleared = ctx.history.dispatch('settings.update', { sheetScale: null });
    if (!cleared.ok) throw new Error(cleared.error);
    expect(layoutSheet(ctx.history.doc, ctx.baseLevelId).scaleLabel).toBe('1/4" = 1\'-0"');
    expect(ctx.history.dispatch('settings.update', { sheetScale: 7 }).ok).toBe(false);
    expect(sheet.schedule).toBeNull();
    expect(sheet.elevation).toBeNull();
    expect(sheet.section).toBeNull();
    expect(sheet.sheetCount).toBe(1);
    expect(layoutElevationSheet(ctx.history.doc, ctx.baseLevelId)).toBeNull();
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
    expect(sheet.elevation).not.toBeNull();
    expect(sheet.viewport.y).toBeGreaterThanOrEqual(sheet.elevation!.y + sheet.elevation!.h - 0.01);
    const lines = buildElevation(buildPlanMeshes(ctx.history.doc), 'front');
    const points = lines.flatMap((item) => item.prims.flatMap((prim) => (prim.t === 'line' ? [prim.a, prim.b] : [])));
    const fitted = fitDrawing(boundsOf(points), sheet.elevation!);
    const width = (boundsOf(points)!.maxX - boundsOf(points)!.minX) / fitted.modelPerPaper;
    const height = (boundsOf(points)!.maxY - boundsOf(points)!.minY) / fitted.modelPerPaper;
    expect(width).toBeLessThanOrEqual(sheet.elevation!.w);
    expect(height).toBeLessThanOrEqual(sheet.elevation!.h);
    expect(lines.some((item) => item.prims.length > 0)).toBe(true);
    expect(sheet.section).not.toBeNull();
    expect(sheet.section!.x).toBeCloseTo(sheet.elevation!.x + sheet.elevation!.w, 3);
    const parts = buildPlanMeshes(ctx.history.doc);
    const cut = buildSection(parts, 'front', 0.5, (part) => pocheFill(part.role, part.materialId ? (ctx.history.doc.materials[part.materialId]?.category ?? null) : null));
    const cutPoints = cut.flatMap((item) => item.prims.flatMap((prim) => (prim.t === 'line' ? [prim.a, prim.b] : prim.t === 'poly' ? prim.rings.flat() : [])));
    const cutFit = fitDrawing(boundsOf(cutPoints), sheet.section!);
    const cutBounds = boundsOf(cutPoints)!;
    expect((cutBounds.maxX - cutBounds.minX) / cutFit.modelPerPaper).toBeLessThanOrEqual(sheet.section!.w);
    expect((cutBounds.maxY - cutBounds.minY) / cutFit.modelPerPaper).toBeLessThanOrEqual(sheet.section!.h);
    expect(cut.some((item) => item.prims.some((prim) => prim.t === 'poly'))).toBe(true);
    expect(sheet.sheetCount).toBe(2);
    const second = layoutElevationSheet(ctx.history.doc, ctx.baseLevelId);
    expect(second?.panels.map((panel) => panel.label)).toEqual(['Back', 'Left', 'Right', 'Section']);
    expect(second?.sheetNumber).toBe(2);
  });

  it('writes both ARCH D pages when the plan has walls', async () => {
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
    expect(pdf.getPageCount()).toBe(2);
    const page = pdf.getPage(0);
    expect(page.getWidth()).toBeCloseTo(SHEET_WIDTH * 72, 3);
    expect(page.getHeight()).toBeCloseTo(SHEET_HEIGHT * 72, 3);
    expect(pdf.getPage(1).getWidth()).toBeCloseTo(SHEET_WIDTH * 72, 3);
    expect(layoutSheet(ctx.history.doc, ctx.baseLevelId).scaleLabel.length).toBeGreaterThan(0);
  });
});
