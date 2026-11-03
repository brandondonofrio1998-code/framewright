import { useCallback, useEffect, useMemo, useRef } from 'react';
import { SHEET_SCALES, boundsOf, buildElevation, buildPlanDisplayList, buildPlanMeshes, buildSection, fitDrawing, layoutSheet, pocheFill, type DisplayItem, type SheetLayout, type Vec2 } from '@framewright/core';
import { useAppearance } from '../app/appearance';
import { dispatch, useDocument } from '../document/store';
import { drawDisplayList } from '../plan/render';
import { Viewport } from '../plan/viewport';

/** Draws one ARCH D sheet: border, title block, and the active level's plan at a standard scale. */
export function SheetView() {
  const doc = useDocument((s) => s.doc);
  const levelId = useDocument((s) => s.activeLevelId);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const layout = useMemo(() => layoutSheet(doc, levelId), [doc, levelId]);
  const items = useMemo(() => buildPlanDisplayList(doc, levelId), [doc, levelId]);
  const model = useMemo(() => (layout.elevation ? buildPlanMeshes(doc) : []), [doc, layout.elevation]);
  const elevationItems = useMemo(() => (layout.elevation ? buildElevation(model, 'front') : []), [model, layout.elevation]);
  const sectionItems = useMemo(
    () =>
      layout.section
        ? buildSection(model, 'front', 0.5, (part) => pocheFill(part.role, part.materialId ? (doc.materials[part.materialId]?.category ?? null) : null))
        : [],
    [doc, model, layout.section],
  );

  const draw = useCallback(() => {
    frameRef.current = 0;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !wrap || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    if (width < 2 || height < 2) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--fw-chrome').trim() || '#e4e7ec';
    ctx.fillRect(0, 0, width, height);
    const pad = 16;
    const fit = Math.min((width - pad * 2) / layout.width, (height - pad * 2) / layout.height);
    if (!(fit > 0)) return;
    const origin = { x: (width - layout.width * fit) / 2, y: (height + layout.height * fit) / 2 };
    const paper = (p: Vec2) => ({ x: origin.x + p.x * fit, y: origin.y - p.y * fit });
    const rect = (box: SheetLayout['border']) => {
      const a = paper({ x: box.x, y: box.y + box.h });
      ctx.fillRect(a.x, a.y, box.w * fit, box.h * fit);
      ctx.strokeRect(a.x, a.y, box.w * fit, box.h * fit);
    };
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1f2328';
    ctx.lineWidth = 1;
    rect({ x: 0, y: 0, w: layout.width, h: layout.height });
    ctx.lineWidth = 1.25;
    rect(layout.border);
    const titleTop = paper({ x: layout.title.x, y: layout.title.y + layout.title.h });
    ctx.beginPath();
    ctx.moveTo(titleTop.x, titleTop.y);
    ctx.lineTo(titleTop.x + layout.title.w * fit, titleTop.y);
    ctx.stroke();
    ctx.fillStyle = '#1f2328';
    ctx.font = `${Math.max(12, 0.22 * fit)}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    const mid = paper({ x: layout.title.x, y: layout.title.y + layout.title.h / 2 });
    ctx.textAlign = 'left';
    ctx.fillText(layout.titleText, mid.x + 10, mid.y);
    ctx.textAlign = 'center';
    ctx.fillText(layout.levelName, mid.x + (layout.title.w * fit) / 2, mid.y);
    ctx.textAlign = 'right';
    ctx.fillText(`${layout.scaleLabel}    Sheet 1    ${layout.date}`, mid.x + layout.title.w * fit - 10, mid.y);
    if (layout.schedule) {
      const box = layout.schedule;
      const top = paper({ x: box.x, y: box.y + box.h });
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(top.x, top.y + box.h * fit);
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.font = `${Math.max(9, 0.14 * fit)}px system-ui, sans-serif`;
      ctx.fillText('Openings', top.x + 8, top.y + 0.28 * fit);
      layout.scheduleRows.forEach((row, index) => {
        const y = top.y + (0.62 + index * 0.32) * fit;
        if (y > top.y + box.h * fit - 0.2 * fit) return;
        ctx.fillText(`${row.mark}  ${row.size}  ${row.style}  ${row.count}`, top.x + 8, y);
      });
    }

    const viewTop = paper({ x: layout.viewport.x, y: layout.viewport.y + layout.viewport.h });
    const viewW = layout.viewport.w * fit;
    const viewH = layout.viewport.h * fit;
    ctx.save();
    ctx.beginPath();
    ctx.rect(viewTop.x, viewTop.y, viewW, viewH);
    ctx.clip();
    ctx.translate(viewTop.x, viewTop.y);
    const view = new Viewport();
    view.width = viewW;
    view.height = viewH;
    view.center = layout.center;
    view.scale = fit / layout.modelPerPaper;
    drawDisplayList(ctx, view, items);
    ctx.restore();

    const pointsOf = (band: readonly DisplayItem[]) =>
      band.flatMap((item) =>
        item.prims.flatMap((prim) => {
          if (prim.t === 'line') return [prim.a, prim.b];
          if (prim.t === 'poly') return prim.rings.flat();
          return [];
        }),
      );
    const drawBand = (box: SheetLayout['border'], band: readonly DisplayItem[], label: string) => {
      const top = paper({ x: box.x, y: box.y + box.h });
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(top.x + box.w * fit, top.y);
      ctx.stroke();
      const fitted = fitDrawing(boundsOf(pointsOf(band)), box);
      ctx.save();
      ctx.beginPath();
      ctx.rect(top.x, top.y, box.w * fit, box.h * fit);
      ctx.clip();
      ctx.translate(top.x, top.y);
      const drawing = new Viewport();
      drawing.width = box.w * fit;
      drawing.height = box.h * fit;
      drawing.center = fitted.center;
      drawing.scale = fit / fitted.modelPerPaper;
      drawDisplayList(ctx, drawing, band);
      ctx.restore();
      ctx.fillStyle = '#1f2328';
      ctx.font = `${Math.max(9, 0.14 * fit)}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(`${label}    ${fitted.scaleLabel}`, top.x + 8, top.y + 0.28 * fit);
    };
    if (layout.elevation) drawBand(layout.elevation, elevationItems, 'Front');
    if (layout.section) {
      const edge = paper({ x: layout.section.x, y: layout.section.y });
      const top = paper({ x: layout.section.x, y: layout.section.y + layout.section.h });
      ctx.beginPath();
      ctx.moveTo(edge.x, edge.y);
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
      drawBand(layout.section, sectionItems, 'Section');
    }
  }, [elevationItems, items, layout, sectionItems]);

  const redraw = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const observer = new ResizeObserver(() => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      draw();
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [draw]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => useAppearance.subscribe(() => redraw()), [redraw]);

  return (
    <div className="sheet-view" ref={wrapRef} data-testid="sheet-view" data-scale={layout.scaleLabel} data-schedule={layout.scheduleRows.map((row) => row.mark).join(' ')} data-elevation={layout.elevation ? 'Front' : ''} data-section={layout.section ? 'Section' : ''}>
      <div className="elevation-bar">
        <label className="section-cut">
          Sheet scale
          <select
            aria-label="Sheet scale"
            className="status-select"
            value={doc.settings.sheetScale ?? ''}
            onChange={(event) => {
              const value = event.target.value;
              dispatch('settings.update', { sheetScale: value === '' ? null : Number(value) });
            }}
          >
            <option value="">Auto</option>
            {SHEET_SCALES.map((scale) => (
              <option key={scale.modelPerPaper} value={scale.modelPerPaper}>
                {scale.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <canvas ref={canvasRef} className="sheet-canvas" />
    </div>
  );
}
