import {
  appendBezierCurve,
  clip,
  closePath,
  endPath,
  fill,
  lineTo,
  moveTo,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  restoreDashPattern,
  rgb,
  radians,
  setDashPattern,
  setFillingRgbColor,
  setLineWidth,
  setStrokingRgbColor,
  StandardFonts,
  stroke,
  type PDFPage,
} from 'pdf-lib';
import { buildElevation } from '../elevate/elevation';
import { buildPlanMeshes } from '../mesh/meshes';
import { boundsOf } from '../geometry/vec2';
import { buildPlanDisplayList } from '../display/plan';
import type { FillId, PenId } from '../display/display-list';
import type { Id, PlanDocument, Vec2 } from '../model/schema';
import { fitDrawing, layoutSheet, SHEET_HEIGHT, SHEET_WIDTH, type PaperRect, type SheetLayout } from './layout';

const PT = 72;

const PENS: Record<PenId, { width: number; color: [number, number, number]; dash?: number[] }> = {
  'wall.face': { width: 0.9, color: [0.12, 0.14, 0.16] },
  'wall.layer': { width: 0.45, color: [0.55, 0.53, 0.5] },
  dimension: { width: 0.5, color: [0.19, 0.2, 0.23] },
  reference: { width: 0.4, color: [0.73, 0.71, 0.68], dash: [4, 3] },
  opening: { width: 0.7, color: [0.12, 0.14, 0.16] },
  'opening.swing': { width: 0.4, color: [0.37, 0.4, 0.44] },
  'opening.hidden': { width: 0.4, color: [0.37, 0.4, 0.44], dash: [3, 2] },
  object: { width: 0.7, color: [0.12, 0.14, 0.16] },
  'object.detail': { width: 0.4, color: [0.37, 0.4, 0.44] },
  'object.hidden': { width: 0.45, color: [0.37, 0.4, 0.44], dash: [3, 2] },
  roof: { width: 0.8, color: [0.42, 0.31, 0.23] },
  foundation: { width: 0.6, color: [0.36, 0.4, 0.38] },
  stair: { width: 0.7, color: [0.14, 0.19, 0.27] },
};

const FILLS: Record<FillId, string> = {
  'wall.structure': '#e4d7c3',
  'wall.sheathing': '#ede3d3',
  'wall.insulation': '#f1ecf4',
  'wall.finish': '#f7f5f2',
  'wall.air': '#ffffff',
};

/** One-page PDF of the ARCH D sheet for a level. Coordinates are PDF points, origin at the bottom left. */
export async function sheetPdf(doc: PlanDocument, levelId: Id): Promise<Uint8Array> {
  const layout = layoutSheet(doc, levelId);
  const items = buildPlanDisplayList(doc, levelId);
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([SHEET_WIDTH * PT, SHEET_HEIGHT * PT]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.12, 0.14, 0.16);
  page.drawRectangle({ x: 0, y: 0, width: layout.width * PT, height: layout.height * PT, color: rgb(1, 1, 1), borderColor: ink, borderWidth: 1 });
  strokeRect(page, layout.border, 1.25, ink);
  const titleTop = (layout.title.y + layout.title.h) * PT;
  page.drawLine({ start: { x: layout.title.x * PT, y: titleTop }, end: { x: (layout.title.x + layout.title.w) * PT, y: titleTop }, thickness: 0.8, color: ink });
  const baseline = (layout.title.y + layout.title.h / 2 - 0.06) * PT;
  page.drawText(layout.titleText, { x: layout.title.x * PT + 10, y: baseline, size: 12, font, color: ink });
  const levelWidth = font.widthOfTextAtSize(layout.levelName, 12);
  page.drawText(layout.levelName, { x: (layout.title.x + layout.title.w / 2) * PT - levelWidth / 2, y: baseline, size: 12, font, color: ink });
  const right = `${layout.scaleLabel}    Sheet 1    ${layout.date}`;
  page.drawText(right, { x: (layout.title.x + layout.title.w) * PT - 10 - font.widthOfTextAtSize(right, 12), y: baseline, size: 12, font, color: ink });
  if (layout.schedule) {
    const box = layout.schedule;
    page.drawLine({
      start: { x: box.x * PT, y: box.y * PT },
      end: { x: box.x * PT, y: (box.y + box.h) * PT },
      thickness: 0.8,
      color: ink,
    });
    page.drawText('Openings', { x: box.x * PT + 8, y: (box.y + box.h - 0.32) * PT, size: 9, font, color: ink });
    layout.scheduleRows.forEach((row, index) => {
      const y = (box.y + box.h - 0.62 - index * 0.32) * PT;
      if (y < box.y * PT + 4) return;
      page.drawText(`${row.mark}  ${row.size}  ${row.style}  ${row.count}`, { x: box.x * PT + 8, y, size: 8, font, color: ink });
    });
  }

  drawModel(page, layout, items, font, ink);
  if (layout.elevation) {
    const lines = buildElevation(buildPlanMeshes(doc), 'front');
    const points = lines.flatMap((item) => item.prims.flatMap((prim) => (prim.t === 'line' ? [prim.a, prim.b] : [])));
    const fitted = fitDrawing(boundsOf(points), layout.elevation);
    const view: SheetLayout = { ...layout, viewport: layout.elevation, modelPerPaper: fitted.modelPerPaper, center: fitted.center, scaleLabel: fitted.scaleLabel };
    drawModel(page, view, lines, font, ink);
    page.drawText(`Front    ${fitted.scaleLabel}`, { x: layout.elevation.x * PT + 8, y: (layout.elevation.y + layout.elevation.h - 0.32) * PT, size: 9, font, color: ink });
  }
  return pdf.save();
}

function drawModel(page: PDFPage, layout: SheetLayout, items: ReturnType<typeof buildPlanDisplayList>, font: Awaited<ReturnType<PDFDocument['embedFont']>>, ink: ReturnType<typeof rgb>): void {
  const vx = layout.viewport.x * PT;
  const vy = layout.viewport.y * PT;
  page.pushOperators(pushGraphicsState(), rectangle(vx, vy, layout.viewport.w * PT, layout.viewport.h * PT), clip(), endPath());
  for (const item of items) {
    for (const prim of item.prims) {
      if (prim.t !== 'poly') continue;
      const [r, g, b] = hex(FILLS[prim.fill]);
      page.pushOperators(setFillingRgbColor(r, g, b));
      for (const ring of prim.rings) trace(page, ring.map((point) => modelPoint(layout, point)), true);
      page.pushOperators(fill());
    }
  }
  for (const item of items) {
    for (const prim of item.prims) {
      if (prim.t === 'poly') {
        if (!prim.pen) continue;
        strokePen(page, prim.pen);
        for (const ring of prim.rings) trace(page, ring.map((point) => modelPoint(layout, point)), true);
        page.pushOperators(stroke(), restoreDashPattern());
      } else if (prim.t === 'line') {
        strokePen(page, prim.pen);
        trace(page, [modelPoint(layout, prim.a), modelPoint(layout, prim.b)], false);
        page.pushOperators(stroke(), restoreDashPattern());
      } else if (prim.t === 'polyline') {
        strokePen(page, prim.pen);
        trace(page, prim.pts.map((point) => modelPoint(layout, point)), prim.closed);
        page.pushOperators(stroke(), restoreDashPattern());
      } else if (prim.t === 'arc') {
        strokePen(page, prim.pen);
        page.pushOperators(...arcCurve(layout, prim.c, prim.r, prim.start, prim.sweep), stroke(), restoreDashPattern());
      } else if (prim.t === 'text') {
        const size = (prim.size / layout.modelPerPaper) * PT;
        if (size < 4) continue;
        const at = modelPoint(layout, prim.p);
        const width = font.widthOfTextAtSize(prim.s, size);
        const dx = prim.align === 'center' ? -width / 2 : prim.align === 'right' ? -width : 0;
        page.drawText(prim.s, { x: at.x + dx, y: at.y, size, font, color: ink, rotate: radians(prim.rot) });
      }
    }
  }
  page.pushOperators(popGraphicsState());
}

function modelPoint(layout: SheetLayout, point: Vec2): Vec2 {
  const x = layout.viewport.x + layout.viewport.w / 2 + (point.x - layout.center.x) / layout.modelPerPaper;
  const y = layout.viewport.y + layout.viewport.h / 2 + (point.y - layout.center.y) / layout.modelPerPaper;
  return { x: x * PT, y: y * PT };
}

function strokeRect(page: PDFPage, box: PaperRect, width: number, color: ReturnType<typeof rgb>): void {
  page.drawRectangle({ x: box.x * PT, y: box.y * PT, width: box.w * PT, height: box.h * PT, borderColor: color, borderWidth: width });
}

function strokePen(page: PDFPage, pen: PenId): void {
  const style = PENS[pen];
  page.pushOperators(setLineWidth(style.width), setStrokingRgbColor(...style.color));
  if (style.dash) page.pushOperators(setDashPattern(style.dash, 0));
}

function trace(page: PDFPage, pts: Vec2[], closed: boolean): void {
  const first = pts[0];
  if (!first) return;
  page.pushOperators(moveTo(first.x, first.y));
  for (const point of pts.slice(1)) page.pushOperators(lineTo(point.x, point.y));
  if (closed) page.pushOperators(closePath());
}

/** A circular arc as cubic segments of at most 90 degrees. */
function arcCurve(layout: SheetLayout, center: Vec2, radius: number, start: number, sweep: number) {
  if (!(radius > 0) || sweep === 0) return [];
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
  const delta = sweep / steps;
  const at = (angle: number) => modelPoint(layout, { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
  let angle = start;
  let current = at(angle);
  const ops = [moveTo(current.x, current.y)];
  for (let i = 0; i < steps; i++) {
    const next = angle + delta;
    const p0 = current;
    const p1 = at(next);
    const k = ((4 / 3) * Math.tan(delta / 4) * radius) / layout.modelPerPaper * PT;
    const c1 = { x: p0.x + k * -Math.sin(angle), y: p0.y + k * Math.cos(angle) };
    const c2 = { x: p1.x - k * -Math.sin(next), y: p1.y - k * Math.cos(next) };
    ops.push(appendBezierCurve(c1.x, c1.y, c2.x, c2.y, p1.x, p1.y));
    angle = next;
    current = p1;
  }
  return ops;
}

function hex(color: string): [number, number, number] {
  const n = Number.parseInt(color.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
